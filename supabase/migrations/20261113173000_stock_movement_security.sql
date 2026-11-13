-- TOKA GDMS — Harden stock receiving and vehicle dispatch RPCs
-- Database-layer role and location enforcement; API checks are defense in depth.
BEGIN;

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
    v_location_id UUID;
BEGIN
    v_operator_id := auth.require_active_role(ARRAY['owner'::user_role_enum, 'manager'::user_role_enum]);

    IF p_product_id IS NULL OR p_location_id IS NULL
       OR p_full_sheets IS NULL OR p_half_sheets IS NULL
       OR p_full_sheets < 0 OR p_half_sheets < 0
       OR (p_full_sheets = 0 AND p_half_sheets = 0) THEN
        RAISE EXCEPTION 'INVALID_STOCK_QUANTITY: Product, warehouse and positive whole-sheet quantities are required';
    END IF;

    PERFORM 1 FROM products WHERE id = p_product_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRODUCT_NOT_FOUND: Active glass product required for stock receipt';
    END IF;

    SELECT id INTO v_location_id
    FROM stock_locations
    WHERE id = p_location_id
      AND location_type = 'warehouse'
      AND is_active = true
      AND vehicle_id IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'INVALID_WAREHOUSE: Stock receipt destination must be an active warehouse location';
    END IF;

    INSERT INTO inventory_balances (product_id, stock_location_id, full_sheets, half_sheets)
    VALUES (p_product_id, v_location_id, p_full_sheets, p_half_sheets)
    ON CONFLICT (product_id, stock_location_id) DO UPDATE
    SET full_sheets = inventory_balances.full_sheets + EXCLUDED.full_sheets,
        half_sheets = inventory_balances.half_sheets + EXCLUDED.half_sheets,
        updated_at = timezone('utc', now());

    INSERT INTO stock_movements (
        product_id, from_location_id, to_location_id,
        full_sheets_delta, half_sheets_delta, fse_delta,
        movement_type, responsible_employee_id, notes
    ) VALUES (
        p_product_id, NULL, v_location_id,
        p_full_sheets, p_half_sheets,
        (p_full_sheets * 1.0) + (p_half_sheets * 0.5),
        'stock_receipt', v_operator_id, p_notes
    );

    INSERT INTO audit_logs (actor_id, action_type, entity_name, entity_id, payload_after)
    VALUES (
        v_operator_id, 'WAREHOUSE_STOCK_RECEIVED', 'inventory_balances', NULL,
        jsonb_build_object(
            'product_id', p_product_id,
            'warehouse_id', v_location_id,
            'full_sheets', p_full_sheets,
            'half_sheets', p_half_sheets,
            'fse', (p_full_sheets * 1.0) + (p_half_sheets * 0.5)
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'received_full', p_full_sheets,
        'received_half', p_half_sheets,
        'fse_delta', (p_full_sheets * 1.0) + (p_half_sheets * 0.5)
    );
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
    v_warehouse_id UUID;
    v_vehicle_location_id UUID;
    v_wh_full INT;
    v_wh_half INT;
BEGIN
    v_operator_id := auth.require_active_role(ARRAY['owner'::user_role_enum, 'manager'::user_role_enum]);

    IF p_product_id IS NULL OR p_warehouse_id IS NULL OR p_vehicle_location_id IS NULL
       OR p_warehouse_id = p_vehicle_location_id
       OR p_full_sheets IS NULL OR p_half_sheets IS NULL
       OR p_full_sheets < 0 OR p_half_sheets < 0
       OR (p_full_sheets = 0 AND p_half_sheets = 0) THEN
        RAISE EXCEPTION 'INVALID_STOCK_QUANTITY: Product, distinct stock locations and positive whole-sheet quantities are required';
    END IF;

    PERFORM 1 FROM products WHERE id = p_product_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRODUCT_NOT_FOUND: Active glass product required for stock dispatch';
    END IF;

    SELECT id INTO v_warehouse_id
    FROM stock_locations
    WHERE id = p_warehouse_id
      AND location_type = 'warehouse'
      AND is_active = true
      AND vehicle_id IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'INVALID_WAREHOUSE: Source must be an active warehouse location';
    END IF;

    SELECT sl.id INTO v_vehicle_location_id
    FROM stock_locations sl
    JOIN vehicles v ON v.id = sl.vehicle_id
    WHERE sl.id = p_vehicle_location_id
      AND sl.location_type = 'truck'
      AND sl.is_active = true
      AND v.is_active = true
      AND v.status = 'active'
    FOR UPDATE OF sl;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'INVALID_VEHICLE_STOCK_LOCATION: Destination must belong to an active roadworthy vehicle';
    END IF;

    SELECT full_sheets, half_sheets INTO v_wh_full, v_wh_half
    FROM inventory_balances
    WHERE product_id = p_product_id
      AND stock_location_id = v_warehouse_id
    FOR UPDATE;

    IF v_wh_full IS NULL OR v_wh_half IS NULL
       OR v_wh_full < p_full_sheets OR v_wh_half < p_half_sheets THEN
        RAISE EXCEPTION 'INSUFFICIENT_WAREHOUSE_STOCK: Warehouse does not have sufficient stock to dispatch';
    END IF;

    UPDATE inventory_balances
    SET full_sheets = full_sheets - p_full_sheets,
        half_sheets = half_sheets - p_half_sheets,
        updated_at = timezone('utc', now())
    WHERE product_id = p_product_id
      AND stock_location_id = v_warehouse_id;

    INSERT INTO inventory_balances (product_id, stock_location_id, full_sheets, half_sheets)
    VALUES (p_product_id, v_vehicle_location_id, p_full_sheets, p_half_sheets)
    ON CONFLICT (product_id, stock_location_id) DO UPDATE
    SET full_sheets = inventory_balances.full_sheets + EXCLUDED.full_sheets,
        half_sheets = inventory_balances.half_sheets + EXCLUDED.half_sheets,
        updated_at = timezone('utc', now());

    INSERT INTO stock_movements (
        product_id, from_location_id, to_location_id,
        full_sheets_delta, half_sheets_delta, fse_delta,
        movement_type, responsible_employee_id, notes
    ) VALUES (
        p_product_id, v_warehouse_id, v_vehicle_location_id,
        p_full_sheets, p_half_sheets,
        (p_full_sheets * 1.0) + (p_half_sheets * 0.5),
        'dispatch_to_truck', v_operator_id, p_notes
    );

    INSERT INTO audit_logs (actor_id, action_type, entity_name, entity_id, payload_after)
    VALUES (
        v_operator_id, 'STOCK_DISPATCHED_TO_VEHICLE', 'inventory_balances', NULL,
        jsonb_build_object(
            'product_id', p_product_id,
            'warehouse_id', v_warehouse_id,
            'vehicle_location_id', v_vehicle_location_id,
            'full_sheets', p_full_sheets,
            'half_sheets', p_half_sheets,
            'fse', (p_full_sheets * 1.0) + (p_half_sheets * 0.5)
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'dispatched_full', p_full_sheets,
        'dispatched_half', p_half_sheets,
        'fse_delta', (p_full_sheets * 1.0) + (p_half_sheets * 0.5)
    );
END;
$$;

REVOKE ALL ON FUNCTION receive_stock_warehouse(UUID, UUID, INT, INT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION receive_stock_warehouse(UUID, UUID, INT, INT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION dispatch_stock_vehicle(UUID, UUID, UUID, INT, INT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION dispatch_stock_vehicle(UUID, UUID, UUID, INT, INT, TEXT) TO authenticated;

COMMIT;
