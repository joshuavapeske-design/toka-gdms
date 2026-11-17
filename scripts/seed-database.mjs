// TOKA GDMS — Supabase Live Database Seeding Script
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://gnikugaoobqhehbjhoyf.supabase.co';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_secret_XPEtp-yoXKv3cG--PSyorQ_3PdHSo2m';

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function seed() {
  console.log('====================================================');
  console.log('TOKA GDMS — SEEDING SUPABASE OPERATIONAL DATA');
  console.log('====================================================');

  // Retrieve existing auth users
  const { data: userList } = await supabase.auth.admin.listUsers();
  const existingUsers = userList?.users || [];

  // ── Helper: create or find auth user ──────────────────────
  async function ensureUser(email, password, fullName) {
    let user = existingUsers.find((u) => u.email === email);
    if (!user) {
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (error) {
        console.error(`  ❌ Failed to create ${email}: ${error.message}`);
        return null;
      }
      user = data.user;
      console.log(`  ✅ Created auth user: ${email}`);
    } else {
      console.log(`  ℹ️  Auth user exists: ${email}`);
    }
    return user;
  }

  // ── Helper: upsert profile ────────────────────────────────
  async function upsertProfile(id, fullName, role, phone) {
    const { error } = await supabase.from('profiles').upsert({
      id,
      full_name: fullName,
      role,
      phone_number: phone,
      is_active: true,
    });
    if (error) console.error(`  ❌ Profile error for ${fullName}: ${error.message}`);
    else console.log(`  ✅ Profile: ${fullName} (${role})`);
  }

  // ══════════════════════════════════════════════════════════
  // 1. CREATE ALL USERS & PROFILES
  // ══════════════════════════════════════════════════════════
  console.log('\n── 1. Creating Users & Profiles ──────────────────');

  const accounts = [
    { email: 'owner@tokaglass.co.ke',      password: 'TokaOwner2026!',  name: 'Titus Kamau (Owner)',        role: 'owner',          phone: '+254700000001' },
    { email: 'manager@tokaglass.co.ke',     password: 'TokaManager2026!', name: 'James Mwangi (Manager)',   role: 'manager',        phone: '+254700000002' },
    { email: 'sales@tokaglass.co.ke',       password: 'TokaStaff2026!',  name: 'Grace Muthoni',             role: 'salesperson',    phone: '+254700000003' },
    { email: 'sales2@tokaglass.co.ke',      password: 'TokaStaff2026!',  name: 'Peter Njuguna',             role: 'salesperson',    phone: '+254700000006' },
    { email: 'driver@tokaglass.co.ke',      password: 'TokaStaff2026!',  name: 'David Ochieng',             role: 'driver',         phone: '+254700000004' },
    { email: 'accountant@tokaglass.co.ke',  password: 'TokaStaff2026!',  name: 'Alice Wanjiku',             role: 'accountant',     phone: '+254700000005' },
    { email: 'collector@tokaglass.co.ke',   password: 'TokaStaff2026!',  name: 'Brian Otieno',              role: 'cash_collector', phone: '+254700000007' },
  ];

  const profileMap = {};

  for (const acct of accounts) {
    const user = await ensureUser(acct.email, acct.password, acct.name);
    if (user) {
      profileMap[acct.role] = user.id;
      // Store extra salesperson IDs separately
      if (acct.email === 'sales2@tokaglass.co.ke') profileMap['salesperson2'] = user.id;
      await upsertProfile(user.id, acct.name, acct.role, acct.phone);
    }
  }

  // ══════════════════════════════════════════════════════════
  // 2. REGISTER VEHICLES (COMPANY-OWNED FLEET)
  // ══════════════════════════════════════════════════════════
  console.log('\n── 2. Registering Vehicles ───────────────────────');

  const vehiclesData = [
    { registration_plate: 'KBZ 123X', make_model: 'Isuzu FRR 10-Tonne Glass Carrier', tonnage_capacity: 10.0, ownership_type: 'owned' },
    { registration_plate: 'KCE 456Y', make_model: 'Mitsubishi Canter 5-Tonne', tonnage_capacity: 5.0, ownership_type: 'owned' },
  ];

  const vehicleIds = {};
  for (const v of vehiclesData) {
    const { data, error } = await supabase
      .from('vehicles')
      .upsert({ ...v, status: 'active', is_active: true }, { onConflict: 'registration_plate' })
      .select()
      .single();
    if (error) console.error(`  ❌ Vehicle ${v.registration_plate}: ${error.message}`);
    else {
      vehicleIds[v.registration_plate] = data.id;
      console.log(`  ✅ Vehicle: ${v.registration_plate} — ${v.make_model}`);
    }
  }

  // ══════════════════════════════════════════════════════════
  // 3. CREATE ROUTES
  // ══════════════════════════════════════════════════════════
  console.log('\n── 3. Creating Delivery Routes ───────────────────');

  const routesData = [
    { code: 'RT-01', name: 'Industrial Area - Gikomba Express', description: 'Main commercial workshop delivery route' },
    { code: 'RT-02', name: 'Westlands - Parklands Loop', description: 'Premium residential and office route' },
  ];

  const routeIds = {};
  for (const r of routesData) {
    const { data, error } = await supabase
      .from('routes')
      .upsert({ ...r, is_active: true }, { onConflict: 'code' })
      .select()
      .single();
    if (error) console.error(`  ❌ Route ${r.code}: ${error.message}`);
    else {
      routeIds[r.code] = data.id;
      console.log(`  ✅ Route: ${r.code} — ${r.name}`);
    }
  }

  // ══════════════════════════════════════════════════════════
  // 4. CREATE TRUCK STOCK LOCATIONS
  // ══════════════════════════════════════════════════════════
  console.log('\n── 4. Setting Up Truck Stock Locations ───────────');

  const truckLocIds = {};
  for (const plate of Object.keys(vehicleIds)) {
    const { data, error } = await supabase
      .from('stock_locations')
      .upsert(
        { name: `Truck ${plate}`, location_type: 'truck', vehicle_id: vehicleIds[plate], is_active: true },
        { onConflict: 'name' }
      )
      .select()
      .single();
    if (error) console.error(`  ❌ Truck location ${plate}: ${error.message}`);
    else {
      truckLocIds[plate] = data.id;
      console.log(`  ✅ Truck stock location: ${data.name}`);
    }
  }

  // ══════════════════════════════════════════════════════════
  // 5. DISPATCH CREW SHIFTS (2-3 PEOPLE PER TRUCK)
  // ══════════════════════════════════════════════════════════
  console.log('\n── 5. Dispatching Crew Shifts ────────────────────');

  const today = new Date().toISOString().split('T')[0];

  // Truck 1: Driver David + Salesperson Grace + Salesperson2 Peter  
  if (vehicleIds['KBZ 123X'] && routeIds['RT-01'] && profileMap.driver && profileMap.salesperson) {
    const crewIds = [profileMap.driver, profileMap.salesperson];
    if (profileMap.salesperson2) crewIds.push(profileMap.salesperson2);

    const { error } = await supabase.from('vehicle_assignments').upsert({
      vehicle_id: vehicleIds['KBZ 123X'],
      route_id: routeIds['RT-01'],
      driver_id: profileMap.driver,
      salesperson_id: profileMap.salesperson,
      secondary_salesperson_id: profileMap.salesperson2 || null,
      crew_ids: crewIds,
      shift_date: today,
      started_at: new Date().toISOString(),
      is_active: true,
    }).select().single();
    if (error) console.error(`  ❌ Shift KBZ 123X: ${error.message}`);
    else console.log(`  ✅ Shift: KBZ 123X → Driver David + Grace + Peter on RT-01`);
  }

  // ══════════════════════════════════════════════════════════
  // 6. LOAD GLASS STOCK ONTO TRUCKS (via stock_movements)
  // ══════════════════════════════════════════════════════════
  console.log('\n── 6. Loading Glass onto Trucks ──────────────────');

  const warehouseId = '33333333-3333-3333-3333-333333333301';
  const products = [
    { id: '22222222-2222-2222-2222-222222222201', name: '4mm Clear', full: 20, half: 4 },
    { id: '22222222-2222-2222-2222-222222222202', name: '5mm Clear', full: 15, half: 2 },
    { id: '22222222-2222-2222-2222-222222222203', name: '6mm Clear', full: 10, half: 0 },
    { id: '22222222-2222-2222-2222-222222222204', name: '5mm Bronze', full: 8,  half: 0 },
    { id: '22222222-2222-2222-2222-222222222205', name: '5mm Grey',  full: 5,  half: 2 },
    { id: '22222222-2222-2222-2222-222222222206', name: '4mm Mirror', full: 6,  half: 0 },
  ];

  for (const plate of Object.keys(truckLocIds)) {
    for (const p of products) {
      // Stock movement: warehouse → truck
      const fse = p.full + (p.half * 0.5);
      const { error } = await supabase.from('stock_movements').insert({
        product_id: p.id,
        from_location_id: warehouseId,
        to_location_id: truckLocIds[plate],
        full_sheets_delta: p.full,
        half_sheets_delta: p.half,
        fse_delta: fse,
        movement_type: 'dispatch_to_truck',
        responsible_employee_id: profileMap.owner || profileMap.manager,
        notes: `Initial truck loading for ${plate}`,
      });
      if (error) console.error(`  ❌ Stock ${p.name} → ${plate}: ${error.message}`);
      else console.log(`  ✅ Loaded ${p.full}F/${p.half}H ${p.name} → ${plate}`);
    }
  }

  // ══════════════════════════════════════════════════════════
  // 7. SEED CUSTOMERS
  // ══════════════════════════════════════════════════════════
  console.log('\n── 7. Seeding Customers ─────────────────────────');

  const customersData = [
    { account_number: 'CUST-001', name: 'Apex Glaziers & Aluminum Works',    primary_phone: '+254712345678', delivery_area: 'Industrial Area, Road C', is_credit_eligible: true,  credit_limit: 250000.0 },
    { account_number: 'CUST-002', name: 'Nairobi Modern Hardware',           primary_phone: '+254723456789', delivery_area: 'Gikomba, Quarry Road',    is_credit_eligible: true,  credit_limit: 150000.0 },
    { account_number: 'CUST-003', name: 'Westlands Premium Interiors',       primary_phone: '+254734567890', delivery_area: 'Westlands, Muthithi Road', is_credit_eligible: false, credit_limit: 0.0 },
    { account_number: 'CUST-004', name: 'Eastleigh Glass & Mirror Centre',   primary_phone: '+254745678901', delivery_area: 'Eastleigh, 1st Avenue',   is_credit_eligible: true,  credit_limit: 500000.0 },
  ];

  const ownerId = profileMap.owner;

  for (const c of customersData) {
    const { data: cust, error } = await supabase
      .from('customers')
      .upsert({ ...c, created_by: ownerId }, { onConflict: 'account_number' })
      .select()
      .single();

    if (error) {
      console.error(`  ❌ Customer ${c.name}: ${error.message}`);
    } else {
      // Upsert credit account
      await supabase.from('credit_accounts').upsert({
        customer_id: cust.id,
        current_balance: 0.0,
        total_credit_extended: 0.0,
        total_credit_repaid: 0.0,
      });
      console.log(`  ✅ Customer: ${cust.name} (${cust.account_number})`);
    }
  }

  // ══════════════════════════════════════════════════════════
  // DONE — Print Login Credentials
  // ══════════════════════════════════════════════════════════
  console.log('\n====================================================');
  console.log('✅ SEEDING COMPLETED SUCCESSFULLY!');
  console.log('====================================================');
  console.log('');
  console.log('LOGIN CREDENTIALS:');
  console.log('──────────────────────────────────────────');
  console.log('  Owner:          owner@tokaglass.co.ke      / TokaOwner2026!');
  console.log('  Manager:        manager@tokaglass.co.ke    / TokaManager2026!');
  console.log('  Salesperson 1:  sales@tokaglass.co.ke      / TokaStaff2026!');
  console.log('  Salesperson 2:  sales2@tokaglass.co.ke     / TokaStaff2026!');
  console.log('  Driver:         driver@tokaglass.co.ke     / TokaStaff2026!');
  console.log('  Accountant:     accountant@tokaglass.co.ke / TokaStaff2026!');
  console.log('  Cash Collector: collector@tokaglass.co.ke  / TokaStaff2026!');
  console.log('──────────────────────────────────────────');
}

seed().catch(console.error);
