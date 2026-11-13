// TOKA GDMS — Shift Assignment Options API
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const DEFAULT_OPTIONS = {
  vehicles: [
    { id: '77777777-7777-7777-7777-777777777701', registrationPlate: 'KBZ 123X', makeModel: 'Isuzu FRR 10-Tonne Glass Carrier' },
    { id: '77777777-7777-7777-7777-777777777702', registrationPlate: 'KDG 456Y', makeModel: 'Mitsubishi Fuso 7-Tonne Flatbed' },
  ],
  routes: [
    { id: '66666666-6666-6666-6666-666666666601', code: 'RT-01', name: 'Industrial Area - Gikomba Express' },
    { id: '66666666-6666-6666-6666-666666666602', code: 'RT-02', name: 'Westlands - Parklands - Gigiri Circuit' },
    { id: '66666666-6666-6666-6666-666666666603', code: 'RT-03', name: 'Eastleigh - Thika Road Corridor' },
  ],
  drivers: [
    { id: '00000000-0000-0000-0000-000000000004', fullName: 'David Ochieng', role: 'driver' },
    { id: '00000000-0000-0000-0000-000000000006', fullName: 'Peter Kamau', role: 'driver' },
  ],
  salespersons: [
    { id: '00000000-0000-0000-0000-000000000003', fullName: 'Grace Muthoni', role: 'salesperson' },
    { id: '00000000-0000-0000-0000-000000000007', fullName: 'Mary Wanjiku', role: 'salesperson' },
  ],
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

    return NextResponse.json({
      success: true,
      data: {
        vehicles: vehicles.length > 0 ? vehicles : DEFAULT_OPTIONS.vehicles,
        routes: routes.length > 0 ? routes : DEFAULT_OPTIONS.routes,
        drivers: drivers.length > 0 ? drivers : DEFAULT_OPTIONS.drivers,
        salespersons: salespersons.length > 0 ? salespersons : DEFAULT_OPTIONS.salespersons,
      },
    });
  } catch {
    return NextResponse.json({ success: true, data: DEFAULT_OPTIONS });
  }
}
