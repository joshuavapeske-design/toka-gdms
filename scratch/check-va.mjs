import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gnikugaoobqhehbjhoyf.supabase.co';
const serviceKey = 'sb_secret_XPEtp-yoXKv3cG--PSyorQ_3PdHSo2m';

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function check() {
  const { data: cols, error } = await supabase
    .from('vehicle_assignments')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Error:', error);
  } else {
    console.log('vehicle_assignments sample row / keys:', cols);
  }
}

check();

