import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendSms } from '@/lib/sms/africas-talking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function secretMatches(received: string | null, expected: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expected = process.env.TOKA_NOTIFICATION_WORKER_SECRET;
  if (!expected || expected.length < 32) {
    return NextResponse.json({ success: false, error: 'Notification worker secret is not configured securely.' }, { status: 503 });
  }
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (!secretMatches(provided, expected)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || url.includes('placeholder') || !serviceKey || serviceKey.includes('placeholder')) {
    return NextResponse.json({ success: false, error: 'Notification database is not configured.' }, { status: 503 });
  }

  try {
    const supabase = createAdminClient();
    const { data: claimed, error: claimError } = await supabase.rpc('claim_pending_notifications', { p_batch_size: 20 });
    if (claimError) {
      return NextResponse.json({ success: false, error: 'Unable to claim notification batch.' }, { status: 500 });
    }

    let acceptedByProvider = 0;
    let failed = 0;
    for (const item of claimed || []) {
      const result = await sendSms({
        to: item.customer_phone,
        message: item.payload,
        deliveryReference: item.delivery_id || undefined,
      });

      if (result.success && result.messageId) {
        const { error } = await supabase.from('notifications').update({
          status: 'sent',
          provider_message_id: result.messageId,
          sent_at: new Date().toISOString(),
          next_retry_at: null,
          last_error: null,
        }).eq('id', item.id).eq('status', 'sending');
        if (error) failed++;
        else acceptedByProvider++;
      } else {
        const attempts = Number(item.attempts || 1);
        const terminal = attempts >= 6;
        const delayMinutes = Math.min(60, 2 ** Math.min(attempts, 6));
        const { error } = await supabase.from('notifications').update({
          status: 'failed',
          last_error: result.error || 'SMS provider did not accept the message',
          next_retry_at: terminal ? null : new Date(Date.now() + delayMinutes * 60_000).toISOString(),
        }).eq('id', item.id).eq('status', 'sending');
        if (!error) failed++;
      }
    }

    return NextResponse.json({
      success: true,
      claimed: (claimed || []).length,
      acceptedByProvider,
      failed,
      note: 'sent means accepted by the SMS provider, not confirmed as delivered to the handset.',
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Notification dispatch failed.' }, { status: 500 });
  }
}
