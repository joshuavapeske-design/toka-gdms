// TOKA GDMS — Africa's Talking Two-Way Inbound SMS Webhook
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendSms } from '@/lib/sms/africas-talking';

type DisputeCategory =
  | 'wrong_items_or_quantities'
  | 'incorrect_price'
  | 'wrong_payment_declared'
  | 'delivery_never_received'
  | 'damaged_glass_uncredited'
  | 'other';

function parseDisputeCategory(text: string): DisputeCategory {
  const upper = text.toUpperCase();

  // Pattern matching for category digits and keywords
  if (
    /\b(2[\s\-_:]*1|CATEGORY[\s\-_:]*1)\b/i.test(upper) ||
    /\b(WRONG ITEM|QUANTITY|COUNT|ITEMS|MISSING SHEET)\b/i.test(upper)
  ) {
    return 'wrong_items_or_quantities';
  }
  if (
    /\b(2[\s\-_:]*2|CATEGORY[\s\-_:]*2)\b/i.test(upper) ||
    /\b(PRICE|RATE|OVERCHARGE|EXPENSIVE|WRONG PRICE)\b/i.test(upper)
  ) {
    return 'incorrect_price';
  }
  if (
    /\b(2[\s\-_:]*3|CATEGORY[\s\-_:]*3)\b/i.test(upper) ||
    /\b(PAYMENT|CASH|MPESA|RECEIPT|BALANCE|DECLARED|PAID MORE)\b/i.test(upper)
  ) {
    return 'wrong_payment_declared';
  }
  if (
    /\b(2[\s\-_:]*4|CATEGORY[\s\-_:]*4)\b/i.test(upper) ||
    /\b(NOT RECEIVED|NEVER RECEIVED|DID NOT GET|NO DELIVERY)\b/i.test(upper)
  ) {
    return 'delivery_never_received';
  }
  if (
    /\b(2[\s\-_:]*5|CATEGORY[\s\-_:]*5)\b/i.test(upper) ||
    /\b(DAMAGED|BROKEN|CRACK|SHATTERED|SCRATCH)\b/i.test(upper)
  ) {
    return 'damaged_glass_uncredited';
  }

  // Standalone digits
  if (/^1\b/.test(upper)) return 'wrong_items_or_quantities';
  if (/^2\b/.test(upper) && upper.length > 2) return 'incorrect_price';
  if (/^3\b/.test(upper)) return 'wrong_payment_declared';
  if (/^4\b/.test(upper)) return 'delivery_never_received';
  if (/^5\b/.test(upper)) return 'damaged_glass_uncredited';

  return 'other';
}

function getCategoryLabel(category: DisputeCategory): string {
  switch (category) {
    case 'wrong_items_or_quantities':
      return 'Wrong Items / Quantity';
    case 'incorrect_price':
      return 'Incorrect Price';
    case 'wrong_payment_declared':
      return 'Payment Discrepancy';
    case 'delivery_never_received':
      return 'Delivery Never Received';
    case 'damaged_glass_uncredited':
      return 'Damaged Glass';
    default:
      return 'General Dispute';
  }
}

export async function POST(request: Request) {
  try {
    // ── 0. Webhook Secret Verification ───────────────────────────────────────
    const configuredSecret = process.env.AFRICAS_TALKING_WEBHOOK_SECRET;
    if (configuredSecret) {
      const url = new URL(request.url);
      const secretHeader =
        request.headers.get('x-webhook-secret') ||
        request.headers.get('x-api-key') ||
        request.headers.get('authorization')?.replace('Bearer ', '');
      const secretQuery = url.searchParams.get('secret') || url.searchParams.get('apiKey');

      if (secretHeader !== configuredSecret && secretQuery !== configuredSecret) {
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
      messageId = body.id || body.messageId || `gen-${Date.now()}`;
    } else {
      // Standard form-urlencoded from Africa's Talking
      const formData = await request.formData();
      from = formData.get('from')?.toString() || '';
      text = formData.get('text')?.toString() || '';
      messageId = formData.get('id')?.toString() || `gen-${Date.now()}`;
    }

    from = from.replace(/\s+/g, '').trim();
    text = text.trim();

    if (!from || !text) {
      return NextResponse.json({ success: false, error: 'Missing sender phone or text' }, { status: 400 });
    }

    // Normalize phone number to E.164 (+254...)
    if (from.startsWith('0')) from = '+254' + from.slice(1);
    else if (from.startsWith('254')) from = '+' + from;
    else if (!from.startsWith('+')) from = '+' + from;

    if (!/^\+[1-9]\d{7,14}$/.test(from)) {
      return NextResponse.json({ success: false, error: 'Invalid sender phone format' }, { status: 400 });
    }

    console.log(`[INBOUND SMS] From: ${from} | ID: ${messageId} | Body: "${text}"`);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const isConfigured = supabaseUrl && !supabaseUrl.includes('placeholder') && !!serviceKey;

    if (!isConfigured) {
      console.log('[INBOUND SMS] Admin Supabase client not configured in environment. Simulating response.');
      return NextResponse.json({ success: true, simulated: true });
    }

    // Use admin client (bypasses RLS for public inbound webhook)
    const supabase = createAdminClient();

    // ── 1. Deduplication check via provider_message_id ──────────────────────
    const { data: existingMsg } = await supabase
      .from('inbound_sms_messages')
      .select('id')
      .eq('provider_message_id', messageId)
      .maybeSingle();

    if (existingMsg) {
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
      return NextResponse.json({ success: false, error: 'Database error logging SMS' }, { status: 500 });
    }

    const inboundRecordId = savedMsg.id;

    // ── 3. Parse Reference and Intent ──────────────────────────────────────
    const upperText = text.toUpperCase();

    // Extract delivery reference: e.g. GD-202611-1234 or GD-1234
    const refMatch = upperText.match(/(GD-\d{6}-\d{4}|GD-\d{4,6})/i);
    const explicitRef = refMatch ? refMatch[0] : null;

    // Extract action intent: 1 / YES vs 2 / NO
    const isConfirm = /\b(1|YES|CONFIRM|CONFIRMED|SAWA)\b/i.test(upperText);
    const isDispute = /\b(2|NO|DISPUTE|PROBLEM|WRONG|HAPANA)\b/i.test(upperText);

    // ── 4. Correlate with delivery & verify sender identity ─────────────────
    let matchedDelivery: {
      id: string;
      delivery_reference: string;
      customer_id: string;
      customer_confirmation_status: string;
      customers: {
        id: string;
        name: string;
        primary_phone: string;
        alt_phone: string | null;
      };
    } | null = null;

    if (explicitRef) {
      const { data: delivery, error: fetchErr } = await supabase
        .from('deliveries')
        .select(`
          id,
          delivery_reference,
          customer_id,
          customer_confirmation_status,
          customers (
            id,
            name,
            primary_phone,
            alt_phone
          )
        `)
        .ilike('delivery_reference', explicitRef)
        .maybeSingle();

      if (fetchErr || !delivery) {
        await supabase
          .from('inbound_sms_messages')
          .update({
            processing_status: 'invalid_reference',
            failure_reason: `Reference ${explicitRef} not found`,
          })
          .eq('id', inboundRecordId);

        await sendSms({
          to: from,
          message: `TOKA GLASS: Delivery reference ${explicitRef} was not found. Please verify the code or call 0700000000.`,
        });

        return NextResponse.json({ success: true, status: 'invalid_reference' });
      }

      // STRICT AUTHENTICATION: Verify sender phone matches customer
      const cust = delivery.customers as any;
      const isAuthorizedSender =
        cust &&
        (cust.primary_phone === from || (cust.alt_phone && cust.alt_phone === from));

      if (!isAuthorizedSender) {
        console.warn(
          `[INBOUND SMS SECURITY] Phone ${from} unauthorized for delivery ${explicitRef} (Customer: ${cust?.name}, Registered: ${cust?.primary_phone})`
        );

        await supabase
          .from('inbound_sms_messages')
          .update({
            processing_status: 'failed',
            failure_reason: `Sender phone ${from} does not match customer phone ${cust?.primary_phone}`,
            matched_delivery_id: delivery.id,
          })
          .eq('id', inboundRecordId);

        await sendSms({
          to: from,
          message: `TOKA GLASS NOTICE: Phone ${from} is not registered for delivery ${explicitRef}. Please reply from the registered business phone or contact 0700000000.`,
        });

        return NextResponse.json({ success: true, status: 'unauthorized_sender' });
      }

      matchedDelivery = delivery as any;
    } else {
      // Find customer by phone number (primary or alt)
      const { data: customer } = await supabase
        .from('customers')
        .select('id, name, primary_phone, alt_phone')
        .or(`primary_phone.eq.${from},alt_phone.eq.${from}`)
        .maybeSingle();

      if (!customer) {
        await supabase
          .from('inbound_sms_messages')
          .update({
            processing_status: 'unmatched',
            failure_reason: `No customer associated with phone ${from}`,
          })
          .eq('id', inboundRecordId);

        return NextResponse.json({ success: true, status: 'unmatched' });
      }

      // Check deliveries within the last 72 hours
      const threeDaysAgo = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
      const { data: pendingDeliveries } = await supabase
        .from('deliveries')
        .select(`
          id,
          delivery_reference,
          customer_id,
          total_amount,
          customer_confirmation_status,
          customers (
            id,
            name,
            primary_phone,
            alt_phone
          )
        `)
        .eq('customer_id', customer.id)
        .gte('created_at', threeDaysAgo)
        .order('created_at', { ascending: false });

      if (!pendingDeliveries || pendingDeliveries.length === 0) {
        await supabase
          .from('inbound_sms_messages')
          .update({
            processing_status: 'unmatched',
            failure_reason: 'No deliveries within last 72 hours for customer',
          })
          .eq('id', inboundRecordId);

        await sendSms({
          to: from,
          message: `TOKA GLASS: No recent deliveries found awaiting action for ${customer.name}. Contact 0700000000 if you need assistance.`,
        });

        return NextResponse.json({ success: true, status: 'no_pending' });
      }

      // Filter for actionable pending deliveries
      const actionable = pendingDeliveries.filter(
        (d) => d.customer_confirmation_status === 'pending' || d.customer_confirmation_status === 'disputed'
      );

      if (actionable.length === 0) {
        await sendSms({
          to: from,
          message: `TOKA GLASS: All your recent deliveries are already confirmed. Contact 0700000000 if you need assistance.`,
        });
        return NextResponse.json({ success: true, status: 'already_confirmed' });
      }

      if (actionable.length > 1) {
        await supabase
          .from('inbound_sms_messages')
          .update({
            processing_status: 'ambiguous',
            failure_reason: `Multiple pending deliveries (${actionable.length}) found`,
          })
          .eq('id', inboundRecordId);

        const optionsText = actionable
          .slice(0, 3)
          .map((d) => `Reply "1 ${d.delivery_reference}" for KES ${Number(d.total_amount).toFixed(2)}`)
          .join('\n');

        await sendSms({
          to: from,
          message: `TOKA GLASS: Multiple deliveries awaiting your action:\n${optionsText}`,
        });

        return NextResponse.json({ success: true, status: 'ambiguous' });
      }

      matchedDelivery = actionable[0] as any;
    }

    // ── 5. Apply State Machine Transition & Actions ──────────────────────────
    if (matchedDelivery) {
      await supabase
        .from('inbound_sms_messages')
        .update({
          matched_delivery_id: matchedDelivery.id,
          processing_status: 'processed',
          processed_at: new Date().toISOString(),
        })
        .eq('id', inboundRecordId);

      const isAlreadyDisputed = matchedDelivery.customer_confirmation_status === 'disputed';

      if (isAlreadyDisputed && !isConfirm) {
        // Customer is responding to structured dispute inquiry
        const category = parseDisputeCategory(text);

        // Update or insert into customer_disputes
        const { data: existingDispute } = await supabase
          .from('customer_disputes')
          .select('id, customer_notes')
          .eq('delivery_id', matchedDelivery.id)
          .eq('is_active', true)
          .maybeSingle();

        if (existingDispute) {
          const updatedNotes = existingDispute.customer_notes
            ? `${existingDispute.customer_notes} | Additional SMS: "${text}"`
            : text;

          await supabase
            .from('customer_disputes')
            .update({
              dispute_category: category,
              customer_notes: updatedNotes,
              inbound_sms_id: inboundRecordId,
            })
            .eq('id', existingDispute.id);
        } else {
          await supabase.from('customer_disputes').insert({
            delivery_id: matchedDelivery.id,
            customer_id: matchedDelivery.customer_id,
            inbound_sms_id: inboundRecordId,
            dispute_category: category,
            customer_notes: text,
            is_active: true,
          });
        }

        const label = getCategoryLabel(category);
        await sendSms({
          to: from,
          message: `TOKA GLASS DISPUTE UPDATE: Reason recorded as "${label}" for delivery ${matchedDelivery.delivery_reference}. Management is reviewing and will contact you directly. Helpline: 0700000000.`,
        });

        return NextResponse.json({ success: true, processed: true, disputeCategory: category });
      }

      if (isConfirm) {
        // CONFIRMATION
        await supabase
          .from('deliveries')
          .update({ customer_confirmation_status: 'confirmed' })
          .eq('id', matchedDelivery.id);

        // Insert into customer_confirmations matching DB schema exactly
        await supabase.from('customer_confirmations').upsert(
          {
            delivery_id: matchedDelivery.id,
            inbound_sms_id: inboundRecordId,
            reply_channel: 'SMS',
            response_code: '1',
            sender_phone: from,
            received_at: new Date().toISOString(),
          },
          { onConflict: 'delivery_id' }
        );

        await sendSms({
          to: from,
          message: `TOKA GLASS: Thank you! Delivery ${matchedDelivery.delivery_reference} has been confirmed. We appreciate your partnership.`,
        });

        return NextResponse.json({ success: true, processed: true, action: 'confirmed' });
      }

      if (isDispute) {
        // DISPUTE
        const category = parseDisputeCategory(text);

        await supabase
          .from('deliveries')
          .update({ customer_confirmation_status: 'disputed' })
          .eq('id', matchedDelivery.id);

        await supabase.from('customer_confirmations').upsert(
          {
            delivery_id: matchedDelivery.id,
            inbound_sms_id: inboundRecordId,
            reply_channel: 'SMS',
            response_code: '2',
            sender_phone: from,
            received_at: new Date().toISOString(),
          },
          { onConflict: 'delivery_id' }
        );

        await supabase.from('customer_disputes').insert({
          delivery_id: matchedDelivery.id,
          customer_id: matchedDelivery.customer_id,
          inbound_sms_id: inboundRecordId,
          dispute_category: category,
          customer_notes: text,
          is_active: true,
        });

        if (category === 'other') {
          // Structured dispute questionnaire
          await sendSms({
            to: from,
            message: `TOKA GLASS ALERT: Dispute registered for ${matchedDelivery.delivery_reference}. Please reply with reason code:\n1 - Wrong items/quantity\n2 - Incorrect price\n3 - Wrong payment declared\n4 - Goods not received\n5 - Damaged glass\nOr call management on 0700000000.`,
          });
        } else {
          const label = getCategoryLabel(category);
          await sendSms({
            to: from,
            message: `TOKA GLASS ALERT: Dispute (${label}) registered for ${matchedDelivery.delivery_reference}. Management has been notified and will contact you immediately. Helpline: 0700000000.`,
          });
        }

        return NextResponse.json({ success: true, processed: true, action: 'disputed', disputeCategory: category });
      }

      // Unrecognized action code
      await sendSms({
        to: from,
        message: `TOKA GLASS: Unrecognized reply for ${matchedDelivery.delivery_reference}. Reply "1" to confirm or "2" to dispute, or call 0700000000.`,
      });

      return NextResponse.json({ success: true, status: 'unrecognized_intent' });
    }

    return NextResponse.json({ success: true, processed: true });
  } catch (err: any) {
    console.error('[INBOUND SMS ERROR]', err);
    return NextResponse.json({ success: false, error: err.message || 'Webhook failed' }, { status: 500 });
  }
}
