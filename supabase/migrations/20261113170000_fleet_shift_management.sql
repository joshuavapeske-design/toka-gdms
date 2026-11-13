-- TOKA GDMS — Atomic fleet and shift administration
-- Owners/managers can create vehicles, routes, truck stock locations and daily crew assignments.
BEGIN;

-- Fleet and stock-location writes must pass through the transaction-safe
-- procedures in this migration; direct table writes bypass overlap checks/audit.
DROP POLICY IF EXISTS "vehicles_modify" ON vehicles;
DROP POLICY IF EXISTS "routes_modify" ON routes;
DROP POLICY IF EXISTS "assignments_modify" ON vehicle_assignments;
DROP POLICY IF EXISTS "stock_locations_modify" ON stock_locations;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_assignment_active_vehicle_day
  ON vehicle_assignments(vehicle_id, shift_date)
  WHERE is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_assignment_active_driver_day
  ON vehicle_assignments(driver_id, shift_date)
  WHERE is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_assignment_active_salesperson_day
  ON vehicle_assignments(salesperson_id, shift_date)
  WHERE is_active = true;

CREATE OR REPLACE FUNCTION create_vehicle_shift_assignment(
  p_registration_plate TEXT,
  p_make_model TEXT,
  p_tonnage_capacity NUMERIC,
  p_route_code TEXT,
  p_route_name TEXT,
  p_route_description TEXT,
  p_driver_id UUID,
  p_salesperson_id UUID,
  p_shift_date DATE,
  p_started_at TIMESTAMPTZ DEFAULT timezone('utc', now())
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_vehicle_id UUID;
  v_route_id UUID;
  v_assignment_id UUID;
  v_stock_location_id UUID;
  v_driver_role user_role_enum;
  v_salesperson_role user_role_enum;
  v_plate TEXT;
  v_route_code TEXT;
BEGIN
  v_actor := auth.require_active_role(ARRAY['owner'::user_role_enum, 'manager'::user_role_enum]);

  v_plate := upper(trim(p_registration_plate));
  v_route_code := upper(trim(p_route_code));

  IF v_plate = '' OR trim(p_make_model) = '' OR p_tonnage_capacity IS NULL OR p_tonnage_capacity <= 0 THEN
    RAISE EXCEPTION 'INVALID_VEHICLE_DETAILS: Registration, make/model and positive tonnage are required';
  END IF;
  IF v_route_code = '' OR trim(p_route_name) = '' THEN
    RAISE EXCEPTION 'INVALID_ROUTE_DETAILS: Route code and route name are required';
  END IF;
  IF p_driver_id IS NULL OR p_salesperson_id IS NULL OR p_driver_id = p_salesperson_id THEN
    RAISE EXCEPTION 'INVALID_CREW: Select two different employees for driver and salesperson';
  END IF;
  IF p_shift_date IS NULL OR p_started_at IS NULL
     OR timezone('Africa/Nairobi', p_started_at)::date <> p_shift_date THEN
    RAISE EXCEPTION 'INVALID_SHIFT_DATE: Shift date must match the Nairobi date of its start time';
  END IF;
  IF p_started_at > timezone('utc', now()) + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'INVALID_SHIFT_START: Shift start cannot be in the future';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('toka:vehicle-registration:' || v_plate, 0));
  SELECT id INTO v_vehicle_id
  FROM vehicles
  WHERE registration_plate = v_plate
  FOR UPDATE;

  IF v_vehicle_id IS NULL THEN
    INSERT INTO vehicles(registration_plate, make_model, tonnage_capacity, status, is_active)
    VALUES (v_plate, trim(p_make_model), p_tonnage_capacity, 'active', true)
    RETURNING id INTO v_vehicle_id;
  ELSE
    PERFORM 1 FROM vehicles
    WHERE id = v_vehicle_id AND is_active = true AND status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'VEHICLE_UNAVAILABLE: Vehicle % is inactive, grounded or under maintenance', v_plate;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('toka:route-code:' || v_route_code, 0));
  SELECT id INTO v_route_id
  FROM routes
  WHERE code = v_route_code
  FOR UPDATE;

  IF v_route_id IS NULL THEN
    INSERT INTO routes(code, name, description, is_active)
    VALUES (v_route_code, trim(p_route_name), NULLIF(trim(COALESCE(p_route_description, '')), ''), true)
    RETURNING id INTO v_route_id;
  ELSE
    PERFORM 1 FROM routes WHERE id = v_route_id AND is_active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'ROUTE_UNAVAILABLE: Selected route is inactive'; END IF;
  END IF;

  SELECT role INTO v_driver_role
  FROM profiles WHERE id = p_driver_id AND is_active = true;
  IF v_driver_role IS DISTINCT FROM 'driver'::user_role_enum THEN
    RAISE EXCEPTION 'INVALID_DRIVER: Selected employee must have an active driver role';
  END IF;

  SELECT role INTO v_salesperson_role
  FROM profiles WHERE id = p_salesperson_id AND is_active = true;
  IF v_salesperson_role IS DISTINCT FROM 'salesperson'::user_role_enum THEN
    RAISE EXCEPTION 'INVALID_SALESPERSON: Selected employee must have an active salesperson role';
  END IF;

  -- Serialize competing assignments for the vehicle and each crew member.
  PERFORM pg_advisory_xact_lock(hashtextextended('toka:vehicle-shift:' || v_vehicle_id::text || ':' || p_shift_date::text, 0));
  IF p_driver_id < p_salesperson_id THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('toka:employee-shift:' || p_driver_id::text || ':' || p_shift_date::text, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('toka:employee-shift:' || p_salesperson_id::text || ':' || p_shift_date::text, 0));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended('toka:employee-shift:' || p_salesperson_id::text || ':' || p_shift_date::text, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('toka:employee-shift:' || p_driver_id::text || ':' || p_shift_date::text, 0));
  END IF;

  IF EXISTS (
    SELECT 1 FROM vehicle_assignments
    WHERE is_active = true AND shift_date = p_shift_date
      AND (vehicle_id = v_vehicle_id OR driver_id IN (p_driver_id, p_salesperson_id)
           OR salesperson_id IN (p_driver_id, p_salesperson_id))
  ) THEN
    RAISE EXCEPTION 'SHIFT_CONFLICT: Vehicle or selected employee already has an active assignment for this date';
  END IF;

  SELECT id INTO v_stock_location_id
  FROM stock_locations
  WHERE vehicle_id = v_vehicle_id AND is_active = true
  FOR UPDATE;

  IF v_stock_location_id IS NULL THEN
    SELECT id INTO v_stock_location_id
    FROM stock_locations
    WHERE vehicle_id = v_vehicle_id AND is_active = false
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_stock_location_id IS NOT NULL THEN
      UPDATE stock_locations SET is_active = true, location_type = 'truck'
      WHERE id = v_stock_location_id;
    ELSE
      INSERT INTO stock_locations(name, location_type, vehicle_id, is_active)
      VALUES ('Truck ' || v_plate, 'truck', v_vehicle_id, true)
      RETURNING id INTO v_stock_location_id;
    END IF;
  END IF;

  INSERT INTO vehicle_assignments(
    vehicle_id, route_id, driver_id, salesperson_id, shift_date, started_at, is_active
  ) VALUES (
    v_vehicle_id, v_route_id, p_driver_id, p_salesperson_id, p_shift_date, p_started_at, true
  ) RETURNING id INTO v_assignment_id;

  INSERT INTO audit_logs(actor_id, action_type, entity_name, entity_id, payload_after)
  VALUES (
    v_actor, 'VEHICLE_SHIFT_ASSIGNED', 'vehicle_assignments', v_assignment_id,
    jsonb_build_object(
      'vehicle_id', v_vehicle_id,
      'registration_plate', v_plate,
      'route_id', v_route_id,
      'driver_id', p_driver_id,
      'salesperson_id', p_salesperson_id,
      'shift_date', p_shift_date,
      'stock_location_id', v_stock_location_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'assignment_id', v_assignment_id,
    'vehicle_id', v_vehicle_id,
    'route_id', v_route_id,
    'stock_location_id', v_stock_location_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION close_vehicle_shift(
  p_assignment_id UUID,
  p_ended_at TIMESTAMPTZ DEFAULT timezone('utc', now())
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_assignment vehicle_assignments%ROWTYPE;
BEGIN
  v_actor := auth.require_active_role(ARRAY['owner'::user_role_enum, 'manager'::user_role_enum]);

  SELECT * INTO v_assignment
  FROM vehicle_assignments
  WHERE id = p_assignment_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND'; END IF;
  IF NOT v_assignment.is_active THEN RAISE EXCEPTION 'SHIFT_ALREADY_CLOSED'; END IF;
  IF p_ended_at IS NULL OR p_ended_at <= v_assignment.started_at
     OR p_ended_at > timezone('utc', now()) + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'INVALID_SHIFT_END: End time must be after shift start and cannot be in the future';
  END IF;

  UPDATE vehicle_assignments
  SET is_active = false, ended_at = p_ended_at
  WHERE id = p_assignment_id;

  INSERT INTO audit_logs(actor_id, action_type, entity_name, entity_id, payload_before, payload_after)
  VALUES (
    v_actor, 'VEHICLE_SHIFT_CLOSED', 'vehicle_assignments', p_assignment_id,
    jsonb_build_object('is_active', true),
    jsonb_build_object('is_active', false, 'ended_at', p_ended_at)
  );

  RETURN jsonb_build_object('success', true, 'assignment_id', p_assignment_id, 'ended_at', p_ended_at);
END;
$$;

REVOKE ALL ON FUNCTION create_vehicle_shift_assignment(TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID, UUID, DATE, TIMESTAMPTZ) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION create_vehicle_shift_assignment(TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID, UUID, DATE, TIMESTAMPTZ) TO authenticated;

REVOKE ALL ON FUNCTION close_vehicle_shift(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION close_vehicle_shift(UUID, TIMESTAMPTZ) TO authenticated;

COMMIT;
