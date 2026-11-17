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

  // 1. Create or retrieve Owner Auth user
  const ownerEmail = 'owner@tokaglass.co.ke';
  const ownerPassword = 'TokaOwner2026!';

  console.log(`\n1. Creating Owner Auth User (${ownerEmail})...`);
  const { data: userList } = await supabase.auth.admin.listUsers();
  let ownerUser = userList?.users?.find((u) => u.email === ownerEmail);

  if (!ownerUser) {
    const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
      email: ownerEmail,
      password: ownerPassword,
      email_confirm: true,
      user_metadata: { full_name: 'TOKA Owner / Executive' },
    });

    if (createErr) {
      console.error('Failed to create owner user:', createErr.message);
      return;
    }
    ownerUser = newUser.user;
    console.log(`✅ Created owner user: ${ownerUser.id}`);
  } else {
    console.log(`ℹ️ Owner user already exists: ${ownerUser.id}`);
  }

  // 2. Create Staff Users (Driver, Salesperson, Accountant)
  const staff = [
    { email: 'sales@tokaglass.co.ke', name: 'Grace Muthoni', role: 'salesperson', phone: '+254700000003' },
    { email: 'driver@tokaglass.co.ke', name: 'David Ochieng', role: 'driver', phone: '+254700000004' },
    { email: 'accountant@tokaglass.co.ke', name: 'Alice Wanjiku', role: 'accountant', phone: '+254700000002' },
  ];

  const profileMap = new Map();
  profileMap.set('owner', ownerUser.id);

  console.log('\n2. Creating Staff Accounts & Profiles...');
  for (const member of staff) {
    let staffUser = userList?.users?.find((u) => u.email === member.email);
    if (!staffUser) {
      const { data: created, error } = await supabase.auth.admin.createUser({
        email: member.email,
        password: 'TokaStaff2026!',
        email_confirm: true,
        user_metadata: { full_name: member.name },
      });
      if (error) {
        console.error(`Error creating ${member.email}:`, error.message);
        continue;
      }
      staffUser = created.user;
    }
    profileMap.set(member.role, staffUser.id);

    // Upsert profile
    const { error: profErr } = await supabase.from('profiles').upsert({
      id: staffUser.id,
      full_name: member.name,
      role: member.role,
      phone_number: member.phone,
      is_active: true,
    });
    if (profErr) console.error(`Error upserting profile for ${member.name}:`, profErr.message);
    else console.log(`✅ Profile ready: ${member.name} (${member.role})`);
  }

  // Upsert Owner Profile
  const { error: ownerProfErr } = await supabase.from('profiles').upsert({
    id: ownerUser.id,
    full_name: 'TOKA Owner / Executive',
    role: 'owner',
    phone_number: '+254700000001',
    is_active: true,
  });
  if (ownerProfErr) console.error('Error upserting owner profile:', ownerProfErr.message);
  else console.log('✅ Owner Profile ready: TOKA Owner / Executive (owner)');

  // 3. Vehicles & Delivery Routes
  console.log('\n3. Seeding Vehicles & Delivery Routes...');
  const { data: vehicle, error: vehErr } = await supabase
    .from('vehicles')
    .upsert(
      {
        registration_plate: 'KBZ 123X',
        make_model: 'Isuzu FRR 10-Tonne Glass Carrier',
        tonnage_capacity: 10.0,
        status: 'active',
        is_active: true,
      },
      { onConflict: 'registration_plate' }
    )
    .select()
    .single();

  if (vehErr) console.error('Vehicle upsert error:', vehErr.message);
  else console.log(`✅ Vehicle ready: ${vehicle.registration_plate} (ID: ${vehicle.id})`);

  const { data: route, error: routeErr } = await supabase
    .from('routes')
    .upsert(
      {
        code: 'RT-01',
        name: 'Industrial Area - Gikomba Express',
        description: 'Main commercial workshop delivery route',
        is_active: true,
      },
      { onConflict: 'code' }
    )
    .select()
    .single();

  if (routeErr) console.error('Route upsert error:', routeErr.message);
  else console.log(`✅ Route ready: ${route.code} - ${route.name}`);

  // 4. Vehicle Stock Location & Active Shift Assignment
  if (vehicle && route && profileMap.get('driver') && profileMap.get('salesperson')) {
    console.log('\n4. Setting up Active Vehicle Shift & Truck Stock Bay...');
    const { data: truckLoc } = await supabase
      .from('stock_locations')
      .upsert(
        {
          name: `Truck ${vehicle.registration_plate} Mobile Bay`,
          location_type: 'truck',
          vehicle_id: vehicle.id,
          is_active: true,
        },
        { onConflict: 'name' }
      )
      .select()
      .single();

    if (truckLoc) console.log(`✅ Truck stock location ready: ${truckLoc.name}`);

    // Create Today's Shift Assignment
    const today = new Date().toISOString().split('T')[0];
    const { data: shift, error: shiftErr } = await supabase
      .from('vehicle_assignments')
      .upsert({
        vehicle_id: vehicle.id,
        route_id: route.id,
        driver_id: profileMap.get('driver'),
        salesperson_id: profileMap.get('salesperson'),
        shift_date: today,
        started_at: new Date().toISOString(),
        is_active: true,
      })
      .select()
      .single();

    if (shiftErr) console.error('Shift creation error:', shiftErr.message);
    else console.log(`✅ Daily shift assignment started: ${vehicle.registration_plate} on Route ${route.code}`);
  }

  // 5. Seed Warehouse Inventory Balances
  console.log('\n5. Seeding Warehouse Inventory Balances...');
  const { data: warehouse } = await supabase
    .from('stock_locations')
    .select('id, name')
    .eq('location_type', 'warehouse')
    .limit(1)
    .single();

  const { data: products } = await supabase.from('products').select('id, name, sku').limit(6);

  if (warehouse && products && products.length > 0) {
    for (const prod of products) {
      await supabase.from('inventory_balances').upsert(
        {
          product_id: prod.id,
          stock_location_id: warehouse.id,
          full_sheets_count: 50,
          half_sheets_count: 4,
          full_sheet_equivalent: 52.0,
        },
        { onConflict: 'product_id,stock_location_id' }
      );
      console.log(`✅ Stocked ${prod.name}: 50 Full Sheets, 4 Half Sheets (52.0 FSE)`);
    }
  }

  // 6. Customers & Credit Accounts
  console.log('\n6. Seeding Customer Directory & Credit Accounts...');
  const customers = [
    {
      account_number: 'CUST-001',
      name: 'Apex Glaziers & Aluminum Works',
      primary_phone: '+254712345678',
      alt_phone: '+254722111222',
      delivery_area: 'Industrial Area, Road C',
      is_credit_eligible: true,
      credit_limit: 250000.0,
      created_by: ownerUser.id,
    },
    {
      account_number: 'CUST-002',
      name: 'Nairobi Modern Hardware',
      primary_phone: '+254723456789',
      delivery_area: 'Gikomba, Quarry Road',
      is_credit_eligible: true,
      credit_limit: 150000.0,
      created_by: ownerUser.id,
    },
    {
      account_number: 'CUST-003',
      name: 'Westlands Premium Interiors',
      primary_phone: '+254734567890',
      delivery_area: 'Westlands, Muthithi Road',
      is_credit_eligible: false,
      credit_limit: 0.0,
      created_by: ownerUser.id,
    },
    {
      account_number: 'CUST-004',
      name: 'Eastleigh Glass & Mirror Centre',
      primary_phone: '+254745678901',
      delivery_area: 'Eastleigh, 1st Avenue',
      is_credit_eligible: true,
      credit_limit: 500000.0,
      created_by: ownerUser.id,
    },
  ];

  for (const c of customers) {
    const { data: cust, error: cErr } = await supabase
      .from('customers')
      .upsert(c, { onConflict: 'account_number' })
      .select()
      .single();

    if (cErr) {
      console.error(`Customer error (${c.name}):`, cErr.message);
    } else if (cust) {
      await supabase.from('credit_accounts').upsert({
        customer_id: cust.id,
        current_balance: 0.0,
        total_credit_extended: 0.0,
        total_credit_repaid: 0.0,
      });
      console.log(`✅ Customer ready: ${cust.name} (${cust.account_number})`);
    }
  }

  console.log('\n====================================================');
  console.log('SEEDING COMPLETED SUCCESSFULLY!');
  console.log('Owner Login Credentials:');
  console.log(`Email:    ${ownerEmail}`);
  console.log(`Password: ${ownerPassword}`);
  console.log('====================================================');
}

seed().catch(console.error);

