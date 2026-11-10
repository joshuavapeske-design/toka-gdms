// TOKA GDMS — Supabase Admin Client (Server-Only with Service Role Key)
import 'server-only';
import { createClient } from '@supabase/supabase-js';

export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!supabaseUrl || supabaseUrl.includes('placeholder') || !serviceRoleKey || serviceRoleKey.includes('placeholder')) {
    throw new Error('[GDMS Security Error] SUPABASE_SERVICE_ROLE_KEY is required for admin operations.');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
