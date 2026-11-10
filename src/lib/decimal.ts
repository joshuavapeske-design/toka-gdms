// TOKA GDMS — Precision Decimal Financial & Stock Mathematics

import Decimal from 'decimal.js';
import type { SellingUnit } from '@/types';

// Configure standard banking round half-up
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export function toDecimal(value: number | string | Decimal): Decimal {
  if (value instanceof Decimal) return value;
  try {
    return new Decimal(value || 0);
  } catch {
    return new Decimal(0);
  }
}

/**
 * Calculates Full-Sheet Equivalent (FSE) based on the confirmed sales model:
 * - 1 Full Sheet = 1.0 FSE (default sale unit)
 * - 1 Half Sheet = 0.5 FSE (ordered sales only)
 */
export function calculateFse(sellingUnit: SellingUnit, quantity: number): number {
  const qty = Math.max(0, Math.floor(quantity));
  switch (sellingUnit) {
    case 'FULL_SHEET':
      return toDecimal(qty).toNumber();
    case 'HALF_SHEET':
      return toDecimal(qty).mul(0.5).toNumber();
  }
}

/**
 * Calculates line total: quantity * applied_unit_price
 */
export function calculateLineTotal(quantity: number, unitPrice: number): number {
  const q = toDecimal(quantity);
  const p = toDecimal(unitPrice);
  return q.mul(p).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * Recalculates full delivery totals from line items and optional discount
 */
export function calculateDeliveryTotals(
  items: Array<{ quantity: number; appliedUnitPrice: number }>,
  discountAmount = 0
): { subtotal: number; discount: number; total: number } {
  let subtotal = new Decimal(0);
  for (const item of items) {
    const line = toDecimal(item.quantity).mul(toDecimal(item.appliedUnitPrice));
    subtotal = subtotal.add(line);
  }
  const subtotalRounded = subtotal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const discount = toDecimal(discountAmount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const total = Decimal.max(0, subtotalRounded.sub(discount)).toNumber();

  return {
    subtotal: subtotalRounded.toNumber(),
    discount: discount.toNumber(),
    total,
  };
}

/**
 * Calculates declared payment totals and resulting outstanding balance:
 * Total Invoice Amount - Total Declared Payments
 */
export function calculatePaymentBalances(
  invoiceTotal: number,
  declarations: Array<{ declaredAmount: number }>
): {
  totalDeclaredPaid: number;
  outstandingBalance: number;
} {
  const total = toDecimal(invoiceTotal);
  let paid = new Decimal(0);

  for (const dec of declarations) {
    paid = paid.add(toDecimal(dec.declaredAmount));
  }

  const paidRounded = paid.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const outstanding = Decimal.max(0, total.sub(paidRounded)).toNumber();

  return {
    totalDeclaredPaid: paidRounded.toNumber(),
    outstandingBalance: outstanding,
  };
}

/**
 * Computes Total Full-Sheet Equivalents in stock:
 * Full Sheets + (Half Sheets * 0.5)
 */
export function calculateStockFse(fullSheets: number, halfSheets: number): number {
  const full = toDecimal(fullSheets);
  const half = toDecimal(halfSheets).mul(0.5);
  return full.add(half).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * Human-readable currency formatter for Kenya Shillings (KES)
 */
export function formatKES(amount: number): string {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
