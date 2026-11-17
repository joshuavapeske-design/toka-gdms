import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gnikugaoobqhehbjhoyf.supabase.co';
const serviceKey = 'sb_secret_XPEtp-yoXKv3cG--PSyorQ_3PdHSo2m';

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function addManager() {
  const users = [
    {
      email: 'manager@tokaglass.co.ke',
      password: 'TokaManager2026!',
      name: 'James Mwangi',
      role: 'manager',
      phone: '+254700000005',
    },
    {
      email: 'collector@tokaglass.co.ke',
      password: 'TokaStaff2026!',
      name: 'Peter Kamau',
      role: 'cash_collector',
      phone: '+254700000006',
    },
  ];

  const { data: userList } = await supabase.auth.admin.listUsers();

  for (const u of users) {
    let authUser = userList?.users?.find((x) => x.email === u.email);
    if (!authUser) {
      const { data: created, error } = await supabase.auth.admin.createUser({
        email: u.email,
        password: u.password,
        email_confirm: true,
        user_metadata: { full_name: u.name },
      });
      if (error) {
        console.error('Error creating user:', error.message);
        continue;
      }
      authUser = created.user;
      console.log(`Created user ${u.email}: ${authUser.id}`);
    } else {
      console.log(`User ${u.email} already exists: ${authUser.id}`);
    }

    const { error: profErr } = await supabase.from('profiles').upsert({
      id: authUser.id,
      full_name: u.name,
      role: u.role,
      phone_number: u.phone,
      is_active: true,
    });

    if (profErr) {
      console.error('Profile upsert error:', profErr.message);
    } else {
      console.log(`✅ Profile upserted: ${u.name} (${u.role})`);
    }
  }
}

addManager();

