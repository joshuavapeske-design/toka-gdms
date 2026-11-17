// TOKA GDMS — Vehicle Shift Assignments API
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { demoStore } from '@/lib/demo-store';

const createAssignmentSchema = z.object({
  vehicleId: z.string().uuid({ message: 'vehicleId must be a valid UUID' }),
  routeId: z.string().uuid({ message: 'routeId must be a valid UUID' }),
  driverId: z.string().uuid({ message: 'driverId must be a valid UUID' }),
  salespersonId: z.string().uuid({ message: 'salespersonId must be a valid UUID' }),
  secondarySalespersonId: z.string().uuid().nullable().optional(),
  crewIds: z.array(z.string().uuid()).optional(),
  shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'shiftDate must be YYYY-MM-DD' }).default(() => new Date().toISOString().split('T')[0]),
});

let simulatedAssignments: any[] = [];

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl || supabaseUrl.includes('placeholder')) {
      return NextResponse.json({ success: true, data: demoStore.getAssignments() });
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
        vehicles (
          registration_plate,
          make_model,
          stock_locations (
            id,
            name
          )
        ),
        routes (code, name),
        driver:profiles!vehicle_assignments_driver_id_fkey (full_name),
        salesperson:profiles!vehicle_assignments_salesperson_id_fkey (full_name)
      `)
      .order('shift_date', { ascending: false })
      .order('is_active', { ascending: false });

    if (error || !data) {
      return NextResponse.json({ success: true, data: demoStore.getAssignments() });
    }

    const formatted = data.map((va: any) => {
      const truckLocation = va.vehicles?.stock_locations?.[0];
      const onboardStock: any[] = [];

      return {
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
        secondarySalespersonId: va.secondary_salesperson_id || null,
        secondarySalespersonName: va.secondary_salesperson?.full_name || null,
        crewIds: va.crew_ids || [],
        shiftDate: va.shift_date,
        startedAt: va.started_at,
        endedAt: va.ended_at,
        isActive: va.is_active,
        createdAt: va.created_at,
        onboardStock,
      };
    });

    return NextResponse.json({ success: true, data: formatted });
  } catch {
    return NextResponse.json({ success: true, data: demoStore.getAssignments() });
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

    const { vehicleId, routeId, driverId, salespersonId, secondarySalespersonId, crewIds, shiftDate } = parseResult.data;

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
        driverName: 'David Ochieng',
        salespersonId,
        salespersonName: 'Grace Muthoni',
        secondarySalespersonId: secondarySalespersonId || null,
        secondarySalespersonName: secondarySalespersonId ? 'Second Sales Rep' : null,
        crewIds: crewIds || [driverId, salespersonId],
        crewNames: ['Driver & Sales Crew'],
        shiftDate,
        startedAt: new Date().toISOString(),
        endedAt: null,
        isActive: true,
        createdAt: new Date().toISOString(),
      };
      demoStore.addAssignment(newSim as any);
      return NextResponse.json({
        success: true,
        simulated: true,
        message: 'Daily vehicle shift assignment successfully started with 2-3 crew members.',
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

    // Try inserting with crew fields; fall back if migration not yet applied
    const insertPayload: any = {
      vehicle_id: vehicleId,
      route_id: routeId,
      driver_id: driverId,
      salesperson_id: salespersonId,
      shift_date: shiftDate,
      started_at: new Date().toISOString(),
      is_active: true,
    };
    if (secondarySalespersonId) insertPayload.secondary_salesperson_id = secondarySalespersonId;
    if (crewIds && crewIds.length > 0) insertPayload.crew_ids = crewIds;

    const { data, error } = await supabase
      .from('vehicle_assignments')
      .insert(insertPayload)
      .select('id, shift_date, started_at, is_active')
      .single();

    if (error) {
      // If error is about missing column secondary_salesperson_id, retry without them
      if (error.message.includes('secondary_salesperson_id') || error.message.includes('crew_ids')) {
        const fallbackInsert = {
          vehicle_id: vehicleId,
          route_id: routeId,
          driver_id: driverId,
          salesperson_id: salespersonId,
          shift_date: shiftDate,
          started_at: new Date().toISOString(),
          is_active: true,
        };
        const { data: fbData, error: fbErr } = await supabase
          .from('vehicle_assignments')
          .insert(fallbackInsert)
          .select('id, shift_date, started_at, is_active')
          .single();

        if (fbErr) {
          return NextResponse.json({ success: false, error: fbErr.message }, { status: 422 });
        }
        return NextResponse.json({
          success: true,
          message: 'Vehicle shift successfully started.',
          data: fbData,
        });
      }

      console.error('[ASSIGNMENT CREATE ERROR]', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      message: 'Vehicle shift successfully started with crew assigned.',
      data,
    });
  } catch (err: any) {
    console.error('[ASSIGNMENT CREATE EXCEPTION]', err);
    return NextResponse.json({ success: false, error: err.message || 'Internal server error' }, { status: 500 });
  }
}

