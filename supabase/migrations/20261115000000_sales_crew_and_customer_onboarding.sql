-- ============================================================================
-- TOKA GDMS — Migration 20261115000000: Multi-Person Sales Crew, Vehicle Glass Stock, & Universal Customer Onboarding
-- ============================================================================

-- 1. MULTI-PERSON VEHICLE CREW ASSIGNMENT (DRIVER + 1-2 SALES REPS)
ALTER TABLE vehicle_assignments 
    ADD COLUMN IF NOT EXISTS secondary_salesperson_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS crew_ids UUID[] DEFAULT '{}';

-- 2. VEHICLE FLEET OWNERSHIP TYPE (OWNED, LEASED, CONTRACTED)
ALTER TABLE vehicles
    ADD COLUMN IF NOT EXISTS ownership_type TEXT NOT NULL DEFAULT 'owned' CHECK (ownership_type IN ('owned', 'leased', 'contracted'));

-- 3. UNIVERSAL CUSTOMER ONBOARDING POLICY (ALL EMPLOYEES CAN ONBOARD CUSTOMERS)
DROP POLICY IF EXISTS "customers_insert_policy" ON customers;
CREATE POLICY "customers_insert_policy" ON customers 
    FOR INSERT 
    WITH CHECK (public.get_user_role() IN ('owner', 'manager', 'salesperson', 'driver', 'cash_collector', 'accountant'));

DROP POLICY IF EXISTS "customers_update_policy" ON customers;
CREATE POLICY "customers_update_policy" ON customers 
    FOR UPDATE 
    USING (public.get_user_role() IN ('owner', 'manager') OR created_by = auth.uid());

-- 4. DIRECT VEHICLE GLASS ASSIGNMENT & LOADING RPC
CREATE OR REPLACE FUNCTION assign_vehicle_glass_stock(
    p_vehicle_id UUID,
    p_product_id UUID,
    p_full_sheets INT,
    p_half_sheets INT DEFAULT 0,
    p_notes TEXT DEFAULT 'Vehicle glass loading for daily sales'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_operator_id UUID;
    v_vehicle_location_id UUID;
    v_veh_plate TEXT;
    v_fse NUMERIC(10, 2);
BEGIN
    v_operator_id := auth.uid();
    IF v_operator_id IS NULL AND current_user = 'postgres' THEN
        SELECT id INTO v_operator_id FROM profiles WHERE role = 'owner' LIMIT 1;
    END IF;

    IF p_full_sheets < 0 OR p_half_sheets < 0 OR (p_full_sheets = 0 AND p_half_sheets = 0) THEN
        RAISE EXCEPTION 'INVALID_QUANTITY: Loading quantities must be positive';
    END IF;

    -- Find or create vehicle truck stock location
    SELECT id INTO v_vehicle_location_id
    FROM stock_locations
    WHERE vehicle_id = p_vehicle_id AND is_active = true;

    IF v_vehicle_location_id IS NULL THEN
        SELECT registration_plate INTO v_veh_plate FROM vehicles WHERE id = p_vehicle_id;
        INSERT INTO stock_locations (name, location_type, vehicle_id, is_active)
        VALUES ('Truck ' || COALESCE(v_veh_plate, p_vehicle_id::text) || ' Mobile Bay', 'truck', p_vehicle_id, true)
        RETURNING id INTO v_vehicle_location_id;
    END IF;

    -- Add/Set vehicle stock balance
    INSERT INTO inventory_balances (product_id, stock_location_id, full_sheets, half_sheets)
    VALUES (p_product_id, v_vehicle_location_id, p_full_sheets, p_half_sheets)
    ON CONFLICT (product_id, stock_location_id) DO UPDATE
    SET full_sheets = inventory_balances.full_sheets + p_full_sheets,
        half_sheets = inventory_balances.half_sheets + p_half_sheets,
        updated_at = timezone('utc', now());

    v_fse := (p_full_sheets * 1.0) + (p_half_sheets * 0.5);

    -- Record stock movement
    INSERT INTO stock_movements (
        product_id, from_location_id, to_location_id,
        full_sheets_delta, half_sheets_delta, fse_delta,
        movement_type, responsible_employee_id, notes
    ) VALUES (
        p_product_id, NULL, v_vehicle_location_id,
        p_full_sheets, p_half_sheets, v_fse,
        'dispatch_to_truck', v_operator_id, p_notes
    );

    RETURN jsonb_build_object(
        'success', true,
        'vehicle_id', p_vehicle_id,
        'location_id', v_vehicle_location_id,
        'full_sheets', p_full_sheets,
        'half_sheets', p_half_sheets,
        'fse', v_fse
    );
END;
$$;
GRANT EXECUTE ON FUNCTION assign_vehicle_glass_stock TO authenticated, service_role;

-- 5. UPDATE SUBMIT_DELIVERY_ATOMIC TO AUTHORIZE ANY CREW MEMBER
-- Drop the old signature first to avoid "function name is not unique" error
DROP FUNCTION IF EXISTS submit_delivery_atomic(
    TEXT, UUID, TEXT, UUID, UUID, UUID,
    NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
    payment_status_enum,
    NUMERIC, NUMERIC, NUMERIC, TIMESTAMPTZ, BOOLEAN, TEXT, JSONB, JSONB, UUID
);
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
    p_delivery_lat NUMERIC DEFAULT NULL,
    p_delivery_lng NUMERIC DEFAULT NULL,
    p_gps_accuracy_m NUMERIC DEFAULT NULL,
    p_device_captured_at TIMESTAMPTZ DEFAULT NULL,
    p_is_offline_submission BOOLEAN DEFAULT false,
    p_notes TEXT DEFAULT NULL,
    p_warehouse_location_id UUID DEFAULT NULL,
    p_items JSONB DEFAULT '[]'::jsonb,
    p_payments JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

    SELECT role INTO v_caller_role
    FROM profiles
    WHERE id = v_caller_id AND is_active = true;

    IF v_caller_role IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Active user profile not found for caller %', v_caller_id;
    END IF;

    IF v_caller_id != p_created_by THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Cannot submit delivery on behalf of another user (% != %)', v_caller_id, p_created_by;
    END IF;

    IF v_caller_role NOT IN ('owner', 'manager', 'salesperson', 'driver') THEN
        RAISE EXCEPTION 'ROLE_NOT_AUTHORIZED: Role % is not authorized to submit deliveries', v_caller_role;
    END IF;

    -- 2. VEHICLE ASSIGNMENT & CREW AUTHORIZATION
    SELECT va.id, va.vehicle_id, va.driver_id, va.salesperson_id, 
           va.secondary_salesperson_id, va.crew_ids,
           va.is_active,
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

    -- Verify caller is assigned to this vehicle shift (Driver, Lead Sales, Second Sales, or Crew member)
    IF v_caller_role IN ('driver', 'salesperson', 'cash_collector') THEN
        IF v_assignment.driver_id != v_caller_id 
           AND v_assignment.salesperson_id != v_caller_id 
           AND (v_assignment.secondary_salesperson_id IS NULL OR v_assignment.secondary_salesperson_id != v_caller_id)
           AND NOT (v_caller_id = ANY(COALESCE(v_assignment.crew_ids, '{}'))) THEN
            RAISE EXCEPTION 'UNAUTHORIZED_SHIFT: Caller % is not assigned to vehicle assignment %', v_caller_id, p_vehicle_assignment_id;
        END IF;
    ELSIF v_caller_role IN ('owner', 'manager') THEN
        IF v_assignment.driver_id != v_caller_id 
           AND v_assignment.salesperson_id != v_caller_id
           AND (v_assignment.secondary_salesperson_id IS NULL OR v_assignment.secondary_salesperson_id != v_caller_id)
           AND NOT (v_caller_id = ANY(COALESCE(v_assignment.crew_ids, '{}'))) THEN
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

        -- Resolve authorized base price
        v_customer_price := NULL;
        SELECT authorized_price INTO v_customer_price
        FROM customer_prices
        WHERE customer_id = p_customer_id
          AND product_id = v_item."productId"
          AND selling_unit = v_item_unit
          AND is_active = true
          AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
        ORDER BY effective_from DESC
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

        -- Validate unit price against authorized price or approved exception
        IF v_item."appliedUnitPrice" < v_auth_unit_price THEN
            IF v_item."priceApprovalId" IS NULL THEN
                RAISE EXCEPTION 'UNAUTHORIZED_PRICE: Applied price % is below authorized base % for product % without priceApprovalId',
                    v_item."appliedUnitPrice", v_auth_unit_price, v_product.sku;
            END IF;

            SELECT id, status, authorized_unit_price, approval_type INTO v_approval
            FROM price_approval_requests
            WHERE id = v_item."priceApprovalId"
              AND customer_id = p_customer_id
              AND product_id = v_item."productId"
              AND selling_unit = v_item_unit
              AND is_consumed = false;

            IF v_approval.id IS NULL OR v_approval.status != 'approved' THEN
                RAISE EXCEPTION 'INVALID_PRICE_APPROVAL: Approval request % not found or not approved', v_item."priceApprovalId";
            END IF;

            IF v_item."appliedUnitPrice" < v_approval.authorized_unit_price THEN
                RAISE EXCEPTION 'PRICE_EXCEEDS_APPROVAL: Applied price % is lower than approved minimum %',
                    v_item."appliedUnitPrice", v_approval.authorized_unit_price;
            END IF;

            -- Mark approval as consumed
            UPDATE price_approval_requests
            SET is_consumed = true, consumed_at = timezone('utc', now()), updated_at = timezone('utc', now())
            WHERE id = v_approval.id;
        END IF;

        v_item_total := v_item_qty * v_item."appliedUnitPrice";
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

    -- Declared paid amount check
    IF p_total_declared_paid IS NOT NULL AND ABS(p_total_declared_paid - v_calc_declared_paid) > 0.01 THEN
        RAISE EXCEPTION 'PAID_AMOUNT_MISMATCH: Submitted paid % != calculated paid %', p_total_declared_paid, v_calc_declared_paid;
    END IF;

    -- Outstanding balance check
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

                INSERT INTO stock_movements (
                    product_id, from_location_id, to_location_id,
                    full_sheets_delta, half_sheets_delta, fse_delta,
                    movement_type, responsible_employee_id, transformation_id, notes
                ) VALUES (
                    v_item."productId", v_source_location_id, v_source_location_id,
                    -v_full_to_split, v_full_to_split * 2, 0.00,
                    'split_full_to_half', p_created_by, v_trans_id, 'Physical split of ' || v_full_to_split || ' sheets'
                );

                v_avail_halves := v_avail_halves + (v_full_to_split * 2);
            END IF;

            -- Deduct ordered half sheets
            UPDATE inventory_balances
            SET half_sheets = half_sheets - v_order_halves, updated_at = timezone('utc', now())
            WHERE product_id = v_item."productId" AND stock_location_id = v_source_location_id;

            INSERT INTO stock_movements (
                product_id, from_location_id, to_location_id,
                full_sheets_delta, half_sheets_delta, fse_delta,
                movement_type, responsible_employee_id, delivery_id, notes
            ) VALUES (
                v_item."productId", v_source_location_id, NULL,
                0, -v_order_halves, -v_order_halves * 0.5,
                'delivery_to_customer', p_created_by, v_delivery_id, 'Delivery ' || p_delivery_reference
            );
        END IF;

        -- Insert line item record
        INSERT INTO delivery_items (
            delivery_id, product_id, selling_unit, quantity,
            fse_equivalent, official_unit_price, applied_unit_price,
            is_special_price, price_approval_id, line_total
        ) VALUES (
            v_delivery_id, v_item."productId", v_item_unit, v_item_qty,
            CASE WHEN v_item_unit = 'FULL_SHEET' THEN v_item_qty * 1.0 ELSE v_item_qty * 0.5 END,
            v_auth_unit_price, v_item."appliedUnitPrice",
            (v_item."appliedUnitPrice" < v_auth_unit_price),
            v_item."priceApprovalId", v_item_qty * v_item."appliedUnitPrice"
        );
    END LOOP;

    -- 10. INSERT PAYMENT DECLARATIONS & EMPLOYEE LIABILITY TRACKING
    FOR v_payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS y(
        "channel" TEXT,
        "declaredAmount" NUMERIC,
        "externalRef" TEXT,
        "notes" TEXT
    )
    LOOP
        IF v_payment."declaredAmount" > 0 THEN
            INSERT INTO payment_declarations (
                delivery_id, channel, declared_amount, external_reference, notes
            ) VALUES (
                v_delivery_id, v_payment."channel"::payment_channel_enum,
                v_payment."declaredAmount", v_payment."externalRef", v_payment."notes"
            );

            -- Employee turnover liability tracking
            IF v_payment."channel" IN ('cash', 'mpesa_employee_phone') THEN
                INSERT INTO employee_turnovers (
                    employee_id, shift_assignment_id, channel, total_declared_liability
                ) VALUES (
                    p_created_by, p_vehicle_assignment_id, v_payment."channel"::turnover_channel_enum, v_payment."declaredAmount"
                )
                ON CONFLICT (employee_id, shift_assignment_id, channel) DO UPDATE
                SET total_declared_liability = employee_turnovers.total_declared_liability + v_payment."declaredAmount",
                    updated_at = timezone('utc', now());
            END IF;
        END IF;
    END LOOP;

    -- 11. GENERATE CANONICAL TWO-WAY SMS NOTIFICATION PAYLOAD
    v_sms_payload := 'TOKA GLASS: Delivery ' || p_delivery_reference || ' confirmed. Total: KES ' ||
                     TO_CHAR(v_calc_total, 'FM999,999,999.00') || ', Paid: KES ' ||
                     TO_CHAR(v_calc_declared_paid, 'FM999,999,999.00') || ', Due: KES ' ||
                     TO_CHAR(v_calc_outstanding, 'FM999,999,999.00') ||
                     '. Reply 1 to CONFIRM or 2 to DISPUTE.';

    INSERT INTO notifications (
        recipient_phone, message_type, content, delivery_id
    ) VALUES (
        v_customer.primary_phone, 'customer_verification_sms', v_sms_payload, v_delivery_id
    );

    -- 12. WRITE SYSTEM AUDIT TRAIL
    INSERT INTO audit_logs (
        actor_id, action_type, entity_name, entity_id, payload_after
    ) VALUES (
        p_created_by, 'DELIVERY_CREATED', 'deliveries', v_delivery_id,
        jsonb_build_object(
            'delivery_reference', p_delivery_reference,
            'client_tx_id', p_client_tx_id,
            'customer_id', p_customer_id,
            'vehicle_assignment_id', p_vehicle_assignment_id,
            'total_amount', v_calc_total,
            'total_declared_paid', v_calc_declared_paid,
            'outstanding_balance', v_calc_outstanding
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'duplicate', false,
        'delivery_id', v_delivery_id,
        'delivery_reference', p_delivery_reference,
        'operational_status', 'delivered',
        'payment_status', v_derived_status,
        'total_amount', v_calc_total,
        'total_declared_paid', v_calc_declared_paid,
        'outstanding_balance', v_calc_outstanding,
        'sms_payload', v_sms_payload
    );
END;
$$;
GRANT EXECUTE ON FUNCTION submit_delivery_atomic TO authenticated, service_role;

