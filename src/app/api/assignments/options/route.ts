// TOKA GDMS — Shift Assignment Options API
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const DEFAULT_OPTIONS = {
  vehicles: [],
  routes: [],
  drivers: [],
  salespersons: [],
  allStaff: [],
};

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl || supabaseUrl.includes('placeholder')) {
      return NextResponse.json({ success: true, data: DEFAULT_OPTIONS });
    }

    const supabase = await createServerSupabaseClient();
    const [vehiclesRes, routesRes, profilesRes] = await Promise.all([
      supabase.from('vehicles').select('id, registration_plate, make_model').eq('is_active', true),
      supabase.from('routes').select('id, code, name').eq('is_active', true),
      supabase.from('profiles').select('id, full_name, role').eq('is_active', true),
    ]);

    const vehicles = (vehiclesRes.data || []).map((v: any) => ({
      id: v.id,
      registrationPlate: v.registration_plate,
      makeModel: v.make_model,
    }));

    const routes = (routesRes.data || []).map((r: any) => ({
      id: r.id,
      code: r.code,
      name: r.name,
    }));

    const profiles = profilesRes.data || [];
    const drivers = profiles.filter((p: any) => p.role === 'driver').map((p: any) => ({
      id: p.id,
      fullName: p.full_name,
      role: p.role,
    }));

    const salespersons = profiles.filter((p: any) => p.role === 'salesperson' || p.role === 'manager' || p.role === 'owner').map((p: any) => ({
      id: p.id,
      fullName: p.full_name,
      role: p.role,
    }));

    const allStaff = profiles.map((p: any) => ({
      id: p.id,
      fullName: p.full_name,
      role: p.role,
    }));

    return NextResponse.json({
      success: true,
      data: {
        vehicles,
        routes,
        drivers,
        salespersons,
        allStaff,
      },
    });
  } catch {
    return NextResponse.json({ success: true, data: DEFAULT_OPTIONS });
  }
}

