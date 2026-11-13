# TOKA GDMS — Current Branch Readiness Tracker

**Last reviewed:** 13 November 2026  
**Repository:** `joshuavapeske-design/toka-gdms`  
**Current implementation branch:** `fix/pre-supabase-security-hardening`  
**Protected baseline:** `main` (must remain unchanged until the implementation branch is verified)  
**Pull request:** [#1 — Security hardening before Supabase staging](https://github.com/joshuavapeske-design/toka-gdms/pull/1)

> **Release status: NOT YET VERIFIED — DO NOT MERGE OR DEPLOY TO PRODUCTION.**  
> The improvements below have been committed to the implementation branch, but the latest branch has not yet completed a fresh `pnpm test`, TypeScript check, production build, and isolated Supabase staging test. Previous test results apply to an earlier commit and are not proof that this branch currently passes.

## 1. Current implementation inventory

| Area | Current state | Verification still required |
|---|---|---|
| Next.js 15 / React 19 / TypeScript / Tailwind | Implemented | Fresh typecheck and production build |
| Supabase Auth and six employee roles | Implemented | Fresh staging users, actual sign-in and role tests |
| Database schema and atomic delivery RPC | Implemented | Apply all migrations to a new Supabase staging database |
| Database security hardening | Additional RLS, trigger and function-grant hardening committed | Execute database tests and verify as real Supabase roles |
| Customer directory and creation | Owner/manager API and UI implemented | Create and read customers in staging |
| Fleet and shift setup | Owner/manager UI and atomic RPC added | Create, close and reassign shifts in staging |
| Warehouse receiving and vehicle dispatch | Owner/manager UI and database-enforced role/location checks added | Apply fifth migration and verify physical movement ledger/balances in staging |
| Delivery capture and stock deduction | Implemented | Test full/half sheets, credit, payments and transaction persistence |
| Delivery ledger and dashboard | Connected to database APIs; local outbox shown separately | Verify actual server records and totals |
| Collections and invoice allocation | API/UI implemented; Nairobi business date applied to financial RPCs | Verify partial and multi-invoice allocation and turnover dates against staging data |
| Disputes | SMS state machine and management UI implemented | Test with authenticated webhook and staging records |
| Offline outbox | IndexedDB status states distinguish pending, needs-review and browser-only records | Browser offline/reconnect and stale-record acceptance tests |
| Outbound SMS | Provider integration and protected dispatcher endpoint implemented | Provider credentials and explicit staging delivery test required |
| Dashboard stock alerts | Not available; no thresholds configured | Must not be represented as active |
| Special price and discount approvals | Database controls exist; complete request/review UI is not implemented | Not available for end-to-end user testing |
| Employee onboarding/profile administration | No in-app management UI | Staging users must be created manually in Supabase Auth and `profiles` |
| Employee turnover settlement | Not complete end-to-end | Not available for acceptance testing |
| Payment reversals/refunds | Database table/invariants exist; complete API/UI workflow is missing | Not available for acceptance testing |
| Stock returns, damage and authorized adjustments | Movement types exist; complete UI/API workflow is missing | Not available for acceptance testing |
| Audit-log viewer and GPS fleet monitoring | Not complete end-to-end | Not available for acceptance testing |
| Automatic notification scheduling | Dispatcher endpoint exists; scheduled worker is not configured | Manual/protected invocation only after explicit SMS setup |

## 2. Current automated verification status

The package scripts currently run:

- `corepack pnpm test` — business rules, financial integrity and PGlite migration/database tests.
- `corepack pnpm run typecheck` — TypeScript compiler.
- `corepack pnpm run build` — Next.js production build.

**Latest branch verification: pending.** The previous user-provided test report showed failures in the business-rule test, migration test, TypeScript check and build. Fixes for those reported failures have since been committed, and additional tests were added for RLS metadata and fleet setup. Those changes have not yet been rerun locally.

GitHub Actions is currently unavailable because the repository account's Actions billing is locked. Recent runs ended in `startup_failure` before jobs started; this is not a passing CI result and is not evidence of a code failure. Run the checks in Antigravity.

## 3. Branch protection and release rules

1. Keep `main` unchanged while the implementation branch is being tested.
2. Make and verify fixes on `fix/pre-supabase-security-hardening`.
3. Use a separate Supabase project and Vercel Preview environment for online testing.
4. Do not connect production credentials, real customer data or live payment/SMS infrastructure during initial staging.
5. Do not merge PR #1 until the tests and staging gate in [Staging Deployment](docs/STAGING_DEPLOYMENT.md) pass.

## 4. Required next verification

See [docs/STAGING_DEPLOYMENT.md](docs/STAGING_DEPLOYMENT.md) for the migration order, first-owner bootstrap, Preview environment variables, staging workflow and deployment gate.

**A local successful build is necessary but not sufficient.** RLS, Supabase Auth, transaction locks, provider webhooks, offline synchronization and online stock operations must also be verified against the isolated staging project.
