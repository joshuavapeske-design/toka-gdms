# GDMS — Security, Anti-Fraud & Data Protection Plan (Corrected & Aligned)

## 1. Threat Modeling & Industry-Specific Attack Vectors

| Attack Vector | Field Scenario | GDMS Mitigating Control |
|---|---|---|
| **Under-declaration of Cash** | Employee collects KES 30,000 cash, declares KES 15,000 in app, pockets KES 15,000. | Real-time SMS dispatched directly to customer phone stating declared amount and balance. Customer replies `2` (NO); instant alert sent to Owner. |
| **Personal M-Pesa Diversion** | Employee asks customer to send funds to employee's personal mobile number. | Separate `mpesa_employee_phone` declaration channel. Funds immediately logged as employee liability requiring physical cash turnover or Paybill forwarding at shift end. |
| **Self-Approved Price Discounts** | Driver gives unauthorized cash discount for an informal kickback. | Price approvals strictly require a distinct reviewer (`requested_by != reviewed_by` database constraint). |
| **Silent Historical Deletions** | Manager or staff deletes a transaction after fraud is detected. | Database triggers permanently block `DELETE` on deliveries, items, payments, collections, and audit logs. |
| **Client-Side Parameter Tampering** | Attacker intercepts HTTP payload and modifies calculated line total or area. | Server-side actions recalculate all totals from raw dimensions; mismatch rejects the request with an integrity violation. |
| **Ghost Delivery at Fake Location** | Driver records delivery while diverting stock to an unauthorized buyer. | GPS coordinates stamped at delivery; system checks proximity against customer's registered delivery coordinates. |
| **Role Elevation Exploits** | User tampers with JWT or sends raw REST requests to promote themselves to Owner. | RLS enforces kernel-level checks; initial Owner account created via secure seed; staff accounts created by invite only. |

---

## 2. Technical Security Safeguards

### A. Credential Isolation & Environment Architecture
- `SUPABASE_SERVICE_ROLE_KEY`: Confined strictly to backend Server Actions and secure cron functions. **Never exposed in `NEXT_PUBLIC_` client bundles.**
- Client mobile browsers only receive `NEXT_PUBLIC_SUPABASE_ANON_KEY`, operating under PostgreSQL Row-Level Security (RLS).

### B. Secure Database Functions (`SECURITY DEFINER`)
- All stored procedures (atomic transaction submissions, payment allocations, stock deductions) are defined with explicit schema search paths to eliminate search_path poisoning:
  ```sql
  CREATE OR REPLACE FUNCTION public.submit_delivery_atomic(...)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$ ... $$;
  ```
- Public execution is revoked by default; execution is granted exclusively to specific authenticated roles.

### C. Realistic Immutability Boundaries & Database Triggers
- GDMS does not claim cryptographic immutability against database administrators or infrastructure owners.
- The append-only and anti-tamper guarantee is enforced through PostgreSQL kernel-level triggers:
  1. `protect_delivery_immutability()`: Strictly blocks modification of core financial fields (`total_amount`, `total_declared_paid`, `outstanding_balance`, `customer_id`, `created_by`, `payload_hash`) after creation. Updates are restricted to operational workflow status transitions.
  2. `prevent_immutable_delete()`: Blocks `DELETE` operations on deliveries, delivery items, payment declarations, stock movements, and customer confirmations.
  3. `protect_profile_privileges()`: Ensures non-owners cannot escalate their role or reactivate their account.
  4. `computeCanonicalPayloadHash()`: SHA-256 canonical hashing of delivery payloads enforces strict idempotency, rejecting any resubmission with altered lines or amounts (`IDEMPOTENCY_PAYLOAD_MISMATCH`).

### D. Inbound Webhook Protection & Sender Authentication
- Africa's Talking incoming webhooks validate secret authentication tokens (`AFRICAS_TALKING_WEBHOOK_SECRET`).
- Duplicate carrier webhooks are deduplicated using `provider_message_id` with `UNIQUE` constraints in `inbound_sms_messages`.
- **Sender Phone Verification**: Delivery confirmations and disputes check that the inbound sender phone matches the registered primary or alternate phone for the customer associated with the delivery, rejecting spoofing or unauthorized third-party confirmations.

### E. Account Bootstrapping & Identity Defense
- Public self-registration is disabled.
- The initial `owner` account is provisioned via migration seed or direct Supabase administrative CLI.
- All subsequent user invitations are initiated by the Owner with pre-assigned roles.
- Suspicious activity (e.g. repeated failed logins, location permission revocation mid-shift) triggers automated administrative alerts.
