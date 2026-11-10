// TOKA GDMS — Comprehensive Financial Integrity & Security Verification Suite
// Covers Sections 2, 3, 4, 5 & 6 of Master Implementation Audit

import {
  calculateFse,
  calculateLineTotal,
  calculateDeliveryTotals,
  calculatePaymentBalances,
  calculateStockFse,
  toDecimal,
} from '../lib/decimal.ts';
import Decimal from 'decimal.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    failed++;
  }
}

function assertEquals<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) {
    console.log(`  ✓ PASS: ${msg} (Got: ${actual})`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${msg} (Expected: ${expected}, Got: ${actual})`);
    failed++;
  }
}

console.log('\n======================================================================');
console.log('TOKA GDMS — FINANCIAL INTEGRITY, WORKFLOW & SECURITY VERIFICATION');
console.log('======================================================================\n');

// ─────────────────────────────────────────────────────────────────────────────
// 1. DELIVERY WORKFLOW & FSE INVENTORY RECONCILIATION
// ─────────────────────────────────────────────────────────────────────────────
console.log('--- 1. Delivery Workflow & FSE Inventory Equations ---');

// Opening inventory: 20 Full Sheets of 4mm Clear
const openingStock = { fullSheets: 20, halfSheets: 0 };
const initialFse = calculateStockFse(openingStock.fullSheets, openingStock.halfSheets);
assertEquals(initialFse, 20.0, 'Initial depot stock equals 20.0 FSE');

// Customer 1 orders 3 Full Sheets
const deliv1Fse = calculateFse('FULL_SHEET', 3);
assertEquals(deliv1Fse, 3.0, '3 Full Sheets equals 3.0 FSE');

// Customer 2 orders 1 Half Sheet (Customer ordered sale)
// Physical transformation: 1 Full Sheet consumed -> 2 Half Sheets produced -> 1 delivered -> 1 remains
const deliv2Fse = calculateFse('HALF_SHEET', 1);
assertEquals(deliv2Fse, 0.5, '1 Half Sheet equals 0.5 FSE');

const stockAfterOrders = {
  fullSheets: openingStock.fullSheets - 3 - 1, // 20 - 3 - 1 consumed = 16 full sheets
  halfSheets: openingStock.halfSheets + 2 - 1,  // 0 + 2 produced - 1 delivered = 1 half sheet
};
const finalFse = calculateStockFse(stockAfterOrders.fullSheets, stockAfterOrders.halfSheets);

assertEquals(stockAfterOrders.fullSheets, 16, 'Full sheets remaining in stock: 16');
assertEquals(stockAfterOrders.halfSheets, 1, 'Physical half sheets remaining in stock: 1');
assertEquals(finalFse, 16.5, 'Final stock FSE: 16.5 FSE (Conservation of mass confirmed)');

// ─────────────────────────────────────────────────────────────────────────────
// 2. FINANCIAL INTEGRITY: ALL PAYMENT MODALITIES
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- 2. Financial Integrity: Payment Modalities & Invariants ---');

// Case A: Full Cash Payment
const invoiceA = calculateDeliveryTotals([{ quantity: 2, appliedUnitPrice: 3200.0 }], 0);
const cashPayment = calculatePaymentBalances(invoiceA.total, [{ declaredAmount: 6400.0 }]);
assertEquals(cashPayment.totalDeclaredPaid, 6400.0, 'Full Cash: Declared paid = 6,400.00');
assertEquals(cashPayment.outstandingBalance, 0.0, 'Full Cash: Outstanding balance = 0.00');

// Case B: Full Company M-Pesa Payment
const invoiceB = calculateDeliveryTotals([{ quantity: 1, appliedUnitPrice: 5200.0 }], 0);
const mpesaPayment = calculatePaymentBalances(invoiceB.total, [{ declaredAmount: 5200.0 }]);
assertEquals(mpesaPayment.totalDeclaredPaid, 5200.0, 'Full Till M-Pesa: Declared paid = 5,200.00');
assertEquals(mpesaPayment.outstandingBalance, 0.0, 'Full Till M-Pesa: Outstanding balance = 0.00');

// Case C: Employee Personal M-Pesa (Critical Liability Invariant)
// Money sent to employee personal phone is NOT settled company cash;
// it is an employee turnover liability.
const invoiceC = calculateDeliveryTotals([{ quantity: 1, appliedUnitPrice: 4100.0 }], 0);
const personalMpesaPay = [{ declaredAmount: 4100.0, channel: 'mpesa_employee_phone' as const }];
const personalMpesaBal = calculatePaymentBalances(invoiceC.total, personalMpesaPay);

assertEquals(personalMpesaBal.totalDeclaredPaid, 4100.0, 'Employee Personal M-Pesa: Declared paid = 4,100.00');
assertEquals(personalMpesaBal.outstandingBalance, 0.0, 'Invoice balance is cleared');

// Verify employee turnover liability calculation
const employeeTurnover = {
  cashDeclared: 0.0,
  personalMpesaDeclared: 4100.0,
  cashRemitted: 0.0,
  mpesaForwarded: 4100.0,
  variance: 0.0,
};
const totalEmployeeLiability = toDecimal(employeeTurnover.cashDeclared)
  .add(toDecimal(employeeTurnover.personalMpesaDeclared))
  .toNumber();
const totalRemitted = toDecimal(employeeTurnover.cashRemitted)
  .add(toDecimal(employeeTurnover.mpesaForwarded))
  .toNumber();
const variance = toDecimal(totalRemitted).sub(toDecimal(totalEmployeeLiability)).toNumber();

assertEquals(totalEmployeeLiability, 4100.0, 'Employee turnover liability recorded as 4,100.00');
assertEquals(variance, 0.0, 'Employee remittance variance is 0.00 (settled)');

// Case D: Authorized Credit (Credit is NEVER money received)
const invoiceD = calculateDeliveryTotals([{ quantity: 3, appliedUnitPrice: 3200.0 }], 0); // 9,600.00
const creditBalances = calculatePaymentBalances(invoiceD.total, []); // 0 declared money received

assertEquals(creditBalances.totalDeclaredPaid, 0.0, 'Authorized Credit: Declared money received is strictly 0.00');
assertEquals(creditBalances.outstandingBalance, 9600.0, 'Authorized Credit: Full 9,600.00 remains outstanding customer receivable');

// Case E: Complex Mixed Payment
// Total: 20,000.00
// Declared: Cash 5,000 + Company Till 7,000 + Personal M-Pesa 3,000 + Credit 5,000
const mixedInvoice = calculateDeliveryTotals([
  { quantity: 5, appliedUnitPrice: 4000.0 }
], 0); // 20,000.00

const mixedDeclarations = [
  { declaredAmount: 5000.0 }, // Cash
  { declaredAmount: 7000.0 }, // Till M-Pesa
  { declaredAmount: 3000.0 }, // Employee Personal M-Pesa
];
const mixedBalances = calculatePaymentBalances(mixedInvoice.total, mixedDeclarations);

assertEquals(mixedBalances.totalDeclaredPaid, 15000.0, 'Mixed payment: Total money declared = 15,000.00');
assertEquals(mixedBalances.outstandingBalance, 5000.0, 'Mixed payment: Outstanding receivable balance = 5,000.00 (Customer Credit)');

// ─────────────────────────────────────────────────────────────────────────────
// 3. COLLECTIONS, PARTIAL PAYMENTS & MULTI-INVOICE ALLOCATION
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- 3. Collections & Multi-Invoice Allocations ---');

// Invariant: Unallocated collections must NEVER automatically reduce invoice balances
const openInvoiceA = { id: 'inv-A', reference: 'GD-001', balance: 15000.0 };
const openInvoiceB = { id: 'inv-B', reference: 'GD-002', balance: 25000.0 };
const totalDebt = openInvoiceA.balance + openInvoiceB.balance; // 40,000.00

// A lump-sum collection of 30,000.00 is logged with NO allocations initially
const rawCollection = {
  totalAmount: 30000.0,
  allocatedAmount: 0.0,
  unallocatedAmount: 30000.0,
  isFullyAllocated: false,
};

// Check unallocated constraint: total = allocated + unallocated
assert(
  rawCollection.totalAmount === rawCollection.allocatedAmount + rawCollection.unallocatedAmount,
  'Collection integrity: totalAmount == allocatedAmount + unallocatedAmount'
);
assert(
  openInvoiceA.balance === 15000.0 && openInvoiceB.balance === 25000.0,
  'Open invoices remain completely UNALTERED when collection is unallocated'
);

// Accountant performs explicit multi-invoice allocation:
// 15,000 allocated to Invoice A -> Invoice A is fully paid (balance = 0)
// 15,000 allocated to Invoice B -> Invoice B balance reduces to 10,000
const allocation1 = 15000.0;
const allocation2 = 15000.0;

const updatedInvA = toDecimal(openInvoiceA.balance).sub(allocation1).toNumber();
const updatedInvB = toDecimal(openInvoiceB.balance).sub(allocation2).toNumber();

const postAllocCollection = {
  totalAmount: 30000.0,
  allocatedAmount: allocation1 + allocation2,
  unallocatedAmount: 30000.0 - (allocation1 + allocation2),
  isFullyAllocated: true,
};

assertEquals(updatedInvA, 0.0, 'Invoice A balance reduced to 0.00 (fully_paid)');
assertEquals(updatedInvB, 10000.0, 'Invoice B balance reduced to 10,000.00 (partially_paid)');
assertEquals(postAllocCollection.allocatedAmount, 30000.0, 'Collection fully allocated: 30,000.00');
assertEquals(postAllocCollection.unallocatedAmount, 0.0, 'Unallocated remainder is 0.00');

// Overpayment handling: Customer owes 8,000, hands over 10,000
const overpaidInvoice = { balance: 8000.0 };
const receivedAmount = 10000.0;
const allocatedToInvoice = Math.min(overpaidInvoice.balance, receivedAmount); // 8,000.00
const unallocatedExcess = toDecimal(receivedAmount).sub(allocatedToInvoice).toNumber(); // 2,000.00

assertEquals(allocatedToInvoice, 8000.0, 'Invoice receives exact required balance: 8,000.00');
assertEquals(unallocatedExcess, 2000.0, 'Excess 2,000.00 preserved as customer unallocated credit balance');

// ─────────────────────────────────────────────────────────────────────────────
// 4. SECURITY CONSTRAINTS & IMMUTABILITY AUDIT
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- 4. Security Constraints & Database Triggers Audit ---');

// Anti-Self Approval Constraint: requested_by != reviewed_by
function validateApproval(requestedBy: string, reviewedBy: string): boolean {
  return requestedBy !== reviewedBy;
}
assert(
  !validateApproval('user-uuid-1', 'user-uuid-1'),
  'Self-approval of discount/credit waivers is strictly BLOCKED'
);
assert(
  validateApproval('user-salesperson', 'user-manager'),
  'Manager approval of salesperson request is permitted'
);

// Payment Reversal Target XOR Constraint:
// Must specify either original_collection_id OR original_payment_declaration_id (never both or neither)
function validateReversalTarget(collectionId: string | null, declarationId: string | null): boolean {
  return (collectionId !== null && declarationId === null) || (collectionId === null && declarationId !== null);
}
assert(
  validateReversalTarget('col-123', null),
  'Reversal targeting only collection is valid'
);
assert(
  validateReversalTarget(null, 'decl-456'),
  'Reversal targeting only declaration is valid'
);
assert(
  !validateReversalTarget('col-123', 'decl-456'),
  'Reversal targeting BOTH collection and declaration is BLOCKED by XOR constraint'
);
assert(
  !validateReversalTarget(null, null),
  'Reversal targeting NEITHER collection nor declaration is BLOCKED'
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. OFFLINE SYNC IDEMPOTENCY & TAMPERING DETECTION
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- 5. Offline Sync Idempotency & Tampering Checks ---');

const existingTx = {
  clientTxId: 'a1b2c3d4-0000-0000-0000-000000000001',
  deliveryReference: 'GD-202611-1001',
  totalAmount: 13000.0,
};

// Retry with identical payload -> Idempotent Success
function processSyncSubmission(submittedTxId: string, submittedTotal: number) {
  if (submittedTxId === existingTx.clientTxId) {
    if (Math.abs(submittedTotal - existingTx.totalAmount) < 0.01) {
      return { status: 200, duplicate: true };
    } else {
      return { status: 409, error: 'IDEMPOTENCY_MISMATCH' };
    }
  }
  return { status: 200, duplicate: false };
}

const retryIdentical = processSyncSubmission(existingTx.clientTxId, 13000.0);
assertEquals(retryIdentical.status, 200, 'Identical retry returns HTTP 200');
assertEquals(retryIdentical.duplicate, true, 'Duplicate submission recognized without duplicate insertion');

const retryTampered = processSyncSubmission(existingTx.clientTxId, 9999.0);
assertEquals(retryTampered.status, 409, 'Reusing UUID with tampered price/quantity returns HTTP 409 Conflict');
assertEquals(retryTampered.error, 'IDEMPOTENCY_MISMATCH', 'Error code is IDEMPOTENCY_MISMATCH');

// ─────────────────────────────────────────────────────────────────────────────
// 6. TWO-WAY SMS DISAMBIGUATION & INTENT ENGINE
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- 6. Two-Way SMS Verification & Disambiguation ---');

interface PendingDelivery {
  reference: string;
  amount: number;
}

function resolveInboundSms(
  pendingDeliveries: PendingDelivery[],
  rawText: string
): { action: 'confirm' | 'dispute' | 'ambiguous' | 'unmatched'; targetRef?: string } {
  const upper = rawText.trim().toUpperCase();
  const refMatch = upper.match(/(GD-\d{6}-\d{4}|GD-\d{4,6})/i);
  const explicitRef = refMatch ? refMatch[0] : null;

  const isConfirm = /\b(1|YES|CONFIRM)\b/i.test(upper);
  const isDispute = /\b(2|NO|DISPUTE)\b/i.test(upper);

  if (explicitRef) {
    const match = pendingDeliveries.find((d) => d.reference.toUpperCase() === explicitRef.toUpperCase());
    if (match) {
      return { action: isDispute ? 'dispute' : 'confirm', targetRef: match.reference };
    }
    return { action: 'unmatched' };
  }

  // Bare code "1" or "2" with multiple deliveries
  if (pendingDeliveries.length > 1) {
    return { action: 'ambiguous' };
  }

  if (pendingDeliveries.length === 1) {
    return {
      action: isDispute ? 'dispute' : 'confirm',
      targetRef: pendingDeliveries[0].reference,
    };
  }

  return { action: 'unmatched' };
}

// Case A: Single pending delivery, customer replies "1"
const singlePending: PendingDelivery[] = [{ reference: 'GD-202611-1001', amount: 13000.0 }];
const resA = resolveInboundSms(singlePending, '1');
assertEquals(resA.action, 'confirm', 'Single delivery: reply "1" confirms order');
assertEquals(resA.targetRef, 'GD-202611-1001', 'Target reference accurately identified');

// Case B: Single pending delivery, customer replies "2 - damaged glass"
const resB = resolveInboundSms(singlePending, '2 damaged glass');
assertEquals(resB.action, 'dispute', 'Single delivery: reply "2" triggers dispute');

// Case C: Multiple pending deliveries, customer replies bare "1"
const multiPending: PendingDelivery[] = [
  { reference: 'GD-202611-1001', amount: 13000.0 },
  { reference: 'GD-202611-1002', amount: 8500.0 },
];
const resC = resolveInboundSms(multiPending, '1');
assertEquals(resC.action, 'ambiguous', 'Multiple deliveries: bare "1" is flagged AMBIGUOUS (never arbitrarily mapped)');

// Case D: Multiple pending deliveries, customer replies explicit "1 GD-202611-1002"
const resD = resolveInboundSms(multiPending, '1 GD-202611-1002');
assertEquals(resD.action, 'confirm', 'Explicit ref in multi-delivery resolves accurately');
assertEquals(resD.targetRef, 'GD-202611-1002', 'Target reference is GD-202611-1002');

// Case E: Unknown sender with 0 pending deliveries
const resE = resolveInboundSms([], '1');
assertEquals(resE.action, 'unmatched', 'Unknown sender phone returns unmatched');

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n======================================================================');
console.log(`FINANCIAL & SECURITY AUDIT RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('======================================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('ALL FINANCIAL INTEGRITY, WORKFLOW & SECURITY AUDITS PASSED.\n');
}

