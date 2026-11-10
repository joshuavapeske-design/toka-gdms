# TOKA GDMS — Comprehensive Verification & Testing Strategy (Confirmed Rules)

## 1. Testing Philosophy & Frameworks

GDMS enforces a rigorous test suite designed to prevent fraud, protect data integrity, and guarantee operational continuity:
- **Unit & Arithmetic Tests**: Vitest for full/half sheet calculations, FSE derivations, Decimal.js financial operations, and SMS regex parsers.
- **Database & RLS Tests**: Supabase local test harness (`pgTAP`) verifying PostgreSQL triggers, constraints, transformation records, and Row-Level Security policies.
- **Integration & API Tests**: Playwright & Node.js test runner validating Server Actions, idempotent sync endpoints, and two-way SMS webhooks.
- **Simulated Offline Tests**: Playwright browser harness simulating offline IndexedDB storage, device restart, and network reconnects.

---

## 2. Expanded Testing Matrix (15 Complex Scenarios)

| # | Test Scenario | Test Method / Harness | Measurable Pass Condition |
|---|---|---|---|
| **1** | **Half-Sheet Transformation** | Customer orders 1 half sheet when truck only has full sheets. | Database executes atomic procedure: 1 full sheet consumed, 2 half sheets produced, 1 delivered, exactly 1 half sheet remains in truck stock. `stock_transformations` row created. |
| **2** | **Full-Sheet Equivalent (FSE) Math** | Inventory holding 9 full sheets and 1 half sheet. | System derives $\text{FSE} = 9 + (1 \times 0.5) = 9.5\text{ FSE}$. Calculation verified with zero rounding errors. |
| **3** | **Unallocated Collections Isolation** | Recording a KES 20,000 cash collection without specifying an invoice. | Collection logged with `unallocated_amount = 20,000.00`; customer account balance reduces; open delivery invoices are **NOT** arbitrarily altered without explicit `payment_allocations`. |
| **4** | **Concurrent Stock Operations** | Parallel API calls deducting the same warehouse sheet stock simultaneously. | Database transaction locks prevent negative inventory; exactly one transaction succeeds while the second fails with `INSUFFICIENT_STOCK`. |
| **5** | **Concurrent Credit Operations** | Two drivers recording credit deliveries simultaneously to a customer near their credit limit. | Atomic credit account balance check prevents over-extension; the second delivery is blocked or flagged for manager review. |
| **6** | **Idempotency Payload Mismatch** | Submitting the same `client_tx_id` with an altered quantity or price. | Server returns `HTTP 409 Conflict` (`IDEMPOTENCY_MISMATCH`); original record remains unaltered; security alert logged. |
| **7** | **Interrupted Synchronization** | Dropping HTTP connection mid-request during sync, then retrying with identical payload. | Server accepts retried submission without creating duplicate delivery or double-deducting inventory. |
| **8** | **Offline Stale Data** | Syncing an offline delivery where master prices or customer credit limits changed online during the shift. | Quoted price respected within tolerance or flagged for manager sign-off; credit breach transitions delivery to `correction_pending`. |
| **9** | **Unauthorized RPC Calls** | Calling `submit_delivery_atomic` with a forged `created_by` or unassigned vehicle. | Function verifies session JWT (`auth.uid()`) and assignment validity; execution fails with `ACCESS_DENIED`. |
| **10**| **Profile & Role Manipulation** | Salesperson attempting `UPDATE profiles SET role = 'owner'`. | Row-Level Security and database trigger reject the update with `PERMISSION_DENIED`. |
| **11**| **Duplicate & Delayed SMS** | Simulating carrier duplicate webhook retry, followed by a customer reply sent 5 days later. | Duplicate webhook ignored via `UNIQUE (provider_message_id)`; late reply accepted but flagged `is_late_response = true`. |
| **12**| **Multiple Invoices Allocation** | Applying a single KES 50,000 collection across 3 open delivery invoices. | First two invoices transition to `fully_paid`; third invoice updates balance to KES 5,000; customer balance decreases by KES 50,000. |
| **13**| **Device Loss & Logout** | Clearing user session or logging out on shared mobile device. | Active user JWT revoked; cached sensitive customer lists cleared; offline outbox securely quarantined. |
| **14**| **Provider SMS Outage** | Simulating Africa's Talking API timeout during delivery creation. | Outbound SMS queued in `notifications` table (`status = 'queued'`); retry worker attempts delivery with exponential backoff. |
| **15**| **Android GPS Lifecycle** | Backgrounding app on Android, locking screen, driving 5 km, and simulating location permission revocation. | Foreground service persistent notification keeps sampling breadcrumbs; permission revocation triggers instant alert to Manager. |

---

## 3. Mapping of the 22 Master Acceptance Criteria

Each of the 22 Master Acceptance Criteria (mandated in Part 22 of the Master Prompt) is mapped to specific verification tests:

| Criterion # | Master Acceptance Criterion | Verifying Test Suite | Pass Condition |
|---|---|---|---|
| **1** | **Create and manage employees** | `tests/rbac/profiles.test.ts` | Owner can invite, assign roles, activate, and deactivate staff. |
| **2** | **Create and manage customers** | `tests/customers/customers.test.ts` | Customers created with contact numbers, delivery area, credit limit, and default GPS. |
| **3** | **Manage glass products and prices** | `tests/pricing/products.test.ts` | Master products defined with full-sheet & half-sheet standard and customer rates. |
| **4** | **Assign vehicles and routes** | `tests/fleet/assignments.test.ts` | Management creates routes and assigns drivers, salespeople, and trucks per shift. |
| **5** | **Record deliveries** | `tests/deliveries/creation.test.ts` | Field employee can record full/half sheet deliveries linked to active vehicle assignment. |
| **6** | **Calculate glass costs accurately** | `tests/math/glass-calculator.test.ts` | Validates full/half sheet quantities, FSE equivalents, and line totals with zero floating-point error. |
| **7** | **Control special pricing** | `tests/pricing/approvals.test.ts` | Price $< \text{standard}$ requires manager approval; self-approval is blocked by DB constraint. |
| **8** | **Record cash & M-Pesa declarations** | `tests/payments/declarations.test.ts` | Declarations recorded across cash, till, and employee phone; balance math verified. |
| **9** | **Record credit deliveries** | `tests/payments/credit.test.ts` | Credit deliveries validated against credit limit; balance updated on credit account. |
| **10**| **Record subsequent collections** | `tests/payments/collections.test.ts` | Cash collectors log collections; payments allocated to open invoices and balances updated. |
| **11**| **Notify customers** | `tests/notifications/dispatch.test.ts` | Submitting delivery enqueues SMS receipt with reference, items, cash, M-Pesa, and balance. |
| **12**| **Receive YES & NO responses** | `tests/notifications/webhooks.test.ts` | Webhook processes reply '1' to `confirmed` and reply '2' to `disputed`. |
| **13**| **Follow up on disputed deliveries** | `tests/notifications/disputes.test.ts` | System dispatches 1-5 dispute questionnaire; category logged and alert shown to owner. |
| **14**| **Track stock movements** | `tests/inventory/movements.test.ts` | Full/half sheet transformations, dispatches, deliveries, and returns reconcile to zero. |
| **15**| **View employee delivery activity** | `tests/management/activity.test.ts` | Dashboard shows all deliveries, declared funds, and sync states per employee. |
| **16**| **View phone GPS locations** | `tests/gps/telemetry.test.ts` | Dashboard renders device coordinates, capture timestamps, accuracy, and stale warnings. |
| **17**| **View assigned vehicles and routes**| `tests/fleet/monitoring.test.ts` | Real-time map displays active company trucks, assigned routes, and communication age. |
| **18**| **Record transactions offline** | `tests/offline/outbox.test.ts` | Full delivery with items and payments recorded in IndexedDB with network off. |
| **19**| **Synchronize offline data reliably** | `tests/offline/sync-engine.test.ts` | Reconnecting syncs outbox idempotently without duplicate records or lost data. |
| **20**| **Access permanent sales history** | `tests/audit/sales-history.test.ts` | Filterable history shows all submitted deliveries; hard deletion is blocked by triggers. |
| **21**| **Review audit logs** | `tests/audit/audit-logs.test.ts` | Append-only audit trail captures actor, timestamp, IP, and before/after state diffs. |
| **22**| **Enforce role permissions** | `tests/rbac/rls-enforcement.test.ts` | RLS and server actions prevent unauthorized access, self-approval, or cross-route snooping. |
