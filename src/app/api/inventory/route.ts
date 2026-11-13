// TOKA GDMS — Real-Time Stock Inventory & Balances API
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const DEFAULT_INVENTORY = [
  {
    id: 'inv-001',
    productId: '22222222-2222-2222-2222-222222222201',
    productName: '4mm Clear Sheet Glass',
    sku: 'GL-CLR-04-2418',
    color: 'Clear',
    thicknessMm: 4.0,
    stockLocationId: '33333333-3333-3333-3333-333333333301',
    locationName: 'Main Central Warehouse (Depot A)',
    locationType: 'warehouse',
    fullSheets: 45,
    halfSheets: 2,
    fse: 46.0,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'inv-002',
    productId: '22222222-2222-2222-2222-222222222201',
    productName: '4mm Clear Sheet Glass',
    sku: 'GL-CLR-04-2418',
    color: 'Clear',
    thicknessMm: 4.0,
    stockLocationId: '33333333-3333-3333-3333-333333333303',
    locationName: 'Truck KBZ 123X Mobile Bay',
    locationType: 'truck',
    fullSheets: 10,
    halfSheets: 1,
    fse: 10.5,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'inv-003',
    productId: '22222222-2222-2222-2222-222222222202',
    productName: '5mm Clear Sheet Glass',
    sku: 'GL-CLR-05-2418',
    color: 'Clear',
    thicknessMm: 5.0,
    stockLocationId: '33333333-3333-3333-3333-333333333301',
    locationName: 'Main Central Warehouse (Depot A)',
    locationType: 'warehouse',
    fullSheets: 30,
    halfSheets: 0,
    fse: 30.0,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'inv-004',
    productId: '22222222-2222-2222-2222-222222222203',
    productName: '6mm Clear Sheet Glass',
    sku: 'GL-CLR-06-2418',
    color: 'Clear',
    thicknessMm: 6.0,
    stockLocationId: '33333333-3333-3333-3333-333333333301',
    locationName: 'Main Central Warehouse (Depot A)',
    locationType: 'warehouse',
    fullSheets: 20,
    halfSheets: 1,
    fse: 20.5,
    updatedAt: new Date().toISOString(),
  },
];

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl || supabaseUrl.includes('placeholder')) {
      return NextResponse.json({ success: true, data: DEFAULT_INVENTORY });
    }

    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from('inventory_balances')
      .select(`
        id,
        product_id,
        stock_location_id,
        full_sheets,
        half_sheets,
        fse,
        updated_at,
        products (name, sku, color, thickness_mm),
        stock_locations (name, location_type)
      `)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('[INVENTORY API ERROR]', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const formatted = (data || []).map((b: any) => ({
      id: b.id,
      productId: b.product_id,
      productName: b.products?.name,
      sku: b.products?.sku,
      color: b.products?.color,
      thicknessMm: b.products?.thickness_mm ? parseFloat(b.products.thickness_mm) : 0,
      stockLocationId: b.stock_location_id,
      locationName: b.stock_locations?.name || 'Unknown Location',
      locationType: b.stock_locations?.location_type || 'warehouse',
      fullSheets: b.full_sheets,
      halfSheets: b.half_sheets,
      fse: parseFloat(b.fse),
      updatedAt: b.updated_at,
    }));

    return NextResponse.json({ success: true, data: formatted });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

