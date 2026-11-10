// TOKA GDMS — Idempotent Delivery Synchronization & Validation API
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  calculateFse,
  calculateLineTotal,
  calculateDeliveryTotals,
  calculatePaymentBalances,
} from '@/lib/decimal';
import { sendSms, generateDeliveryNotificationSms } from '@/lib/sms/africas-talking';
import type { QueuedOfflineDelivery } from '@/lib/offline/db';
import type { DeliveryItem, PaymentDeclaration } from '@/types';

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as QueuedOfflineDelivery;

    // ── 1. Payload validation ──────────────────────────────────────────────
    if (!payload.clientTxId || typeof payload.clientTxId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing clientTxId for idempotency' },
        { status: 400 }
      );
    }

    if (!payload.customerId) {
      return NextResponse.json(
        { success: false, error: 'Customer is required' },
        { status: 400 }
      );
    }

    if (!payload.items || payload.items.length === 0) {
      return NextResponse.json(
        { success: false, error: 'At least one glass item is required' },
        { status: 400 }
      );
    }

    // Enforce confirmed business rule: ONLY FULL_SHEET and HALF_SHEET are authorized selling units
    for (const item of payload.items) {
      if (item.sellingUnit !== 'FULL_SHEET' && item.sellingUnit !== 'HALF_SHEET') {
        return NextResponse.json(
          { success: false, error: `Invalid selling unit "${item.sellingUnit}". TOKA GDMS only authorizes FULL_SHEET (default) and HALF_SHEET (ordered).` },
          { status: 422 }
        );
      }
    }

    // ── 2. Server-side Recalculation (Decimal.js) ──────────────────────────
    // NEVER TRUST CLIENT-SUBMITTED TOTALS
    const calculatedItems: DeliveryItem[] = (payload.items || []).map((item: DeliveryItem) => {
      const qty = Math.max(1, Math.floor(item.quantity || 1));
      const price = Math.max(0, Number(item.appliedUnitPrice) || 0);
      const fse = calculateFse(item.sellingUnit, qty);
      const lineTotal = calculateLineTotal(qty, price);

      return {
        ...item,
        quantity: qty,
        appliedUnitPrice: price,
        fullSheetEquivalent: fse,
        lineTotal,
      };
    });

    const deliveryTotals = calculateDeliveryTotals(
      calculatedItems.map((i: DeliveryItem) => ({ quantity: i.quantity, appliedUnitPrice: i.appliedUnitPrice })),
      payload.discountAmount || 0
    );

    const nonCreditPayments = (payload.payments || []).filter((p: PaymentDeclaration) => p.channel !== 'credit');
    const paymentBalances = calculatePaymentBalances(
      deliveryTotals.total,
      nonCreditPayments.map((p: PaymentDeclaration) => ({ declaredAmount: Number(p.declaredAmount) || 0 }))
    );

    const creditAmount = (payload.payments || [])
      .filter((p: PaymentDeclaration) => p.channel === 'credit')
      .reduce((sum: number, p: PaymentDeclaration) => sum + (Number(p.declaredAmount) || 0), 0);

    const effectiveOutstanding = Math.max(0, paymentBalances.outstandingBalance - creditAmount);

    // Determine initial payment status
    let paymentStatus: 'unpaid' | 'partially_paid' | 'fully_paid' | 'credit' = 'unpaid';
    if (paymentBalances.totalDeclaredPaid >= deliveryTotals.total && deliveryTotals.total > 0) {
      paymentStatus = 'fully_paid';
    } else if (paymentBalances.totalDeclaredPaid > 0) {
      paymentStatus = 'partially_paid';
    } else if (creditAmount > 0) {
      paymentStatus = 'credit';
    }

    // ── 3. Database Persistence (Supabase) ─────────────────────────────────
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const isConfigured = supabaseUrl && !supabaseUrl.includes('placeholder');

    if (isConfigured) {
      const supabase = await createServerSupabaseClient();

      // Check idempotency: Has this clientTxId already been synced?
      const { data: existingDelivery } = await supabase
        .from('deliveries')
        .select('id, delivery_reference, client_tx_id, total_amount')
        .eq('client_tx_id', payload.clientTxId)
        .maybeSingle();

      if (existingDelivery) {
        // Anti-Tampering Check: Does payload total match the existing delivery?
        if (Math.abs(Number(existingDelivery.total_amount) - deliveryTotals.total) > 0.01) {
          return NextResponse.json(
            {
              success: false,
              error: 'IDEMPOTENCY_MISMATCH: A delivery with this clientTxId already exists with a different financial total.',
            },
            { status: 409 }
          );
        }

        // Idempotent duplicate: Return success immediately without re-processing
        return NextResponse.json({
          success: true,
          duplicate: true,
          deliveryId: existingDelivery.id,
          deliveryReference: existingDelivery.delivery_reference,
          message: 'Delivery was already synchronized.',
        });
      }

      // Resolve user profile for auditing
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const createdById = user?.id;
      if (!createdById) {
        return NextResponse.json(
          { success: false, error: 'Authenticated user profile required' },
          { status: 401 }
        );
      }

      // Resolve Vehicle Assignment (Shift)
      let vehicleAssignmentId = payload.vehicleAssignmentId;
      if (!vehicleAssignmentId) {
        // Fallback to active assignment for current user
        const { data: activeAssignment } = await supabase
          .from('vehicle_assignments')
          .select('id')
          .or(`driver_id.eq.${createdById},salesperson_id.eq.${createdById}`)
          .eq('is_active', true)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (activeAssignment) {
          vehicleAssignmentId = activeAssignment.id;
        } else {
          // If none active, find any default active assignment
          const { data: anyAssignment } = await supabase
            .from('vehicle_assignments')
            .select('id')
            .eq('is_active', true)
            .limit(1)
            .maybeSingle();
          vehicleAssignmentId = anyAssignment?.id;
        }
      }

      if (!vehicleAssignmentId) {
        return NextResponse.json(
          { success: false, error: 'No active vehicle shift found. Please start a shift first.' },
          { status: 422 }
        );
      }

      // Try Atomic RPC First
      let deliveryId: string | null = null;
      let deliveryReference = payload.deliveryReference;

      const { data: rpcData, error: rpcError } = await supabase.rpc('submit_delivery_atomic', {
        p_delivery_reference: payload.deliveryReference,
        p_client_tx_id: payload.clientTxId,
        p_customer_id: payload.customerId,
        p_created_by: createdById,
        p_vehicle_assignment_id: vehicleAssignmentId,
        p_subtotal_amount: deliveryTotals.subtotal,
        p_discount_amount: deliveryTotals.discount,
        p_total_amount: deliveryTotals.total,
        p_total_declared_paid: paymentBalances.totalDeclaredPaid,
        p_outstanding_balance: effectiveOutstanding,
        p_payment_status: paymentStatus,
        p_delivery_lat: payload.deliveryLat ?? null,
        p_delivery_lng: payload.deliveryLng ?? null,
        p_gps_accuracy_m: payload.gpsAccuracyM ?? null,
        p_device_captured_at: payload.deviceCapturedAt || new Date().toISOString(),
        p_is_offline_submission: payload.isOfflineSubmission ?? false,
        p_notes: payload.errorMessage || null,
        p_items: calculatedItems,
        p_payments: payload.payments || [],
      });

      if (!rpcError && rpcData?.success) {
        deliveryId = rpcData.delivery_id;
        deliveryReference = rpcData.delivery_reference;
      } else {
        // Fallback to direct relational inserts if RPC is not yet deployed to database
        const { data: insertedDelivery, error: deliveryError } = await supabase
          .from('deliveries')
          .insert({
            delivery_reference: payload.deliveryReference,
            client_tx_id: payload.clientTxId,
            customer_id: payload.customerId,
            created_by: createdById,
            vehicle_assignment_id: vehicleAssignmentId,
            operational_status: 'delivered',
            payment_status: paymentStatus,
            reconciliation_status: 'pending_reconciliation',
            customer_confirmation_status: 'pending',
            subtotal_amount: deliveryTotals.subtotal,
            discount_amount: deliveryTotals.discount,
            total_amount: deliveryTotals.total,
            total_declared_paid: paymentBalances.totalDeclaredPaid,
            outstanding_balance: effectiveOutstanding,
            delivery_lat: payload.deliveryLat ?? null,
            delivery_lng: payload.deliveryLng ?? null,
            gps_accuracy_m: payload.gpsAccuracyM ?? null,
            device_captured_at: payload.deviceCapturedAt || new Date().toISOString(),
            submitted_at: new Date().toISOString(),
            synced_at: new Date().toISOString(),
            is_offline_submission: payload.isOfflineSubmission ?? false,
            notes: payload.errorMessage || null,
          })
          .select('id, delivery_reference')
          .single();

        if (deliveryError || !insertedDelivery) {
          console.error('[SYNC ERROR] Insert delivery failed:', deliveryError);
          return NextResponse.json(
            { success: false, error: deliveryError?.message || 'Failed to persist delivery' },
            { status: 500 }
          );
        }

        deliveryId = insertedDelivery.id;

        // Insert Delivery Items
        const itemsToInsert = calculatedItems.map((item: DeliveryItem) => ({
          delivery_id: deliveryId,
          product_id: item.productId,
          selling_unit: item.sellingUnit,
          quantity: item.quantity,
          full_sheet_equivalent: item.fullSheetEquivalent,
          official_unit_price: item.officialUnitPrice,
          applied_unit_price: item.appliedUnitPrice,
          is_special_price: item.isSpecialPrice ?? false,
          price_approval_id: item.priceApprovalId ?? null,
          line_total: item.lineTotal,
        }));

        await supabase.from('delivery_items').insert(itemsToInsert);

        // Insert Payment Declarations
        if (payload.payments && payload.payments.length > 0) {
          const validPayments = payload.payments
            .filter((p: PaymentDeclaration) => Number(p.declaredAmount) > 0 && p.channel !== 'credit')
            .map((p: PaymentDeclaration) => ({
              delivery_id: deliveryId,
              channel: p.channel,
              declared_amount: Number(p.declaredAmount),
              declared_by: createdById,
              external_ref: p.externalRef || null,
              notes: p.notes || null,
            }));

          if (validPayments.length > 0) {
            await supabase.from('payment_declarations').insert(validPayments);
          }
        }

        // Deduct stock via stock_movements (Ledger)
        for (const item of calculatedItems) {
          const fullDelta = item.sellingUnit === 'FULL_SHEET' ? -item.quantity : 0;
          const halfDelta = item.sellingUnit === 'HALF_SHEET' ? -item.quantity : 0;
          const fseDelta = -item.fullSheetEquivalent;

          await supabase.from('stock_movements').insert({
            product_id: item.productId,
            from_location_id: '33333333-3333-3333-3333-333333333301',
            to_location_id: null,
            full_sheets_delta: fullDelta,
            half_sheets_delta: halfDelta,
            fse_delta: fseDelta,
            movement_type: 'delivery_to_customer',
            responsible_employee_id: createdById,
            delivery_id: deliveryId,
            notes: `Delivery ${payload.deliveryReference}`,
          });
        }
      }

      // Dispatch Customer SMS Notification
      if (payload.customerPhone && deliveryId) {
        const itemSummary = calculatedItems
          .map((i: DeliveryItem) => `${i.quantity}x ${i.sellingUnit === 'FULL_SHEET' ? 'Full Sheet' : 'Half Sheet'} ${i.productName || 'Glass'}`)
          .join(', ');

        const smsText = generateDeliveryNotificationSms({
          deliveryReference: deliveryReference,
          totalAmount: deliveryTotals.total,
          totalPaid: paymentBalances.totalDeclaredPaid,
          outstandingBalance: effectiveOutstanding,
          itemSummary,
        });

        // Queue SMS in notifications table
        await supabase.from('notifications').insert({
          delivery_id: deliveryId,
          customer_phone: payload.customerPhone,
          channel: 'SMS',
          payload: smsText,
          provider: 'AFRICAS_TALKING',
          status: 'queued',
        });

        // Trigger asynchronous send
        sendSms({
          to: payload.customerPhone,
          message: smsText,
          deliveryReference: deliveryReference,
        }).catch((err: any) => console.error('[SMS ASYNC ERROR]', err));
      }

      return NextResponse.json({
        success: true,
        deliveryId,
        deliveryReference: deliveryReference,
        calculatedTotals: {
          subtotal: deliveryTotals.subtotal,
          total: deliveryTotals.total,
          declaredPaid: paymentBalances.totalDeclaredPaid,
          outstandingBalance: effectiveOutstanding,
        },
      });
    }

    // ── 4. Fallback for Dev/Simulation Mode ─────────────────────────────────
    // When Supabase is not configured, simulate successful sync
    const simulatedDeliveryId = `sim-del-${Date.now()}`;

    if (payload.customerPhone) {
      const itemSummary = calculatedItems
        .map((i: DeliveryItem) => `${i.quantity}x ${i.sellingUnit === 'FULL_SHEET' ? 'Full Sheet' : 'Half Sheet'} ${i.productName || 'Glass'}`)
        .join(', ');

      const smsText = generateDeliveryNotificationSms({
        deliveryReference: payload.deliveryReference,
        totalAmount: deliveryTotals.total,
        totalPaid: paymentBalances.totalDeclaredPaid,
        outstandingBalance: effectiveOutstanding,
        itemSummary,
      });

      sendSms({
        to: payload.customerPhone,
        message: smsText,
        deliveryReference: payload.deliveryReference,
      }).catch(console.error);
    }

    return NextResponse.json({
      success: true,
      simulated: true,
      deliveryId: simulatedDeliveryId,
      deliveryReference: payload.deliveryReference,
      calculatedTotals: {
        subtotal: deliveryTotals.subtotal,
        total: deliveryTotals.total,
        declaredPaid: paymentBalances.totalDeclaredPaid,
        outstandingBalance: effectiveOutstanding,
      },
    });
  } catch (err: any) {
    console.error('[SYNC API ERROR]', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error during delivery synchronization' },
      { status: 500 }
    );
  }
}
