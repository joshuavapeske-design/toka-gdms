# TOKA GDMS — Current Verification Plan

## 1. Automated checks actually wired into the repository

The current `package.json` defines these scripts:

| Command | What it runs |
|---|---|
| `corepack pnpm test` | Node's TypeScript-strip runner executes `src/tests/business-rules.test.ts`, `src/tests/financial-integrity.test.ts`, and `src/tests/database-integrity.test.ts` in sequence. |
| `corepack pnpm run typecheck` | `tsc --noEmit` against the project TypeScript configuration. |
| `corepack pnpm run build` | Next.js production build. |

The database suite uses **PGlite**, a PostgreSQL-compatible WASM test engine. It applies the repository migrations—including fleet, stock-movement and Nairobi business-date hardening—and exercises database functions, constraints, grants and selected policy/role behavior.

The current project scripts do **not** run Vitest, pgTAP, Playwright, Android instrumentation, or a real Supabase integration suite. Do not describe those as completed automated checks unless they are added and executed.

## 2. Fresh verification procedure

Run these commands from the repository root on `fix/pre-supabase-security-hardening`:

```powershell
git status --short
git branch --show-current
git pull --ff-only origin fix/pre-supabase-security-hardening

corepack pnpm --version
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm run typecheck
corepack pnpm run build
```

Expected package-manager version: `9.15.9`.

Save the complete output for all three checks. Do not merge if a command fails. Do not suppress failures, skip a suite, remove a database assertion, or weaken an authorization rule merely to obtain a green result.

## 3. What the PGlite database suite does and does not prove

The PGlite suite is valuable for applying SQL to a PostgreSQL-compatible engine and checking function logic, constraints, function grants and policy definitions. It is not a replacement for a fresh Supabase staging project.

A separate staging test must still verify:
- Supabase Auth sessions and profile lookups.
- Actual PostgREST access using owner, manager, salesperson, driver, cash_collector and accountant accounts.
- RLS behavior against rows belonging to other employees.
- Migration compatibility with the selected hosted Supabase project.
- Atomic stock and delivery transactions under real concurrent requests.
- Authenticated webhook processing and provider behavior.
- Offline synchronization and conflict handling in an actual browser.

## 4. Online staging test matrix

| # | Scenario | Required pass condition |
|---|---|---|
| 1 | Owner sign-in | Owner Auth account maps to an active `profiles` row and reaches the app. |
| 2 | Role restrictions | Non-management users cannot access fleet administration or receive/dispatch stock. |
| 3 | Customer creation | Owner/manager can create a customer; duplicate account number is rejected. |
| 4 | Fleet setup | Owner/manager creates a vehicle/route/driver/salesperson shift; vehicle and crew conflicts are rejected. |
| 5 | Shift closure | Manager closes a shift; a later non-overlapping shift may be assigned. |
| 6 | Warehouse receipt | Owner/manager records full and half sheets at a warehouse and the stock ledger/balance agree. |
| 7 | Vehicle dispatch | Owner/manager transfers stock from warehouse to a truck; insufficient stock is rejected. |
| 8 | Full-sheet delivery | Delivery uses the assigned vehicle location and writes one atomic invoice/stock transaction. |
| 9 | Half-sheet delivery | Splitting one full sheet produces two halves; one delivered leaves one half; FSE is conserved. |
| 10 | Credit delivery | Credit must be explicit, customer eligibility and limit are enforced, and credit is not counted as cash received. |
| 11 | Collection and allocation | Collection is recorded separately; only explicit allocation changes the intended invoice balance. |
| 12 | Delivery ledger | Persisted server deliveries appear in the ledger; browser-only items remain separately labelled. |
| 13 | Offline replay | Same payload/UUID is idempotent; changed payload is rejected; stale records remain in needs-review. |
| 14 | SMS webhook | Invalid secret and missing provider message ID are rejected; valid replies are deduplicated and mapped to the intended delivery. |
| 15 | Demo labeling | Simulated/local-only operations are never displayed as records written to the shared business database. |

Use test data only. Keep real SMS disabled for the first staging pass.

## 5. Known workflows not yet covered end-to-end

The current staging build does not yet provide complete user-facing workflows for:
- Employee invitation and profile administration.
- Special-price and discount approval requests/reviews.
- Employee turnover settlement.
- Payment reversals and refunds.
- Stock returns, damaged glass, and authorized stock adjustments.
- Audit-log review and GPS fleet monitoring.
- Scheduled outbound notification dispatch.

These are not accepted as complete just because a table or database procedure exists. Track them separately in the implementation plan before calling the full system production-ready.

## 6. Release gate

A Vercel Preview may be shared for controlled testing only when:
1. All three automated commands pass on the current branch head.
2. All migrations apply to a fresh isolated Supabase staging database.
3. Owner, manager, salesperson, driver and cash_collector role access is verified against staging data.
4. The staging scenarios relevant to the preview pass without data-integrity or authorization errors.
5. The Preview uses `GDMS_DEMO_MODE=false` and only test data/secrets.

A passing build is necessary, not sufficient. A Vercel Preview is not production approval.
