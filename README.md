# TOKA Glass Distribution Management System (GDMS)

> **Enterprise-grade distribution, fleet, inventory, credit, and anti-fraud management system for commercial glass distribution.**

---

## 1. Executive Summary & Core Business Model

TOKA GDMS is a lightweight, mobile-first management system built to operate a fast-moving glass distribution fleet with complete operational accountability:

### Confirmed Glass Sales Model
- **Full Sheets are sold by default.**
- **Half Sheets are sold ONLY when specifically ordered by a customer.**
- **Half-Sheet Transformation**: Producing a half sheet splits 1 physical full sheet into 2 physical halves. When 1 half is delivered, the remaining half **must remain accounted for in physical stock**. It is never classified as scrap or discarded.
- **Full-Sheet Equivalent (FSE)**: $\text{FSE} = \text{Full Sheets} + (\text{Half Sheets} \times 0.5)$.

### Core Operational Principles
1. **EVERY DELIVERY MUST BE ACCOUNTED FOR.**
2. **EVERY PAYMENT MUST BE DECLARED.**
3. **EVERY CUSTOMER MUST BE NOTIFIED INDEPENDENTLY.**
4. **EVERY DISCREPANCY MUST BE VISIBLE.**
5. **EVERY SUBMITTED TRANSACTION MUST REMAIN IN THE PERMANENT BUSINESS HISTORY.**

---

## 2. Technical Stack

| Layer | Selected Technology | Operational Rationale |
|---|---|---|
| **Frontend Framework** | **Next.js 15+ (App Router, React 19, TypeScript Strict)** | High performance, server components for secure views, native mobile-responsive layouts. |
| **Styling & UI** | **Tailwind CSS v4 + Lucide React** | Utility-first, zero-runtime overhead, ergonomic mobile UI with high-contrast data density. |
| **Backend & Database** | **Supabase (Managed PostgreSQL 15+)** | Industrial-grade ACID transactions, Row-Level Security (RLS), atomic RPCs, Realtime subscriptions. |
| **Offline Storage** | **IndexedDB (via idb / Dexie)** | Resilient local storage for offline delivery creation, transaction queues, and asset caching. |
| **Mobile Runtime** | **PWA + Capacitor Android Shell** | PWA for low-friction access; Capacitor plugin for reliable foreground/background GPS tracking on Android. |
| **Notifications** | **Africa's Talking (Two-Way SMS) & WhatsApp Cloud API** | Direct customer verification loop bypassing employee phones; independent audit channel. |
| **Hosting & CI/CD** | **Vercel + Supabase Cloud** | Global edge network, automated branch previews, managed automated PostgreSQL backups. |

---

## 3. Project Documentation Directory

- [`DELIVERY_STATUS.md`](DELIVERY_STATUS.md) — Master implementation verification tracker and milestone checklist.
- [`docs/PRODUCT_SCOPE.md`](docs/PRODUCT_SCOPE.md) — Product requirements, full/half sheet sales rules, FSE inventory formulas, mixed-payment worked examples, employee turnover, and credit accounting.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Modular monolithic architecture, system diagrams, boundary contexts, and data flow.
- [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md) — PostgreSQL DDL, tables, constraints, trigger locks, `ON DELETE RESTRICT` cascade protection, and append-only immutability.
- [`docs/USER_PERMISSIONS.md`](docs/USER_PERMISSIONS.md) — Table-by-table RBAC matrix, RLS policy definitions, and server-side authorization boundaries.
- [`docs/BUSINESS_WORKFLOWS.md`](docs/BUSINESS_WORKFLOWS.md) — State machines for full/half sheet sales, price approvals, dispute lifecycle, employee turnover settlement, and debt collections.
- [`docs/OFFLINE_SYNC.md`](docs/OFFLINE_SYNC.md) — Unified offline data models, client UUID idempotency (`client_tx_id`), conflict resolution (payload mismatch 409), stale data rules, and sync state indicators.
- [`docs/GPS_TRACKING.md`](docs/GPS_TRACKING.md) — Three distinct location collection mechanisms (delivery stamp, Capacitor foreground tracking, vehicle tracker boundary), timestamp preservation, and stale location indicators.
- [`docs/NOTIFICATIONS.md`](docs/NOTIFICATIONS.md) — Complete two-way SMS state machine, `inbound_sms_messages` persistent event model, multi-delivery disambiguation, and dispute questionnaires.
- [`docs/SECURITY.md`](docs/SECURITY.md) — Threat models, anti-fraud defenses, tamper-proofing, realistic immutability boundaries, and credential isolation.
- [`docs/TESTING.md`](docs/TESTING.md) — Expanded 15-scenario verification matrix, automated test frameworks, and complete mapping of all 22 Master Acceptance Criteria.
- [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) — Roadmap with anti-retrofit offline foundations, phased priorities, and testable Definition of Done criteria.
