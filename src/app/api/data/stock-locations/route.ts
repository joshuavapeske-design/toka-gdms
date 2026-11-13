import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { isExplicitDemoMode, isSupabaseConfigured } from '@/lib/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (!isSupabaseConfigured()) {
      if (isExplicitDemoMode()) {
        return NextResponse.json({ success: true, simulated: true, data: { warehouses: [], vehicles: [] } });
      }
      return NextResponse.json({ success: false, error: 'Supabase is not configured.' }, { status: 503 });
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 });

    const { data, error } = await supabase
      .from('stock_locations')
      .select('id,name,location_type,vehicle_id,vehicles(registration_plate,make_model)')
      .eq('is_active', true)
      .order('name');

    if (error) {
      console.error('[STOCK LOCATIONS API ERROR]', error);
      return NextResponse.json({ success: false, error: 'Unable to load stock locations.' }, { status: 500 });
    }

    const formatted = (data || []).map((location: any) => ({
      id: location.id,
      name: location.name,
      locationType: location.location_type,
      vehicleId: location.vehicle_id,
      vehicleRegistrationPlate: location.vehicles?.registration_plate || null,
      vehicleModel: location.vehicles?.make_model || null,
    }));

    return NextResponse.json({
      success: true,
      data: {
        warehouses: formatted.filter((item) => item.locationType === 'warehouse'),
        vehicles: formatted.filter((item) => item.locationType === 'truck' && item.vehicleId),
      },
    });
  } catch (error) {
    console.error('[STOCK LOCATIONS API EXCEPTION]', error);
    return NextResponse.json({ success: false, error: 'Unable to load stock locations.' }, { status: 500 });
  }
}
