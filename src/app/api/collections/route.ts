// TOKA GDMS — Collections API (Record and List Collections)
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { z } from 'zod';
import { isExplicitDemoMode, isSupabaseConfigured } from '@/lib/runtime';

const createCollectionSchema = z.object({
  customerId: z.string().uuid({ message: 'Valid customerId is required' }),
  channel: z.enum(['cash', 'mpesa_company_till', 'mpesa_employee_phone', 'bank_transfer']),
  amount: z.number().positive({ message: 'Collection amount must be positive' }),
  externalRef: z.string().max(100).nullable().optional(),
  notes: z.string().max(255).nullable().optional(),
});

export async function GET() {
  try {
    if (!isSupabaseConfigured()) {
      if (isExplicitDemoMode()) return NextResponse.json({ success: true, data: [], simulated: true });
      return NextResponse.json({ success: false, error: 'Supabase is not configured.' }, { status: 503 });
    }

    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from('collections')
      .select(`
        id,
        collection_reference,
        customer_id,
        collected_by,
        channel,
        total_amount,
        allocated_amount,
        unallocated_amount,
        is_fully_allocated,
        external_ref,
        notes,
        collection_date,
        created_at,
        customers (name, account_number),
        collector:collected_by (full_name)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[COLLECTIONS API ERROR]', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const formatted = (data || []).map((c: any) => ({
      id: c.id,
      collectionReference: c.collection_reference,
      customerId: c.customer_id,
      customerName: c.customers?.name || 'Unknown Customer',
      customerAccountNumber: c.customers?.account_number,
      collectedByName: c.collector?.full_name || 'Collector',
      channel: c.channel,
      totalAmount: parseFloat(c.total_amount),
      allocatedAmount: parseFloat(c.allocated_amount),
      unallocatedAmount: parseFloat(c.unallocated_amount),
      isFullyAllocated: c.is_fully_allocated,
      externalRef: c.external_ref,
      notes: c.notes,
      collectionDate: new Date(c.collection_date).toLocaleString('en-KE'),
    }));

    return NextResponse.json({ success: true, data: formatted });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = createCollectionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors.map((e) => e.message).join('; ') },
        { status: 422 }
      );
    }

    const { customerId, channel, amount, externalRef, notes } = parsed.data;

    if (!isSupabaseConfigured()) {
      if (!isExplicitDemoMode()) return NextResponse.json({ success: false, error: 'Supabase is not configured.' }, { status: 503 });
      return NextResponse.json({
        success: true,
        simulated: true,
        collectionId: `sim-col-${Date.now()}`,
        collectionReference: `COL-202611-${Math.floor(1000 + Math.random() * 9000)}`,
        totalAmount: amount,
        unallocatedAmount: amount,
      });
    }

    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.rpc('record_customer_collection', {
      p_customer_id: customerId,
      p_channel: channel,
      p_amount: amount,
      p_external_ref: externalRef || null,
      p_notes: notes || null,
    });

    if (error || !data?.success) {
      return NextResponse.json(
        { success: false, error: error?.message || 'Failed to record customer collection' },
        { status: 422 }
      );
    }

    return NextResponse.json({ success: true, ...data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

