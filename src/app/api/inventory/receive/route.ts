// TOKA GDMS — Warehouse Stock Receiving API
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const receiveStockSchema = z.object({
  productId: z.string().uuid({ message: 'productId must be a valid UUID' }),
  stockLocationId: z.string().uuid().default('33333333-3333-3333-3333-333333333301'),
  fullSheets: z.number().int().min(0, { message: 'fullSheets must be >= 0' }).default(0),
  halfSheets: z.number().int().min(0, { message: 'halfSheets must be >= 0' }).default(0),
  notes: z.string().max(500).optional(),
}).refine((data) => data.fullSheets > 0 || data.halfSheets > 0, {
  message: 'Must receive at least 1 full sheet or 1 half sheet',
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parseResult = receiveStockSchema.safeParse(body);

    if (!parseResult.success) {
      const errorMsg = parseResult.error.errors.map((e) => e.message).join('; ');
      return NextResponse.json({ success: false, error: errorMsg }, { status: 400 });
    }

    const { productId, stockLocationId, fullSheets, halfSheets, notes } = parseResult.data;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl || supabaseUrl.includes('placeholder')) {
      // Local simulation
      const fse = fullSheets + (halfSheets * 0.5);
      return NextResponse.json({
        success: true,
        simulated: true,
        message: `Successfully received ${fullSheets} full sheets and ${halfSheets} half sheets (${fse.toFixed(1)} FSE).`,
        data: {
          productId,
          stockLocationId,
          fullSheets,
          halfSheets,
          fse,
        },
      });
    }

    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.rpc('receive_stock_warehouse', {
      p_product_id: productId,
      p_warehouse_location_id: stockLocationId,
      p_full_sheets: fullSheets,
      p_half_sheets: halfSheets,
      p_notes: notes || 'Supplier delivery via Web UI',
    });

    if (error || !data?.success) {
      console.error('[STOCK RECEIVE ERROR]', error || data);
      return NextResponse.json(
        { success: false, error: error?.message || data?.error || 'Failed to record stock receipt' },
        { status: 422 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Stock receipt successfully recorded into warehouse inventory.',
      data,
    });
  } catch (err: any) {
    console.error('[STOCK RECEIVE EXCEPTION]', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

