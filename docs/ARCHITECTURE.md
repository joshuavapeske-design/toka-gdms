# GDMS — System Architecture Proposal (Corrected & Aligned)

## 1. Architectural Philosophy: The Modular Monolith

GDMS is architected as a **Modular Monolith** built on Next.js 15+ (App Router) and Supabase (PostgreSQL 15+).

### Operational Rationale for Modular Monolith over Microservices
1. **ACID Transaction Guarantees**: In glass distribution, creating a delivery, deducting truck inventory, updating customer credit balances, and declaring payment breakdowns must execute within single, atomic database transactions. Distributed transactions across microservices introduce split-brain risks, partial failures, and data discrepancies—the exact failure modes this system exists to eliminate.
2. **Operational Simplicity**: A commercial glass distribution enterprise requires high reliability with minimal operational overhead. A modular monolith avoids Kubernetes cluster complexity, service-to-service authentication overhead, and distributed tracing costs.
3. **Domain Cohesion with Next.js**: Next.js App Router isolates domain modules (`/modules/deliveries`, `/modules/inventory`, `/modules/payments`, `/modules/fleet`) while sharing strict TypeScript types and atomic database functions.

---

## 2. High-Level Architecture Diagram

```mermaid
graph TB
    subgraph Client Tier - Field & Management
        PWA["Next.js Responsive PWA<br/>Mobile Field App (Driver/Sales)"]
        CAP["Capacitor Native Android Shell<br/>Foreground GPS Service"]
        IDB[("IndexedDB Local Storage<br/>Offline Outbox & Cached Catalog")]
    end

    subgraph Edge & Compute Tier - Vercel
        RSC["Next.js Server Components<br/>Secure Management Views"]
        ACTIONS["Next.js Server Actions<br/>Deliveries, Approvals, Payments"]
        SYNC_API["/api/sync/deliveries<br/>Idempotent Batch Processor"]
        WH_SMS["/api/webhooks/sms<br/>Africa's Talking Webhook Handler"]
        WH_GPS["/api/telemetry/vehicle<br/>Vehicle Tracker Gateway"]
    end

    subgraph Persistence & Security Tier - Supabase
        S_AUTH["Supabase Auth<br/>JWT & Session Management"]
        S_RLS["Row Level Security (RLS)<br/>Role & Route Access Engine"]
        S_RPC["PostgreSQL 15+ Stored Functions<br/>Atomic ACID Business Procedures"]
        S_PG[("PostgreSQL Database<br/>Append-Only Transaction Store")]
        S_RT["Supabase Realtime<br/>Manager Live Feeds"]
    end

    subgraph External Notification Services
        AT["Africa's Talking API<br/>Two-Way SMS Gateway"]
        WA["WhatsApp Cloud API<br/>Digital Invoice Cards"]
    end

    subgraph Hardware Integration Boundary
        TRACKER_GW["Vehicle GPS Hardware<br/>Traccar / NMEA Webhook Ingestion"]
    end

    %% Client Layer Connections
    PWA <--> IDB
    CAP <--> IDB
    PWA -->|HTTPS / RSC| RSC
    PWA -->|Server Actions| ACTIONS
    CAP -->|Periodic GPS Telemetry| SYNC_API
    IDB -->|Batch Reconnect Sync| SYNC_API

    %% Edge to Database
    RSC --> S_PG
    ACTIONS --> S_RPC
    SYNC_API --> S_RPC
    WH_SMS --> S_RPC
    WH_GPS --> S_PG
    S_RPC --- S_RLS
    S_RPC --- S_PG
    S_AUTH --- S_RLS
    S_RT -.->|Websocket Live Updates| PWA

    %% Edge to External Gateways
    ACTIONS -->|Outbound SMS Receipts| AT
    ACTIONS -->|Outbound WA Receipts| WA
    AT -->|Inbound Customer Replies| WH_SMS
    TRACKER_GW -->|Hardware Telemetry| WH_GPS
```

---

## 3. Layer Breakdown & Implementation Strategy

### A. Presentation & Application Layer (Next.js App Router)
- **Server Components (`RSC`)**: Used for all management, owner, and accountant views. Renders financial data securely on the server without leaking sensitive business logic or master price calculation algorithms to the browser.
- **Client Components (`"use client"`)**: Used for the field delivery workflow, interactive glass dimension calculators, and local offline forms.
- **Server Actions & Route Handlers**: Sensitive business logic (price approvals, delivery submissions, payment declarations, debt collections) executes exclusively on the server with Zod schema validation and session-based authorization checks.

### B. Mobile Runtime & GPS Execution Strategy
- **Tier 1 (Universal PWA Mode)**: Standard web application accessible via mobile Chrome/Safari with service worker caching for offline assets. Captures high-accuracy point-in-time GPS fixes at delivery submission.
- **Tier 2 (Capacitor Android Native Shell)**: For active shift tracking, the PWA is hosted inside an Android APK wrapper with a persistent foreground service (`FOREGROUND_SERVICE_LOCATION`), displaying a non-dismissible notification to sample breadcrumbs reliably every 3–5 minutes.
- **Tier 3 (Vehicle Tracker Boundary)**: Dedicated hardware GPS units wired to truck batteries ingest data via `/api/telemetry/vehicle` directly into `location_samples` (`source = 'vehicle_tracker'`).

### C. Data Persistence & Security (Supabase PostgreSQL 15+)
- **Row-Level Security (RLS)**: Enforces access control at the database kernel level. Unauthorized queries across routes or roles are rejected by the database engine.
- **Atomic Stored Procedures (`SECURITY DEFINER`)**: Critical multi-table operations (e.g. deducting truck inventory + generating delivery record + creating payment declarations + scheduling SMS) execute inside single atomic PL/pgSQL procedures with explicit schema search paths (`SET search_path = public, pg_temp;`).
- **Append-Only Immutability**: PostgreSQL `BEFORE DELETE` triggers prevent deletion of submitted deliveries, items, payments, collections, and audit logs.

### D. External Telephony Gateway (Africa's Talking)
- **Primary Two-Way SMS Engine**: Sends automated delivery receipts with reference codes (e.g. `GD-00125`) and captures inbound customer replies (`1` for YES, `2` for NO, `1-5` for disputes).
- **Persistent Inbound Event Model**: Inbound SMS webhooks write raw payloads to `inbound_sms_messages` with `provider_message_id` deduplication before processing business logic.
