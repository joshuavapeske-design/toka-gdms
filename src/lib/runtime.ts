export function isExplicitDemoMode(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.GDMS_DEMO_MODE === 'true';
}
export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return Boolean(url && key && !url.includes('placeholder') && !key.includes('placeholder'));
}
export function assertSupabaseConfigured(): void {
  if (!isSupabaseConfigured()) throw new Error('TOKA GDMS requires valid Supabase configuration.');
}
