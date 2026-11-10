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
import crypto from 'crypto';

/**
 * Generates a canonical, deterministic SHA-256 hash of the delivery payload.
 * Ensures that any modification to items, quantities, prices, or payments
 * results in a distinct hash, strictly detecting tampering upon retry.
 */
function computeCanonicalPayloadHash(
  customerId: string,
  vehicleAssignmentId: string,
  items: DeliveryItem[],
  payments: PaymentDeclaration[]
): string {
  const sortedItems = [...items]
    .sort((a, b) => a.productId.localeCompare(b.productId) || a.sellingUnit.localeCompare(b.sellingUnit))
    .map((i) => `${i.productId}:${i.sellingUnit}:${i.quantity}:${i.appliedUnitPrice.toFixed(2)}:${i.priceApprovalId || ''}`)
    .join('|');

  const sortedPayments = [...(payments || [])]
    .sort((a, b) => a.channel.localeCompare(b.channel))
    .map((p) => `${p.channel}:${Number(p.declaredAmount).toFixed(2)}:${p.externalRef || ''}`)
    .join('|');

  const raw = `${customerId}|${vehicleAssignmentId}|${sortedItems}|${sortedPayments}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

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

    // Sum all monetary declarations (Cash, Company Till M-Pesa, Employee Personal M-Pesa, Bank Transfer)
    // Credit is an authorization of debt, NEVER money received.
    const nonCreditPayments = (payload.payments || []).filter((p: PaymentDeclaration) => p.channel !== 'credit');
    const paymentBalances = calculatePaymentBalances(
      deliveryTotals.total,
      nonCreditPayments.map((p: PaymentDeclaration) => ({ declaredAmount: Number(p.declaredAmount) || 0 }))
    );

    const totalMoneyDeclared = paymentBalances.totalDeclaredPaid;

    // CORRECT FINANCIAL ACCOUNTING:
    // Outstanding balance = Total Invoice - Total Money Declared Received.
    // Credit is NEVER subtracted from the outstanding balance!
    let outstandingBalance = 0;
    let paymentStatus: 'unpaid' | 'partially_paid' | 'fully_paid' | 'credit' = 'unpaid';

    if (totalMoneyDeclared >= deliveryTotals.total && deliveryTotals.total > 0) {
      paymentStatus = 'fully_paid';
      outstandingBalance = 0;
    } else if (totalMoneyDeclared > 0) {
      paymentStatus = 'partially_paid';
      outstandingBalance = deliveryTotals.total - totalMoneyDeclared;
    } else {
      paymentStatus = 'credit';
      outstandingBalance = deliveryTotals.total;
    }

    // Compute canonical hash for idempotency and anti-tampering
    const canonicalHash = computeCanonicalPayloadHash(
      payload.customerId,
      payload.vehicleAssignmentId || '',
      calculatedItems,
      payload.payments || []
    );

    // ── 3. Database Persistence (Supabase) ─────────────────────────────────
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const isConfigured = supabaseUrl && !supabaseUrl.includes('placeholder');

    if (isConfigured) {
      const supabase = await createServerSupabaseClient();

      // Resolve user profile for caller authentication
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const createdById = user?.id;
      if (!createdById) {
        return NextResponse.json(
          { success: false, error: 'Authentication required' },
          { status: 401 }
        );
      }

      // Check idempotency: Has this clientTxId already been synced?
      const { data: existingDelivery } = await supabase
        .from('deliveries')
        .select('id, delivery_reference, client_tx_id, payload_hash, total_amount')
        .eq('client_tx_id', payload.clientTxId)
        .maybeSingle();

      if (existingDelivery) {
        // Anti-Tampering Check: Does the canonical payload hash match the existing record?
        if (existingDelivery.payload_hash && existingDelivery.payload_hash !== canonicalHash) {
          return NextResponse.json(
            {
              success: false,
              error: 'IDEMPOTENCY_MISMATCH: A delivery with this clientTxId already exists with a different payload or financial total.',
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

      // Resolve Vehicle Assignment (Shift)
      // Must be an active shift assigned to THIS employee. NO SILENT ASSIGNMENT OF SOMEONE ELSE'S VEHICLE!
      let vehicleAssignmentId = payload.vehicleAssignmentId;
      if (!vehicleAssignmentId) {
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
        }
      } else {
        // Verify that the specified assignment belongs to the caller
        const { data: verifiedAssignment } = await supabase
          .from('vehicle_assignments')
          .select('id')
          .eq('id', vehicleAssignmentId)
          .or(`driver_id.eq.${createdById},salesperson_id.eq.${createdById}`)
          .eq('is_active', true)
          .maybeSingle();

        if (!verifiedAssignment) {
          vehicleAssignmentId = undefined as any;
        }
      }

      if (!vehicleAssignmentId) {
        return NextResponse.json(
          {
            success: false,
            error: 'NO_ACTIVE_SHIFT: Employee is not assigned to an active vehicle shift. Delivery rejected.',
          },
          { status: 422 }
        );
      }

      // Execute Single Atomic Procedure (RPC)
      // Strictly NO non-atomic fallback inserts. Every delivery commits completely or fails!
      const { data: rpcData, error: rpcError } = await supabase.rpc('submit_delivery_atomic', {
        p_delivery_reference: payload.deliveryReference,
        p_client_tx_id: payload.clientTxId,
        p_payload_hash: canonicalHash,
        p_customer_id: payload.customerId,
        p_created_by: createdById,
        p_vehicle_assignment_id: vehicleAssignmentId,
        p_subtotal_amount: deliveryTotals.subtotal,
        p_discount_amount: deliveryTotals.discount,
        p_total_amount: deliveryTotals.total,
        p_total_declared_paid: totalMoneyDeclared,
        p_outstanding_balance: outstandingBalance,
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

      if (rpcError || !rpcData?.success) {
        console.error('[SYNC ERROR] Atomic RPC execution failed:', rpcError);
        return NextResponse.json(
          {
            success: false,
            error: rpcError?.message || 'Database rejected atomic delivery submission',
          },
          { status: 422 }
        );
      }

      const deliveryId = rpcData.delivery_id;
      const deliveryReference = rpcData.delivery_reference;

      // Dispatch Customer SMS Notification with explicit payment channel breakdown
      if (payload.customerPhone && deliveryId) {
        const itemSummary = calculatedItems
          .map((i: DeliveryItem) => `${i.quantity}x ${i.sellingUnit === 'FULL_SHEET' ? 'Full Sheet' : 'Half Sheet'} ${i.productName || 'Glass'}`)
          .join(', ');

        const cashPaid = (payload.payments || [])
          .filter((p) => p.channel === 'cash')
          .reduce((s, p) => s + (Number(p.declaredAmount) || 0), 0);
        const tillPaid = (payload.payments || [])
          .filter((p) => p.channel === 'mpesa_company_till')
          .reduce((s, p) => s + (Number(p.declaredAmount) || 0), 0);
        const empPaid = (payload.payments || [])
          .filter((p) => p.channel === 'mpesa_employee_phone')
          .reduce((s, p) => s + (Number(p.declaredAmount) || 0), 0);

        const smsText = generateDeliveryNotificationSms({
          deliveryReference,
          totalAmount: deliveryTotals.total,
          totalPaid: totalMoneyDeclared,
          outstandingBalance,
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

        // Asynchronously dispatch through provider
        sendSms({
          to: payload.customerPhone,
          message: smsText,
          deliveryReference,
        }).catch((err: any) => console.error('[SMS ASYNC ERROR]', err));
      }

      return NextResponse.json({
        success: true,
        deliveryId,
        deliveryReference,
        calculatedTotals: {
          subtotal: deliveryTotals.subtotal,
          total: deliveryTotals.total,
          declaredPaid: totalMoneyDeclared,
          outstandingBalance,
        },
      });
    }

    // ── 4. Fallback for Dev/Simulation Mode (When Supabase Unconfigured) ───
    const simulatedDeliveryId = `sim-del-${Date.now()}`;

    if (payload.customerPhone) {
      const itemSummary = calculatedItems
        .map((i: DeliveryItem) => `${i.quantity}x ${i.sellingUnit === 'FULL_SHEET' ? 'Full Sheet' : 'Half Sheet'} ${i.productName || 'Glass'}`)
        .join(', ');

      const smsText = generateDeliveryNotificationSms({
        deliveryReference: payload.deliveryReference,
        totalAmount: deliveryTotals.total,
        totalPaid: totalMoneyDeclared,
        outstandingBalance,
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
        declaredPaid: totalMoneyDeclared,
        outstandingBalance,
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
