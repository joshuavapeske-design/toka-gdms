import { createClient } from '@supabase/supabase-js';

const url = 'https://gnikugaoobqhehbjhoyf.supabase.co';
const serviceKey = 'sb_secret_XPEtp-yoXKv3cG--PSyorQ_3PdHSo2m';

const adminClient = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function check() {
  const tables = [
    'profiles',
    'product_categories',
    'products',
    'customers',
    'vehicles',
    'routes',
    'stock_locations',
    'inventory_balances',
    'deliveries',
  ];

  console.log('--- Checking Database Tables in Supabase ---');
  for (const table of tables) {
    const { count, error } = await adminClient
      .from(table)
      .select('*', { count: 'exact', head: true });
    if (error) {
      console.log(`❌ Table "${table}": Error -> ${error.message}`);
    } else {
      console.log(`✅ Table "${table}": Exists! Rows: ${count}`);
    }
  }

  // Check stored procedure
  console.log('\n--- Checking RPC Function ---');
  const { data: rpcTest, error: rpcErr } = await adminClient.rpc('submit_delivery_atomic', {
    p_delivery_reference: 'GD-TEST',
  });
  if (rpcErr) {
    console.log('RPC check result:', rpcErr.message);
  } else {
    console.log('RPC check result:', rpcTest);
  }
}

check();
