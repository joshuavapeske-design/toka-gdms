// TOKA GDMS — Africa's Talking Two-Way Inbound SMS Webhook
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { sendSms } from '@/lib/sms/africas-talking';

export async function POST(request: Request) {
  try {
    let from = '';
    let text = '';
    let messageId = '';

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const body = await request.json();
      from = body.from || body.sender || '';
      text = body.text || body.message || '';
      messageId = body.id || body.messageId || `gen-${Date.now()}`;
    } else {
      // Standard form-urlencoded from Africa's Talking
      const formData = await request.formData();
      from = formData.get('from')?.toString() || '';
      text = formData.get('text')?.toString() || '';
      messageId = formData.get('id')?.toString() || `gen-${Date.now()}`;
    }

    from = from.trim();
    text = text.trim();

    if (!from || !text) {
      return NextResponse.json({ success: false, error: 'Missing sender phone or text' }, { status: 400 });
    }

    // Normalize phone number to E.164
    if (from.startsWith('0')) from = '+254' + from.slice(1);
    else if (!from.startsWith('+')) from = '+' + from;

    console.log(`[INBOUND SMS] From: ${from} | ID: ${messageId} | Body: "${text}"`);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const isConfigured = supabaseUrl && !supabaseUrl.includes('placeholder');

    if (!isConfigured) {
      // Simulation response in development
      console.log('[INBOUND SMS] Simulated successful processing.');
      return NextResponse.json({ success: true, simulated: true });
    }

    const supabase = await createServerSupabaseClient();

    // ── 1. Deduplication check via provider_message_id ──────────────────────
    const { data: existingMsg } = await supabase
      .from('inbound_sms_messages')
      .select('id')
      .eq('provider_message_id', messageId)
      .maybeSingle();

    if (existingMsg) {
      // Idempotent ignore
      return NextResponse.json({ success: true, duplicate: true });
    }

    // ── 2. Persist raw inbound message ──────────────────────────────────────
    const { data: savedMsg, error: saveErr } = await supabase
      .from('inbound_sms_messages')
      .insert({
        provider_message_id: messageId,
        sender_phone: from,
        raw_message_text: text,
        processing_status: 'received',
      })
      .select('id')
      .single();

    if (saveErr) {
      console.error('[INBOUND SMS] Failed to log raw message:', saveErr);
      return NextResponse.json({ success: false, error: 'Database error' }, { status: 500 });
    }

    const inboundRecordId = savedMsg.id;

    // ── 3. Parse Reference and Intent ──────────────────────────────────────
    const upperText = text.toUpperCase();

    // Extract delivery reference: e.g. GD-202611-1234 or GD-1234
    const refMatch = upperText.match(/(GD-\d{6}-\d{4}|GD-\d{4,6})/i);
    const explicitRef = refMatch ? refMatch[0] : null;

    // Extract action intent: 1 / YES vs 2 / NO
    const isConfirm = /\b(1|YES|CONFIRM|CONFIRMED)\b/i.test(upperText);
    const isDispute = /\b(2|NO|DISPUTE|PROBLEM|WRONG)\b/i.test(upperText);

    // ── 4. Correlate with delivery ─────────────────────────────────────────
    let matchedDelivery: { id: string; delivery_reference: string; customer_id: string } | null = null;

    if (explicitRef) {
      const { data: delivery } = await supabase
        .from('deliveries')
        .select('id, delivery_reference, customer_id')
        .ilike('delivery_reference', explicitRef)
        .maybeSingle();

      if (!delivery) {
        await supabase
          .from('inbound_sms_messages')
          .update({ processing_status: 'invalid_reference' })
          .eq('id', inboundRecordId);

        await sendSms({
          to: from,
          message: `TOKA GLASS: Delivery reference ${explicitRef} was not found. Please verify the code or call 0700000000.`,
        });

        return NextResponse.json({ success: true, status: 'invalid_reference' });
      }
      matchedDelivery = delivery;
    } else {
      // Search for customer by phone number
      const { data: customer } = await supabase
        .from('customers')
        .select('id')
        .eq('primary_phone', from)
        .maybeSingle();

      if (!customer) {
        await supabase
          .from('inbound_sms_messages')
          .update({ processing_status: 'unmatched' })
          .eq('id', inboundRecordId);

        return NextResponse.json({ success: true, status: 'unmatched' });
      }

      // Find pending deliveries for this customer within the last 72 hours
      const threeDaysAgo = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
      const { data: pendingDeliveries } = await supabase
        .from('deliveries')
        .select('id, delivery_reference, customer_id, total_amount')
        .eq('customer_id', customer.id)
        .eq('customer_confirmation_status', 'pending')
        .gte('created_at', threeDaysAgo)
        .order('created_at', { ascending: false });

      if (!pendingDeliveries || pendingDeliveries.length === 0) {
        await supabase
          .from('inbound_sms_messages')
          .update({ processing_status: 'unmatched' })
          .eq('id', inboundRecordId);

        await sendSms({
          to: from,
          message: `TOKA GLASS: No pending deliveries found for this number. Contact 0700000000 if you need assistance.`,
        });

        return NextResponse.json({ success: true, status: 'no_pending' });
      }

      if (pendingDeliveries.length > 1) {
        // Ambiguous: multiple pending deliveries
        await supabase
          .from('inbound_sms_messages')
          .update({ processing_status: 'ambiguous' })
          .eq('id', inboundRecordId);

        const optionsText = pendingDeliveries
          .slice(0, 3)
          .map((d) => `Reply "1 ${d.delivery_reference}" for KES ${d.total_amount}`)
          .join('\n');

        await sendSms({
          to: from,
          message: `TOKA GLASS NOTICE: You have multiple deliveries awaiting confirmation:\n${optionsText}`,
        });

        return NextResponse.json({ success: true, status: 'ambiguous' });
      }

      // Exactly 1 pending delivery
      matchedDelivery = pendingDeliveries[0];
    }

    // ── 5. Apply State Machine Transition ──────────────────────────────────
    if (matchedDelivery) {
      await supabase
        .from('inbound_sms_messages')
        .update({
          matched_delivery_id: matchedDelivery.id,
          processing_status: 'processed',
          processed_at: new Date().toISOString(),
        })
        .eq('id', inboundRecordId);

      if (isConfirm) {
        // CONFIRMATION
        await supabase
          .from('deliveries')
          .update({ customer_confirmation_status: 'confirmed' })
          .eq('id', matchedDelivery.id);

        await supabase.from('customer_confirmations').upsert(
          {
            delivery_id: matchedDelivery.id,
            customer_phone: from,
            confirmation_status: 'confirmed',
            response_code: '1',
            raw_response_text: text,
            confirmed_at: new Date().toISOString(),
          },
          { onConflict: 'delivery_id' }
        );

        await sendSms({
          to: from,
          message: `TOKA GLASS: Thank you! Delivery ${matchedDelivery.delivery_reference} has been confirmed. We appreciate your partnership.`,
        });
      } else if (isDispute) {
        // DISPUTE
        await supabase
          .from('deliveries')
          .update({ customer_confirmation_status: 'disputed' })
          .eq('id', matchedDelivery.id);

        await supabase.from('customer_confirmations').upsert(
          {
            delivery_id: matchedDelivery.id,
            customer_phone: from,
            confirmation_status: 'disputed',
            response_code: '2',
            raw_response_text: text,
            confirmed_at: new Date().toISOString(),
          },
          { onConflict: 'delivery_id' }
        );

        await supabase.from('customer_disputes').insert({
          delivery_id: matchedDelivery.id,
          customer_id: matchedDelivery.customer_id,
          inbound_sms_id: inboundRecordId,
          customer_notes: text,
          is_active: true,
        });

        await sendSms({
          to: from,
          message: `TOKA GLASS ALERT: Your dispute for ${matchedDelivery.delivery_reference} has been registered. Our management team has been alerted and will contact you immediately. Helpline: 0700000000.`,
        });
      }
    }

    return NextResponse.json({ success: true, processed: true });
  } catch (err: any) {
    console.error('[INBOUND SMS ERROR]', err);
    return NextResponse.json({ success: false, error: err.message || 'Webhook failed' }, { status: 500 });
  }
}

