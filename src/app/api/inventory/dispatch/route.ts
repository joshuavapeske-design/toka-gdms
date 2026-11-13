// TOKA GDMS — Vehicle Stock Dispatch API
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const dispatchStockSchema = z.object({
  productId: z.string().uuid({ message: 'productId must be a valid UUID' }),
  fromLocationId: z.string().uuid({ message: 'fromLocationId must be a valid UUID' }),
  toLocationId: z.string().uuid({ message: 'toLocationId must be a valid UUID' }),
  fullSheets: z.number().int().min(0, { message: 'fullSheets must be >= 0' }).default(0),
  halfSheets: z.number().int().min(0, { message: 'halfSheets must be >= 0' }).default(0),
  notes: z.string().max(500).optional(),
}).refine((data) => data.fullSheets > 0 || data.halfSheets > 0, {
  message: 'Must dispatch at least 1 full sheet or 1 half sheet',
}).refine((data) => data.fromLocationId !== data.toLocationId, {
  message: 'Source and destination locations must be different',
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parseResult = dispatchStockSchema.safeParse(body);

    if (!parseResult.success) {
      const errorMsg = parseResult.error.errors.map((e) => e.message).join('; ');
      return NextResponse.json({ success: false, error: errorMsg }, { status: 400 });
    }

    const { productId, fromLocationId, toLocationId, fullSheets, halfSheets, notes } = parseResult.data;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl || supabaseUrl.includes('placeholder')) {
      // Local simulation
      const fse = fullSheets + (halfSheets * 0.5);
      return NextResponse.json({
        success: true,
        simulated: true,
        message: `Successfully dispatched ${fullSheets} full sheets and ${halfSheets} half sheets (${fse.toFixed(1)} FSE) to vehicle bay.`,
        data: {
          productId,
          fromLocationId,
          toLocationId,
          fullSheets,
          halfSheets,
          fse,
        },
      });
    }

    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.rpc('dispatch_stock_vehicle', {
      p_product_id: productId,
      p_from_location_id: fromLocationId,
      p_to_location_id: toLocationId,
      p_full_sheets: fullSheets,
      p_half_sheets: halfSheets,
      p_notes: notes || 'Vehicle morning stock dispatch via Web UI',
    });

    if (error || !data?.success) {
      console.error('[STOCK DISPATCH ERROR]', error || data);
      return NextResponse.json(
        { success: false, error: error?.message || data?.error || 'Failed to dispatch stock to vehicle' },
        { status: 422 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Stock successfully dispatched and loaded onto vehicle bay.',
      data,
    });
  } catch (err: any) {
    console.error('[STOCK DISPATCH EXCEPTION]', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
