// TOKA GDMS — Africa's Talking Two-Way Inbound SMS Webhook
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendSms } from '@/lib/sms/africas-talking';
import { timingSafeEqual } from 'node:crypto';
import { isExplicitDemoMode, isSupabaseConfigured } from '@/lib/runtime';

function secretMatches(received: string | null, expected: string): boolean {
  if (!received) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  try {
    // ── 0. Mandatory Webhook Authentication ──────────────────────────────────
    const configuredSecret = process.env.AFRICAS_TALKING_WEBHOOK_SECRET;
    const demoWithoutDatabase = isExplicitDemoMode() && !isSupabaseConfigured();
    const validConfiguredSecret = Boolean(
      configuredSecret &&
      configuredSecret.length >= 32 &&
      !/^(your_|replace-|placeholder)/i.test(configuredSecret)
    );
    if (!validConfiguredSecret && !demoWithoutDatabase) {
      return NextResponse.json({ success: false, error: 'A non-placeholder webhook secret of at least 32 characters is required.' }, { status: 500 });
    }
    if (validConfiguredSecret && configuredSecret) {
      const secretHeader =
        request.headers.get('x-webhook-secret') ||
        request.headers.get('x-api-key') ||
        request.headers.get('authorization')?.replace('Bearer ', '');

      if (!secretMatches(secretHeader, configuredSecret)) {
        console.warn('[SMS WEBHOOK] Unauthorized webhook attempt: secret mismatch.');
        return NextResponse.json({ success: false, error: 'Unauthorized webhook call' }, { status: 401 });
      }
    }

    let from = '';
    let text = '';
    let messageId = '';

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const body = await request.json();
      from = body.from || body.sender || '';
      text = body.text || body.message || '';
      messageId = body.id || body.messageId || '';
    } else {
      // Standard form-urlencoded from Africa's Talking
      const formData = await request.formData();
      from = formData.get('from')?.toString() || '';
      text = formData.get('text')?.toString() || '';
      messageId = formData.get('id')?.toString() || '';
    }

    from = from.replace(/\s+/g, '').trim();
    text = text.trim();

    // ── 1. Mandatory Parameters & Genuine Provider Message ID ───────────────
    if (!messageId) {
      console.warn('[SMS WEBHOOK] Rejected: Missing genuine provider message ID.');
      return NextResponse.json(
        { success: false, error: 'Missing required provider message ID' },
        { status: 400 }
      );
    }

    if (!from || !text) {
      return NextResponse.json(
        { success: false, error: 'Missing sender phone or text' },
        { status: 400 }
      );
    }

    // Normalize phone number to E.164 (+254...)
    if (from.startsWith('0')) from = '+254' + from.slice(1);
    else if (from.startsWith('254')) from = '+' + from;
    else if (!from.startsWith('+')) from = '+' + from;

    if (!/^\+[1-9]\d{7,14}$/.test(from)) {
      return NextResponse.json({ success: false, error: 'Invalid sender phone format' }, { status: 400 });
    }

    console.log(`[INBOUND SMS] From: ${from} | Provider ID: ${messageId} | Body: "${text}"`);

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const isConfigured = isSupabaseConfigured() && Boolean(serviceKey) && !serviceKey.includes('placeholder');
    if (!isConfigured) {
      if (isExplicitDemoMode()) return NextResponse.json({ success: true, simulated: true });
      return NextResponse.json({ success: false, error: 'SMS processing infrastructure is not configured.' }, { status: 503 });
    }

    // Use admin client (bypasses RLS for public inbound webhook)
    const supabase = createAdminClient();

    // ── 2. Execute Single Atomic Stored Procedure (RPC) ───────────────────────
    const { data: rpcResult, error: rpcError } = await supabase.rpc('process_inbound_sms_atomic', {
      p_provider_message_id: messageId,
      p_sender_phone: from,
      p_raw_text: text,
    });

    if (rpcError) {
      console.error('[SMS WEBHOOK] Database RPC error:', rpcError);
      return NextResponse.json({ success: false, error: 'Database processing failed' }, { status: 500 });
    }

    if (rpcResult?.duplicate) {
      return NextResponse.json({ success: true, duplicate: true });
    }

    const status = rpcResult?.status;
    const ref = rpcResult?.delivery_reference || '';

    // ── 3. Send SMS Feedback According to Atomic State Transition ───────────
    if (status === 'ambiguous') {
      await sendSms({ to: from, message: 'TOKA GLASS: More than one recent delivery is awaiting a reply. Please include the delivery reference from your receipt.' });
    } else if (status === 'invalid_reference') {
      await sendSms({
        to: from,
        message: `TOKA GLASS: Delivery reference ${rpcResult?.reference || ''} was not found. Please verify the code or call 0700000000.`,
      });
    } else if (status === 'unauthorized_sender') {
      await sendSms({
        to: from,
        message: `TOKA GLASS NOTICE: Phone ${from} is not registered for delivery ${ref}. Please reply from the registered phone or call 0700000000.`,
      });
    } else if (status === 'confirmed') {
      await sendSms({
        to: from,
        message: `TOKA GLASS: Thank you! Delivery ${ref} has been confirmed. We appreciate your partnership.`,
      });
    } else if (status === 'disputed') {
      await sendSms({
        to: from,
        message: `TOKA GLASS ALERT: Dispute registered for ${ref}. Reply with reason: 1-Wrong items/qty, 2-Wrong price, 3-Payment discrepancy, 4-Not received, 5-Broken glass. Helpline: 0700000000.`,
      });
    } else if (status === 'dispute_updated') {
      const categoryLabel = (rpcResult?.category || 'other').replace(/_/g, ' ');
      await sendSms({
        to: from,
        message: `TOKA GLASS DISPUTE UPDATE: Reason recorded as "${categoryLabel}" for ${ref}. Management is reviewing and will contact you directly. Helpline: 0700000000.`,
      });
    } else if (status === 'unrecognized_intent') {
      await sendSms({
        to: from,
        message: `TOKA GLASS: Unrecognized reply for ${ref}. Reply "1" to confirm or "2" to dispute, or call 0700000000.`,
      });
    }

    return NextResponse.json({ success: true, ...rpcResult });
  } catch (err: any) {
    console.error('[INBOUND SMS ERROR]', err);
    return NextResponse.json({ success: false, error: err.message || 'Webhook failed' }, { status: 500 });
  }
}
