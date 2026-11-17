import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gnikugaoobqhehbjhoyf.supabase.co';
const serviceKey = 'sb_secret_XPEtp-yoXKv3cG--PSyorQ_3PdHSo2m';

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function check() {
  // Test if we can update customer insert policy or if we can run it
  // Notice that in Supabase client, we can call rpc functions if one exists for executing sql, or we can check tables
  const { data, error } = await supabase.from('customers').insert({
    name: 'Test Customer Temp',
    account_number: 'TEST-TEMP-001',
    primary_phone: '+254700999888',
    delivery_area: 'Test Area',
    created_by: 'c88014ed-fc4e-4615-a756-fbed4b7f2832',
  }).select();

  console.log('Customer insert test:', error ? error.message : 'Success!');

  if (data && data.length > 0) {
    await supabase.from('customers').delete().eq('id', data[0].id);
  }
}

check();

