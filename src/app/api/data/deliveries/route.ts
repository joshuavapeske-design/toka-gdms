import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { isExplicitDemoMode, isSupabaseConfigured } from '@/lib/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (!isSupabaseConfigured()) {
      if (isExplicitDemoMode()) {
        return NextResponse.json({ success: true, data: [], simulated: true });
      }
      return NextResponse.json({ success: false, error: 'Supabase is not configured.' }, { status: 503 });
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 });

    const { data, error } = await supabase
      .from('deliveries')
      .select(`
        id,
        delivery_reference,
        customer_id,
        created_by,
        operational_status,
        payment_status,
        customer_confirmation_status,
        total_amount,
        total_declared_paid,
        outstanding_balance,
        created_at,
        customers (name),
        profiles:created_by (full_name)
      `)
      .order('created_at', { ascending: false })
      .limit(250);

    if (error) {
      console.error('[DELIVERIES API ERROR]', error);
      return NextResponse.json({ success: false, error: 'Unable to load delivery records.' }, { status: 500 });
    }

    const formatted = (data || []).map((item: any) => ({
      id: item.id,
      deliveryReference: item.delivery_reference,
      customerId: item.customer_id,
      customerName: item.customers?.name || 'Unknown customer',
      createdByName: item.profiles?.full_name || 'Employee',
      operationalStatus: item.operational_status,
      paymentStatus: item.payment_status,
      customerConfirmationStatus: item.customer_confirmation_status,
      totalAmount: Number(item.total_amount),
      totalDeclaredPaid: Number(item.total_declared_paid),
      outstandingBalance: Number(item.outstanding_balance),
      createdAt: item.created_at,
    }));

    return NextResponse.json({ success: true, data: formatted });
  } catch (error) {
    console.error('[DELIVERIES API EXCEPTION]', error);
    return NextResponse.json({ success: false, error: 'Unable to load delivery records.' }, { status: 500 });
  }
}
