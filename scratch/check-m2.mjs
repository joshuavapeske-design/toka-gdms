import { createClient } from '@supabase/supabase-js';

const url = 'https://gnikugaoobqhehbjhoyf.supabase.co';
const serviceKey = 'sb_secret_XPEtp-yoXKv3cG--PSyorQ_3PdHSo2m';

const adminClient = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function checkFunctions() {
  const { data, error } = await adminClient
    .from('customer_confirmation_events')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.log('Migration 2 check (table customer_confirmation_events): NOT YET APPLIED ->', error.message);
  } else {
    console.log('Migration 2 check: APPLIED! customer_confirmation_events exists.');
  }
}

checkFunctions();

