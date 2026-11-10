-- ============================================================================
-- TOKA GDMS — ROW-LEVEL SECURITY (RLS) POLICIES & ATOMIC DELIVERY RPC
-- Migration: 20261110000000_rls_policies_and_atomic_rpc.sql
-- ============================================================================

-- 1. SECURE ROLE HELPER FUNCTION
CREATE OR REPLACE FUNCTION auth.get_user_role()
RETURNS user_role_enum 
LANGUAGE sql 
STABLE 
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid() AND is_active = true;
$$;

-- ============================================================================
-- 2. ENABLE ROW-LEVEL SECURITY ON ALL APPLICATION TABLES
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

-- ============================================================================
-- 3. PROFILES POLICIES
-- ============================================================================

CREATE POLICY "profiles_select_policy" ON profiles
FOR SELECT USING (
    auth.get_user_role() IN ('owner', 'manager', 'accountant')
    OR id = auth.uid()
);

CREATE POLICY "profiles_insert_owner" ON profiles
FOR INSERT WITH CHECK (
    auth.get_user_role() = 'owner'
);

CREATE POLICY "profiles_update_policy" ON profiles
FOR UPDATE USING (
    auth.get_user_role() = 'owner'
    OR (id = auth.uid() AND auth.get_user_role() IS NOT NULL)
);

-- ============================================================================
-- 4. CUSTOMERS & CREDIT POLICIES
-- ============================================================================

CREATE POLICY "customers_select_policy" ON customers
FOR SELECT USING (
    auth.get_user_role() IN ('owner', 'manager', 'accountant', 'cash_collector')
    OR auth.get_user_role() IN ('salesperson', 'driver')
);

CREATE POLICY "customers_insert_policy" ON customers
FOR INSERT WITH CHECK (
    auth.get_user_role() IN ('owner', 'manager')
);

CREATE POLICY "customers_update_policy" ON customers
FOR UPDATE USING (
    auth.get_user_role() IN ('owner', 'manager')
);

CREATE POLICY "credit_accounts_select" ON credit_accounts
FOR SELECT USING (
    auth.get_user_role() IN ('owner', 'manager', 'accountant', 'cash_collector', 'salesperson')
);

CREATE POLICY "credit_accounts_update" ON credit_accounts
FOR UPDATE USING (
    auth.get_user_role() IN ('owner', 'manager', 'accountant')
);

-- ============================================================================
-- 5. PRODUCTS & CATALOG POLICIES
-- ============================================================================

CREATE POLICY "products_select_all" ON products
FOR SELECT USING (true);

CREATE POLICY "products_modify_owner_manager" ON products
FOR ALL USING (
    auth.get_user_role() IN ('owner', 'manager')
);

CREATE POLICY "categories_select_all" ON product_categories
FOR SELECT USING (true);

CREATE POLICY "customer_prices_select" ON customer_prices
FOR SELECT USING (
    auth.get_user_role() IN ('owner', 'manager', 'accountant', 'salesperson', 'driver')
);

CREATE POLICY "customer_prices_modify" ON customer_prices
FOR ALL USING (
    auth.get_user_role() IN ('owner', 'manager')
);

-- ============================================================================
-- 6. FLEET & ASSIGNMENTS POLICIES
-- ============================================================================

CREATE POLICY "vehicles_select" ON vehicles FOR SELECT USING (true);
CREATE POLICY "vehicles_modify" ON vehicles FOR ALL USING (auth.get_user_role() IN ('owner', 'manager'));

CREATE POLICY "routes_select" ON routes FOR SELECT USING (true);
CREATE POLICY "routes_modify" ON routes FOR ALL USING (auth.get_user_role() IN ('owner', 'manager'));

CREATE POLICY "assignments_select" ON vehicle_assignments
FOR SELECT USING (
    auth.get_user_role() IN ('owner', 'manager', 'accountant')
    OR driver_id = auth.uid()
    OR salesperson_id = auth.uid()
);

-- ============================================================================
-- 7. DELIVERIES & LINE ITEMS POLICIES
-- ============================================================================

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

CREATE POLICY "deliveries_insert_policy" ON deliveries
FOR INSERT WITH CHECK (
    auth.get_user_role() IN ('owner', 'manager', 'salesperson', 'driver')
    AND created_by = auth.uid()
);

CREATE POLICY "deliveries_update_policy" ON deliveries
FOR UPDATE USING (
    auth.get_user_role() IN ('owner', 'manager')
);

CREATE POLICY "deliveries_delete_block" ON deliveries
FOR DELETE USING (false);

CREATE POLICY "delivery_items_select" ON delivery_items
FOR SELECT USING (
    auth.get_user_role() IN ('owner', 'manager', 'accountant')
    OR delivery_id IN (SELECT id FROM deliveries WHERE created_by = auth.uid())
);

CREATE POLICY "delivery_items_insert" ON delivery_items
FOR INSERT WITH CHECK (
    auth.get_user_role() IN ('owner', 'manager', 'salesperson', 'driver')
);

-- ============================================================================
-- 8. PAYMENT DECLARATIONS & COLLECTIONS POLICIES
-- ============================================================================

CREATE POLICY "payment_declarations_select" ON payment_declarations
FOR SELECT USING (
    auth.get_user_role() IN ('owner', 'manager', 'accountant')
    OR declared_by = auth.uid()
);

CREATE POLICY "payment_declarations_insert" ON payment_declarations
FOR INSERT WITH CHECK (
    auth.get_user_role() IN ('owner', 'manager', 'salesperson', 'driver')
    AND declared_by = auth.uid()
);

CREATE POLICY "collections_select" ON collections
FOR SELECT USING (
    auth.get_user_role() IN ('owner', 'manager', 'accountant')
    OR collected_by = auth.uid()
);

CREATE POLICY "collections_insert" ON collections
FOR INSERT WITH CHECK (
    auth.get_user_role() IN ('owner', 'manager', 'cash_collector', 'accountant')
    AND collected_by = auth.uid()
);

CREATE POLICY "payment_allocations_policy" ON payment_allocations
FOR ALL USING (
    auth.get_user_role() IN ('owner', 'manager', 'accountant', 'cash_collector')
);

-- ============================================================================
-- 9. INVENTORY & STOCK MOVEMENTS POLICIES
-- ============================================================================

CREATE POLICY "stock_locations_select" ON stock_locations FOR SELECT USING (true);
CREATE POLICY "stock_movements_select" ON stock_movements
FOR SELECT USING (
    auth.get_user_role() IN ('owner', 'manager', 'accountant')
    OR responsible_employee_id = auth.uid()
);

CREATE POLICY "stock_movements_insert" ON stock_movements
FOR INSERT WITH CHECK (
    auth.get_user_role() IN ('owner', 'manager', 'salesperson', 'driver')
);

CREATE POLICY "stock_transformations_policy" ON stock_transformations
FOR ALL USING (
    auth.get_user_role() IN ('owner', 'manager', 'salesperson', 'driver')
);

-- ============================================================================
-- 10. DISPUTES, CONFIRMATIONS & AUDIT
-- ============================================================================

CREATE POLICY "customer_confirmations_select" ON customer_confirmations FOR SELECT USING (true);
CREATE POLICY "customer_disputes_policy" ON customer_disputes
FOR ALL USING (
    auth.get_user_role() IN ('owner', 'manager', 'accountant')
);

CREATE POLICY "audit_logs_select" ON audit_logs
FOR SELECT USING (
    auth.get_user_role() IN ('owner', 'manager', 'accountant')
);

-- ============================================================================
-- 11. ATOMIC DELIVERY CREATION STORED PROCEDURE (RPC)
-- ============================================================================

CREATE OR REPLACE FUNCTION submit_delivery_atomic(
    p_delivery_reference TEXT,
    p_client_tx_id UUID,
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
    v_existing_id UUID;
    v_existing_total NUMERIC;
    v_delivery_id UUID;
    v_item RECORD;
    v_payment RECORD;
    v_full_delta INT;
    v_half_delta INT;
    v_fse_delta NUMERIC;
    v_item_unit selling_unit_enum;
    v_item_qty INT;
    v_item_price NUMERIC;
    v_item_fse NUMERIC;
    v_item_total NUMERIC;
BEGIN
    -- 1. IDEMPOTENCY CHECK
    SELECT id, total_amount INTO v_existing_id, v_existing_total
    FROM deliveries
    WHERE client_tx_id = p_client_tx_id;

    IF v_existing_id IS NOT NULL THEN
        -- Check for payload mismatch (tampering)
        IF v_existing_total != p_total_amount THEN
            RAISE EXCEPTION 'IDEMPOTENCY_MISMATCH: Existing delivery has total % but submission has %', v_existing_total, p_total_amount;
        END IF;

        -- Return existing record without duplicate insertion
        RETURN jsonb_build_object(
            'success', true,
            'duplicate', true,
            'delivery_id', v_existing_id,
            'delivery_reference', p_delivery_reference,
            'message', 'Delivery was already synchronized.'
        );
    END IF;

    -- 2. INSERT CORE DELIVERY RECORD
    INSERT INTO deliveries (
        delivery_reference,
        client_tx_id,
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

    -- 3. INSERT LINE ITEMS & STOCK MOVEMENTS ATOMICALLY
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
        
        IF v_item_unit = 'FULL_SHEET' THEN
            v_item_fse := v_item_qty * 1.0;
            v_full_delta := -v_item_qty;
            v_half_delta := 0;
        ELSIF v_item_unit = 'HALF_SHEET' THEN
            v_item_fse := v_item_qty * 0.5;
            v_full_delta := 0;
            v_half_delta := -v_item_qty;
        ELSE
            RAISE EXCEPTION 'INVALID_SELLING_UNIT: Only FULL_SHEET and HALF_SHEET are authorized';
        END IF;

        v_fse_delta := -v_item_fse;
        v_item_total := ROUND(v_item_qty * v_item_price, 2);

        -- Insert line item
        INSERT INTO delivery_items (
            delivery_id,
            product_id,
            selling_unit,
            quantity,
            full_sheet_equivalent,
            official_unit_price,
            applied_unit_price,
            is_special_price,
            price_approval_id,
            line_total
        ) VALUES (
            v_delivery_id,
            v_item."productId",
            v_item_unit,
            v_item_qty,
            v_item_fse,
            v_item."officialUnitPrice",
            v_item_price,
            COALESCE(v_item."isSpecialPrice", false),
            v_item."priceApprovalId",
            v_item_total
        );

        -- Record inventory deduction ledger
        INSERT INTO stock_movements (
            product_id,
            from_location_id,
            to_location_id,
            full_sheets_delta,
            half_sheets_delta,
            fse_delta,
            movement_type,
            responsible_employee_id,
            delivery_id,
            notes
        ) VALUES (
            v_item."productId",
            p_warehouse_location_id,
            NULL,
            v_full_delta,
            v_half_delta,
            v_fse_delta,
            'delivery_to_customer',
            p_created_by,
            v_delivery_id,
            'Delivery ' || p_delivery_reference
        );
    END LOOP;

    -- 4. INSERT PAYMENT DECLARATIONS
    FOR v_payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS y(
        "channel" TEXT,
        "declaredAmount" NUMERIC,
        "externalRef" TEXT,
        "notes" TEXT
    )
    LOOP
        IF v_payment."declaredAmount" > 0 AND v_payment."channel" != 'credit' THEN
            INSERT INTO payment_declarations (
                delivery_id,
                channel,
                declared_amount,
                declared_by,
                external_ref,
                notes
            ) VALUES (
                v_delivery_id,
                v_payment."channel"::payment_channel_enum,
                v_payment."declaredAmount",
                p_created_by,
                v_payment."externalRef",
                v_payment."notes"
            );
        END IF;
    END LOOP;

    -- 5. RETURN SUCCESS
    RETURN jsonb_build_object(
        'success', true,
        'duplicate', false,
        'delivery_id', v_delivery_id,
        'delivery_reference', p_delivery_reference
    );
END;
$$;

