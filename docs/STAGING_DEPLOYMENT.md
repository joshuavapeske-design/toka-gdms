# TOKA GDMS — Safe Online Staging Setup

This guide is for a **separate test environment**, not the live business system.

## Important status

The development branch is `fix/pre-supabase-security-hardening`. It must be tested before it is merged or deployed to production.

The current implementation supports the core staging path:
- Supabase sign-in and role-based access.
- Owner/manager customer creation.
- Owner/manager vehicle and daily crew assignment.
- Warehouse stock receipt and warehouse-to-vehicle dispatch.
- Delivery creation and server-side inventory/financial validation.
- Delivery ledger, dashboard, collections and allocations.
- Browser offline outbox with separate pending, needs-review and browser-only states.

The following are **not complete end-to-end features yet**:
- Employee invitation/profile management UI (staging employees must be created manually in Supabase Auth and `profiles`).
- Special-price and discount request/review UI.
- Employee turnover settlement and payment reversal workflows.
- Stock returns, damage recording and authorized stock adjustments.
- Audit-log viewer and GPS fleet-monitoring dashboard.
- Automatic scheduling of the outbound notification worker.
- Live Africa's Talking SMS delivery (requires provider credentials and configuration).

Do not treat this build as production-ready or as a complete implementation of all 22 acceptance criteria.

## 1. Create a dedicated Supabase staging project

Create a new Supabase project specifically for TOKA testing. Do not reuse a production project and do not import real customer, employee, stock or financial data.

In the Supabase SQL Editor, apply these migrations **in this order**, once each:

1. `supabase/migrations/20261109000000_initial_schema.sql`
2. `supabase/migrations/20261110000000_rls_policies_and_atomic_rpc.sql`
3. `supabase/migrations/20261110190000_pre_supabase_security_hardening.sql`
4. `supabase/migrations/20261113170000_fleet_shift_management.sql`
5. `supabase/migrations/20261113173000_stock_movement_security.sql`
6. `supabase/migrations/20261113180000_nairobi_business_day.sql`

Stop if any migration reports an error. Do not continue with a partially migrated database. Do not remove or weaken a failing constraint or RLS policy just to make the migration run.

After the migrations, verify that the product catalogue and a warehouse stock location exist before loading sample stock.

## 2. Bootstrap the first owner and test employees

There is no employee invitation/profile-management screen yet. Create test users manually in Supabase **Authentication → Users**. Create/confirm an Auth user for the owner, then copy that user's UUID.

In the SQL Editor, insert the matching profile. Replace the example UUID, name and phone with the test user's values:

```sql
INSERT INTO public.profiles (id, full_name, phone_number, role, is_active)
VALUES (
  'REPLACE-WITH-AUTH-USER-UUID',
  'TOKA Staging Owner',
  '+254700000001',
  'owner',
  true
);
```

Create additional Auth users and matching profiles for:
- One `manager` (optional if the owner will administer all tests).
- At least one `driver`.
- At least one `salesperson`.
- Optionally one `cash_collector` and one `accountant`.

Use unique E.164 phone numbers for each profile. Do not give the same person multiple accounts just to bypass role checks. Driver and salesperson assignments require two different active users with the corresponding roles.

The application currently does not provision Auth users or manage employee profiles. Keep the UUIDs and test credentials in a secure local password manager; never commit them to the repository.

## 3. Configure a Vercel Preview deployment

Connect the GitHub repository to Vercel if it is not already connected. Select `fix/pre-supabase-security-hardening` as the **Preview** branch. Do not merge it into `main` and do not configure this test as a Production deployment.

Set these environment variables for the **Preview environment only**:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL of the dedicated staging project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Staging project's publishable/anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Staging project's service-role key (server-side only) |
| `GDMS_DEMO_MODE` | `false` |
| `NEXT_PUBLIC_APP_URL` | The Vercel Preview URL |
| `AFRICAS_TALKING_WEBHOOK_SECRET` | A unique random secret of at least 32 characters |
| `TOKA_NOTIFICATION_WORKER_SECRET` | A separate unique random secret of at least 32 characters |

Do not create a `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` variable. The service-role key must never be exposed to browser code.

Leave `AFRICAS_TALKING_USERNAME`, `AFRICAS_TALKING_API_KEY` and `AFRICAS_TALKING_SENDER_ID` unset until the staging SMS provider is deliberately configured. Do not use real SMS credits or a real sender ID for the first staging pass.

Redeploy the Preview after saving the variables. Confirm that `GDMS_DEMO_MODE=false` is in the Preview environment: demo mode must never be enabled in a deployed environment.

## 4. First staging test sequence

Sign in with the staging owner account and use test data only.

1. Open **Customers** and create a sample customer with a test phone number.
2. Open **Fleet & Shifts**, create a test vehicle/route, and assign the test driver and salesperson.
3. Open **Inventory**, receive a small sample quantity of full sheets into the warehouse.
4. Dispatch a test quantity from that warehouse to the vehicle.
5. Create a delivery against the assigned truck using a sample customer. Test full-sheet sales first, then an explicitly ordered half-sheet.
6. Confirm that the physical full/half counts and FSE change correctly.
7. Open **Deliveries** and confirm that the server-persisted delivery is present.
8. Record a test customer collection and allocate only the intended amount to a test invoice.
9. Sign out and test role restrictions using separate driver, salesperson and cash-collector accounts.

Treat all "declared received" amounts as staff declarations, not independently verified M-Pesa or bank receipts.

## 5. Stop conditions

Stop testing and report the error; do not work around it by disabling safeguards, if any of the following occurs:
- A migration fails.
- A user can read records outside their role.
- A salesperson/driver can create or close a fleet shift.
- A stock movement allows negative stock or an unexplained balance change.
- A half-sheet transaction does not conserve FSE.
- A delivery appears as synchronized in the browser but is absent from Supabase.
- A simulated or failed SMS/collection is shown as a real completed transaction.
- A financial amount, collection allocation or customer balance is inconsistent.

## 6. Deployment gate

A Preview deployment is suitable for wider testing only after all of the following are true:

- Antigravity reports `corepack pnpm test` passed on the current branch.
- Antigravity reports `corepack pnpm run typecheck` passed.
- Antigravity reports `corepack pnpm run build` passed.
- All four migrations apply cleanly to a fresh staging project.
- Owner, manager, driver, salesperson and collector role tests pass against the staging database.
- The first staging test sequence above has been completed without data-integrity or authorization errors.

A passing local build alone does not prove Supabase RLS, webhook authentication, real provider SMS or production readiness.
