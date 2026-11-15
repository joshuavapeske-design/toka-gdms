// TOKA GDMS — Vehicle Glass Loading API (Assign glass carried by vehicles)
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { demoStore } from '@/lib/demo-store';

const loadStockSchema = z.object({
  vehicleId: z.string().uuid({ message: 'vehicleId must be a valid UUID' }),
  productId: z.string().uuid({ message: 'productId must be a valid UUID' }),
  fullSheets: z.number().int().nonnegative().default(0),
  halfSheets: z.number().int().nonnegative().default(0),
  notes: z.string().optional().default('Daily route glass load'),
}).refine((data) => data.fullSheets > 0 || data.halfSheets > 0, {
  message: 'Must load at least 1 full sheet or 1 half sheet onto vehicle',
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parseResult = loadStockSchema.safeParse(body);

    if (!parseResult.success) {
      const errorMsg = parseResult.error.errors.map((e) => e.message).join('; ');
      return NextResponse.json({ success: false, error: errorMsg }, { status: 400 });
    }

    const { vehicleId, productId, fullSheets, halfSheets, notes } = parseResult.data;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl || supabaseUrl.includes('placeholder')) {
      const updated = demoStore.loadVehicleStock({
        vehicleId,
        productId,
        fullSheets,
        halfSheets,
        notes,
      });
      return NextResponse.json({
        success: true,
        message: `Successfully loaded ${fullSheets} full sheets & ${halfSheets} half sheets onto vehicle.`,
        data: updated,
      });
    }

    const supabase = await createServerSupabaseClient();

    // Call stored procedure assign_vehicle_glass_stock if available, or direct balance update
    const { data: rpcData, error: rpcErr } = await supabase.rpc('assign_vehicle_glass_stock', {
      p_vehicle_id: vehicleId,
      p_product_id: productId,
      p_full_sheets: fullSheets,
      p_half_sheets: halfSheets,
      p_notes: notes,
    });

    if (!rpcErr && rpcData?.success) {
      return NextResponse.json({
        success: true,
        message: `Assigned ${fullSheets} full sheets & ${halfSheets} half sheets to vehicle.`,
        data: rpcData,
      });
    }

    // Direct fallback if RPC not yet created in remote DB
    // 1. Find or create stock_location
    let { data: loc } = await supabase
      .from('stock_locations')
      .select('id')
      .eq('vehicle_id', vehicleId)
      .eq('is_active', true)
      .maybeSingle();

    if (!loc) {
      const { data: veh } = await supabase.from('vehicles').select('registration_plate').eq('id', vehicleId).single();
      const { data: newLoc } = await supabase
        .from('stock_locations')
        .insert({
          name: `Truck ${veh?.registration_plate || vehicleId} Mobile Bay`,
          location_type: 'truck',
          vehicle_id: vehicleId,
          is_active: true,
        })
        .select('id')
        .single();
      loc = newLoc;
    }

    if (!loc) {
      return NextResponse.json({ success: false, error: 'Could not resolve vehicle stock location' }, { status: 422 });
    }

    // 2. Upsert inventory_balances
    const { data: existingBal } = await supabase
      .from('inventory_balances')
      .select('id, full_sheets, half_sheets')
      .eq('product_id', productId)
      .eq('stock_location_id', loc.id)
      .maybeSingle();

    if (existingBal) {
      await supabase
        .from('inventory_balances')
        .update({
          full_sheets: existingBal.full_sheets + fullSheets,
          half_sheets: existingBal.half_sheets + halfSheets,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingBal.id);
    } else {
      await supabase.from('inventory_balances').insert({
        product_id: productId,
        stock_location_id: loc.id,
        full_sheets: fullSheets,
        halfSheets: halfSheets,
      });
    }

    return NextResponse.json({
      success: true,
      message: `Assigned ${fullSheets} full sheets and ${halfSheets} half sheets to vehicle stock bay.`,
      data: { vehicleId, locationId: loc.id, fullSheets, halfSheets },
    });
  } catch (err: any) {
    console.error('[LOAD VEHICLE STOCK EXCEPTION]', err);
    return NextResponse.json({ success: false, error: err.message || 'Internal server error' }, { status: 500 });
  }
}
