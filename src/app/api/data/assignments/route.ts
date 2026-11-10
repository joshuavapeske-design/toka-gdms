// TOKA GDMS — Active Vehicle Assignments API
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { VehicleAssignment } from '@/types';

// Default seed assignment for offline/local simulation
const DEFAULT_ASSIGNMENT: VehicleAssignment = {
  id: '55555555-5555-5555-5555-555555555501',
  vehicleId: '77777777-7777-7777-7777-777777777701',
  vehicleRegistrationPlate: 'KBZ 123X',
  vehicleModel: 'Isuzu FRR 10-Tonne Glass Carrier',
  routeId: '66666666-6666-6666-6666-666666666601',
  routeName: 'Route 1: Industrial Area - Gikomba Express',
  driverId: '00000000-0000-0000-0000-000000000004',
  driverName: 'David Ochieng',
  salespersonId: '00000000-0000-0000-0000-000000000003',
  salespersonName: 'Grace Muthoni',
  shiftDate: new Date().toISOString().split('T')[0],
  startedAt: new Date().toISOString(),
  isActive: true,
  createdAt: new Date().toISOString(),
};

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (supabaseUrl && !supabaseUrl.includes('placeholder')) {
      const supabase = await createServerSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }

      // Query active assignment for this employee
      const { data, error } = await supabase
        .from('vehicle_assignments')
        .select(`
          id,
          vehicle_id,
          route_id,
          driver_id,
          salesperson_id,
          shift_date,
          started_at,
          ended_at,
          is_active,
          created_at,
          vehicles (registration_plate, make_model),
          routes (name, code),
          driver:driver_id (full_name),
          salesperson:salesperson_id (full_name)
        `)
        .eq('is_active', true)
        .or(`driver_id.eq.${user.id},salesperson_id.eq.${user.id}`)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[ASSIGNMENTS API ERROR]', error);
        return NextResponse.json(
          { success: false, error: `Database error: ${error.message}` },
          { status: 500 }
        );
      }

      if (data) {
        const v = data.vehicles as any;
        const r = data.routes as any;
        const d = data.driver as any;
        const s = data.salesperson as any;

        const formatted: VehicleAssignment = {
          id: data.id,
          vehicleId: data.vehicle_id,
          vehicleRegistrationPlate: v?.registration_plate || 'KBZ 123X',
          vehicleModel: v?.make_model,
          routeId: data.route_id,
          routeName: r?.name || r?.code,
          driverId: data.driver_id,
          driverName: d?.full_name,
          salespersonId: data.salesperson_id,
          salespersonName: s?.full_name,
          shiftDate: data.shift_date,
          startedAt: data.started_at,
          endedAt: data.ended_at,
          isActive: data.is_active,
          createdAt: data.created_at,
        };

        return NextResponse.json({ success: true, data: formatted });
      }

      return NextResponse.json({ success: true, data: null });
    }

    // In local development simulation mode
    return NextResponse.json({ success: true, data: DEFAULT_ASSIGNMENT });
  } catch (err: any) {
    console.error('[ASSIGNMENTS API EXCEPTION]', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

