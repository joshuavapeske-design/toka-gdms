// TOKA GDMS — Real-Time Stock Inventory & Balances API
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { isExplicitDemoMode, isSupabaseConfigured } from '@/lib/runtime';

export async function GET() {
  try {
    if (!isSupabaseConfigured()) {
      if (isExplicitDemoMode()) return NextResponse.json({ success: true, data: [], simulated: true });
      return NextResponse.json({ success: false, error: 'Supabase is not configured.' }, { status: 503 });
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

