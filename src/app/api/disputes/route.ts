// TOKA GDMS — Customer Disputes API (List and Resolve Disputes)
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { z } from 'zod';
import { isExplicitDemoMode, isSupabaseConfigured } from '@/lib/runtime';

const resolveDisputeSchema = z.object({
  disputeId: z.string().uuid({ message: 'Valid disputeId is required' }),
  resolutionNotes: z.string().min(5, { message: 'Resolution notes must be at least 5 characters' }),
  isConfirmedLegitimate: z.boolean().default(false),
});

export async function GET() {
  try {
    if (!isSupabaseConfigured()) {
      if (isExplicitDemoMode()) return NextResponse.json({ success: true, data: [], simulated: true });
      return NextResponse.json({ success: false, error: 'Supabase is not configured.' }, { status: 503 });
    }

    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from('customer_disputes')
      .select(`
        id,
        delivery_id,
        customer_id,
        dispute_category,
        customer_notes,
        is_active,
        investigated_by,
        resolution_notes,
        resolved_at,
        created_at,
        deliveries (delivery_reference, total_amount),
        customers (name, primary_phone),
        investigator:investigated_by (full_name)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[DISPUTES API ERROR]', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const formatted = (data || []).map((d: any) => ({
      id: d.id,
      deliveryId: d.delivery_id,
      deliveryReference: d.deliveries?.delivery_reference || 'Unknown Reference',
      totalAmount: d.deliveries?.total_amount ? parseFloat(d.deliveries.total_amount) : 0,
      customerId: d.customer_id,
      customerName: d.customers?.name || 'Customer',
      customerPhone: d.customers?.primary_phone || 'No phone',
      disputeCategory: d.dispute_category || 'other',
      customerNotes: d.customer_notes || '',
      isActive: d.is_active,
      investigatorName: d.investigator?.full_name,
      resolutionNotes: d.resolution_notes,
      resolvedAt: d.resolved_at,
      createdAt: d.created_at,
    }));

    return NextResponse.json({ success: true, data: formatted });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = resolveDisputeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors.map((e) => e.message).join('; ') },
        { status: 422 }
      );
    }

    const { disputeId, resolutionNotes } = parsed.data;

    if (!isSupabaseConfigured()) {
      if (isExplicitDemoMode()) return NextResponse.json({ success: true, simulated: true });
      return NextResponse.json({ success: false, error: 'Supabase is not configured.' }, { status: 503 });
    }

    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase.rpc('resolve_customer_dispute', {
      p_dispute_id: disputeId,
      p_resolution_notes: resolutionNotes,
    });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

