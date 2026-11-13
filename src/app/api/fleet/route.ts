import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/runtime';

export const dynamic = 'force-dynamic';

const assignmentSchema = z.object({
  registrationPlate: z.string().trim().min(2).max(20),
  makeModel: z.string().trim().min(2).max(100),
  tonnageCapacity: z.number().finite().positive().max(100),
  routeCode: z.string().trim().min(2).max(20),
  routeName: z.string().trim().min(2).max(120),
  routeDescription: z.string().trim().max(500).optional(),
  driverId: z.string().uuid(),
  salespersonId: z.string().uuid(),
  shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startedAt: z.string().datetime(),
}).strict();

const closeShiftSchema = z.object({
  assignmentId: z.string().uuid(),
}).strict();

async function getManagerContext() {
  if (!isSupabaseConfigured()) {
    return { ok: false as const, response: NextResponse.json({ success: false, error: 'Fleet administration requires a connected staging database.' }, { status: 503 }) };
  }
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 }) };

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role,is_active')
    .eq('id', user.id)
    .single();

  if (error || !profile?.is_active) {
    return { ok: false as const, response: NextResponse.json({ success: false, error: 'Active employee profile required.' }, { status: 403 }) };
  }
  if (!['owner', 'manager'].includes(profile.role)) {
    return { ok: false as const, response: NextResponse.json({ success: false, error: 'Only owners and managers can administer fleet shifts.' }, { status: 403 }) };
  }
  return { ok: true as const, supabase, user };
}

export async function GET() {
  try {
    const context = await getManagerContext();
    if (!context.ok) return context.response;
    const { supabase } = context;

    const [vehiclesResult, routesResult, profilesResult, assignmentsResult] = await Promise.all([
      supabase.from('vehicles').select('id,registration_plate,make_model,tonnage_capacity,status,is_active').eq('is_active', true).order('registration_plate'),
      supabase.from('routes').select('id,code,name,is_active').eq('is_active', true).order('code'),
      supabase.from('profiles').select('id,full_name,phone_number,role').eq('is_active', true).in('role', ['driver', 'salesperson']).order('full_name'),
      supabase.from('vehicle_assignments').select(`
        id,shift_date,started_at,ended_at,is_active,
        vehicles(registration_plate,make_model),
        routes(code,name),
        driver:driver_id(full_name),
        salesperson:salesperson_id(full_name)
      `).order('shift_date', { ascending: false }).order('started_at', { ascending: false }).limit(100),
    ]);

    const failure = vehiclesResult.error || routesResult.error || profilesResult.error || assignmentsResult.error;
    if (failure) {
      console.error('[FLEET API ERROR]', failure);
      return NextResponse.json({ success: false, error: 'Unable to load fleet administration data.' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: {
        vehicles: vehiclesResult.data || [],
        routes: routesResult.data || [],
        employees: profilesResult.data || [],
        assignments: (assignmentsResult.data || []).map((item: any) => ({
          id: item.id,
          shiftDate: item.shift_date,
          startedAt: item.started_at,
          endedAt: item.ended_at,
          isActive: item.is_active,
          vehicle: item.vehicles,
          route: item.routes,
          driver: item.driver,
          salesperson: item.salesperson,
        })),
      },
    });
  } catch (error) {
    console.error('[FLEET API EXCEPTION]', error);
    return NextResponse.json({ success: false, error: 'Unable to load fleet administration data.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await getManagerContext();
    if (!context.ok) return context.response;

    let body: unknown;
    try { body = await request.json(); }
    catch { return NextResponse.json({ success: false, error: 'Malformed JSON request.' }, { status: 400 }); }

    const parsed = assignmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.issues.map((issue) => issue.message).join(' ') }, { status: 422 });
    }

    const input = parsed.data;
    const { data, error } = await context.supabase.rpc('create_vehicle_shift_assignment', {
      p_registration_plate: input.registrationPlate,
      p_make_model: input.makeModel,
      p_tonnage_capacity: input.tonnageCapacity,
      p_route_code: input.routeCode,
      p_route_name: input.routeName,
      p_route_description: input.routeDescription || null,
      p_driver_id: input.driverId,
      p_salesperson_id: input.salespersonId,
      p_shift_date: input.shiftDate,
      p_started_at: input.startedAt,
    });

    if (error) {
      console.error('[FLEET ASSIGNMENT RPC ERROR]', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 422 });
    }
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('[FLEET ASSIGNMENT API EXCEPTION]', error);
    return NextResponse.json({ success: false, error: 'Unable to create vehicle shift.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await getManagerContext();
    if (!context.ok) return context.response;

    let body: unknown;
    try { body = await request.json(); }
    catch { return NextResponse.json({ success: false, error: 'Malformed JSON request.' }, { status: 400 }); }

    const parsed = closeShiftSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'A valid assignment ID is required.' }, { status: 422 });
    }

    const { data, error } = await context.supabase.rpc('close_vehicle_shift', {
      p_assignment_id: parsed.data.assignmentId,
      p_ended_at: new Date().toISOString(),
    });
    if (error) {
      console.error('[FLEET SHIFT CLOSE RPC ERROR]', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 422 });
    }
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('[FLEET SHIFT CLOSE API EXCEPTION]', error);
    return NextResponse.json({ success: false, error: 'Unable to close vehicle shift.' }, { status: 500 });
  }
}
