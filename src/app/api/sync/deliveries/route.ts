// TOKA GDMS — Idempotent Delivery Synchronization & Validation API
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  calculateFse,
  calculateLineTotal,
  calculateDeliveryTotals,
  calculatePaymentBalances,
} from '@/lib/decimal';
import type { DeliveryItem, PaymentDeclaration } from '@/types';
import crypto from 'crypto';

// ── Zod Runtime Validation Schemas (Strict, No Silent Normalization) ─────────
const deliveryItemInputSchema = z.object({
  productId: z.string().uuid({ message: 'productId must be a valid UUID' }),
  sellingUnit: z.enum(['FULL_SHEET', 'HALF_SHEET'], {
    errorMap: () => ({ message: 'sellingUnit must be FULL_SHEET or HALF_SHEET' }),
  }),
  quantity: z
    .number()
    .int({ message: 'quantity must be an integer' })
    .positive({ message: 'quantity must be greater than zero' }),
  appliedUnitPrice: z
    .number()
    .finite({ message: 'appliedUnitPrice must be a valid finite number' })
    .nonnegative({ message: 'appliedUnitPrice cannot be negative' }),
  officialUnitPrice: z.number().finite().nonnegative().optional(),
  priceApprovalId: z.string().uuid().nullable().optional(),
});

const paymentDeclarationInputSchema = z.object({
  channel: z.enum(['cash', 'mpesa_company_till', 'mpesa_employee_phone', 'bank_transfer', 'credit']),
  declaredAmount: z
    .number()
    .finite({ message: 'declaredAmount must be finite' })
    .nonnegative({ message: 'declaredAmount cannot be negative' }),
  externalRef: z.string().max(100).nullable().optional(),
  notes: z.string().max(255).nullable().optional(),
});

const deliverySyncPayloadSchema = z.object({
  clientTxId: z.string().uuid({ message: 'clientTxId must be a valid RFC4122 UUID' }),
  deliveryReference: z.string().regex(/^GD-\d{6}-\d{4}$/, { message: 'deliveryReference must match GD-YYYYMM-XXXX' }),
  customerId: z.string().uuid({ message: 'customerId must be a valid UUID' }),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  vehicleAssignmentId: z.string().uuid({ message: 'vehicleAssignmentId must be a valid UUID' }),
  discountAmount: z.number().finite().nonnegative().default(0),
  notes: z.string().max(500).nullable().optional(),
  deliveryLat: z.number().min(-90).max(90).nullable().optional(),
  deliveryLng: z.number().min(-180).max(180).nullable().optional(),
  gpsAccuracyM: z.number().nonnegative().nullable().optional(),
  deviceCapturedAt: z.string().datetime().nullable().optional(),
  isOfflineSubmission: z.boolean().default(false),
  items: z.array(deliveryItemInputSchema).min(1, { message: 'Delivery must have at least one line item' }).max(50),
  payments: z.array(paymentDeclarationInputSchema).max(20).default([]),
});

/**
 * Generates a complete, canonical, deterministic SHA-256 hash of the business transaction.
 * Material fields include: clientTxId, deliveryReference, customerId, vehicleAssignmentId,
 * discountAmount, notes, all sorted line items, and all sorted payments.
 */
function computeCanonicalPayloadHash(payload: {
  clientTxId: string;
  deliveryReference: string;
  customerId: string;
  vehicleAssignmentId: string;
  discountAmount?: number;
  notes?: string | null;
  items: Array<{
    productId: string;
    sellingUnit: string;
    quantity: number;
    appliedUnitPrice: number;
    priceApprovalId?: string | null;
  }>;
  payments: Array<{
    channel: string;
    declaredAmount: number;
    externalRef?: string | null;
    notes?: string | null;
  }>;
}): string {
  const sortedItems = [...payload.items]
    .sort((a, b) => a.productId.localeCompare(b.productId) || a.sellingUnit.localeCompare(b.sellingUnit))
    .map(
      (i) =>
        `${i.productId}:${i.sellingUnit}:${i.quantity}:${i.appliedUnitPrice.toFixed(2)}:${i.priceApprovalId || ''}`
    )
    .join('|');

  const sortedPayments = [...(payload.payments || [])]
    .sort((a, b) => a.channel.localeCompare(b.channel) || (a.externalRef || '').localeCompare(b.externalRef || ''))
    .map((p) => `${p.channel}:${Number(p.declaredAmount).toFixed(2)}:${p.externalRef || ''}`)
    .join('|');

  const raw = [
    payload.clientTxId,
    payload.deliveryReference,
    payload.customerId,
    payload.vehicleAssignmentId,
    (payload.discountAmount || 0).toFixed(2),
    payload.notes || '',
    sortedItems,
    sortedPayments,
  ].join('::');

  return crypto.createHash('sha256').update(raw).digest('hex');
}

export async function POST(request: Request) {
  try {
    let rawBody: any;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Malformed JSON payload' }, { status: 400 });
    }

    // ── 1. Strict Runtime Schema Validation (Zod) ─────────────────────────
    const parseResult = deliverySyncPayloadSchema.safeParse(rawBody);
    if (!parseResult.success) {
      const errorMsg = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
      return NextResponse.json({ success: false, error: `Validation error: ${errorMsg}` }, { status: 422 });
    }

    const payload = parseResult.data;

    // ── 2. Server-side Financial Calculations (Decimal.js) ────────────────
    const calculatedItems: DeliveryItem[] = payload.items.map((item) => {
      const fse = calculateFse(item.sellingUnit, item.quantity);
      const lineTotal = calculateLineTotal(item.quantity, item.appliedUnitPrice);

      return {
        ...item,
        officialUnitPrice: item.officialUnitPrice ?? item.appliedUnitPrice,
        isSpecialPrice: Boolean(item.priceApprovalId || (item.officialUnitPrice && item.officialUnitPrice !== item.appliedUnitPrice)),
        fullSheetEquivalent: fse,
        lineTotal,
      };
    });

    const deliveryTotals = calculateDeliveryTotals(
      calculatedItems.map((i) => ({ quantity: i.quantity, appliedUnitPrice: i.appliedUnitPrice })),
      payload.discountAmount
    );

    // Filter non-credit payments: Credit is authorized customer debt, NEVER money received.
    const nonCreditPayments = payload.payments.filter((p) => p.channel !== 'credit');
    const paymentBalances = calculatePaymentBalances(
      deliveryTotals.total,
      nonCreditPayments.map((p) => ({ declaredAmount: p.declaredAmount }))
    );

    const totalMoneyDeclared = paymentBalances.totalDeclaredPaid;
    const outstandingBalance = paymentBalances.outstandingBalance;

    let paymentStatus: 'unpaid' | 'partially_paid' | 'fully_paid' | 'credit' = 'unpaid';
    if (totalMoneyDeclared >= deliveryTotals.total && deliveryTotals.total > 0) {
      paymentStatus = 'fully_paid';
    } else if (totalMoneyDeclared > 0) {
      paymentStatus = 'partially_paid';
    } else {
      paymentStatus = 'credit';
    }

    // Compute complete canonical SHA-256 hash
    const canonicalHash = computeCanonicalPayloadHash({
      clientTxId: payload.clientTxId,
      deliveryReference: payload.deliveryReference,
      customerId: payload.customerId,
      vehicleAssignmentId: payload.vehicleAssignmentId,
      discountAmount: payload.discountAmount,
      notes: payload.notes,
      items: payload.items,
      payments: payload.payments,
    });

    // ── 3. Database Persistence (Atomic Supabase RPC) ──────────────────────
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const isConfigured = supabaseUrl && !supabaseUrl.includes('placeholder');

    if (isConfigured) {
      const supabase = await createServerSupabaseClient();

      // Resolve authenticated caller
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const createdById = user?.id;
      if (!createdById) {
        return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
      }

      // ── Idempotency Check ────────────────────────────────────────────────
      const { data: existingDelivery } = await supabase
        .from('deliveries')
        .select('id, delivery_reference, client_tx_id, payload_hash, total_amount')
        .eq('client_tx_id', payload.clientTxId)
        .maybeSingle();

      if (existingDelivery) {
        if (existingDelivery.payload_hash && existingDelivery.payload_hash !== canonicalHash) {
          return NextResponse.json(
            {
              success: false,
              code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
              error: 'IDEMPOTENCY_PAYLOAD_MISMATCH: A delivery with this clientTxId already exists with a different payload or financial total.',
            },
            { status: 409 }
          );
        }

        return NextResponse.json({
          success: true,
          duplicate: true,
          deliveryId: existingDelivery.id,
          deliveryReference: existingDelivery.delivery_reference,
          message: 'Delivery was already synchronized.',
        });
      }

      // ── Shift Verification ───────────────────────────────────────────────
      const { data: verifiedAssignment } = await supabase
        .from('vehicle_assignments')
        .select('id, is_active, driver_id, salesperson_id')
        .eq('id', payload.vehicleAssignmentId)
        .eq('is_active', true)
        .maybeSingle();

      if (!verifiedAssignment) {
        return NextResponse.json(
          {
            success: false,
            error: `INVALID_SHIFT: Vehicle assignment ${payload.vehicleAssignmentId} is not active or does not exist.`,
          },
          { status: 422 }
        );
      }

      // Check caller belongs to this assignment
      const isAssigned =
        verifiedAssignment.driver_id === createdById || verifiedAssignment.salesperson_id === createdById;

      // Check if caller is manager/owner for admin override
      const { data: callerProfile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', createdById)
        .single();

      const isManager = callerProfile?.role === 'owner' || callerProfile?.role === 'manager';

      if (!isAssigned && !isManager) {
        return NextResponse.json(
          {
            success: false,
            error: `UNAUTHORIZED_SHIFT: Employee is not assigned to vehicle assignment ${payload.vehicleAssignmentId}.`,
          },
          { status: 403 }
        );
      }

      // ── Execute Single Atomic Procedure (RPC) ────────────────────────────
      // No non-atomic fallback inserts. Every delivery commits completely or fails!
      const { data: rpcData, error: rpcError } = await supabase.rpc('submit_delivery_atomic', {
        p_delivery_reference: payload.deliveryReference,
        p_client_tx_id: payload.clientTxId,
        p_payload_hash: canonicalHash,
        p_customer_id: payload.customerId,
        p_created_by: createdById,
        p_vehicle_assignment_id: payload.vehicleAssignmentId,
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
        p_notes: payload.notes || null,
        p_items: calculatedItems,
        p_payments: payload.payments,
      });

      if (rpcError || !rpcData?.success) {
        console.error('[SYNC ERROR] submit_delivery_atomic RPC failed:', rpcError);
        return NextResponse.json(
          {
            success: false,
            error: rpcError?.message || 'Database rejected atomic delivery submission',
          },
          { status: 422 }
        );
      }

      return NextResponse.json({
        success: true,
        deliveryId: rpcData.delivery_id,
        deliveryReference: rpcData.delivery_reference,
        totalAmount: rpcData.total_amount,
        totalDeclaredPaid: rpcData.total_declared_paid,
        outstandingBalance: rpcData.outstanding_balance,
        paymentStatus: rpcData.payment_status,
      });
    }

    // ── Local Simulation Mode (Development without Supabase) ───────────────
    return NextResponse.json({
      success: true,
      simulated: true,
      deliveryId: `sim-${Date.now()}`,
      deliveryReference: payload.deliveryReference,
      totalAmount: deliveryTotals.total,
      totalDeclaredPaid: totalMoneyDeclared,
      outstandingBalance,
      paymentStatus,
    });
  } catch (err: any) {
    console.error('[DELIVERY SYNC EXCEPTION]', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error during delivery synchronization' },
      { status: 500 }
    );
  }
}
