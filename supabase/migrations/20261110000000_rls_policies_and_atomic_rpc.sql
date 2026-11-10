-- ============================================================================
-- TOKA GDMS — ROW-LEVEL SECURITY, AUDIT CONTROLS & ATOMIC BUSINESS RPCS
-- Migration: 20261110000000_rls_policies_and_atomic_rpc.sql
-- ============================================================================

-- Ensure standard Supabase roles exist
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 1. SCHEMA ENHANCEMENTS FOR BUSINESS INTEGRITY & CONCURRENCY
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS payload_hash TEXT NOT NULL DEFAULT '';

-- Effective-dated customer prices support (allows multiple historical price versions)
ALTER TABLE customer_prices DROP CONSTRAINT IF EXISTS customer_prices_customer_id_product_id_selling_unit_key;
ALTER TABLE customer_prices ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS idx_customer_prices_lookup 
ON customer_prices(customer_id, product_id, selling_unit, valid_from, valid_to);

-- Lockable inventory balances with check constraints (prevents negative stock at kernel level)
CREATE TABLE IF NOT EXISTS inventory_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    stock_location_id UUID NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
    full_sheets INT NOT NULL DEFAULT 0 CHECK (full_sheets >= 0),
    half_sheets INT NOT NULL DEFAULT 0 CHECK (half_sheets >= 0),
    fse NUMERIC(10, 2) GENERATED ALWAYS AS (full_sheets + (half_sheets * 0.5)) STORED,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT uq_product_stock_location UNIQUE (product_id, stock_location_id)
);
CREATE INDEX IF NOT EXISTS idx_inv_bal_prod ON inventory_balances(product_id);
CREATE INDEX IF NOT EXISTS idx_inv_bal_loc ON inventory_balances(stock_location_id);

-- One-to-many customer confirmation events (immutable customer reply log)
CREATE TABLE IF NOT EXISTS customer_confirmation_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE RESTRICT,
    inbound_sms_id UUID REFERENCES inbound_sms_messages(id) ON DELETE RESTRICT,
    sender_phone TEXT NOT NULL,
    response_code TEXT NOT NULL,
    reply_channel TEXT NOT NULL DEFAULT 'SMS',
    event_type TEXT NOT NULL CHECK (event_type IN ('confirmation', 'dispute', 'dispute_category_clarification', 'unrecognized', 'unauthorized_attempt')),
    raw_text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_conf_events_deliv ON customer_confirmation_events(delivery_id);

-- 2. SECURE ROLE HELPER FUNCTION
CREATE OR REPLACE FUNCTION auth.get_user_role()
RETURNS user_role_enum 
LANGUAGE sql 
STABLE 
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid() AND is_active = true;
$$;

REVOKE EXECUTE ON FUNCTION auth.get_user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.get_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION auth.get_user_role() TO service_role;

-- ============================================================================
-- 3. PRIVILEGE ESCALATION & IMMUTABILITY TRIGGERS
-- ============================================================================

-- Prevent non-owners from modifying role or is_active
CREATE OR REPLACE FUNCTION protect_profile_privileges()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id UUID;
    v_actor_role user_role_enum;
    v_active_owner_count INT;
BEGIN
    IF (OLD.role IS DISTINCT FROM NEW.role OR OLD.is_active IS DISTINCT FROM NEW.is_active) THEN
        v_actor_id := auth.uid();
        
        IF v_actor_id IS NULL THEN
            RAISE EXCEPTION 'PERMISSION_DENIED: Unauthenticated user cannot modify user roles or account status';
        END IF;

        SELECT role INTO v_actor_role FROM profiles WHERE id = v_actor_id AND is_active = true;

        IF v_actor_role IS DISTINCT FROM 'owner' THEN
            RAISE EXCEPTION 'PERMISSION_DENIED: Only owners can alter user roles or account status';
        END IF;

        -- Prevent deactivating or demoting the last active owner
        IF (OLD.role = 'owner' AND (NEW.role != 'owner' OR NEW.is_active = false)) THEN
            SELECT COUNT(*) INTO v_active_owner_count
            FROM profiles
            WHERE role = 'owner' AND is_active = true AND id != OLD.id;

            IF v_active_owner_count = 0 THEN
                RAISE EXCEPTION 'INVALID_OPERATION: Cannot demote or deactivate the last remaining active owner';
            END IF;
        END IF;

        -- Record audit log
        INSERT INTO audit_logs (
            actor_id, action_type, entity_name, entity_id, payload_before, payload_after
        ) VALUES (
            COALESCE(v_actor_id, OLD.id), 'PROFILE_PRIVILEGE_CHANGE', 'profiles', OLD.id,
            jsonb_build_object('role', OLD.role, 'is_active', OLD.is_active),
            jsonb_build_object('role', NEW.role, 'is_active', NEW.is_active)
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_privileges ON profiles;
CREATE TRIGGER trg_protect_profile_privileges
BEFORE UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION protect_profile_privileges();

-- Prevent modification of historical financial/reference fields on submitted deliveries
CREATE OR REPLACE FUNCTION protect_delivery_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF OLD.client_tx_id IS DISTINCT FROM NEW.client_tx_id
       OR OLD.payload_hash IS DISTINCT FROM NEW.payload_hash
       OR OLD.delivery_reference IS DISTINCT FROM NEW.delivery_reference
       OR OLD.customer_id IS DISTINCT FROM NEW.customer_id
       OR OLD.created_by IS DISTINCT FROM NEW.created_by
       OR OLD.vehicle_assignment_id IS DISTINCT FROM NEW.vehicle_assignment_id
       OR OLD.subtotal_amount IS DISTINCT FROM NEW.subtotal_amount
       OR OLD.discount_amount IS DISTINCT FROM NEW.discount_amount
       OR OLD.total_amount IS DISTINCT FROM NEW.total_amount
       OR OLD.total_declared_paid IS DISTINCT FROM NEW.total_declared_paid
       OR OLD.outstanding_balance IS DISTINCT FROM NEW.outstanding_balance THEN
        RAISE EXCEPTION 'IMMUTABLE_DELIVERY: Core financial, customer, vehicle assignment, and reference attributes cannot be altered on a submitted delivery.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_delivery_immutability ON deliveries;
CREATE TRIGGER trg_protect_delivery_immutability
BEFORE UPDATE ON deliveries
FOR EACH ROW EXECUTE FUNCTION protect_delivery_immutability();

-- Prevent UPDATE on immutable child ledgers (append-only)
CREATE OR REPLACE FUNCTION prevent_immutable_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: Updates are not permitted on this append-only business ledger.';
END;
$$;

DROP TRIGGER IF EXISTS trg_no_update_delivery_items ON delivery_items;
CREATE TRIGGER trg_no_update_delivery_items BEFORE UPDATE ON delivery_items FOR EACH ROW EXECUTE FUNCTION prevent_immutable_update();

DROP TRIGGER IF EXISTS trg_no_update_payment_declarations ON payment_declarations;
CREATE TRIGGER trg_no_update_payment_declarations BEFORE UPDATE ON payment_declarations FOR EACH ROW EXECUTE FUNCTION prevent_immutable_update();

DROP TRIGGER IF EXISTS trg_no_update_stock_movements ON stock_movements;
CREATE TRIGGER trg_no_update_stock_movements BEFORE UPDATE ON stock_movements FOR EACH ROW EXECUTE FUNCTION prevent_immutable_update();

DROP TRIGGER IF EXISTS trg_no_update_stock_transformations ON stock_transformations;
CREATE TRIGGER trg_no_update_stock_transformations BEFORE UPDATE ON stock_transformations FOR EACH ROW EXECUTE FUNCTION prevent_immutable_update();

-- ============================================================================
-- 4. ENABLE ROW-LEVEL SECURITY ON ALL APPLICATION TABLES
-- ============================================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_reversals ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_turnovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_sms_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_confirmation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transformations ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_corrections ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 5. RLS POLICIES FOR ALL TABLES (ROLE-SCOPED, NO BLIND INSERT HOLES)
-- ============================================================================

-- PROFILES
DROP POLICY IF EXISTS "profiles_select_policy" ON profiles;
CREATE POLICY "profiles_select_policy" ON profiles
FOR SELECT USING (auth.get_user_role() IN ('owner', 'manager', 'accountant') OR id = auth.uid());

DROP POLICY IF EXISTS "profiles_insert_owner" ON profiles;
CREATE POLICY "profiles_insert_owner" ON profiles
FOR INSERT WITH CHECK (auth.get_user_role() = 'owner');

DROP POLICY IF EXISTS "profiles_update_policy" ON profiles;
CREATE POLICY "profiles_update_policy" ON profiles
FOR UPDATE USING (auth.get_user_role() = 'owner' OR id = auth.uid());

-- CUSTOMERS & CONTACTS
DROP POLICY IF EXISTS "customers_select_policy" ON customers;
CREATE POLICY "customers_select_policy" ON customers FOR SELECT USING (true);

DROP POLICY IF EXISTS "customers_insert_policy" ON customers;
CREATE POLICY "customers_insert_policy" ON customers FOR INSERT WITH CHECK (auth.get_user_role() IN ('owner', 'manager'));

DROP POLICY IF EXISTS "customers_update_policy" ON customers;
CREATE POLICY "customers_update_policy" ON customers FOR UPDATE USING (auth.get_user_role() IN ('owner', 'manager'));

DROP POLICY IF EXISTS "customer_contacts_select" ON customer_contacts;
CREATE POLICY "customer_contacts_select" ON customer_contacts FOR SELECT USING (true);

DROP POLICY IF EXISTS "customer_contacts_modify" ON customer_contacts;
CREATE POLICY "customer_contacts_modify" ON customer_contacts FOR ALL USING (auth.get_user_role() IN ('owner', 'manager'));

-- CREDIT ACCOUNTS
DROP POLICY IF EXISTS "credit_accounts_select" ON credit_accounts;
CREATE POLICY "credit_accounts_select" ON credit_accounts FOR SELECT USING (true);

DROP POLICY IF EXISTS "credit_accounts_update" ON credit_accounts;
CREATE POLICY "credit_accounts_update" ON credit_accounts FOR UPDATE USING (auth.get_user_role() IN ('owner', 'manager', 'accountant'));

-- PRODUCTS & CATALOG
DROP POLICY IF EXISTS "products_select_all" ON products;
CREATE POLICY "products_select_all" ON products FOR SELECT USING (true);

DROP POLICY IF EXISTS "products_modify_owner_manager" ON products;
CREATE POLICY "products_modify_owner_manager" ON products FOR ALL USING (auth.get_user_role() IN ('owner', 'manager'));

DROP POLICY IF EXISTS "categories_select_all" ON product_categories;
CREATE POLICY "categories_select_all" ON product_categories FOR SELECT USING (true);

DROP POLICY IF EXISTS "customer_prices_select" ON customer_prices;
CREATE POLICY "customer_prices_select" ON customer_prices FOR SELECT USING (true);

DROP POLICY IF EXISTS "customer_prices_modify" ON customer_prices;
CREATE POLICY "customer_prices_modify" ON customer_prices FOR ALL USING (auth.get_user_role() IN ('owner', 'manager'));

-- PRICE APPROVAL REQUESTS
DROP POLICY IF EXISTS "price_approvals_select" ON price_approval_requests;
CREATE POLICY "price_approvals_select" ON price_approval_requests
FOR SELECT USING (auth.get_user_role() IN ('owner', 'manager', 'accountant') OR requested_by = auth.uid());

DROP POLICY IF EXISTS "price_approvals_insert" ON price_approval_requests;
CREATE POLICY "price_approvals_insert" ON price_approval_requests
FOR INSERT WITH CHECK (requested_by = auth.uid());

DROP POLICY IF EXISTS "price_approvals_update" ON price_approval_requests;
CREATE POLICY "price_approvals_update" ON price_approval_requests
FOR UPDATE USING (auth.get_user_role() IN ('owner', 'manager') AND requested_by != auth.uid());

-- FLEET & ASSIGNMENTS
DROP POLICY IF EXISTS "vehicles_select" ON vehicles;
CREATE POLICY "vehicles_select" ON vehicles FOR SELECT USING (true);

DROP POLICY IF EXISTS "vehicles_modify" ON vehicles;
CREATE POLICY "vehicles_modify" ON vehicles FOR ALL USING (auth.get_user_role() IN ('owner', 'manager'));

DROP POLICY IF EXISTS "routes_select" ON routes;
CREATE POLICY "routes_select" ON routes FOR SELECT USING (true);

DROP POLICY IF EXISTS "routes_modify" ON routes;
CREATE POLICY "routes_modify" ON routes FOR ALL USING (auth.get_user_role() IN ('owner', 'manager'));

DROP POLICY IF EXISTS "assignments_select" ON vehicle_assignments;
CREATE POLICY "assignments_select" ON vehicle_assignments
FOR SELECT USING (auth.get_user_role() IN ('owner', 'manager', 'accountant') OR driver_id = auth.uid() OR salesperson_id = auth.uid());

DROP POLICY IF EXISTS "assignments_modify" ON vehicle_assignments;
CREATE POLICY "assignments_modify" ON vehicle_assignments FOR ALL USING (auth.get_user_role() IN ('owner', 'manager'));

-- DELIVERIES & LINE ITEMS
DROP POLICY IF EXISTS "deliveries_select_policy" ON deliveries;
CREATE POLICY "deliveries_select_policy" ON deliveries
FOR SELECT USING (
    auth.get_user_role() IN ('owner', 'manager', 'accountant')
    OR created_by = auth.uid()
    OR vehicle_assignment_id IN (
        SELECT id FROM vehicle_assignments WHERE driver_id = auth.uid() OR salesperson_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "deliveries_insert_policy" ON deliveries;
CREATE POLICY "deliveries_insert_policy" ON deliveries
FOR INSERT WITH CHECK (
    auth.get_user_role() IN ('owner', 'manager', 'salesperson', 'driver')
    AND created_by = auth.uid()
);

DROP POLICY IF EXISTS "deliveries_update_policy" ON deliveries;
CREATE POLICY "deliveries_update_policy" ON deliveries
FOR UPDATE USING (
    auth.get_user_role() IN ('owner', 'manager', 'accountant')
    OR created_by = auth.uid()
);

DROP POLICY IF EXISTS "delivery_items_select" ON delivery_items;
CREATE POLICY "delivery_items_select" ON delivery_items
FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM deliveries d
        WHERE d.id = delivery_items.delivery_id
        AND (
            auth.get_user_role() IN ('owner', 'manager', 'accountant')
            OR d.created_by = auth.uid()
        )
    )
);

DROP POLICY IF EXISTS "delivery_items_insert" ON delivery_items;
CREATE POLICY "delivery_items_insert" ON delivery_items
FOR INSERT WITH CHECK (
    EXISTS (
        SELECT 1 FROM deliveries d
        WHERE d.id = delivery_items.delivery_id
        AND (
            auth.get_user_role() IN ('owner', 'manager', 'salesperson', 'driver')
            AND d.created_by = auth.uid()
        )
    )
);

-- PAYMENTS, COLLECTIONS & ALLOCATIONS
DROP POLICY IF EXISTS "payment_decl_select" ON payment_declarations;
CREATE POLICY "payment_decl_select" ON payment_declarations
FOR SELECT USING (
    auth.get_user_role() IN ('owner', 'manager', 'accountant')
    OR declared_by = auth.uid()
);

DROP POLICY IF EXISTS "payment_decl_insert" ON payment_declarations;
CREATE POLICY "payment_decl_insert" ON payment_declarations
FOR INSERT WITH CHECK (
    auth.get_user_role() IN ('owner', 'manager', 'salesperson', 'driver')
    AND declared_by = auth.uid()
);

DROP POLICY IF EXISTS "collections_select" ON collections;
CREATE POLICY "collections_select" ON collections
FOR SELECT USING (
    auth.get_user_role() IN ('owner', 'manager', 'accountant')
    OR collected_by = auth.uid()
);

DROP POLICY IF EXISTS "collections_insert" ON collections;
CREATE POLICY "collections_insert" ON collections
FOR INSERT WITH CHECK (
    auth.get_user_role() IN ('owner', 'manager', 'cash_collector', 'accountant', 'salesperson', 'driver')
    AND collected_by = auth.uid()
);

DROP POLICY IF EXISTS "allocations_select" ON payment_allocations;
CREATE POLICY "allocations_select" ON payment_allocations FOR SELECT USING (true);

DROP POLICY IF EXISTS "allocations_insert" ON payment_allocations;
CREATE POLICY "allocations_insert" ON payment_allocations
FOR INSERT WITH CHECK (auth.get_user_role() IN ('owner', 'manager', 'accountant'));

DROP POLICY IF EXISTS "reversals_select" ON payment_reversals;
CREATE POLICY "reversals_select" ON payment_reversals
FOR SELECT USING (auth.get_user_role() IN ('owner', 'manager', 'accountant'));

DROP POLICY IF EXISTS "reversals_insert" ON payment_reversals;
CREATE POLICY "reversals_insert" ON payment_reversals
FOR INSERT WITH CHECK (auth.get_user_role() IN ('owner', 'manager', 'accountant'));

-- TURNOVER SETTLEMENTS
DROP POLICY IF EXISTS "turnovers_select" ON employee_turnovers;
CREATE POLICY "turnovers_select" ON employee_turnovers
FOR SELECT USING (
    auth.get_user_role() IN ('owner', 'manager', 'accountant')
    OR employee_id = auth.uid()
);

DROP POLICY IF EXISTS "turnovers_insert_update" ON employee_turnovers;
CREATE POLICY "turnovers_insert_update" ON employee_turnovers
FOR ALL USING (auth.get_user_role() IN ('owner', 'manager', 'accountant'));

-- SMS, CONFIRMATIONS & DISPUTES
DROP POLICY IF EXISTS "inbound_sms_select" ON inbound_sms_messages;
CREATE POLICY "inbound_sms_select" ON inbound_sms_messages
FOR SELECT USING (auth.get_user_role() IN ('owner', 'manager', 'accountant'));

DROP POLICY IF EXISTS "confirmations_select" ON customer_confirmations;
CREATE POLICY "confirmations_select" ON customer_confirmations FOR SELECT USING (true);

DROP POLICY IF EXISTS "confirmation_events_select" ON customer_confirmation_events;
CREATE POLICY "confirmation_events_select" ON customer_confirmation_events FOR SELECT USING (true);

DROP POLICY IF EXISTS "disputes_select" ON customer_disputes;
CREATE POLICY "disputes_select" ON customer_disputes FOR SELECT USING (true);

DROP POLICY IF EXISTS "disputes_modify" ON customer_disputes;
CREATE POLICY "disputes_modify" ON customer_disputes
FOR UPDATE USING (auth.get_user_role() IN ('owner', 'manager'));

-- NOTIFICATIONS
DROP POLICY IF EXISTS "notifications_select" ON notifications;
CREATE POLICY "notifications_select" ON notifications
FOR SELECT USING (auth.get_user_role() IN ('owner', 'manager', 'accountant'));

-- STOCK & INVENTORY
DROP POLICY IF EXISTS "stock_locations_select" ON stock_locations;
CREATE POLICY "stock_locations_select" ON stock_locations FOR SELECT USING (true);

DROP POLICY IF EXISTS "stock_locations_modify" ON stock_locations;
CREATE POLICY "stock_locations_modify" ON stock_locations FOR ALL USING (auth.get_user_role() IN ('owner', 'manager'));

DROP POLICY IF EXISTS "inventory_balances_select" ON inventory_balances;
CREATE POLICY "inventory_balances_select" ON inventory_balances FOR SELECT USING (true);

DROP POLICY IF EXISTS "stock_transformations_select" ON stock_transformations;
CREATE POLICY "stock_transformations_select" ON stock_transformations FOR SELECT USING (true);

DROP POLICY IF EXISTS "stock_movements_select" ON stock_movements;
CREATE POLICY "stock_movements_select" ON stock_movements FOR SELECT USING (true);

-- LOCATION SAMPLES & AUDIT LOGS
DROP POLICY IF EXISTS "location_samples_select" ON location_samples;
CREATE POLICY "location_samples_select" ON location_samples
FOR SELECT USING (auth.get_user_role() IN ('owner', 'manager'));

DROP POLICY IF EXISTS "location_samples_insert" ON location_samples;
CREATE POLICY "location_samples_insert" ON location_samples
FOR INSERT WITH CHECK (
    auth.get_user_role() IN ('owner', 'manager', 'salesperson', 'driver')
);

DROP POLICY IF EXISTS "audit_logs_select" ON audit_logs;
CREATE POLICY "audit_logs_select" ON audit_logs
FOR SELECT USING (auth.get_user_role() IN ('owner', 'manager'));

DROP POLICY IF EXISTS "corrections_select" ON transaction_corrections;
CREATE POLICY "corrections_select" ON transaction_corrections
FOR SELECT USING (auth.get_user_role() IN ('owner', 'manager', 'accountant'));

-- ============================================================================
-- 6. ATOMIC DELIVERY CREATION STORED PROCEDURE (RPC)
-- Comprehensive: Caller check, vehicle shift check, canonical idempotency hash,
-- independent server calculations, stock locking, physical half-sheet transformation,
-- credit account check/lock, turnover liability, and notification queuing.
-- ============================================================================

CREATE OR REPLACE FUNCTION submit_delivery_atomic(
    p_delivery_reference TEXT,
    p_client_tx_id UUID,
    p_payload_hash TEXT,
    p_customer_id UUID,
    p_created_by UUID,
    p_vehicle_assignment_id UUID,
    p_subtotal_amount NUMERIC,
    p_discount_amount NUMERIC,
    p_total_amount NUMERIC,
    p_total_declared_paid NUMERIC,
    p_outstanding_balance NUMERIC,
    p_payment_status payment_status_enum,
    p_delivery_lat NUMERIC DEFAULT NULL,
    p_delivery_lng NUMERIC DEFAULT NULL,
    p_gps_accuracy_m NUMERIC DEFAULT NULL,
    p_device_captured_at TIMESTAMPTZ DEFAULT NULL,
    p_is_offline_submission BOOLEAN DEFAULT false,
    p_notes TEXT DEFAULT NULL,
    p_items JSONB DEFAULT '[]'::jsonb,
    p_payments JSONB DEFAULT '[]'::jsonb,
    p_warehouse_location_id UUID DEFAULT '33333333-3333-3333-3333-333333333301'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role user_role_enum;
    v_existing_id UUID;
    v_existing_hash TEXT;
    v_delivery_id UUID;
    v_trans_id UUID;
    v_turnover_id UUID;
    v_assignment RECORD;
    v_customer RECORD;
    v_credit_acc RECORD;
    v_source_location_id UUID;
    
    -- Calculated financial totals
    v_calc_subtotal NUMERIC := 0.00;
    v_calc_discount NUMERIC := 0.00;
    v_calc_total NUMERIC := 0.00;
    v_calc_declared_paid NUMERIC := 0.00;
    v_calc_outstanding NUMERIC := 0.00;
    v_derived_status payment_status_enum;
    
    -- Payment channel breakdowns
    v_cash_declared NUMERIC := 0.00;
    v_emp_mpesa_declared NUMERIC := 0.00;
    v_till_mpesa_declared NUMERIC := 0.00;
    v_bank_declared NUMERIC := 0.00;
    
    -- Line item cursor
    v_item RECORD;
    v_product RECORD;
    v_item_unit selling_unit_enum;
    v_item_qty INT;
    v_auth_unit_price NUMERIC;
    v_item_total NUMERIC;
    v_customer_price NUMERIC;
    v_approval RECORD;
    
    -- Stock balances
    v_avail_full INT;
    v_avail_halves INT;
    v_order_halves INT;
    v_halves_from_stock INT;
    v_shortage INT;
    v_full_to_split INT;
    
    -- Payment cursor
    v_payment RECORD;
    v_sms_payload TEXT;
BEGIN
    -- 1. CALLER AUTHENTICATION & ROLE VERIFICATION
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED: Caller must be authenticated to submit deliveries';
    END IF;

    IF v_caller_id != p_created_by THEN
        RAISE EXCEPTION 'UNAUTHORIZED: p_created_by (%) does not match authenticated user (%)', p_created_by, v_caller_id;
    END IF;

    SELECT role INTO v_caller_role
    FROM profiles
    WHERE id = v_caller_id AND is_active = true;

    IF v_caller_role IS NULL THEN
        RAISE EXCEPTION 'ACCESS_DENIED: Caller profile not found or account is deactivated';
    END IF;

    IF v_caller_role NOT IN ('owner', 'manager', 'salesperson', 'driver') THEN
        RAISE EXCEPTION 'ROLE_NOT_AUTHORIZED: Role % is not authorized to submit deliveries', v_caller_role;
    END IF;

    -- 2. VEHICLE SHIFT ASSIGNMENT VERIFICATION
    SELECT va.id, va.vehicle_id, va.driver_id, va.salesperson_id, va.is_active,
           v.status AS vehicle_status, v.is_active AS vehicle_active
    INTO v_assignment
    FROM vehicle_assignments va
    JOIN vehicles v ON v.id = va.vehicle_id
    WHERE va.id = p_vehicle_assignment_id;

    IF v_assignment.id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ASSIGNMENT: Vehicle assignment % does not exist', p_vehicle_assignment_id;
    END IF;

    IF NOT v_assignment.is_active THEN
        RAISE EXCEPTION 'INACTIVE_ASSIGNMENT: Vehicle assignment % is not active', p_vehicle_assignment_id;
    END IF;

    IF v_assignment.vehicle_status != 'active' OR NOT v_assignment.vehicle_active THEN
        RAISE EXCEPTION 'VEHICLE_UNAVAILABLE: Assigned vehicle is % or inactive', v_assignment.vehicle_status;
    END IF;

    IF v_caller_role IN ('driver', 'salesperson') THEN
        IF v_assignment.driver_id != v_caller_id AND v_assignment.salesperson_id != v_caller_id THEN
            RAISE EXCEPTION 'UNAUTHORIZED_SHIFT: Caller % is not assigned to vehicle assignment %', v_caller_id, p_vehicle_assignment_id;
        END IF;
    ELSIF v_caller_role IN ('owner', 'manager') THEN
        IF v_assignment.driver_id != v_caller_id AND v_assignment.salesperson_id != v_caller_id THEN
            INSERT INTO audit_logs (actor_id, action_type, entity_name, entity_id, payload_after)
            VALUES (v_caller_id, 'ADMIN_DELIVERY_OVERRIDE', 'vehicle_assignments', p_vehicle_assignment_id,
                    jsonb_build_object('notes', 'Manager/Owner ' || v_caller_id || ' submitted delivery ' || p_delivery_reference || ' on assignment ' || p_vehicle_assignment_id));
        END IF;
    END IF;

    -- 3. RESOLVE SOURCE STOCK LOCATION (VEHICLE LOCATION FIRST)
    SELECT id INTO v_source_location_id
    FROM stock_locations
    WHERE vehicle_id = v_assignment.vehicle_id AND is_active = true;

    IF v_source_location_id IS NULL THEN
        IF p_warehouse_location_id IS NOT NULL THEN
            SELECT id INTO v_source_location_id
            FROM stock_locations
            WHERE id = p_warehouse_location_id AND is_active = true;
        END IF;
        
        IF v_source_location_id IS NULL THEN
            RAISE EXCEPTION 'STOCK_LOCATION_NOT_FOUND: No active stock location found for vehicle % or warehouse %',
                v_assignment.vehicle_id, p_warehouse_location_id;
        END IF;
    END IF;

    -- 4. CANONICAL PAYLOAD HASH IDEMPOTENCY CHECK
    IF p_payload_hash IS NULL OR p_payload_hash = '' THEN
        RAISE EXCEPTION 'PAYLOAD_HASH_REQUIRED: Canonical SHA-256 payload hash is required';
    END IF;

    SELECT id, payload_hash INTO v_existing_id, v_existing_hash
    FROM deliveries
    WHERE client_tx_id = p_client_tx_id;

    IF v_existing_id IS NOT NULL THEN
        IF v_existing_hash IS DISTINCT FROM p_payload_hash THEN
            RAISE EXCEPTION 'IDEMPOTENCY_PAYLOAD_MISMATCH: Existing delivery with clientTxId % has differing payload hash', p_client_tx_id;
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'duplicate', true,
            'delivery_id', v_existing_id,
            'delivery_reference', p_delivery_reference,
            'message', 'Delivery was already synchronized.'
        );
    END IF;

    -- 5. CUSTOMER VALIDATION
    SELECT id, is_credit_eligible, credit_limit, primary_phone, name
    INTO v_customer
    FROM customers
    WHERE id = p_customer_id AND is_active = true;

    IF v_customer.id IS NULL THEN
        RAISE EXCEPTION 'CUSTOMER_NOT_FOUND: Customer % does not exist or is inactive', p_customer_id;
    END IF;

    -- 6. INDEPENDENT FINANCIAL VALIDATION & PRICING
    IF jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'EMPTY_DELIVERY: Delivery must contain at least one line item';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        "productId" UUID,
        "sellingUnit" TEXT,
        "quantity" INT,
        "appliedUnitPrice" NUMERIC,
        "priceApprovalId" UUID
    )
    LOOP
        v_item_unit := v_item."sellingUnit"::selling_unit_enum;
        v_item_qty := v_item."quantity";

        IF v_item_qty <= 0 THEN
            RAISE EXCEPTION 'INVALID_QUANTITY: Line item quantity must be positive';
        END IF;

        IF v_item."appliedUnitPrice" < 0 THEN
            RAISE EXCEPTION 'INVALID_PRICE: Unit price cannot be negative';
        END IF;

        -- Verify product exists
        SELECT id, name, sku, standard_full_sheet_price, standard_half_sheet_price
        INTO v_product
        FROM products
        WHERE id = v_item."productId" AND is_active = true;

        IF v_product.id IS NULL THEN
            RAISE EXCEPTION 'PRODUCT_NOT_FOUND: Product % does not exist or is inactive', v_item."productId";
        END IF;

        -- Resolve authorized base price:
        -- 1. Effective-dated customer price
        v_customer_price := NULL;
        SELECT authorized_price INTO v_customer_price
        FROM customer_prices
        WHERE customer_id = p_customer_id
          AND product_id = v_item."productId"
          AND selling_unit = v_item_unit
          AND is_active = true
          AND valid_from <= timezone('utc', now())
          AND (valid_to IS NULL OR valid_to > timezone('utc', now()))
        ORDER BY valid_from DESC
        LIMIT 1;

        IF v_customer_price IS NOT NULL THEN
            v_auth_unit_price := v_customer_price;
        ELSE
            IF v_item_unit = 'FULL_SHEET' THEN
                v_auth_unit_price := v_product.standard_full_sheet_price;
            ELSE
                v_auth_unit_price := v_product.standard_half_sheet_price;
            END IF;
        END IF;

        -- 2. Verify special price approval if price differs from authorized base
        IF v_item."appliedUnitPrice" != v_auth_unit_price THEN
            IF v_item."priceApprovalId" IS NULL THEN
                RAISE EXCEPTION 'UNAUTHORIZED_PRICE: Applied price % differs from authorized base % without approval for product %',
                    v_item."appliedUnitPrice", v_auth_unit_price, v_product.sku;
            END IF;

            SELECT id, status, requested_by, reviewed_by, requested_price, customer_id, product_id, selling_unit
            INTO v_approval
            FROM price_approval_requests
            WHERE id = v_item."priceApprovalId";

            IF v_approval.id IS NULL OR v_approval.status != 'approved' THEN
                RAISE EXCEPTION 'PRICE_APPROVAL_INVALID: Price approval % is not approved', v_item."priceApprovalId";
            END IF;

            IF v_approval.requested_by = v_approval.reviewed_by THEN
                RAISE EXCEPTION 'PRICE_APPROVAL_ILLEGAL: Anti-self-approval violation on approval %', v_item."priceApprovalId";
            END IF;

            IF v_approval.product_id != v_item."productId" OR v_approval.selling_unit != v_item_unit THEN
                RAISE EXCEPTION 'PRICE_APPROVAL_MISMATCH: Approval % does not match product or unit', v_item."priceApprovalId";
            END IF;

            IF v_approval.requested_price != v_item."appliedUnitPrice" THEN
                RAISE EXCEPTION 'PRICE_APPROVAL_PRICE_MISMATCH: Approved price % != applied price %',
                    v_approval.requested_price, v_item."appliedUnitPrice";
            END IF;
        END IF;

        v_item_total := ROUND(v_item_qty * v_item."appliedUnitPrice", 2);
        v_calc_subtotal := v_calc_subtotal + v_item_total;
    END LOOP;

    -- Subtotal integrity check
    IF p_subtotal_amount IS NOT NULL AND ABS(p_subtotal_amount - v_calc_subtotal) > 0.01 THEN
        RAISE EXCEPTION 'SUBTOTAL_MISMATCH: Submitted subtotal % != calculated subtotal %', p_subtotal_amount, v_calc_subtotal;
    END IF;

    -- Discount integrity check
    v_calc_discount := COALESCE(p_discount_amount, 0.00);
    IF v_calc_discount < 0 THEN
        RAISE EXCEPTION 'INVALID_DISCOUNT: Discount cannot be negative';
    END IF;
    IF v_calc_discount > v_calc_subtotal THEN
        RAISE EXCEPTION 'INVALID_DISCOUNT: Discount % cannot exceed subtotal %', v_calc_discount, v_calc_subtotal;
    END IF;

    v_calc_total := v_calc_subtotal - v_calc_discount;
    IF p_total_amount IS NOT NULL AND ABS(p_total_amount - v_calc_total) > 0.01 THEN
        RAISE EXCEPTION 'TOTAL_MISMATCH: Submitted total % != calculated total %', p_total_amount, v_calc_total;
    END IF;

    -- Payment declarations breakdown
    FOR v_payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS y(
        "channel" TEXT,
        "declaredAmount" NUMERIC,
        "externalRef" TEXT,
        "notes" TEXT
    )
    LOOP
        IF v_payment."declaredAmount" < 0 THEN
            RAISE EXCEPTION 'INVALID_PAYMENT: Declared amount cannot be negative';
        END IF;

        IF v_payment."channel" NOT IN ('cash', 'mpesa_company_till', 'mpesa_employee_phone', 'bank_transfer', 'credit') THEN
            RAISE EXCEPTION 'INVALID_PAYMENT_CHANNEL: Channel % is invalid', v_payment."channel";
        END IF;

        IF v_payment."channel" = 'cash' THEN
            v_cash_declared := v_cash_declared + v_payment."declaredAmount";
            v_calc_declared_paid := v_calc_declared_paid + v_payment."declaredAmount";
        ELSIF v_payment."channel" = 'mpesa_employee_phone' THEN
            v_emp_mpesa_declared := v_emp_mpesa_declared + v_payment."declaredAmount";
            v_calc_declared_paid := v_calc_declared_paid + v_payment."declaredAmount";
        ELSIF v_payment."channel" = 'mpesa_company_till' THEN
            v_till_mpesa_declared := v_till_mpesa_declared + v_payment."declaredAmount";
            v_calc_declared_paid := v_calc_declared_paid + v_payment."declaredAmount";
        ELSIF v_payment."channel" = 'bank_transfer' THEN
            v_bank_declared := v_bank_declared + v_payment."declaredAmount";
            v_calc_declared_paid := v_calc_declared_paid + v_payment."declaredAmount";
        END IF;
    END LOOP;

    IF p_total_declared_paid IS NOT NULL AND ABS(p_total_declared_paid - v_calc_declared_paid) > 0.01 THEN
        RAISE EXCEPTION 'DECLARED_PAID_MISMATCH: Submitted declared paid % != calculated money payments %',
            p_total_declared_paid, v_calc_declared_paid;
    END IF;

    -- Outstanding receivable = Total Invoice - Money Declared Received
    v_calc_outstanding := GREATEST(0.00, v_calc_total - v_calc_declared_paid);
    IF p_outstanding_balance IS NOT NULL AND ABS(p_outstanding_balance - v_calc_outstanding) > 0.01 THEN
        RAISE EXCEPTION 'BALANCE_MISMATCH: Submitted outstanding % != calculated balance % (% - %)',
            p_outstanding_balance, v_calc_outstanding, v_calc_total, v_calc_declared_paid;
    END IF;

    -- Derived payment status
    IF v_calc_declared_paid >= v_calc_total THEN
        v_derived_status := 'fully_paid';
    ELSIF v_calc_declared_paid > 0 THEN
        v_derived_status := 'partially_paid';
    ELSE
        v_derived_status := 'unpaid';
    END IF;

    -- 7. CREDIT ACCOUNT CONCURRENCY-SAFE CHECK & LOCK
    IF v_calc_outstanding > 0 THEN
        IF NOT v_customer.is_credit_eligible THEN
            RAISE EXCEPTION 'CREDIT_NOT_AUTHORIZED: Customer % is not credit eligible for outstanding balance %',
                v_customer.name, v_calc_outstanding;
        END IF;

        -- Lock customer credit account row
        SELECT customer_id, current_balance, total_credit_extended
        INTO v_credit_acc
        FROM credit_accounts
        WHERE customer_id = p_customer_id
        FOR UPDATE;

        IF v_credit_acc.customer_id IS NULL THEN
            INSERT INTO credit_accounts (customer_id, current_balance, total_credit_extended)
            VALUES (p_customer_id, 0.00, 0.00)
            RETURNING customer_id, current_balance, total_credit_extended INTO v_credit_acc;
        END IF;

        IF v_credit_acc.current_balance + v_calc_outstanding > v_customer.credit_limit THEN
            RAISE EXCEPTION 'CREDIT_LIMIT_EXCEEDED: Credit purchase of % brings balance % over limit %',
                v_calc_outstanding, v_credit_acc.current_balance + v_calc_outstanding, v_customer.credit_limit;
        END IF;

        UPDATE credit_accounts
        SET current_balance = current_balance + v_calc_outstanding,
            total_credit_extended = total_credit_extended + v_calc_outstanding,
            updated_at = timezone('utc', now())
        WHERE customer_id = p_customer_id;
    END IF;

    -- 8. INSERT DELIVERIES RECORD
    INSERT INTO deliveries (
        delivery_reference, client_tx_id, payload_hash, customer_id, created_by,
        vehicle_assignment_id, operational_status, payment_status, reconciliation_status,
        customer_confirmation_status, subtotal_amount, discount_amount, total_amount,
        total_declared_paid, outstanding_balance, delivery_lat, delivery_lng,
        gps_accuracy_m, device_captured_at, submitted_at, synced_at,
        is_offline_submission, notes
    ) VALUES (
        p_delivery_reference, p_client_tx_id, p_payload_hash, p_customer_id, p_created_by,
        p_vehicle_assignment_id, 'delivered', v_derived_status, 'pending_reconciliation',
        'pending', v_calc_subtotal, v_calc_discount, v_calc_total,
        v_calc_declared_paid, v_calc_outstanding, p_delivery_lat, p_delivery_lng,
        p_gps_accuracy_m, COALESCE(p_device_captured_at, timezone('utc', now())),
        timezone('utc', now()), timezone('utc', now()), p_is_offline_submission, p_notes
    )
    RETURNING id INTO v_delivery_id;

    -- 9. PROCESS LINE ITEMS, STOCK LOCKING & PHYSICAL HALF-SHEET TRANSFORMATION
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        "productId" UUID,
        "sellingUnit" TEXT,
        "quantity" INT,
        "appliedUnitPrice" NUMERIC,
        "priceApprovalId" UUID
    )
    LOOP
        v_item_unit := v_item."sellingUnit"::selling_unit_enum;
        v_item_qty := v_item."quantity";

        -- Lock inventory balance at source location
        SELECT full_sheets, half_sheets
        INTO v_avail_full, v_avail_halves
        FROM inventory_balances
        WHERE product_id = v_item."productId" AND stock_location_id = v_source_location_id
        FOR UPDATE;

        IF v_avail_full IS NULL THEN
            INSERT INTO inventory_balances (product_id, stock_location_id, full_sheets, half_sheets)
            VALUES (v_item."productId", v_source_location_id, 0, 0)
            RETURNING full_sheets, half_sheets INTO v_avail_full, v_avail_halves;
        END IF;

        IF v_item_unit = 'FULL_SHEET' THEN
            IF v_avail_full < v_item_qty THEN
                RAISE EXCEPTION 'INSUFFICIENT_STOCK: Required % full sheets, but only % available at location %',
                    v_item_qty, v_avail_full, v_source_location_id;
            END IF;

            UPDATE inventory_balances
            SET full_sheets = full_sheets - v_item_qty, updated_at = timezone('utc', now())
            WHERE product_id = v_item."productId" AND stock_location_id = v_source_location_id;

            INSERT INTO stock_movements (
                product_id, from_location_id, to_location_id,
                full_sheets_delta, half_sheets_delta, fse_delta,
                movement_type, responsible_employee_id, delivery_id, notes
            ) VALUES (
                v_item."productId", v_source_location_id, NULL,
                -v_item_qty, 0, -v_item_qty * 1.0,
                'delivery_to_customer', p_created_by, v_delivery_id, 'Delivery ' || p_delivery_reference
            );
        ELSE
            -- HALF_SHEET ordered sale
            v_order_halves := v_item_qty;
            v_halves_from_stock := LEAST(v_avail_halves, v_order_halves);
            v_shortage := v_order_halves - v_halves_from_stock;

            IF v_shortage > 0 THEN
                v_full_to_split := CEIL(v_shortage / 2.0)::INT;

                IF v_avail_full < v_full_to_split THEN
                    RAISE EXCEPTION 'INSUFFICIENT_STOCK: Order requires % half sheets. Only % half sheets in stock; splitting requires % full sheets, but only % full sheets available',
                        v_order_halves, v_avail_halves, v_full_to_split, v_avail_full;
                END IF;

                -- Record transformation
                INSERT INTO stock_transformations (
                    product_id, stock_location_id, full_sheets_consumed, half_sheets_produced, operator_id, notes
                ) VALUES (
                    v_item."productId", v_source_location_id, v_full_to_split, v_full_to_split * 2, p_created_by,
                    'Split transformation for delivery ' || p_delivery_reference
                ) RETURNING id INTO v_trans_id;

                -- Update balance: consume full sheets, produce 2x half sheets
                UPDATE inventory_balances
                SET full_sheets = full_sheets - v_full_to_split,
                    half_sheets = half_sheets + (v_full_to_split * 2),
                    updated_at = timezone('utc', now())
                WHERE product_id = v_item."productId" AND stock_location_id = v_source_location_id;

                -- Record transformation movement (fse delta = 0)
                INSERT INTO stock_movements (
                    product_id, from_location_id, to_location_id,
                    full_sheets_delta, half_sheets_delta, fse_delta,
                    movement_type, responsible_employee_id, transformation_id, notes
                ) VALUES (
                    v_item."productId", v_source_location_id, v_source_location_id,
                    -v_full_to_split, v_full_to_split * 2, 0.00,
                    'split_full_to_half', p_created_by, v_trans_id, 'Split transformation for delivery ' || p_delivery_reference
                );
            END IF;

            -- Deduct ordered half sheets
            UPDATE inventory_balances
            SET half_sheets = half_sheets - v_order_halves, updated_at = timezone('utc', now())
            WHERE product_id = v_item."productId" AND stock_location_id = v_source_location_id;

            -- Record customer delivery movement
            INSERT INTO stock_movements (
                product_id, from_location_id, to_location_id,
                full_sheets_delta, half_sheets_delta, fse_delta,
                movement_type, responsible_employee_id, delivery_id, notes
            ) VALUES (
                v_item."productId", v_source_location_id, NULL,
                0, -v_order_halves, -(v_order_halves * 0.5),
                'delivery_to_customer', p_created_by, v_delivery_id, 'Delivery ' || p_delivery_reference
            );
        END IF;

        -- Record line item
        INSERT INTO delivery_items (
            delivery_id, product_id, selling_unit, quantity, full_sheet_equivalent,
            official_unit_price, applied_unit_price, is_special_price, price_approval_id, line_total
        ) VALUES (
            v_delivery_id, v_item."productId", v_item_unit, v_item_qty,
            CASE WHEN v_item_unit = 'FULL_SHEET' THEN v_item_qty * 1.0 ELSE v_item_qty * 0.5 END,
            v_auth_unit_price, v_item."appliedUnitPrice",
            (v_item."appliedUnitPrice" != v_auth_unit_price),
            v_item."priceApprovalId",
            ROUND(v_item_qty * v_item."appliedUnitPrice", 2)
        );
    END LOOP;

    -- 10. INSERT PAYMENT DECLARATIONS
    FOR v_payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS y(
        "channel" TEXT,
        "declaredAmount" NUMERIC,
        "externalRef" TEXT,
        "notes" TEXT
    )
    LOOP
        IF v_payment."declaredAmount" > 0 AND v_payment."channel" != 'credit' THEN
            INSERT INTO payment_declarations (
                delivery_id, channel, declared_amount, declared_by, external_ref, notes
            ) VALUES (
                v_delivery_id, v_payment."channel"::payment_channel_enum,
                v_payment."declaredAmount", p_created_by, v_payment."externalRef", v_payment."notes"
            );
        END IF;
    END LOOP;

    -- 11. RECORD EMPLOYEE TURNOVER LIABILITIES
    IF v_cash_declared > 0 OR v_emp_mpesa_declared > 0 THEN
        SELECT id INTO v_turnover_id
        FROM employee_turnovers
        WHERE employee_id = p_created_by AND shift_date = CURRENT_DATE;

        IF v_turnover_id IS NOT NULL THEN
            UPDATE employee_turnovers
            SET cash_declared = cash_declared + v_cash_declared,
                personal_mpesa_declared = personal_mpesa_declared + v_emp_mpesa_declared,
                variance = (cash_remitted + mpesa_forwarded) - ((cash_declared + v_cash_declared) + (personal_mpesa_declared + v_emp_mpesa_declared))
            WHERE id = v_turnover_id;
        ELSE
            INSERT INTO employee_turnovers (
                employee_id, shift_date, cash_declared, personal_mpesa_declared,
                cash_remitted, mpesa_forwarded, variance
            ) VALUES (
                p_created_by, CURRENT_DATE, v_cash_declared, v_emp_mpesa_declared,
                0.00, 0.00, -(v_cash_declared + v_emp_mpesa_declared)
            );
        END IF;
    END IF;

    -- 12. NOTIFICATION OUTBOX QUEUEING
    v_sms_payload := 'TOKA GLASS: Delivery ' || p_delivery_reference || ' recorded. Total: KES ' ||
                     TO_CHAR(v_calc_total, 'FM999,999,990.00') || ', Paid: KES ' ||
                     TO_CHAR(v_calc_declared_paid, 'FM999,999,990.00') || ', Due: KES ' ||
                     TO_CHAR(v_calc_outstanding, 'FM999,999,990.00') || '. Reply 1 to CONFIRM or 2 to DISPUTE. Help: 0700000000';

    INSERT INTO notifications (
        delivery_id, customer_phone, channel, payload, status
    ) VALUES (
        v_delivery_id, v_customer.primary_phone, 'SMS', v_sms_payload, 'queued'
    );

    -- 13. RETURN SUCCESS
    RETURN jsonb_build_object(
        'success', true,
        'duplicate', false,
        'delivery_id', v_delivery_id,
        'delivery_reference', p_delivery_reference,
        'total_amount', v_calc_total,
        'total_declared_paid', v_calc_declared_paid,
        'outstanding_balance', v_calc_outstanding,
        'payment_status', v_derived_status
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION submit_delivery_atomic FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submit_delivery_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION submit_delivery_atomic TO service_role;

-- ============================================================================
-- 7. STOCK MANAGEMENT PROCEDURES (RECEIVE, DISPATCH, RETURN, DAMAGE, ADJUST)
-- ============================================================================

CREATE OR REPLACE FUNCTION receive_stock_warehouse(
    p_product_id UUID,
    p_location_id UUID,
    p_full_sheets INT,
    p_half_sheets INT DEFAULT 0,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_operator_id UUID;
    v_operator_role user_role_enum;
BEGIN
    v_operator_id := auth.uid();
    IF v_operator_id IS NULL AND current_user = 'postgres' THEN
        SELECT id INTO v_operator_id FROM profiles WHERE role = 'owner' LIMIT 1;
    END IF;

    SELECT role INTO v_operator_role FROM profiles WHERE id = v_operator_id;
    IF v_operator_role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Only owners and managers can receive stock into warehouse';
    END IF;

    IF p_full_sheets < 0 OR p_half_sheets < 0 OR (p_full_sheets = 0 AND p_half_sheets = 0) THEN
        RAISE EXCEPTION 'INVALID_STOCK_QUANTITY: Quantities must be non-negative and non-zero';
    END IF;

    -- Update or insert inventory balance
    INSERT INTO inventory_balances (product_id, stock_location_id, full_sheets, half_sheets)
    VALUES (p_product_id, p_location_id, p_full_sheets, p_half_sheets)
    ON CONFLICT (product_id, stock_location_id) DO UPDATE
    SET full_sheets = inventory_balances.full_sheets + p_full_sheets,
        half_sheets = inventory_balances.half_sheets + p_half_sheets,
        updated_at = timezone('utc', now());

    -- Record stock movement
    INSERT INTO stock_movements (
        product_id, from_location_id, to_location_id,
        full_sheets_delta, half_sheets_delta, fse_delta,
        movement_type, responsible_employee_id, notes
    ) VALUES (
        p_product_id, NULL, p_location_id,
        p_full_sheets, p_half_sheets, (p_full_sheets * 1.0) + (p_half_sheets * 0.5),
        'stock_receipt', v_operator_id, p_notes
    );

    RETURN jsonb_build_object('success', true, 'received_full', p_full_sheets, 'received_half', p_half_sheets);
END;
$$;

CREATE OR REPLACE FUNCTION dispatch_stock_vehicle(
    p_product_id UUID,
    p_warehouse_id UUID,
    p_vehicle_location_id UUID,
    p_full_sheets INT,
    p_half_sheets INT DEFAULT 0,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_operator_id UUID;
    v_wh_full INT;
    v_wh_half INT;
BEGIN
    v_operator_id := auth.uid();
    IF v_operator_id IS NULL AND current_user = 'postgres' THEN
        SELECT id INTO v_operator_id FROM profiles WHERE role = 'owner' LIMIT 1;
    END IF;

    IF p_full_sheets < 0 OR p_half_sheets < 0 OR (p_full_sheets = 0 AND p_half_sheets = 0) THEN
        RAISE EXCEPTION 'INVALID_QUANTITY: Dispatch quantities must be positive';
    END IF;

    -- Lock warehouse balance
    SELECT full_sheets, half_sheets INTO v_wh_full, v_wh_half
    FROM inventory_balances
    WHERE product_id = p_product_id AND stock_location_id = p_warehouse_id
    FOR UPDATE;

    IF v_wh_full IS NULL OR v_wh_full < p_full_sheets OR v_wh_half < p_half_sheets THEN
        RAISE EXCEPTION 'INSUFFICIENT_WAREHOUSE_STOCK: Warehouse does not have sufficient stock to dispatch';
    END IF;

    -- Deduct warehouse balance
    UPDATE inventory_balances
    SET full_sheets = full_sheets - p_full_sheets,
        half_sheets = half_sheets - p_half_sheets,
        updated_at = timezone('utc', now())
    WHERE product_id = p_product_id AND stock_location_id = p_warehouse_id;

    -- Add to vehicle stock balance
    INSERT INTO inventory_balances (product_id, stock_location_id, full_sheets, half_sheets)
    VALUES (p_product_id, p_vehicle_location_id, p_full_sheets, p_half_sheets)
    ON CONFLICT (product_id, stock_location_id) DO UPDATE
    SET full_sheets = inventory_balances.full_sheets + p_full_sheets,
        half_sheets = inventory_balances.half_sheets + p_half_sheets,
        updated_at = timezone('utc', now());

    -- Record transfer stock movement
    INSERT INTO stock_movements (
        product_id, from_location_id, to_location_id,
        full_sheets_delta, half_sheets_delta, fse_delta,
        movement_type, responsible_employee_id, notes
    ) VALUES (
        p_product_id, p_warehouse_id, p_vehicle_location_id,
        p_full_sheets, p_half_sheets, (p_full_sheets * 1.0) + (p_half_sheets * 0.5),
        'dispatch_to_truck', v_operator_id, p_notes
    );

    RETURN jsonb_build_object('success', true, 'dispatched_full', p_full_sheets, 'dispatched_half', p_half_sheets);
END;
$$;

-- ============================================================================
-- 8. COLLECTIONS & ALLOCATION STORED PROCEDURES
-- ============================================================================

CREATE OR REPLACE FUNCTION record_customer_collection(
    p_customer_id UUID,
    p_channel payment_channel_enum,
    p_amount NUMERIC,
    p_external_ref TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_collector_id UUID;
    v_ref TEXT;
    v_collection_id UUID;
    v_turnover_id UUID;
BEGIN
    v_collector_id := auth.uid();
    IF v_collector_id IS NULL AND current_user = 'postgres' THEN
        SELECT id INTO v_collector_id FROM profiles WHERE role = 'owner' LIMIT 1;
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'INVALID_AMOUNT: Collection amount must be positive';
    END IF;

    -- Generate reference: COL-YYYYMM-XXXX
    v_ref := 'COL-' || TO_CHAR(CURRENT_DATE, 'YYYYMM') || '-' || LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');

    INSERT INTO collections (
        collection_reference, customer_id, collected_by, channel,
        total_amount, allocated_amount, unallocated_amount, external_ref, notes
    ) VALUES (
        v_ref, p_customer_id, v_collector_id, p_channel,
        p_amount, 0.00, p_amount, p_external_ref, p_notes
    ) RETURNING id INTO v_collection_id;

    -- If cash or personal m-pesa, update turnover liability
    IF p_channel IN ('cash', 'mpesa_employee_phone') THEN
        SELECT id INTO v_turnover_id
        FROM employee_turnovers
        WHERE employee_id = v_collector_id AND shift_date = CURRENT_DATE;

        IF v_turnover_id IS NOT NULL THEN
            UPDATE employee_turnovers
            SET cash_declared = cash_declared + (CASE WHEN p_channel = 'cash' THEN p_amount ELSE 0 END),
                personal_mpesa_declared = personal_mpesa_declared + (CASE WHEN p_channel = 'mpesa_employee_phone' THEN p_amount ELSE 0 END)
            WHERE id = v_turnover_id;
        ELSE
            INSERT INTO employee_turnovers (
                employee_id, shift_date, cash_declared, personal_mpesa_declared, cash_remitted, mpesa_forwarded, variance
            ) VALUES (
                v_collector_id, CURRENT_DATE,
                (CASE WHEN p_channel = 'cash' THEN p_amount ELSE 0 END),
                (CASE WHEN p_channel = 'mpesa_employee_phone' THEN p_amount ELSE 0 END),
                0.00, 0.00, -p_amount
            );
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'collection_id', v_collection_id,
        'collection_reference', v_ref,
        'total_amount', p_amount,
        'unallocated_amount', p_amount
    );
END;
$$;

CREATE OR REPLACE FUNCTION allocate_collection_invoice(
    p_collection_id UUID,
    p_delivery_id UUID,
    p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_operator_id UUID;
    v_collection RECORD;
    v_delivery RECORD;
BEGIN
    v_operator_id := auth.uid();
    IF v_operator_id IS NULL AND current_user = 'postgres' THEN
        SELECT id INTO v_operator_id FROM profiles WHERE role = 'owner' LIMIT 1;
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'INVALID_ALLOCATION_AMOUNT: Allocation amount must be positive';
    END IF;

    -- Lock collection
    SELECT * INTO v_collection
    FROM collections
    WHERE id = p_collection_id
    FOR UPDATE;

    IF v_collection.id IS NULL THEN
        RAISE EXCEPTION 'COLLECTION_NOT_FOUND: Collection does not exist';
    END IF;

    IF v_collection.unallocated_amount < p_amount THEN
        RAISE EXCEPTION 'INSUFFICIENT_UNALLOCATED_FUNDS: Collection has % unallocated, cannot allocate %',
            v_collection.unallocated_amount, p_amount;
    END IF;

    -- Lock delivery
    SELECT * INTO v_delivery
    FROM deliveries
    WHERE id = p_delivery_id
    FOR UPDATE;

    IF v_delivery.id IS NULL THEN
        RAISE EXCEPTION 'DELIVERY_NOT_FOUND: Delivery invoice does not exist';
    END IF;

    IF v_delivery.customer_id != v_collection.customer_id THEN
        RAISE EXCEPTION 'CUSTOMER_MISMATCH: Collection customer does not match invoice customer';
    END IF;

    IF v_delivery.outstanding_balance < p_amount THEN
        RAISE EXCEPTION 'EXCESS_ALLOCATION: Invoice balance is %, cannot allocate %',
            v_delivery.outstanding_balance, p_amount;
    END IF;

    -- Update collection
    UPDATE collections
    SET allocated_amount = allocated_amount + p_amount,
        unallocated_amount = unallocated_amount - p_amount,
        is_fully_allocated = (unallocated_amount - p_amount = 0)
    WHERE id = p_collection_id;

    -- Update delivery outstanding balance
    UPDATE deliveries
    SET outstanding_balance = outstanding_balance - p_amount,
        payment_status = (CASE WHEN outstanding_balance - p_amount = 0 THEN 'fully_paid' ELSE 'partially_paid' END)::payment_status_enum
    WHERE id = p_delivery_id;

    -- Update credit account balance
    UPDATE credit_accounts
    SET current_balance = GREATEST(0.00, current_balance - p_amount),
        total_credit_repaid = total_credit_repaid + p_amount,
        last_payment_date = timezone('utc', now()),
        updated_at = timezone('utc', now())
    WHERE customer_id = v_collection.customer_id;

    -- Insert allocation record
    INSERT INTO payment_allocations (
        collection_id, delivery_id, allocated_amount, allocated_by
    ) VALUES (
        p_collection_id, p_delivery_id, p_amount, v_operator_id
    );

    RETURN jsonb_build_object(
        'success', true,
        'allocated_amount', p_amount,
        'remaining_collection_unallocated', v_collection.unallocated_amount - p_amount,
        'remaining_invoice_balance', v_delivery.outstanding_balance - p_amount
    );
END;
$$;

-- ============================================================================
-- 9. INBOUND SMS ATOMIC PROCESSING & DISPUTE STATE MACHINE RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION process_inbound_sms_atomic(
    p_provider_message_id TEXT,
    p_sender_phone TEXT,
    p_raw_text TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_inbound_id UUID;
    v_delivery RECORD;
    v_customer RECORD;
    v_upper_text TEXT;
    v_ref_match TEXT;
    v_is_confirm BOOLEAN;
    v_is_dispute BOOLEAN;
    v_category dispute_category_enum := 'other';
    v_event_type TEXT;
    v_code TEXT;
BEGIN
    -- Check deduplication
    SELECT id INTO v_inbound_id
    FROM inbound_sms_messages
    WHERE provider_message_id = p_provider_message_id;

    IF v_inbound_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'duplicate', true);
    END IF;

    -- Insert raw inbound SMS
    INSERT INTO inbound_sms_messages (
        provider_message_id, sender_phone, raw_message_text, processing_status
    ) VALUES (
        p_provider_message_id, p_sender_phone, p_raw_text, 'received'
    ) RETURNING id INTO v_inbound_id;

    v_upper_text := UPPER(TRIM(p_raw_text));

    -- Extract explicit reference if present
    SELECT (regexp_matches(v_upper_text, '(GD-\d{6}-\d{4}|GD-\d{4,6})'))[1] INTO v_ref_match;

    IF v_ref_match IS NOT NULL THEN
        SELECT d.id, d.delivery_reference, d.customer_id, d.customer_confirmation_status,
               c.primary_phone, c.alt_phone, c.name AS customer_name
        INTO v_delivery
        FROM deliveries d
        JOIN customers c ON c.id = d.customer_id
        WHERE d.delivery_reference ILIKE v_ref_match;

        IF v_delivery.id IS NULL THEN
            UPDATE inbound_sms_messages
            SET processing_status = 'invalid_reference', failure_reason = 'Reference ' || v_ref_match || ' not found'
            WHERE id = v_inbound_id;

            RETURN jsonb_build_object('success', false, 'status', 'invalid_reference', 'reference', v_ref_match);
        END IF;

        -- Strict sender phone verification
        IF v_delivery.primary_phone != p_sender_phone AND COALESCE(v_delivery.alt_phone, '') != p_sender_phone THEN
            UPDATE inbound_sms_messages
            SET processing_status = 'failed',
                failure_reason = 'Unauthorized sender ' || p_sender_phone || ' for delivery ' || v_ref_match,
                matched_delivery_id = v_delivery.id
            WHERE id = v_inbound_id;

            INSERT INTO customer_confirmation_events (
                delivery_id, inbound_sms_id, sender_phone, response_code, event_type, raw_text
            ) VALUES (
                v_delivery.id, v_inbound_id, p_sender_phone, 'UNAUTHORIZED', 'unauthorized_attempt', p_raw_text
            );

            RETURN jsonb_build_object('success', false, 'status', 'unauthorized_sender', 'reference', v_ref_match);
        END IF;
    ELSE
        -- Match customer by phone number
        SELECT id, name INTO v_customer
        FROM customers
        WHERE primary_phone = p_sender_phone OR alt_phone = p_sender_phone;

        IF v_customer.id IS NULL THEN
            UPDATE inbound_sms_messages
            SET processing_status = 'unmatched', failure_reason = 'Sender not found in customer directory'
            WHERE id = v_inbound_id;

            RETURN jsonb_build_object('success', false, 'status', 'unmatched');
        END IF;

        -- Find pending delivery in last 72h
        SELECT d.id, d.delivery_reference, d.customer_id, d.customer_confirmation_status
        INTO v_delivery
        FROM deliveries d
        WHERE d.customer_id = v_customer.id
          AND d.customer_confirmation_status IN ('pending', 'disputed')
          AND d.created_at >= timezone('utc', now()) - INTERVAL '72 hours'
        ORDER BY d.created_at DESC
        LIMIT 1;

        IF v_delivery.id IS NULL THEN
            UPDATE inbound_sms_messages
            SET processing_status = 'unmatched', failure_reason = 'No active pending/disputed deliveries for customer'
            WHERE id = v_inbound_id;

            RETURN jsonb_build_object('success', false, 'status', 'no_pending');
        END IF;
    END IF;

    -- Update inbound message matched delivery
    UPDATE inbound_sms_messages
    SET matched_delivery_id = v_delivery.id,
        processing_status = 'processed',
        processed_at = timezone('utc', now())
    WHERE id = v_inbound_id;

    -- State Machine
    -- 1. If delivery is ALREADY DISPUTED: incoming responses are questionnaire reasons!
    IF v_delivery.customer_confirmation_status = 'disputed' THEN
        IF v_upper_text ~ '(^|\s)(1|WRONG ITEM|QUANTITY|COUNT)($|\s)' THEN
            v_category := 'wrong_items_or_quantities';
        ELSIF v_upper_text ~ '(^|\s)(2|PRICE|RATE|OVERCHARGE)($|\s)' THEN
            v_category := 'incorrect_price';
        ELSIF v_upper_text ~ '(^|\s)(3|PAYMENT|CASH|MPESA|BALANCE)($|\s)' THEN
            v_category := 'wrong_payment_declared';
        ELSIF v_upper_text ~ '(^|\s)(4|NOT RECEIVED|NEVER RECEIVED)($|\s)' THEN
            v_category := 'delivery_never_received';
        ELSIF v_upper_text ~ '(^|\s)(5|DAMAGED|BROKEN|CRACK)($|\s)' THEN
            v_category := 'damaged_glass_uncredited';
        END IF;

        UPDATE customer_disputes
        SET dispute_category = v_category,
            customer_notes = customer_notes || ' | Follow-up SMS: ' || p_raw_text
        WHERE delivery_id = v_delivery.id AND is_active = true;

        INSERT INTO customer_confirmation_events (
            delivery_id, inbound_sms_id, sender_phone, response_code, event_type, raw_text
        ) VALUES (
            v_delivery.id, v_inbound_id, p_sender_phone, 'CATEGORY_UPDATE', 'dispute_category_clarification', p_raw_text
        );

        RETURN jsonb_build_object(
            'success', true,
            'status', 'dispute_updated',
            'delivery_reference', v_delivery.delivery_reference,
            'category', v_category
        );
    END IF;

    -- 2. Delivery is awaiting initial response
    v_is_confirm := v_upper_text ~ '(^|\s)(1|YES|CONFIRM|CONFIRMED|SAWA)($|\s)';
    v_is_dispute := v_upper_text ~ '(^|\s)(2|NO|DISPUTE|PROBLEM|WRONG|HAPANA)($|\s)';

    IF v_is_confirm THEN
        UPDATE deliveries
        SET customer_confirmation_status = 'confirmed'
        WHERE id = v_delivery.id;

        INSERT INTO customer_confirmation_events (
            delivery_id, inbound_sms_id, sender_phone, response_code, event_type, raw_text
        ) VALUES (
            v_delivery.id, v_inbound_id, p_sender_phone, '1', 'confirmation', p_raw_text
        );

        INSERT INTO customer_confirmations (
            delivery_id, inbound_sms_id, reply_channel, response_code, sender_phone
        ) VALUES (
            v_delivery.id, v_inbound_id, 'SMS', '1', p_sender_phone
        ) ON CONFLICT (delivery_id) DO NOTHING;

        RETURN jsonb_build_object('success', true, 'status', 'confirmed', 'delivery_reference', v_delivery.delivery_reference);
    ELSIF v_is_dispute THEN
        UPDATE deliveries
        SET customer_confirmation_status = 'disputed'
        WHERE id = v_delivery.id;

        -- Parse category if given in initial message (e.g., '2 3' or '2 price wrong')
        IF v_upper_text ~ '(2[\s\-_:]*1|WRONG ITEM|QUANTITY)' THEN
            v_category := 'wrong_items_or_quantities';
        ELSIF v_upper_text ~ '(2[\s\-_:]*2|PRICE|RATE|OVERCHARGE)' THEN
            v_category := 'incorrect_price';
        ELSIF v_upper_text ~ '(2[\s\-_:]*3|PAYMENT|CASH|MPESA)' THEN
            v_category := 'wrong_payment_declared';
        ELSIF v_upper_text ~ '(2[\s\-_:]*4|NOT RECEIVED|NEVER)' THEN
            v_category := 'delivery_never_received';
        ELSIF v_upper_text ~ '(2[\s\-_:]*5|DAMAGED|BROKEN|CRACK)' THEN
            v_category := 'damaged_glass_uncredited';
        END IF;

        INSERT INTO customer_disputes (
            delivery_id, customer_id, inbound_sms_id, dispute_category, customer_notes, is_active
        ) VALUES (
            v_delivery.id, v_delivery.customer_id, v_inbound_id, v_category, p_raw_text, true
        );

        INSERT INTO customer_confirmation_events (
            delivery_id, inbound_sms_id, sender_phone, response_code, event_type, raw_text
        ) VALUES (
            v_delivery.id, v_inbound_id, p_sender_phone, '2', 'dispute', p_raw_text
        );

        INSERT INTO customer_confirmations (
            delivery_id, inbound_sms_id, reply_channel, response_code, sender_phone
        ) VALUES (
            v_delivery.id, v_inbound_id, 'SMS', '2', p_sender_phone
        ) ON CONFLICT (delivery_id) DO NOTHING;

        RETURN jsonb_build_object(
            'success', true,
            'status', 'disputed',
            'delivery_reference', v_delivery.delivery_reference,
            'category', v_category
        );
    ELSE
        INSERT INTO customer_confirmation_events (
            delivery_id, inbound_sms_id, sender_phone, response_code, event_type, raw_text
        ) VALUES (
            v_delivery.id, v_inbound_id, p_sender_phone, 'UNRECOGNIZED', 'unrecognized', p_raw_text
        );

        RETURN jsonb_build_object('success', false, 'status', 'unrecognized_intent', 'delivery_reference', v_delivery.delivery_reference);
    END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION process_inbound_sms_atomic FROM PUBLIC;
GRANT EXECUTE ON FUNCTION process_inbound_sms_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION process_inbound_sms_atomic TO service_role;
