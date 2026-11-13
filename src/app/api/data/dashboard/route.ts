import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { isExplicitDemoMode, isSupabaseConfigured } from '@/lib/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (!isSupabaseConfigured()) {
      if (isExplicitDemoMode()) {
        return NextResponse.json({
          success: true,
          simulated: true,
          data: {
            todayDeliveries: 0,
            todayRevenue: 0,
            activeDisputes: 0,
            outstandingCredit: 0,
            lowStockAlerts: null,
            activeVehicles: 0,
            totalCustomers: 0,
          },
        });
      }
      return NextResponse.json({ success: false, error: 'Supabase is not configured.' }, { status: 503 });
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 });

    const nairobiDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
    const startOfDay = new Date(`${nairobiDate}T00:00:00+03:00`).toISOString();

    const [deliveryResult, disputeResult, creditResult, vehicleResult, customerResult] = await Promise.all([
      supabase.from('deliveries').select('id,total_declared_paid,created_at').gte('created_at', startOfDay),
      supabase.from('customer_disputes').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('credit_accounts').select('current_balance'),
      supabase.from('vehicle_assignments').select('id', { count: 'exact', head: true }).eq('is_active', true).eq('shift_date', nairobiDate),
      supabase.from('customers').select('id', { count: 'exact', head: true }).eq('is_active', true),
    ]);

    const firstError = deliveryResult.error || disputeResult.error || creditResult.error || vehicleResult.error || customerResult.error;
    if (firstError) {
      console.error('[DASHBOARD API ERROR]', firstError);
      return NextResponse.json({ success: false, error: 'Unable to load dashboard statistics.' }, { status: 500 });
    }

    const todayDeliveries = deliveryResult.data || [];
    const data = {
      todayDeliveries: todayDeliveries.length,
      todayRevenue: todayDeliveries.reduce((sum, row) => sum + Number(row.total_declared_paid || 0), 0),
      activeDisputes: disputeResult.count || 0,
      outstandingCredit: (creditResult.data || []).reduce((sum, row) => sum + Number(row.current_balance || 0), 0),
      lowStockAlerts: null,
      activeVehicles: vehicleResult.count || 0,
      totalCustomers: customerResult.count || 0,
    };

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('[DASHBOARD API EXCEPTION]', error);
    return NextResponse.json({ success: false, error: 'Unable to load dashboard statistics.' }, { status: 500 });
  }
}
