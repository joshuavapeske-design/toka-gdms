import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gnikugaoobqhehbjhoyf.supabase.co';
const serviceKey = 'sb_secret_XPEtp-yoXKv3cG--PSyorQ_3PdHSo2m';

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function listAll() {
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, phone_number, is_active')
    .order('role');

  const { data: authUsers } = await supabase.auth.admin.listUsers();

  console.log('--- ALL AUTH USERS & PROFILES ---');
  for (const p of profiles || []) {
    const au = authUsers?.users?.find((u) => u.id === p.id);
    console.log(`Role: ${p.role.padEnd(15)} | Email: ${(au?.email || 'N/A').padEnd(25)} | Name: ${p.full_name}`);
  }
}

listAll();

