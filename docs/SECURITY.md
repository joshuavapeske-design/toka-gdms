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

### C. Realistic Immutability Boundaries
- GDMS does not claim cryptographic immutability against database administrators or infrastructure owners.
- The append-only guarantee is enforced against:
  - All application users (Owner, Manager, Salesperson, Driver, Cash Collector, Accountant).
  - External API consumers via Row-Level Security policies and PostgreSQL triggers.
  - Database-level automated daily point-in-time recovery (PITR) backups prevent unauthorized administrative truncation.

### D. Inbound Webhook Protection & Idempotency
- Africa's Talking incoming webhooks validate secret authentication tokens and signature headers.
- Duplicate carrier deliveries are deduplicated using `provider_message_id` with `UNIQUE` constraints in `inbound_sms_messages`.

### E. Account Bootstrapping & Identity Defense
- Public self-registration is disabled.
- The initial `owner` account is provisioned via migration seed or direct Supabase administrative CLI.
- All subsequent user invitations are initiated by the Owner with pre-assigned roles.
- Suspicious activity (e.g. repeated failed logins, location permission revocation mid-shift) triggers automated administrative alerts.
