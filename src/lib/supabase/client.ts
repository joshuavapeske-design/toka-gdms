// TOKA GDMS — Supabase Browser Client

import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('placeholder') || supabaseAnonKey.includes('placeholder')) {
    throw new Error('TOKA GDMS requires valid Supabase browser configuration.');
  }
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
