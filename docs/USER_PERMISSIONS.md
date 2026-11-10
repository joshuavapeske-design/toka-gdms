# GDMS — Role-Based Access Control (RBAC) & Row-Level Security (RLS) Specification

## 1. System Roles & Operational Distinctions

GDMS supports six internal operational roles and one external notification entity:

1. **Owner (`owner`)**: Full business oversight. Master price control, credit policy overrides, user management, audit review, and executive reporting.
2. **Manager (`manager`)**: Operational management. Customer creation, vehicle and route scheduling, discount and credit approval within pre-configured limits, and dispute review.
3. **Salesperson (`salesperson`)**: Customer interaction in the field. Enters dimensional glass cuts, submits price approval requests, declares payment amounts, and views transactions for assigned routes.
4. **Driver (`driver`)**: Vehicle operation, cargo inspection, physical delivery handover, and location capture. *On smaller distribution runs, one user may be granted both driver and salesperson operational permissions, but the system preserves distinct role definitions.*
5. **Cash Collector (`cash_collector`)**: Dedicated credit and debt collection. Collects cash and M-Pesa, logs collection entries, and allocates payments against outstanding invoices. Cannot create deliveries or alter prices.
6. **Accountant (`accountant`)**: Financial reconciliation. Verifies bank deposits, Paybill statements, employee personal M-Pesa turnover, and generates balance sheets. Read-only on delivery specifications.
7. **Customer**: External recipient. Interacts strictly via Two-Way SMS (and optional WhatsApp receipts) to confirm or dispute deliveries.

---

## 2. Comprehensive Table-by-Table Permission Matrix

| Database Table | Owner | Manager | Salesperson | Driver | Cash Collector | Accountant | Customer (SMS) |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **`profiles`** | S, I, U | S (Team) | S (Self) | S (Self) | S (Self) | S (All) | None |
| **`customers`** | S, I, U | S, I, U | S (Assigned) | S (Assigned) | S (Assigned) | S (All) | None |
| **`customer_contacts`** | S, I, U | S, I, U | S, I | S | S | S | None |
| **`customer_prices`** | S, I, U | S, I, U | S | S | None | S | None |
| **`products` & `categories`** | S, I, U | S, I, U | S | S | S | S | None |
| **`price_approval_requests`** | S, U | S, U | S (Self), I | S (Self), I | None | S | None |
| **`credit_accounts`** | S, I, U | S, U (Limits) | S (Read-Only) | None | S (Assigned) | S, U | None |
| **`vehicles` & `routes`** | S, I, U | S, I, U | S (Assigned) | S (Assigned) | None | S | None |
| **`vehicle_assignments`** | S, I, U | S, I, U | S (Assigned) | S (Assigned) | None | S | None |
| **`deliveries`** | S, U (Status) | S, U (Status) | S (Assigned), I | S (Assigned), I | S (Assigned) | S (All) | None |
| **`delivery_items`** | S | S | S (Assigned), I | S (Assigned), I | None | S | None |
| **`payment_declarations`** | S | S | S (Self), I | S (Self), I | None | S | None |
| **`collections`** | S, U (Recon) | S | None | None | S (Self), I | S, U (Recon) | None |
| **`payment_allocations`** | S | S | None | None | S, I | S, I | None |
| **`payment_reversals`** | S, U (Approve)| S (View) | None | None | None | S, I (Request) | None |
| **`employee_turnovers`** | S, U (Approve)| S (View) | S (Self) | S (Self) | S (Self) | S, I, U (Settle) | None |
| **`stock_locations`** | S, I, U | S, I, U | S | S | None | S | None |
| **`stock_movements`** | S, I, U | S, I, U | S (Assigned), I | S (Assigned), I | None | S | None |
| **`location_samples`** | S | S | I (Phone GPS) | I (Phone GPS) | None | None | None |
| **`notifications`** | S | S | None | None | None | None | None |
| **`inbound_sms_messages`** | S | S | None | None | None | None | **I (Via Webhook)** |
| **`customer_confirmations`**| S | S | S (Assigned) | S (Assigned) | None | S | None |
| **`customer_disputes`** | S, U (Resolve)| S, U (Investigate)| S (Assigned) | S (Assigned) | None | S | None |
| **`transaction_corrections`**| S, U (Approve)| S, U (Approve)| None | None | None | S, I (Request) | None |
| **`audit_logs`** | S | S (Operational) | None | None | None | S (Financial) | None |

*Legend: S = SELECT, I = INSERT, U = UPDATE. **DELETE is permanently prohibited across all roles on transactional, financial, and audit tables.***

---

## 3. Row-Level Security (RLS) Implementation Strategy

### A. Role Helper Functions
```sql
-- Secure helper to extract active user role
CREATE OR REPLACE FUNCTION auth.get_user_role()
RETURNS user_role_enum 
LANGUAGE sql 
STABLE 
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid() AND is_active = true;
$$;
```

### B. Core RLS Policies

#### 1. Deliveries Policy
```sql
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;

-- SELECT Policy
CREATE POLICY "deliveries_select_policy" ON deliveries
FOR SELECT USING (
    auth.get_user_role() IN ('owner', 'manager', 'accountant')
    OR (
        auth.get_user_role() IN ('salesperson', 'driver')
        AND (
            created_by = auth.uid()
            OR vehicle_assignment_id IN (
                SELECT id FROM vehicle_assignments 
                WHERE (salesperson_id = auth.uid() OR driver_id = auth.uid())
            )
        )
    )
    OR (
        auth.get_user_role() = 'cash_collector'
        AND customer_id IN (
            SELECT customer_id FROM collections WHERE collected_by = auth.uid()
        )
    )
);

-- INSERT Policy
CREATE POLICY "deliveries_insert_policy" ON deliveries
FOR INSERT WITH CHECK (
    auth.get_user_role() IN ('owner', 'manager', 'salesperson', 'driver')
    AND created_by = auth.uid()
);

-- UPDATE Policy (Restricted to specific lifecycle operations via RPC)
CREATE POLICY "deliveries_update_policy" ON deliveries
FOR UPDATE USING (
    auth.get_user_role() IN ('owner', 'manager')
);

-- DELETE Policy (Blocked for all authenticated roles)
CREATE POLICY "deliveries_delete_block" ON deliveries
FOR DELETE USING (false);
```

#### 2. Price Approval Requests Policy
```sql
ALTER TABLE price_approval_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "price_approvals_select" ON price_approval_requests
FOR SELECT USING (
    auth.get_user_role() IN ('owner', 'manager', 'accountant')
    OR requested_by = auth.uid()
);

CREATE POLICY "price_approvals_insert" ON price_approval_requests
FOR INSERT WITH CHECK (
    auth.get_user_role() IN ('salesperson', 'driver', 'manager')
    AND requested_by = auth.uid()
);

CREATE POLICY "price_approvals_update" ON price_approval_requests
FOR UPDATE USING (
    auth.get_user_role() IN ('owner', 'manager')
    AND requested_by != auth.uid() -- Strict self-approval block
);
```

---

## 4. Server-Side Authorization Invariants

1. **Session-Derived User Context**: No Server Action or API endpoint accepts a `userId` parameter in the client request body. The active user ID is extracted strictly from the validated Supabase session token (`auth.uid()`).
2. **Server-Side Recalculation**: All line totals, areas, discounts, and payment balances submitted from the frontend are recalculated on the server. If a submitted line total differs from the server's calculation by even KES 0.01, the transaction is rejected with an integrity violation error.
3. **Approval Identity Guard**: When a manager approves a price discount or credit extension, the server-side action stamps the approver's authenticated user ID. A requester cannot approve their own submission under any circumstances.

---

## 5. Secure Initial Owner Bootstrapping & Registration Security

- **Public Registration Disabled**: Public users cannot create accounts with elevated roles or assign themselves permissions.
- **Invite-Only / Seed Bootstrapping**:
  - The initial `owner` account is created via Supabase database migration seed scripts or an environment-gated CLI command using the Supabase Service Role Key.
  - Subsequent staff accounts are created exclusively by the `owner` or authorized `manager` through the administrative management interface.
  - New user sign-ups default to disabled status (`is_active = false`) and require explicit Owner authorization before gaining system access.
