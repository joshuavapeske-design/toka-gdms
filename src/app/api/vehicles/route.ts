// TOKA GDMS — Fleet Vehicles API (Owner & Manager Fleet Registration)
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { demoStore } from '@/lib/demo-store';

const createVehicleSchema = z.object({
  registrationPlate: z.string().min(2, { message: 'Registration plate is required' }).transform((v) => v.trim().toUpperCase()),
  makeModel: z.string().min(2, { message: 'Make and model is required' }),
  tonnageCapacity: z.number().positive({ message: 'Tonnage capacity must be greater than 0' }),
  ownershipType: z.enum(['owned', 'leased', 'contracted']).default('owned'),
});

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl || supabaseUrl.includes('placeholder')) {
      const vehicles = demoStore.getVehicles();
      return NextResponse.json({ success: true, data: vehicles });
    }

    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from('vehicles')
      .select(`
        id,
        registration_plate,
        make_model,
        tonnage_capacity,
        ownership_type,
        status,
        is_active,
        created_at,
        stock_locations (
          id,
          name,
          inventory_balances (
            product_id,
            full_sheets,
            half_sheets,
            fse,
            products (name, sku)
          )
        )
      `)
      .eq('is_active', true)
      .order('registration_plate');

    if (error || !data) {
      console.warn('[VEHICLES GET FALLBACK]', error?.message);
      return NextResponse.json({ success: true, data: demoStore.getVehicles() });
    }

    const formatted = data.map((v: any) => {
      const truckLocation = v.stock_locations?.[0];
      const onboardStock = (truckLocation?.inventory_balances || []).map((b: any) => ({
        productId: b.product_id,
        productName: b.products?.name || 'Glass',
        sku: b.products?.sku || '',
        locationId: truckLocation?.id,
        locationName: truckLocation?.name,
        fullSheets: b.full_sheets,
        halfSheets: b.half_sheets,
        fseTotal: parseFloat(b.fse) || (b.full_sheets + b.half_sheets * 0.5),
      }));

      return {
        id: v.id,
        registrationPlate: v.registration_plate,
        makeModel: v.make_model,
        tonnageCapacity: parseFloat(v.tonnage_capacity) || 0,
        ownershipType: v.ownership_type || 'owned',
        status: v.status,
        isActive: v.is_active,
        createdAt: v.created_at,
        stockLocationId: truckLocation?.id,
        onboardStock,
      };
    });

    return NextResponse.json({ success: true, data: formatted });
  } catch (err: any) {
    console.error('[VEHICLES GET EXCEPTION]', err);
    return NextResponse.json({ success: true, data: demoStore.getVehicles() });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parseResult = createVehicleSchema.safeParse(body);

    if (!parseResult.success) {
      const errorMsg = parseResult.error.errors.map((e) => e.message).join('; ');
      return NextResponse.json({ success: false, error: errorMsg }, { status: 400 });
    }

    const { registrationPlate, makeModel, tonnageCapacity, ownershipType } = parseResult.data;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl || supabaseUrl.includes('placeholder')) {
      const newVeh = demoStore.addVehicle({
        registrationPlate,
        makeModel,
        tonnageCapacity,
        ownershipType,
      });
      return NextResponse.json({
        success: true,
        message: `Vehicle ${registrationPlate} added to fleet.`,
        data: newVeh,
      });
    }

    const supabase = await createServerSupabaseClient();

    // Insert vehicle
    const { data: vehicle, error: vehErr } = await supabase
      .from('vehicles')
      .insert({
        registration_plate: registrationPlate,
        make_model: makeModel,
        tonnage_capacity: tonnageCapacity,
        ownership_type: ownershipType,
        status: 'active',
        is_active: true,
      })
      .select()
      .single();

    if (vehErr) {
      console.error('[VEHICLE CREATE ERROR]', vehErr);
      return NextResponse.json({ success: false, error: vehErr.message }, { status: 422 });
    }

    // Auto-create its dedicated truck mobile stock location
    await supabase.from('stock_locations').insert({
      name: `Truck ${registrationPlate} Mobile Bay`,
      location_type: 'truck',
      vehicle_id: vehicle.id,
      is_active: true,
    });

    return NextResponse.json({
      success: true,
      message: `Vehicle ${registrationPlate} registered and assigned mobile stock location.`,
      data: vehicle,
    });
  } catch (err: any) {
    console.error('[VEHICLE CREATE EXCEPTION]', err);
    return NextResponse.json({ success: false, error: err.message || 'Internal server error' }, { status: 500 });
  }
}
