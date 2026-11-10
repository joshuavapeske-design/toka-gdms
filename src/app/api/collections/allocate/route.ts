// TOKA GDMS — Allocate Collection to Invoice API
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { z } from 'zod';

const allocateSchema = z.object({
  collectionId: z.string().uuid({ message: 'Valid collectionId is required' }),
  deliveryId: z.string().uuid({ message: 'Valid deliveryId is required' }),
  amount: z.number().positive({ message: 'Allocation amount must be positive' }),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = allocateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors.map((e) => e.message).join('; ') },
        { status: 422 }
      );
    }

    const { collectionId, deliveryId, amount } = parsed.data;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl || supabaseUrl.includes('placeholder')) {
      return NextResponse.json({
        success: true,
        simulated: true,
        allocatedAmount: amount,
      });
    }

    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.rpc('allocate_collection_invoice', {
      p_collection_id: collectionId,
      p_delivery_id: deliveryId,
      p_amount: amount,
    });

    if (error || !data?.success) {
      return NextResponse.json(
        { success: false, error: error?.message || 'Failed to allocate collection to invoice' },
        { status: 422 }
      );
    }

    return NextResponse.json({ success: true, ...data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

