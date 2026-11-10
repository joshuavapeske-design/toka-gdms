-- ============================================================================
-- TOKA GDMS — ROW-LEVEL SECURITY, AUDIT CONTROLS & ATOMIC DELIVERY RPC
-- Migration: 20261110000000_rls_policies_and_atomic_rpc.sql
-- ============================================================================

-- 1. ADD PAYLOAD HASH COLUMN TO DELIVERIES (FOR CANONICAL IDEMPOTENCY)
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS payload_hash TEXT NOT NULL DEFAULT '';

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

-- Revoke default public execution
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
BEGIN
    IF (OLD.role != NEW.role OR OLD.is_active != NEW.is_active) THEN
        IF (auth.get_user_role() != 'owner' AND current_user != 'postgres' AND current_user != 'service_role') THEN
            RAISE EXCEPTION 'PERMISSION_DENIED: Only owners can alter user roles or account status';
        END IF;
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
    IF OLD.client_tx_id != NEW.client_tx_id
       OR OLD.total_amount != NEW.total_amount
       OR OLD.subtotal_amount != NEW.subtotal_amount
       OR OLD.discount_amount != NEW.discount_amount
       OR OLD.total_declared_paid != NEW.total_declared_paid
       OR OLD.outstanding_balance != NEW.outstanding_balance
       OR OLD.customer_id != NEW.customer_id
       OR OLD.delivery_reference != NEW.delivery_reference THEN
        RAISE EXCEPTION 'IMMUTABLE_DELIVERY: Core financial, customer, and reference attributes cannot be altered on a submitted delivery.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_delivery_immutability ON deliveries;
CREATE TRIGGER trg_protect_delivery_immutability
BEFORE UPDATE ON deliveries
FOR EACH ROW EXECUTE FUNCTION protect_delivery_immutability();

-- ============================================================================
-- 4. ENABLE ROW-LEVEL SECURITY ON ALL APPLICATION TABLES
-- ============================================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
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
ALTER TABLE customer_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transformations ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_corrections ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 5. RLS POLICIES FOR ALL TABLES (NO DEFAULT-DENY HOLES)
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
FOR UPDATE USING (auth.get_user_role() IN ('owner', 'manager'));

DROP POLICY IF EXISTS "deliveries_delete_block" ON deliveries;
CREATE POLICY "deliveries_delete_block" ON deliveries FOR DELETE USING (false);

DROP POLICY IF EXISTS "delivery_items_select" ON delivery_items;
CREATE POLICY "delivery_items_select" ON delivery_items FOR SELECT USING (true);

DROP POLICY IF EXISTS "delivery_items_insert" ON delivery_items;
CREATE POLICY "delivery_items_insert" ON delivery_items
FOR INSERT WITH CHECK (auth.get_user_role() IN ('owner', 'manager', 'salesperson', 'driver'));

-- PAYMENT DECLARATIONS & COLLECTIONS
DROP POLICY IF EXISTS "payment_declarations_select" ON payment_declarations;
CREATE POLICY "payment_declarations_select" ON payment_declarations FOR SELECT USING (true);

DROP POLICY IF EXISTS "payment_declarations_insert" ON payment_declarations;
CREATE POLICY "payment_declarations_insert" ON payment_declarations
FOR INSERT WITH CHECK (declared_by = auth.uid());

DROP POLICY IF EXISTS "collections_select" ON collections;
CREATE POLICY "collections_select" ON collections FOR SELECT USING (true);

DROP POLICY IF EXISTS "collections_insert" ON collections;
CREATE POLICY "collections_insert" ON collections
FOR INSERT WITH CHECK (collected_by = auth.uid() AND auth.get_user_role() IN ('owner', 'manager', 'cash_collector', 'accountant'));

DROP POLICY IF EXISTS "collections_update" ON collections;
CREATE POLICY "collections_update" ON collections
FOR UPDATE USING (auth.get_user_role() IN ('owner', 'manager', 'accountant'));

DROP POLICY IF EXISTS "payment_allocations_select" ON payment_allocations;
CREATE POLICY "payment_allocations_select" ON payment_allocations FOR SELECT USING (true);

DROP POLICY IF EXISTS "payment_allocations_insert" ON payment_allocations;
CREATE POLICY "payment_allocations_insert" ON payment_allocations
FOR INSERT WITH CHECK (auth.get_user_role() IN ('owner', 'manager', 'accountant', 'cash_collector'));

-- REVERSALS & TURNOVERS
DROP POLICY IF EXISTS "payment_reversals_select" ON payment_reversals;
CREATE POLICY "payment_reversals_select" ON payment_reversals
FOR SELECT USING (auth.get_user_role() IN ('owner', 'manager', 'accountant'));

DROP POLICY IF EXISTS "payment_reversals_insert" ON payment_reversals;
CREATE POLICY "payment_reversals_insert" ON payment_reversals
FOR INSERT WITH CHECK (requested_by = auth.uid() AND auth.get_user_role() = 'accountant');

DROP POLICY IF EXISTS "payment_reversals_update" ON payment_reversals;
CREATE POLICY "payment_reversals_update" ON payment_reversals
FOR UPDATE USING (auth.get_user_role() = 'owner' AND requested_by != auth.uid());

DROP POLICY IF EXISTS "employee_turnovers_select" ON employee_turnovers;
CREATE POLICY "employee_turnovers_select" ON employee_turnovers
FOR SELECT USING (auth.get_user_role() IN ('owner', 'manager', 'accountant') OR employee_id = auth.uid());

DROP POLICY IF EXISTS "employee_turnovers_modify" ON employee_turnovers;
CREATE POLICY "employee_turnovers_modify" ON employee_turnovers
FOR ALL USING (auth.get_user_role() IN ('owner', 'manager', 'accountant'));

-- INVENTORY & STOCK
DROP POLICY IF EXISTS "stock_locations_select" ON stock_locations;
CREATE POLICY "stock_locations_select" ON stock_locations FOR SELECT USING (true);

DROP POLICY IF EXISTS "stock_movements_select" ON stock_movements;
CREATE POLICY "stock_movements_select" ON stock_movements FOR SELECT USING (true);

DROP POLICY IF EXISTS "stock_movements_insert" ON stock_movements;
CREATE POLICY "stock_movements_insert" ON stock_movements
FOR INSERT WITH CHECK (responsible_employee_id = auth.uid() OR auth.get_user_role() IN ('owner', 'manager'));

DROP POLICY IF EXISTS "stock_transformations_select" ON stock_transformations;
CREATE POLICY "stock_transformations_select" ON stock_transformations FOR SELECT USING (true);

DROP POLICY IF EXISTS "stock_transformations_insert" ON stock_transformations;
CREATE POLICY "stock_transformations_insert" ON stock_transformations
FOR INSERT WITH CHECK (operator_id = auth.uid() OR auth.get_user_role() IN ('owner', 'manager'));

-- SMS, CONFIRMATIONS & DISPUTES
DROP POLICY IF EXISTS "inbound_sms_select" ON inbound_sms_messages;
CREATE POLICY "inbound_sms_select" ON inbound_sms_messages
FOR SELECT USING (auth.get_user_role() IN ('owner', 'manager', 'accountant'));

DROP POLICY IF EXISTS "customer_confirmations_select" ON customer_confirmations;
CREATE POLICY "customer_confirmations_select" ON customer_confirmations FOR SELECT USING (true);

DROP POLICY IF EXISTS "customer_disputes_select" ON customer_disputes;
CREATE POLICY "customer_disputes_select" ON customer_disputes FOR SELECT USING (true);

DROP POLICY IF EXISTS "customer_disputes_modify" ON customer_disputes;
CREATE POLICY "customer_disputes_modify" ON customer_disputes
FOR ALL USING (auth.get_user_role() IN ('owner', 'manager', 'accountant'));

DROP POLICY IF EXISTS "notifications_select" ON notifications;
CREATE POLICY "notifications_select" ON notifications
FOR SELECT USING (auth.get_user_role() IN ('owner', 'manager', 'accountant'));

-- TELEMETRY, AUDIT & CORRECTIONS
DROP POLICY IF EXISTS "location_samples_select" ON location_samples;
CREATE POLICY "location_samples_select" ON location_samples
FOR SELECT USING (auth.get_user_role() IN ('owner', 'manager'));

DROP POLICY IF EXISTS "location_samples_insert" ON location_samples;
CREATE POLICY "location_samples_insert" ON location_samples FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "audit_logs_select" ON audit_logs;
CREATE POLICY "audit_logs_select" ON audit_logs
FOR SELECT USING (auth.get_user_role() IN ('owner', 'manager', 'accountant'));

DROP POLICY IF EXISTS "transaction_corrections_select" ON transaction_corrections;
CREATE POLICY "transaction_corrections_select" ON transaction_corrections
FOR SELECT USING (auth.get_user_role() IN ('owner', 'manager', 'accountant'));

DROP POLICY IF EXISTS "transaction_corrections_insert" ON transaction_corrections;
CREATE POLICY "transaction_corrections_insert" ON transaction_corrections
FOR INSERT WITH CHECK (requested_by = auth.uid() AND auth.get_user_role() IN ('accountant', 'manager'));

DROP POLICY IF EXISTS "transaction_corrections_update" ON transaction_corrections;
CREATE POLICY "transaction_corrections_update" ON transaction_corrections
FOR UPDATE USING (auth.get_user_role() = 'owner' AND requested_by != auth.uid());

-- ============================================================================
-- 6. ATOMIC DELIVERY CREATION STORED PROCEDURE (RPC)
-- Complete with caller authorization, vehicle verification, physical half-sheet
-- transformation, stock ledger locking, and canonical payload hash idempotency
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
    v_item RECORD;
    v_payment RECORD;
    v_product RECORD;
    v_customer RECORD;
    v_credit_acc RECORD;
    v_assignment RECORD;
    v_item_unit selling_unit_enum;
    v_item_qty INT;
    v_item_price NUMERIC;
    v_item_fse NUMERIC;
    v_official_price NUMERIC;
    v_item_total NUMERIC;
    v_half_sheets_needed INT;
    v_full_sheets_to_split INT;
    v_avail_half_sheets NUMERIC;
    v_avail_full_sheets NUMERIC;
BEGIN
    -- 1. CALLER AUTHENTICATION & AUTHORIZATION ENFORCEMENT
    v_caller_id := auth.uid();
    
    -- If executed through authenticated Supabase context, enforce caller match
    IF v_caller_id IS NOT NULL THEN
        IF v_caller_id != p_created_by THEN
            RAISE EXCEPTION 'UNAUTHORIZED: p_created_by must match authenticated caller id';
        END IF;

        SELECT role, is_active INTO v_caller_role
        FROM profiles WHERE id = v_caller_id AND is_active = true;

        IF v_caller_role IS NULL THEN
            RAISE EXCEPTION 'ACCESS_DENIED: Caller profile not found or account is deactivated';
        END IF;

        IF v_caller_role NOT IN ('owner', 'manager', 'salesperson', 'driver') THEN
            RAISE EXCEPTION 'ROLE_NOT_AUTHORIZED: Role % is not authorized to submit deliveries', v_caller_role;
        END IF;

        -- 2. VEHICLE SHIFT ASSIGNMENT VERIFICATION
        -- Caller MUST be assigned to the vehicle shift
        SELECT id, driver_id, salesperson_id, is_active INTO v_assignment
        FROM vehicle_assignments
        WHERE id = p_vehicle_assignment_id AND is_active = true;

        IF v_assignment.id IS NULL THEN
            RAISE EXCEPTION 'INVALID_ASSIGNMENT: Active vehicle assignment not found';
        END IF;

        IF v_caller_role IN ('driver', 'salesperson') AND 
           v_assignment.driver_id != v_caller_id AND 
           v_assignment.salesperson_id != v_caller_id THEN
            RAISE EXCEPTION 'UNAUTHORIZED_SHIFT: Caller is not assigned to vehicle assignment %', p_vehicle_assignment_id;
        END IF;
    END IF;

    -- 3. CANONICAL PAYLOAD HASH IDEMPOTENCY CHECK
    SELECT id, payload_hash INTO v_existing_id, v_existing_hash
    FROM deliveries
    WHERE client_tx_id = p_client_tx_id;

    IF v_existing_id IS NOT NULL THEN
        IF v_existing_hash != p_payload_hash AND p_payload_hash != '' THEN
            RAISE EXCEPTION 'IDEMPOTENCY_MISMATCH: Existing delivery with clientTxId % has differing payload hash', p_client_tx_id;
        END IF;

        -- Idempotent acknowledge
        RETURN jsonb_build_object(
            'success', true,
            'duplicate', true,
            'delivery_id', v_existing_id,
            'delivery_reference', p_delivery_reference,
            'message', 'Delivery was already synchronized.'
        );
    END IF;

    -- 4. CUSTOMER & CREDIT VALIDATION
    SELECT id, is_credit_eligible, credit_limit INTO v_customer
    FROM customers WHERE id = p_customer_id AND is_active = true;

    IF v_customer.id IS NULL THEN
        RAISE EXCEPTION 'CUSTOMER_NOT_FOUND: Customer does not exist or is inactive';
    END IF;

    IF p_outstanding_balance > 0 THEN
        IF NOT v_customer.is_credit_eligible THEN
            RAISE EXCEPTION 'CREDIT_NOT_AUTHORIZED: Customer is not authorized for credit purchases';
        END IF;

        -- Check credit limit against credit account
        SELECT current_balance, total_credit_extended, total_credit_repaid 
        INTO v_credit_acc
        FROM credit_accounts WHERE customer_id = p_customer_id;

        IF v_credit_acc.current_balance + p_outstanding_balance > v_customer.credit_limit THEN
            RAISE EXCEPTION 'CREDIT_LIMIT_EXCEEDED: Transaction exceeds customer credit limit (Balance: %, Limit: %, Requested: %)',
                v_credit_acc.current_balance, v_customer.credit_limit, p_outstanding_balance;
        END IF;

        -- Update credit account balance atomically
        UPDATE credit_accounts
        SET current_balance = current_balance + p_outstanding_balance,
            total_credit_extended = total_credit_extended + p_outstanding_balance,
            updated_at = timezone('utc', now())
        WHERE customer_id = p_customer_id;
    END IF;

    -- 5. INSERT DELIVERIES ROW
    INSERT INTO deliveries (
        delivery_reference,
        client_tx_id,
        payload_hash,
        customer_id,
        created_by,
        vehicle_assignment_id,
        operational_status,
        payment_status,
        reconciliation_status,
        customer_confirmation_status,
        subtotal_amount,
        discount_amount,
        total_amount,
        total_declared_paid,
        outstanding_balance,
        delivery_lat,
        delivery_lng,
        gps_accuracy_m,
        device_captured_at,
        submitted_at,
        synced_at,
        is_offline_submission,
        notes
    ) VALUES (
        p_delivery_reference,
        p_client_tx_id,
        p_payload_hash,
        p_customer_id,
        p_created_by,
        p_vehicle_assignment_id,
        'delivered',
        p_payment_status,
        'pending_reconciliation',
        'pending',
        p_subtotal_amount,
        p_discount_amount,
        p_total_amount,
        p_total_declared_paid,
        p_outstanding_balance,
        p_delivery_lat,
        p_delivery_lng,
        p_gps_accuracy_m,
        COALESCE(p_device_captured_at, timezone('utc', now())),
        timezone('utc', now()),
        timezone('utc', now()),
        p_is_offline_submission,
        p_notes
    )
    RETURNING id INTO v_delivery_id;

    -- 6. PROCESS LINE ITEMS, PRICES & INVENTORY
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        "productId" UUID,
        "sellingUnit" TEXT,
        "quantity" INT,
        "fullSheetEquivalent" NUMERIC,
        "officialUnitPrice" NUMERIC,
        "appliedUnitPrice" NUMERIC,
        "isSpecialPrice" BOOLEAN,
        "priceApprovalId" UUID,
        "lineTotal" NUMERIC
    )
    LOOP
        v_item_unit := v_item."sellingUnit"::selling_unit_enum;
        v_item_qty := v_item."quantity";
        v_item_price := v_item."appliedUnitPrice";

        IF v_item_qty <= 0 THEN
            RAISE EXCEPTION 'INVALID_QUANTITY: Item quantity must be positive';
        END IF;

        -- Verify Product & Official Pricing
        SELECT id, standard_full_sheet_price, standard_half_sheet_price INTO v_product
        FROM products WHERE id = v_item."productId" AND is_active = true;

        IF v_product.id IS NULL THEN
            RAISE EXCEPTION 'PRODUCT_NOT_FOUND: Product % is invalid', v_item."productId";
        END IF;

        v_official_price := CASE 
            WHEN v_item_unit = 'FULL_SHEET' THEN v_product.standard_full_sheet_price
            WHEN v_item_unit = 'HALF_SHEET' THEN v_product.standard_half_sheet_price
            ELSE 0.00
        END;

        -- Independent Price Authorization Check
        IF v_item_price < v_official_price THEN
            IF v_item."priceApprovalId" IS NULL THEN
                RAISE EXCEPTION 'UNAUTHORIZED_PRICE: Discount on product % requires an approved price request', v_item."productId";
            END IF;

            -- Check price approval record
            PERFORM id FROM price_approval_requests
            WHERE id = v_item."priceApprovalId"
              AND product_id = v_item."productId"
              AND selling_unit = v_item_unit
              AND requested_price = v_item_price
              AND status = 'approved'
              AND requested_by != reviewed_by;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'INVALID_PRICE_APPROVAL: Approved price request not verified for product %', v_item."productId";
            END IF;
        END IF;

        IF v_item_unit = 'FULL_SHEET' THEN
            v_item_fse := v_item_qty * 1.0;
            v_item_total := ROUND(v_item_qty * v_item_price, 2);

            -- Deduct full sheets from inventory
            INSERT INTO stock_movements (
                product_id, from_location_id, to_location_id,
                full_sheets_delta, half_sheets_delta, fse_delta,
                movement_type, responsible_employee_id, delivery_id, notes
            ) VALUES (
                v_item."productId", p_warehouse_location_id, NULL,
                -v_item_qty, 0, -v_item_fse,
                'delivery_to_customer', p_created_by, v_delivery_id, 'Delivery ' || p_delivery_reference
            );

        ELSIF v_item_unit = 'HALF_SHEET' THEN
            v_item_fse := v_item_qty * 0.5;
            v_item_total := ROUND(v_item_qty * v_item_price, 2);
            v_half_sheets_needed := v_item_qty;

            -- Calculate currently available physical half sheets at location (ledger lock)
            SELECT COALESCE(SUM(half_sheets_delta), 0) INTO v_avail_half_sheets
            FROM stock_movements
            WHERE product_id = v_item."productId"
              AND (to_location_id = p_warehouse_location_id OR from_location_id = p_warehouse_location_id);

            -- If physical half sheets are insufficient, execute transformation: 1 full sheet -> 2 half sheets
            IF v_avail_half_sheets < v_half_sheets_needed THEN
                v_full_sheets_to_split := CEIL((v_half_sheets_needed - v_avail_half_sheets) / 2.0)::INT;

                -- Insert physical transformation record
                INSERT INTO stock_transformations (
                    product_id, stock_location_id, full_sheets_consumed, half_sheets_produced, operator_id, notes
                ) VALUES (
                    v_item."productId", p_warehouse_location_id, v_full_sheets_to_split, v_full_sheets_to_split * 2, p_created_by,
                    'Split full sheet to produce ordered half sheets for delivery ' || p_delivery_reference
                ) RETURNING id INTO v_trans_id;

                -- Stock movement: Consumption of full sheets and production of physical half sheets (FSE delta = 0)
                INSERT INTO stock_movements (
                    product_id, from_location_id, to_location_id,
                    full_sheets_delta, half_sheets_delta, fse_delta,
                    movement_type, responsible_employee_id, transformation_id, notes
                ) VALUES (
                    v_item."productId", p_warehouse_location_id, p_warehouse_location_id,
                    -v_full_sheets_to_split, v_full_sheets_to_split * 2, 0.00,
                    'split_full_to_half', p_created_by, v_trans_id, 'Split transformation for ' || p_delivery_reference
                );
            END IF;

            -- Deduct ordered half sheets for customer delivery
            INSERT INTO stock_movements (
                product_id, from_location_id, to_location_id,
                full_sheets_delta, half_sheets_delta, fse_delta,
                movement_type, responsible_employee_id, delivery_id, notes
            ) VALUES (
                v_item."productId", p_warehouse_location_id, NULL,
                0, -v_half_sheets_needed, -v_item_fse,
                'delivery_to_customer', p_created_by, v_delivery_id, 'Delivery ' || p_delivery_reference
            );
        END IF;

        -- Insert line item
        INSERT INTO delivery_items (
            delivery_id, product_id, selling_unit, quantity, full_sheet_equivalent,
            official_unit_price, applied_unit_price, is_special_price, price_approval_id, line_total
        ) VALUES (
            v_delivery_id, v_item."productId", v_item_unit, v_item_qty, v_item_fse,
            v_official_price, v_item_price, (v_item_price != v_official_price), v_item."priceApprovalId", v_item_total
        );
    END LOOP;

    -- 7. INSERT PAYMENT DECLARATIONS
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
                v_delivery_id, v_payment."channel"::payment_channel_enum, v_payment."declaredAmount",
                p_created_by, v_payment."externalRef", v_payment."notes"
            );
        END IF;
    END LOOP;

    -- 8. RETURN SUCCESS
    RETURN jsonb_build_object(
        'success', true,
        'duplicate', false,
        'delivery_id', v_delivery_id,
        'delivery_reference', p_delivery_reference
    );
END;
$$;

-- Restrict function execution: NO PUBLIC EXECUTION
REVOKE EXECUTE ON FUNCTION submit_delivery_atomic FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submit_delivery_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION submit_delivery_atomic TO service_role;
