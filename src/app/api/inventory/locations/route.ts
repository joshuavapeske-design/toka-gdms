// TOKA GDMS — Stock Locations API
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export interface StockLocationOption {
  id: string;
  name: string;
  locationType: 'warehouse' | 'truck' | 'transit';
  vehicleId?: string | null;
}

const DEFAULT_LOCATIONS: StockLocationOption[] = [
  {
    id: '33333333-3333-3333-3333-333333333301',
    name: 'Main Central Warehouse (Depot A)',
    locationType: 'warehouse',
  },
  {
    id: '33333333-3333-3333-3333-333333333303',
    name: 'Truck KBZ 123X Mobile Bay',
    locationType: 'truck',
    vehicleId: '77777777-7777-7777-7777-777777777701',
  },
  {
    id: '33333333-3333-3333-3333-333333333302',
    name: 'Transit Holding Bay',
    locationType: 'transit',
  },
];

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl || supabaseUrl.includes('placeholder')) {
      return NextResponse.json({ success: true, data: DEFAULT_LOCATIONS });
    }

    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from('stock_locations')
      .select('id, name, location_type, vehicle_id')
      .eq('is_active', true)
      .order('name');

    if (error || !data || data.length === 0) {
      return NextResponse.json({ success: true, data: DEFAULT_LOCATIONS });
    }

    const formatted: StockLocationOption[] = data.map((loc: any) => ({
      id: loc.id,
      name: loc.name,
      locationType: loc.location_type,
      vehicleId: loc.vehicle_id,
    }));

    return NextResponse.json({ success: true, data: formatted });
  } catch {
    return NextResponse.json({ success: true, data: DEFAULT_LOCATIONS });
  }
}

