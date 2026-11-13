// TOKA GDMS — Comprehensive PostgreSQL Database & Kernel Integrity Tests
// Executes directly against real in-process PostgreSQL 18.6 WASM via PGlite
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string, detail?: any) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`, detail !== undefined ? detail : '');
    failed++;
  }
}

async function assertRejects(promise: Promise<any>, expectedErrorPattern: string | RegExp, message: string) {
  try {
    await promise;
    console.error(`  ✗ FAIL: Expected error matching "${expectedErrorPattern}", but succeeded: ${message}`);
    failed++;
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    const matches = typeof expectedErrorPattern === 'string'
      ? errMsg.includes(expectedErrorPattern)
      : expectedErrorPattern.test(errMsg);

    if (matches) {
      console.log(`  ✓ PASS: Rejected as expected (${expectedErrorPattern}): ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: Error did not match pattern "${expectedErrorPattern}". Got: "${errMsg}": ${message}`);
      failed++;
    }
  }
}

async function runDatabaseTests() {
  console.log('======================================================================');
  console.log('TOKA GDMS — REAL POSTGRESQL DATABASE & KERNEL INTEGRITY TEST SUITE');
  console.log('======================================================================\n');

  const db = new PGlite();

  // ── Setup Mock Supabase Environment ──────────────────────────────────────
  await db.exec(`
    DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN null; END $$;
    DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN null; END $$;

    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT,
      created_at TIMESTAMPTZ DEFAULT timezone('utc', now())
    );

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
    $$ LANGUAGE sql STABLE;
  `);

  console.log('--- Suite 1: Clean Migration Application & Schema Verification ---');
  const sql1 = fs.readFileSync(path.resolve('supabase/migrations/20261109000000_initial_schema.sql'), 'utf8');
  await db.exec(sql1);
  assert(true, '20261109000000_initial_schema.sql applied cleanly');

  const sql2 = fs.readFileSync(path.resolve('supabase/migrations/20261110000000_rls_policies_and_atomic_rpc.sql'), 'utf8');
  await db.exec(sql2);
  assert(true, '20261110000000_rls_policies_and_atomic_rpc.sql applied cleanly');

  const sql3 = fs.readFileSync(path.resolve('supabase/migrations/20261110190000_pre_supabase_security_hardening.sql'), 'utf8');
  await db.exec(sql3);
  assert(true, '20261110190000_pre_supabase_security_hardening.sql applied cleanly');

  const sql4 = fs.readFileSync(path.resolve('supabase/migrations/20261113170000_fleet_shift_management.sql'), 'utf8');
  await db.exec(sql4);
  assert(true, '20261113170000_fleet_shift_management.sql applied cleanly');

  const privilegeChecks = await db.query<any>(`
    SELECT
      has_function_privilege('anon', 'public.receive_stock_warehouse(uuid,uuid,integer,integer,text)', 'EXECUTE') AS anon_stock_receive,
      has_function_privilege('authenticated', 'public.process_inbound_sms_atomic(text,text,text)', 'EXECUTE') AS authenticated_sms_processor,
      has_function_privilege('service_role', 'public.process_inbound_sms_atomic(text,text,text)', 'EXECUTE') AS service_sms_processor,
      has_function_privilege('authenticated', 'public.submit_delivery_atomic(text,uuid,text,uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,payment_status_enum,numeric,numeric,numeric,timestamp with time zone,boolean,text,jsonb,jsonb,uuid)', 'EXECUTE') AS authenticated_delivery_submit
  `);
  const grants = privilegeChecks.rows[0];
  assert(grants.anon_stock_receive === false, 'Anonymous users cannot execute stock receipt RPC');
  assert(grants.authenticated_sms_processor === false, 'Authenticated users cannot forge provider SMS RPC calls');
  assert(grants.service_sms_processor === true, 'Service role can process provider SMS callbacks');
  assert(grants.authenticated_delivery_submit === true, 'Authenticated employees can execute the delivery RPC');

  const readPolicyChecks = await db.query<any>(`
    SELECT
      has_table_privilege('anon', 'public.profiles', 'SELECT') AS anon_profiles,
      has_table_privilege('authenticated', 'public.profiles', 'SELECT') AS authenticated_profiles,
      has_table_privilege('anon', 'public.customers', 'SELECT') AS anon_customers,
      has_table_privilege('anon', 'public.customer_contacts', 'SELECT') AS anon_contacts,
      has_table_privilege('anon', 'public.inventory_balances', 'SELECT') AS anon_inventory,
      has_table_privilege('anon', 'public.deliveries', 'SELECT') AS anon_deliveries,
      EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'customers'
          AND policyname = 'customers_select_authenticated'
          AND 'authenticated' = ANY(roles)
          AND qual ILIKE '%auth.get_user_role%'
      ) AS customer_policy_role_scoped,
      EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'inventory_balances'
          AND policyname = 'inventory_balances_select_authenticated'
          AND 'authenticated' = ANY(roles)
          AND qual ILIKE '%auth.get_user_role%'
      ) AS inventory_policy_role_scoped,
      NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'vehicles' AND policyname = 'vehicles_modify'
      ) AS vehicle_writes_rpc_only,
      NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'routes' AND policyname = 'routes_modify'
      ) AS route_writes_rpc_only,
      NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'vehicle_assignments' AND policyname = 'assignments_modify'
      ) AS shift_writes_rpc_only,
      NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'stock_locations' AND policyname = 'stock_locations_modify'
      ) AS stock_locations_rpc_only
  `);
  const readPolicies = readPolicyChecks.rows[0];
  assert(readPolicies.anon_profiles === false, 'Anonymous users have no direct SELECT grant on employee profiles');
  assert(readPolicies.authenticated_profiles === true, 'Authenticated employees can resolve their own profile subject to RLS');
  assert(readPolicies.anon_customers === false, 'Anonymous users have no direct SELECT grant on customer records');
  assert(readPolicies.anon_contacts === false, 'Anonymous users have no direct SELECT grant on customer contact records');
  assert(readPolicies.anon_inventory === false, 'Anonymous users have no direct SELECT grant on inventory balances');
  assert(readPolicies.anon_deliveries === false, 'Anonymous users have no direct SELECT grant on delivery records');
  assert(readPolicies.customer_policy_role_scoped === true, 'Customer reads require an authenticated employee role');
  assert(readPolicies.inventory_policy_role_scoped === true, 'Inventory reads require an authorized employee role');
  assert(readPolicies.vehicle_writes_rpc_only === true, 'Vehicle writes are routed through the audited fleet procedure');
  assert(readPolicies.route_writes_rpc_only === true, 'Route writes are routed through the audited fleet procedure');
  assert(readPolicies.shift_writes_rpc_only === true, 'Vehicle shift writes are routed through the audited fleet procedure');
  assert(readPolicies.stock_locations_rpc_only === true, 'Stock location writes are routed through controlled procedures');

  const sensitiveReadPolicies = await db.query<any>(`
    SELECT
      EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'payment_allocations'
          AND policyname = 'allocations_select_scoped'
          AND qual ILIKE '%collections%'
      ) AS allocation_policy_scoped,
      EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'customer_confirmation_events'
          AND policyname = 'confirmation_events_select_scoped'
          AND qual ILIKE '%vehicle_assignments%'
      ) AS confirmation_events_policy_scoped,
      EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'customer_disputes'
          AND policyname = 'disputes_select_roles'
          AND qual ILIKE '%auth.get_user_role%'
      ) AS disputes_policy_scoped,
      EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'credit_accounts'
          AND policyname = 'credit_accounts_select_roles'
          AND qual ILIKE '%cash_collector%'
      ) AS credit_policy_scoped
  `);
  assert(sensitiveReadPolicies.rows[0].allocation_policy_scoped === true, 'Payment allocation reads are limited to finance roles or the collection owner');
  assert(sensitiveReadPolicies.rows[0].confirmation_events_policy_scoped === true, 'Customer confirmation events are limited to admins and the delivery team');
  assert(sensitiveReadPolicies.rows[0].disputes_policy_scoped === true, 'Customer dispute records are limited to management and accounting');
  assert(sensitiveReadPolicies.rows[0].credit_policy_scoped === true, 'Customer credit ledger reads are limited to relevant internal roles');

  // Verify inventory_balances table exists
  const tableCheck = await db.query<any>(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_name IN ('inventory_balances', 'customer_confirmation_events', 'deliveries', 'stock_movements');
  `);
  assert(tableCheck.rows.length === 4, 'All critical tables verified in PostgreSQL catalog');

  // ── Setup Test Entities ──────────────────────────────────────────────────
  const ownerId = '00000000-0000-0000-0000-000000000001';
  const managerId = '00000000-0000-0000-0000-000000000002';
  const salesId = '00000000-0000-0000-0000-000000000003';
  const driverId = '00000000-0000-0000-0000-000000000004';
  const collectorId = '00000000-0000-0000-0000-000000000005';
  const otherDriverId = '00000000-0000-0000-0000-000000000006';

  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${ownerId}', 'owner@tokaglass.co.ke'),
      ('${managerId}', 'manager@tokaglass.co.ke'),
      ('${salesId}', 'sales@tokaglass.co.ke'),
      ('${driverId}', 'driver@tokaglass.co.ke'),
      ('${collectorId}', 'collector@tokaglass.co.ke'),
      ('${otherDriverId}', 'otherdriver@tokaglass.co.ke'),
      ('00000000-0000-0000-0000-000000000007', 'sales2@tokaglass.co.ke')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO profiles (id, full_name, role, phone_number, is_active) VALUES
      ('${ownerId}', 'Toka Owner', 'owner', '+254700000001', true),
      ('${managerId}', 'Toka Manager', 'manager', '+254700000002', true),
      ('${salesId}', 'Grace Muthoni', 'salesperson', '+254700000003', true),
      ('${driverId}', 'David Ochieng', 'driver', '+254700000004', true),
      ('${collectorId}', 'John Collector', 'cash_collector', '+254700000005', true),
      ('${otherDriverId}', 'Unassigned Driver', 'driver', '+254700000006', true),
      ('00000000-0000-0000-0000-000000000007', 'Second Salesperson', 'salesperson', '+254700000007', true)
    ON CONFLICT (id) DO UPDATE SET is_active = true;
  `);

  const vehicleId = '77777777-7777-7777-7777-777777777701';
  const routeId = '66666666-6666-6666-6666-666666666601';
  const assignmentId = '55555555-5555-5555-5555-555555555501';
  const truckLocationId = '33333333-3333-3333-3333-333333333303';
  const warehouseId = '33333333-3333-3333-3333-333333333301';

  await db.exec(`
    INSERT INTO vehicles (id, registration_plate, make_model, tonnage_capacity, status, is_active)
    VALUES ('${vehicleId}', 'KBZ 123X', 'Isuzu FRR 10-Tonne', 10.0, 'active', true)
    ON CONFLICT (registration_plate) DO NOTHING;

    INSERT INTO routes (id, code, name)
    VALUES ('${routeId}', 'RT-01', 'Industrial Area - Gikomba Express')
    ON CONFLICT (code) DO NOTHING;

    INSERT INTO vehicle_assignments (id, vehicle_id, route_id, driver_id, salesperson_id, is_active)
    VALUES ('${assignmentId}', '${vehicleId}', '${routeId}', '${driverId}', '${salesId}', true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO stock_locations (id, name, location_type, vehicle_id, is_active)
    VALUES ('${truckLocationId}', 'Truck KBZ 123X Mobile Bay', 'truck', '${vehicleId}', true)
    ON CONFLICT (name) DO NOTHING;

    INSERT INTO customers (id, account_number, name, primary_phone, delivery_area, is_credit_eligible, credit_limit, is_active, created_by)
    VALUES
      ('44444444-4444-4444-4444-444444444401', 'CUST-001', 'Kariuki Glass & Hardware', '+254712345678', 'Gikomba Market', true, 50000.00, true, '${ownerId}'),
      ('44444444-4444-4444-4444-444444444403', 'CUST-003', 'Mwangi Glaziers', '+254711000003', 'Eastleigh', false, 0.00, true, '${ownerId}')
    ON CONFLICT (id) DO NOTHING;
  `);

  const custEligibleId = '44444444-4444-4444-4444-444444444401';
  const custIneligibleId = '44444444-4444-4444-4444-444444444403';
  const prod4mm = '22222222-2222-2222-2222-222222222201'; // 4mm Clear (FS: 3200, HS: 1750)
  const prod5mm = '22222222-2222-2222-2222-222222222202'; // 5mm Clear (FS: 4100, HS: 2200)

  // Helper function to set authenticated user context
  const setAuthUser = async (userId: string | null) => {
    if (userId) {
      await db.exec(`SET request.jwt.claim.sub = '${userId}';`);
    } else {
      await db.exec(`SET request.jwt.claim.sub = '';`);
    }
  };

  // Exercise the policies as the actual Supabase database roles, not only as the
  // migration owner. This validates role-granted table access plus RLS filtering.
  await db.exec('SET ROLE anon');
  await assertRejects(
    db.query<any>(`SELECT id FROM customers LIMIT 1;`),
    'permission denied',
    'Anonymous database role cannot read customer records'
  );
  await db.exec('RESET ROLE');

  await setAuthUser(salesId);
  await db.exec('SET ROLE authenticated');
  const authenticatedCustomerRead = await db.query<any>(`SELECT id FROM customers;`);
  assert(authenticatedCustomerRead.rows.length > 0, 'Authorized salesperson can read customer directory records');

  const salespersonDisputeRead = await db.query<any>(`SELECT id FROM customer_disputes;`);
  assert(salespersonDisputeRead.rows.length === 0, 'Salesperson cannot read management dispute records');
  await db.exec('RESET ROLE');
  await setAuthUser(null);

  const fleetGrantChecks = await db.query<any>(`
    SELECT
      has_function_privilege('anon', 'public.create_vehicle_shift_assignment(text,text,numeric,text,text,text,uuid,uuid,date,timestamp with time zone)', 'EXECUTE') AS anon_create_shift,
      has_function_privilege('authenticated', 'public.create_vehicle_shift_assignment(text,text,numeric,text,text,text,uuid,uuid,date,timestamp with time zone)', 'EXECUTE') AS employee_create_shift,
      has_function_privilege('service_role', 'public.create_vehicle_shift_assignment(text,text,numeric,text,text,text,uuid,uuid,date,timestamp with time zone)', 'EXECUTE') AS service_create_shift
  `);
  assert(fleetGrantChecks.rows[0].anon_create_shift === false, 'Anonymous users cannot create vehicle shifts');
  assert(fleetGrantChecks.rows[0].employee_create_shift === true, 'Authenticated users can invoke the role-checked shift procedure');
  assert(fleetGrantChecks.rows[0].service_create_shift === false, 'Service role cannot bypass the employee shift procedure');

  console.log('\n--- Suite 2: Fleet Setup & Shift Assignment ---');
  await setAuthUser(managerId);
  const assignmentResult = await db.query<any>(`
    SELECT create_vehicle_shift_assignment(
      'KBC 456Y',
      'Isuzu NQR 7-Tonne',
      7.0,
      'RT-02',
      'Westlands - Parklands',
      'Westlands and Parklands delivery route',
      '${otherDriverId}',
      '00000000-0000-0000-0000-000000000007',
      (timezone('Africa/Nairobi', now() - INTERVAL '1 minute'))::date,
      now() - INTERVAL '1 minute'
    ) AS result
  `);
  const createdShift = assignmentResult.rows[0].result;
  assert(Boolean(createdShift.assignment_id), 'Fleet setup creates a vehicle shift assignment');
  assert(Boolean(createdShift.stock_location_id), 'Fleet setup creates the vehicle stock location automatically');

  await assertRejects(
    db.query<any>(`
      SELECT create_vehicle_shift_assignment(
        'KBC 456Y', 'Isuzu NQR 7-Tonne', 7.0, 'RT-02', 'Westlands - Parklands', NULL,
        '${otherDriverId}', '00000000-0000-0000-0000-000000000007',
        (timezone('Africa/Nairobi', now() - INTERVAL '1 minute'))::date, now() - INTERVAL '1 minute'
      );
    `),
    'SHIFT_CONFLICT',
    'The same vehicle and crew cannot receive overlapping active shifts'
  );

  await db.query<any>(`SELECT close_vehicle_shift('${createdShift.assignment_id}', now());`);
  const closedShiftCheck = await db.query<any>(`
    SELECT is_active, ended_at FROM vehicle_assignments WHERE id = '${createdShift.assignment_id}'
  `);
  assert(closedShiftCheck.rows[0].is_active === false && Boolean(closedShiftCheck.rows[0].ended_at), 'Manager can close a vehicle shift and record its end time');

  const reassignmentResult = await db.query<any>(`
    SELECT create_vehicle_shift_assignment(
      'KBC 456Y',
      'Isuzu NQR 7-Tonne',
      7.0,
      'RT-02',
      'Westlands - Parklands',
      NULL,
      '${otherDriverId}',
      '00000000-0000-0000-0000-000000000007',
      (timezone('Africa/Nairobi', now() + INTERVAL '30 seconds'))::date,
      now() + INTERVAL '30 seconds'
    ) AS result
  `);
  assert(Boolean(reassignmentResult.rows[0].result.assignment_id), 'Vehicle and crew can be reassigned after the previous shift ends');

  await db.query<any>(`SELECT close_vehicle_shift('${reassignmentResult.rows[0].result.assignment_id}', now() + INTERVAL '1 minute');`);
  await setAuthUser(null);

  console.log('\n--- Suite 3: Caller Authentication & Vehicle Shift Enforcement ---');
  // 1. Unauthenticated execution rejected
  await setAuthUser(null);
  await assertRejects(
    db.query<any>(`
      SELECT submit_delivery_atomic(
        'GD-202611-0001', '11111111-0000-0000-0000-000000000001', 'hash1',
        '${custEligibleId}', '${driverId}', '${assignmentId}',
        3200.00, 0.00, 3200.00, 3200.00, 0.00, 'fully_paid',
        NULL, NULL, NULL, NULL, false, 'test',
        '[{"productId":"${prod4mm}","sellingUnit":"FULL_SHEET","quantity":1,"appliedUnitPrice":3200.00}]'::jsonb,
        '[{"channel":"cash","declaredAmount":3200.00}]'::jsonb
      );
    `),
    'UNAUTHENTICATED',
    'Unauthenticated RPC caller rejected'
  );

  // 2. Caller spoofing p_created_by rejected
  await setAuthUser(salesId);
  await assertRejects(
    db.query<any>(`
      SELECT submit_delivery_atomic(
        'GD-202611-0002', '11111111-0000-0000-0000-000000000002', 'hash2',
        '${custEligibleId}', '${driverId}', '${assignmentId}',
        3200.00, 0.00, 3200.00, 3200.00, 0.00, 'fully_paid',
        NULL, NULL, NULL, NULL, false, 'test',
        '[{"productId":"${prod4mm}","sellingUnit":"FULL_SHEET","quantity":1,"appliedUnitPrice":3200.00}]'::jsonb,
        '[{"channel":"cash","declaredAmount":3200.00}]'::jsonb
      );
    `),
    'UNAUTHORIZED',
    'Caller cannot impersonate another employee (auth.uid != p_created_by)'
  );

  // 3. Driver not assigned to this shift rejected
  await setAuthUser(otherDriverId);
  await assertRejects(
    db.query<any>(`
      SELECT submit_delivery_atomic(
        'GD-202611-0003', '11111111-0000-0000-0000-000000000003', 'hash3',
        '${custEligibleId}', '${otherDriverId}', '${assignmentId}',
        3200.00, 0.00, 3200.00, 3200.00, 0.00, 'fully_paid',
        NULL, NULL, NULL, NULL, false, 'test',
        '[{"productId":"${prod4mm}","sellingUnit":"FULL_SHEET","quantity":1,"appliedUnitPrice":3200.00}]'::jsonb,
        '[{"channel":"cash","declaredAmount":3200.00}]'::jsonb
      );
    `),
    'UNAUTHORIZED_SHIFT',
    'Unassigned driver rejected from submitting delivery on another shift'
  );

  // 4. Ineligible role (cash_collector) rejected
  await setAuthUser(collectorId);
  await assertRejects(
    db.query<any>(`
      SELECT submit_delivery_atomic(
        'GD-202611-0004', '11111111-0000-0000-0000-000000000004', 'hash4',
        '${custEligibleId}', '${collectorId}', '${assignmentId}',
        3200.00, 0.00, 3200.00, 3200.00, 0.00, 'fully_paid',
        NULL, NULL, NULL, NULL, false, 'test',
        '[{"productId":"${prod4mm}","sellingUnit":"FULL_SHEET","quantity":1,"appliedUnitPrice":3200.00}]'::jsonb,
        '[{"channel":"cash","declaredAmount":3200.00}]'::jsonb
      );
    `),
    'ROLE_NOT_AUTHORIZED',
    'Cash collector role prohibited from submitting deliveries'
  );

  console.log('\n--- Suite 3: Profile Security & Immutability Kernel Triggers ---');
  // Attempt self-role escalation
  await setAuthUser(salesId);
  await assertRejects(
    db.query<any>(`UPDATE profiles SET role = 'owner' WHERE id = '${salesId}';`),
    'PERMISSION_DENIED',
    'Salesperson cannot escalate their role to owner'
  );

  // Attempt deactivating the last active owner
  await setAuthUser(ownerId);
  await assertRejects(
    db.query<any>(`UPDATE profiles SET is_active = false WHERE id = '${ownerId}';`),
    'INVALID_OPERATION',
    'Owner cannot deactivate the last remaining active owner'
  );

  console.log('\n--- Suite 4: Stock Locking & Physical Half-Sheet Transformations ---');
  // Initialize Truck Stock: 10 full sheets, 0 half sheets
  await db.exec(`
    INSERT INTO inventory_balances (product_id, stock_location_id, full_sheets, half_sheets)
    VALUES ('${prod4mm}', '${truckLocationId}', 10, 0)
    ON CONFLICT (product_id, stock_location_id) DO UPDATE SET full_sheets = 10, half_sheets = 0;
  `);

  // Deliver 1 ordered half sheet (Part 4.4 Example 1: 10 full, 0 half -> order 1 half -> 9 full, 1 half, 9.5 FSE)
  await setAuthUser(driverId);
  const txId1 = 'a0000000-0000-0000-0000-000000000001';
  const res1 = await db.query<any>(`
    SELECT submit_delivery_atomic(
      'GD-202611-0010', '${txId1}', 'hash_stock_1',
      '${custEligibleId}', '${driverId}', '${assignmentId}',
      1750.00, 0.00, 1750.00, 1750.00, 0.00, 'fully_paid',
      NULL, NULL, NULL, NULL, false, 'Half sheet order',
      '[{"productId":"${prod4mm}","sellingUnit":"HALF_SHEET","quantity":1,"appliedUnitPrice":1750.00}]'::jsonb,
      '[{"channel":"cash","declaredAmount":1750.00}]'::jsonb
    );
  `);
  assert(res1.rows[0].submit_delivery_atomic.success === true, '1 Half sheet delivery committed successfully');

  // Check ending stock balance
  const bal1 = await db.query<any>(`
    SELECT full_sheets, half_sheets, fse FROM inventory_balances
    WHERE product_id = '${prod4mm}' AND stock_location_id = '${truckLocationId}';
  `);
  assert(bal1.rows[0].full_sheets === 9, 'Full sheets remaining is exactly 9 (Got: ' + bal1.rows[0].full_sheets + ')');
  assert(bal1.rows[0].half_sheets === 1, 'Physical half sheets remaining is exactly 1 (Got: ' + bal1.rows[0].half_sheets + ')');
  assert(parseFloat(bal1.rows[0].fse) === 9.5, 'Stock FSE is exactly 9.5 (Got: ' + bal1.rows[0].fse + ')');

  // Verify stock_transformations record exists
  const trans1 = await db.query<any>(`
    SELECT full_sheets_consumed, half_sheets_produced FROM stock_transformations
    WHERE product_id = '${prod4mm}' AND stock_location_id = '${truckLocationId}';
  `);
  assert(trans1.rows.length === 1, '1 stock_transformation record permanently persisted');
  assert(trans1.rows[0].full_sheets_consumed === 1, '1 Full sheet consumed for transformation');
  assert(trans1.rows[0].half_sheets_produced === 2, '2 Physical half sheets produced');

  // Deliver 1 half sheet when 1 half sheet already in stock (10 full, 1 half -> order 1 half -> 10 full, 0 half)
  // Currently: 9 full, 1 half. Order 1 half -> should consume existing half without split -> 9 full, 0 half!
  const txId2 = 'a0000000-0000-0000-0000-000000000002';
  await db.query<any>(`
    SELECT submit_delivery_atomic(
      'GD-202611-0011', '${txId2}', 'hash_stock_2',
      '${custEligibleId}', '${driverId}', '${assignmentId}',
      1750.00, 0.00, 1750.00, 1750.00, 0.00, 'fully_paid',
      NULL, NULL, NULL, NULL, false, 'Consume existing half',
      '[{"productId":"${prod4mm}","sellingUnit":"HALF_SHEET","quantity":1,"appliedUnitPrice":1750.00}]'::jsonb,
      '[{"channel":"cash","declaredAmount":1750.00}]'::jsonb
    );
  `);
  const bal2 = await db.query<any>(`
    SELECT full_sheets, half_sheets, fse FROM inventory_balances
    WHERE product_id = '${prod4mm}' AND stock_location_id = '${truckLocationId}';
  `);
  assert(bal2.rows[0].full_sheets === 9, 'Full sheets remained 9 without unnecessary split (Got: ' + bal2.rows[0].full_sheets + ')');
  assert(bal2.rows[0].half_sheets === 0, 'Half sheets consumed to 0 (Got: ' + bal2.rows[0].half_sheets + ')');
  assert(parseFloat(bal2.rows[0].fse) === 9.0, 'Stock FSE is 9.0 (Got: ' + bal2.rows[0].fse + ')');

  // Attempt to deliver more full sheets than available (Available: 9 full, order: 10 full)
  const txIdFailStock = 'a0000000-0000-0000-0000-000000000009';
  await assertRejects(
    db.query<any>(`
      SELECT submit_delivery_atomic(
        'GD-202611-0012', '${txIdFailStock}', 'hash_excess_stock',
        '${custEligibleId}', '${driverId}', '${assignmentId}',
        32000.00, 0.00, 32000.00, 32000.00, 0.00, 'fully_paid',
        NULL, NULL, NULL, NULL, false, 'Excess stock request',
        '[{"productId":"${prod4mm}","sellingUnit":"FULL_SHEET","quantity":10,"appliedUnitPrice":3200.00}]'::jsonb,
        '[{"channel":"cash","declaredAmount":32000.00}]'::jsonb
      );
    `),
    'INSUFFICIENT_STOCK',
    'Delivery exceeding available stock rejected with INSUFFICIENT_STOCK'
  );

  console.log('\n--- Suite 5: Independent Financial Calculations & Pricing ---');
  // 1. Client-supplied subtotal mismatch rejected
  const txIdMathErr = 'b0000000-0000-0000-0000-000000000001';
  await assertRejects(
    db.query<any>(`
      SELECT submit_delivery_atomic(
        'GD-202611-0020', '${txIdMathErr}', 'hash_math_err',
        '${custEligibleId}', '${driverId}', '${assignmentId}',
        1000.00, 0.00, 3200.00, 3200.00, 0.00, 'fully_paid',
        NULL, NULL, NULL, NULL, false, 'Mismatched subtotal',
        '[{"productId":"${prod4mm}","sellingUnit":"FULL_SHEET","quantity":1,"appliedUnitPrice":3200.00}]'::jsonb,
        '[{"channel":"cash","declaredAmount":3200.00}]'::jsonb
      );
    `),
    'SUBTOTAL_MISMATCH',
    'Falsified client subtotal rejected by database math calculation'
  );

  // 2. Client unapproved price discount rejected
  const txIdUnapprovedPrice = 'b0000000-0000-0000-0000-000000000002';
  await assertRejects(
    db.query<any>(`
      SELECT submit_delivery_atomic(
        'GD-202611-0021', '${txIdUnapprovedPrice}', 'hash_unapproved_price',
        '${custEligibleId}', '${driverId}', '${assignmentId}',
        2500.00, 0.00, 2500.00, 2500.00, 0.00, 'fully_paid',
        NULL, NULL, NULL, NULL, false, 'Unauthorized discount',
        '[{"productId":"${prod4mm}","sellingUnit":"FULL_SHEET","quantity":1,"appliedUnitPrice":2500.00}]'::jsonb,
        '[{"channel":"cash","declaredAmount":2500.00}]'::jsonb
      );
    `),
    'UNAUTHORIZED_PRICE',
    'Unapproved driver discount rejected by price enforcement'
  );

  // 3. Credit on ineligible customer rejected
  const txIdIneligibleCredit = 'b0000000-0000-0000-0000-000000000003';
  await assertRejects(
    db.query<any>(`
      SELECT submit_delivery_atomic(
        'GD-202611-0022', '${txIdIneligibleCredit}', 'hash_ineligible_credit',
        '${custIneligibleId}', '${driverId}', '${assignmentId}',
        3200.00, 0.00, 3200.00, 0.00, 3200.00, 'credit',
        NULL, NULL, NULL, NULL, false, 'Credit on cash-only customer',
        '[{"productId":"${prod4mm}","sellingUnit":"FULL_SHEET","quantity":1,"appliedUnitPrice":3200.00}]'::jsonb,
        '[]'::jsonb
      );
    `),
    'CREDIT_NOT_AUTHORIZED',
    'Credit purchase on credit-ineligible customer rejected'
  );

  console.log('\n--- Suite 6: Canonical Idempotency & Tampering Protection ---');
  const txIdIdempotency = 'c0000000-0000-0000-0000-000000000001';
  const canonicalHashReal = '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8';

  // First submission: successful
  const idemRes1 = await db.query<any>(`
    SELECT submit_delivery_atomic(
      'GD-202611-0030', '${txIdIdempotency}', '${canonicalHashReal}',
      '${custEligibleId}', '${driverId}', '${assignmentId}',
      3200.00, 0.00, 3200.00, 3200.00, 0.00, 'fully_paid',
      NULL, NULL, NULL, NULL, false, 'Idempotency test',
      '[{"productId":"${prod4mm}","sellingUnit":"FULL_SHEET","quantity":1,"appliedUnitPrice":3200.00}]'::jsonb,
      '[{"channel":"cash","declaredAmount":3200.00}]'::jsonb
    );
  `);
  assert(idemRes1.rows[0].submit_delivery_atomic.success === true, 'First delivery submission succeeds');

  // Retry with IDENTICAL payload hash -> returns duplicate without re-deducting stock
  const idemRes2 = await db.query<any>(`
    SELECT submit_delivery_atomic(
      'GD-202611-0030', '${txIdIdempotency}', '${canonicalHashReal}',
      '${custEligibleId}', '${driverId}', '${assignmentId}',
      3200.00, 0.00, 3200.00, 3200.00, 0.00, 'fully_paid',
      NULL, NULL, NULL, NULL, false, 'Idempotency test',
      '[{"productId":"${prod4mm}","sellingUnit":"FULL_SHEET","quantity":1,"appliedUnitPrice":3200.00}]'::jsonb,
      '[{"channel":"cash","declaredAmount":3200.00}]'::jsonb
    );
  `);
  assert(idemRes2.rows[0].submit_delivery_atomic.duplicate === true, 'Duplicate retry acknowledged cleanly (duplicate: true)');

  // Retry with CHANGED payload hash -> REJECTED with IDEMPOTENCY_PAYLOAD_MISMATCH
  await assertRejects(
    db.query<any>(`
      SELECT submit_delivery_atomic(
        'GD-202611-0030', '${txIdIdempotency}', 'TAMPERED_HASH_123',
        '${custEligibleId}', '${driverId}', '${assignmentId}',
        3200.00, 0.00, 3200.00, 3200.00, 0.00, 'fully_paid',
        NULL, NULL, NULL, NULL, false, 'Tampered retry',
        '[{"productId":"${prod4mm}","sellingUnit":"FULL_SHEET","quantity":1,"appliedUnitPrice":3200.00}]'::jsonb,
        '[{"channel":"cash","declaredAmount":3200.00}]'::jsonb
      );
    `),
    'IDEMPOTENCY_PAYLOAD_MISMATCH',
    'Reusing clientTxId with modified payload rejected as tampering'
  );

  console.log('\n--- Suite 7: Collections, Multi-Invoice Allocations & Turnover ---');
  // 1. Record customer collection
  await setAuthUser(collectorId);
  const colRes = await db.query<any>(`
    SELECT record_customer_collection(
      '${custEligibleId}', 'cash', 10000.00, 'CASH-REC-101', 'Direct shop collection'
    );
  `);
  const colData = colRes.rows[0].record_customer_collection;
  assert(colData.success === true, 'Customer collection recorded');
  const collectionId = colData.collection_id;

  // Verify turnover liability increased for collector
  const turnoverRes = await db.query<any>(`
    SELECT cash_declared, variance FROM employee_turnovers WHERE employee_id = '${collectorId}';
  `);
  assert(parseFloat(turnoverRes.rows[0].cash_declared) === 10000.00, 'Collector cash turnover liability is 10,000.00');

  console.log('\n--- Suite 8: Inbound SMS Webhook & Dispute State Machine ---');
  // First delivery awaiting confirmation: GD-202611-0030
  // Verify customer primary phone: +254712345678
  const smsConfirm = await db.query<any>(`
    SELECT process_inbound_sms_atomic('msg-prov-001', '+254712345678', '1 GD-202611-0030');
  `);
  assert(smsConfirm.rows[0].process_inbound_sms_atomic.status === 'confirmed', 'Inbound SMS 1 confirmed delivery');

  // Verify delivery table status is confirmed
  const delConfirm = await db.query<any>(`SELECT customer_confirmation_status FROM deliveries WHERE delivery_reference = 'GD-202611-0030';`);
  assert(delConfirm.rows[0].customer_confirmation_status === 'confirmed', 'Delivery status is confirmed in database');

  // Test dispute on another delivery
  const smsDispute = await db.query<any>(`
    SELECT process_inbound_sms_atomic('msg-prov-002', '+254712345678', '2 GD-202611-0010');
  `);
  assert(smsDispute.rows[0].process_inbound_sms_atomic.status === 'disputed', 'Inbound SMS 2 marked delivery as disputed');

  // Critical State Machine Test: Follow-up response '1' (reason: wrong items/quantity) MUST NOT flip back to confirmed!
  const smsDisputeReason = await db.query<any>(`
    SELECT process_inbound_sms_atomic('msg-prov-003', '+254712345678', '1 GD-202611-0010');
  `);
  assert(smsDisputeReason.rows[0].process_inbound_sms_atomic.status === 'dispute_updated', 'Dispute questionnaire reply 1 categorized dispute reason');
  assert(smsDisputeReason.rows[0].process_inbound_sms_atomic.category === 'wrong_items_or_quantities', 'Category parsed as wrong_items_or_quantities');

  const delStillDisputed = await db.query<any>(`SELECT customer_confirmation_status FROM deliveries WHERE delivery_reference = 'GD-202611-0010';`);
  assert(delStillDisputed.rows[0].customer_confirmation_status === 'disputed', 'Disputed delivery remains in DISPUTED status (never flipped to confirmed)');

  // Unauthorized sender phone rejected
  const smsUnauthorized = await db.query<any>(`
    SELECT process_inbound_sms_atomic('msg-prov-004', '+254799999999', '1 GD-202611-0030');
  `);
  assert(smsUnauthorized.rows[0].process_inbound_sms_atomic.status === 'unauthorized_sender', 'Spoofed sender phone rejected from confirming customer delivery');

  console.log('\n======================================================================');
  console.log(`REAL DATABASE TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runDatabaseTests().catch((err) => {
  console.error('Fatal Database Test Error:', err);
  process.exit(1);
});
