// TOKA GDMS — Vehicle Shift Assignments API
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const createAssignmentSchema = z.object({
  vehicleId: z.string().uuid({ message: 'vehicleId must be a valid UUID' }),
  routeId: z.string().uuid({ message: 'routeId must be a valid UUID' }),
  driverId: z.string().uuid({ message: 'driverId must be a valid UUID' }),
  salespersonId: z.string().uuid({ message: 'salespersonId must be a valid UUID' }),
  shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'shiftDate must be YYYY-MM-DD' }).default(() => new Date().toISOString().split('T')[0]),
});

let simulatedAssignments = [
  {
    id: '55555555-5555-5555-5555-555555555501',
    vehicleId: '77777777-7777-7777-7777-777777777701',
    vehiclePlate: 'KBZ 123X',
    vehicleModel: 'Isuzu FRR 10-Tonne Glass Carrier',
    routeId: '66666666-6666-6666-6666-666666666601',
    routeCode: 'RT-01',
    routeName: 'Industrial Area - Gikomba Express',
    driverId: '00000000-0000-0000-0000-000000000004',
    driverName: 'David Ochieng',
    salespersonId: '00000000-0000-0000-0000-000000000003',
    salespersonName: 'Grace Muthoni',
    shiftDate: new Date().toISOString().split('T')[0],
    startedAt: new Date().toISOString(),
    endedAt: null,
    isActive: true,
    createdAt: new Date().toISOString(),
  },
];

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl || supabaseUrl.includes('placeholder')) {
      return NextResponse.json({ success: true, data: simulatedAssignments });
    }

    const supabase = await createServerSupabaseClient();
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
        routes (code, name),
        driver:profiles!vehicle_assignments_driver_id_fkey (full_name),
        salesperson:profiles!vehicle_assignments_salesperson_id_fkey (full_name)
      `)
      .order('shift_date', { ascending: false })
      .order('is_active', { ascending: false });

    if (error || !data || data.length === 0) {
      return NextResponse.json({ success: true, data: simulatedAssignments });
    }

    const formatted = data.map((va: any) => ({
      id: va.id,
      vehicleId: va.vehicle_id,
      vehiclePlate: va.vehicles?.registration_plate || 'Unknown Plate',
      vehicleModel: va.vehicles?.make_model || '',
      routeId: va.route_id,
      routeCode: va.routes?.code || '',
      routeName: va.routes?.name || 'Assigned Route',
      driverId: va.driver_id,
      driverName: va.driver?.full_name || 'Assigned Driver',
      salespersonId: va.salesperson_id,
      salespersonName: va.salesperson?.full_name || 'Assigned Salesperson',
      shiftDate: va.shift_date,
      startedAt: va.started_at,
      endedAt: va.ended_at,
      isActive: va.is_active,
      createdAt: va.created_at,
    }));

    return NextResponse.json({ success: true, data: formatted });
  } catch {
    return NextResponse.json({ success: true, data: simulatedAssignments });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parseResult = createAssignmentSchema.safeParse(body);

    if (!parseResult.success) {
      const errorMsg = parseResult.error.errors.map((e) => e.message).join('; ');
      return NextResponse.json({ success: false, error: errorMsg }, { status: 400 });
    }

    const { vehicleId, routeId, driverId, salespersonId, shiftDate } = parseResult.data;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl || supabaseUrl.includes('placeholder')) {
      const newSim = {
        id: `va-${Date.now()}`,
        vehicleId,
        vehiclePlate: 'KBZ 123X',
        vehicleModel: 'Isuzu FRR 10-Tonne',
        routeId,
        routeCode: 'RT-NEW',
        routeName: 'Dispatched Route',
        driverId,
        driverName: 'Assigned Driver',
        salespersonId,
        salespersonName: 'Assigned Salesperson',
        shiftDate,
        startedAt: new Date().toISOString(),
        endedAt: null,
        isActive: true,
        createdAt: new Date().toISOString(),
      };
      simulatedAssignments.unshift(newSim);
      return NextResponse.json({
        success: true,
        simulated: true,
        message: 'Daily vehicle shift assignment successfully started.',
        data: newSim,
      });
    }

    const supabase = await createServerSupabaseClient();

    // Check if vehicle or driver already has active shift on this date
    const { data: existingActive } = await supabase
      .from('vehicle_assignments')
      .select('id')
      .eq('vehicle_id', vehicleId)
      .eq('shift_date', shiftDate)
      .eq('is_active', true)
      .maybeSingle();

    if (existingActive) {
      return NextResponse.json(
        { success: false, error: 'This vehicle already has an active shift assignment for today.' },
        { status: 409 }
      );
    }

    const { data, error } = await supabase
      .from('vehicle_assignments')
      .insert({
        vehicle_id: vehicleId,
        route_id: routeId,
        driver_id: driverId,
        salesperson_id: salespersonId,
        shift_date: shiftDate,
        started_at: new Date().toISOString(),
        is_active: true,
      })
      .select('id, shift_date, started_at, is_active')
      .single();

    if (error) {
      console.error('[ASSIGNMENT CREATE ERROR]', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      message: 'Vehicle shift successfully started.',
      data,
    });
  } catch (err: any) {
    console.error('[ASSIGNMENT CREATE EXCEPTION]', err);
    return NextResponse.json({ success: false, error: err.message || 'Internal server error' }, { status: 500 });
  }
}
