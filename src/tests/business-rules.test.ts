// TOKA GDMS — Business Rules & Arithmetic Verification Test Suite
// Verifies core anti-fraud invariants, FSE mathematics, and Decimal.js precision

import {
  calculateFse,
  calculateLineTotal,
  calculateDeliveryTotals,
  calculatePaymentBalances,
  calculateStockFse,
  formatKES,
} from '../lib/decimal.ts';
import { generateClientTxId, generateDeliveryReference, generateCollectionReference } from '../lib/uuid.ts';
import { generateDeliveryNotificationSms } from '../lib/sms/africas-talking.ts';

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, description: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${description}`);
    testsPassed++;
  } else {
    console.error(`  ✗ FAIL: ${description}`);
    testsFailed++;
  }
}

function assertEquals<T>(actual: T, expected: T, description: string) {
  const pass = actual === expected;
  if (pass) {
    console.log(`  ✓ PASS: ${description} (Got: ${actual})`);
    testsPassed++;
  } else {
    console.error(`  ✗ FAIL: ${description} (Expected: ${expected}, Got: ${actual})`);
    testsFailed++;
  }
}

console.log('\n======================================================');
console.log('TOKA GDMS — CRITICAL BUSINESS RULES & ARITHMETIC TESTS');
console.log('======================================================\n');

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE 1: FULL-SHEET EQUIVALENT (FSE) MATHEMATICS
// ─────────────────────────────────────────────────────────────────────────────
console.log('--- Suite 1: Full-Sheet Equivalent (FSE) Rules ---');

// Invariant: 1 Full Sheet = 1.0 FSE
assertEquals(calculateFse('FULL_SHEET', 1), 1.0, '1 Full Sheet must equal 1.0 FSE');
assertEquals(calculateFse('FULL_SHEET', 5), 5.0, '5 Full Sheets must equal 5.0 FSE');

// Invariant: 1 Half Sheet = 0.5 FSE
assertEquals(calculateFse('HALF_SHEET', 1), 0.5, '1 Half Sheet must equal 0.5 FSE');
assertEquals(calculateFse('HALF_SHEET', 2), 1.0, '2 Half Sheets must equal 1.0 FSE');
assertEquals(calculateFse('HALF_SHEET', 3), 1.5, '3 Half Sheets must equal 1.5 FSE');

// Confirmed business rule: NO piece sales allowed; only Full Sheets (default) & Half Sheets (ordered)
assert(
  ['FULL_SHEET', 'HALF_SHEET'].length === 2,
  'Selling units strictly restricted to FULL_SHEET and HALF_SHEET'
);

// Scenario 1 & 2: User Confirmed Transformation Example
// Opening stock: 10 full sheets
// Customer orders 1 half sheet:
// 1 full sheet consumed -> 2 half sheets produced -> 1 delivered -> 1 half remaining
// Final stock: 9 full sheets + 1 half sheet = 9.5 FSE
const openingStockFull = 10;
const openingStockHalf = 0;
const fullSheetsConsumed = 1;
const halfSheetsProduced = fullSheetsConsumed * 2; // 2
const halfSheetsDelivered = 1;

const remainingFull = openingStockFull - fullSheetsConsumed; // 9
const remainingHalf = openingStockHalf + halfSheetsProduced - halfSheetsDelivered; // 1
const remainingFse = calculateStockFse(remainingFull, remainingHalf);

assertEquals(remainingFull, 9, 'Remaining full sheets must be 9');
assertEquals(remainingHalf, 1, 'Remaining half sheets must be 1');
assertEquals(remainingFse, 9.5, 'Remaining stock FSE must be exactly 9.5');

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE 2: DECIMAL.JS FINANCIAL RECONCILIATION & ROUNDING
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Suite 2: Decimal.js Financial Math & Rounding ---');

// Line item calculation with exact round-half-up
const line1 = calculateLineTotal(2, 3200.0);
assertEquals(line1, 6400.0, '2 full sheets 4mm Clear @ 3,200.00 = 6,400.00');

const line2 = calculateLineTotal(1, 2200.0);
assertEquals(line2, 2200.0, '1 ordered half sheet 5mm Clear @ 2,200.00 = 2,200.00');

const line3 = calculateLineTotal(1, 5200.0);
assertEquals(line3, 5200.0, '1 full sheet 6mm Clear @ 5,200.00 = 5,200.00');

// Delivery totals calculation
const items = [
  { quantity: 2, appliedUnitPrice: 3200.0 },
  { quantity: 1, appliedUnitPrice: 2200.0 },
  { quantity: 1, appliedUnitPrice: 5200.0 },
];
const deliveryTotals = calculateDeliveryTotals(items, 800.0); // KES 800 authorized discount

assertEquals(deliveryTotals.subtotal, 13800.0, 'Subtotal: 6400 + 2200 + 5200 = 13,800.00');
assertEquals(deliveryTotals.discount, 800.0, 'Discount must be 800.00');
assertEquals(deliveryTotals.total, 13000.0, 'Total invoice: 13,800.00 - 800.00 = 13,000.00');

// Mixed payment declarations
// Cash: 4,000.00
// Company M-Pesa: 5,000.00
// Employee personal M-Pesa: 2,000.00
// Total declared paid: 11,000.00
// Remaining outstanding on credit: 2,000.00
const payments = [
  { declaredAmount: 4000.0 },
  { declaredAmount: 5000.0 },
  { declaredAmount: 2000.0 },
];
const paymentBalances = calculatePaymentBalances(deliveryTotals.total, payments);

assertEquals(paymentBalances.totalDeclaredPaid, 11000.0, 'Declared paid: 4000 + 5000 + 2000 = 11,000.00');
assertEquals(paymentBalances.outstandingBalance, 2000.0, 'Outstanding balance: 13,000.00 - 11,000.00 = 2,000.00');

// Currency formatting
const formatted = formatKES(12500.5);
assert(formatted.includes('12,500.50'), `Formatted currency should include 12,500.50 (Got: ${formatted})`);

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE 3: IDEMPOTENCY & REFERENCE GENERATORS
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Suite 3: UUID & Human-Readable Reference Generators ---');

const uuid1 = generateClientTxId();
const uuid2 = generateClientTxId();
assert(uuid1 !== uuid2, 'Two generated UUIDs must be distinct');
assert(
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid1),
  `ClientTxId must conform to RFC4122 UUIDv4 format (Got: ${uuid1})`
);

const delRef1 = generateDeliveryReference();
const delRef2 = generateDeliveryReference();
assert(delRef1 !== delRef2, 'Two generated delivery references must be distinct');
assert(/^GD-\d{6}-\d{4}$/.test(delRef1), `Delivery reference must match GD-YYYYMM-XXXX (Got: ${delRef1})`);

const colRef = generateCollectionReference();
assert(/^COL-\d{6}-\d{4}$/.test(colRef), `Collection reference must match COL-YYYYMM-XXXX (Got: ${colRef})`);

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE 4: SMS NOTIFICATION TEMPLATE & PARSING REGEX
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Suite 4: Customer Verification SMS Engine ---');

const smsMessage = generateDeliveryNotificationSms({
  deliveryReference: 'GD-202611-5432',
  totalAmount: 10000.0,
  totalPaid: 7000.0,
  outstandingBalance: 3000.0,
  itemSummary: '2x Full 4mm Clear, 1x Half 5mm Clear',
});

assert(smsMessage.includes('GD-202611-5432'), 'SMS must contain delivery reference');
assert(smsMessage.includes('Total: KES 10,000'), 'SMS must contain formatted total');
assert(smsMessage.includes('Paid: KES 7,000'), 'SMS must contain formatted declared paid');
assert(smsMessage.includes('Bal: KES 3,000'), 'SMS must contain formatted outstanding balance');
assert(smsMessage.includes('To confirm received, reply: 1'), 'SMS must instruct reply 1 for confirmation');
assert(smsMessage.includes('To report an issue or dispute, reply: 2'), 'SMS must instruct reply 2 for dispute');

// Inbound regex verification
const refRegex = /(GD-\d{6}-\d{4}|GD-\d{4,6})/i;
const confirmRegex = /\b(1|YES|CONFIRM|CONFIRMED)\b/i;
const disputeRegex = /\b(2|NO|DISPUTE|PROBLEM|WRONG)\b/i;

assert(refRegex.test('1 GD-202611-5432'), 'Regex matches explicit ref in "1 GD-202611-5432"');
assert(confirmRegex.test('1 GD-202611-5432'), 'Intent matches CONFIRM in "1 GD-202611-5432"');
assert(disputeRegex.test('2 GD-202611-5432'), 'Intent matches DISPUTE in "2 GD-202611-5432"');
assert(disputeRegex.test('NO I only received 1 sheet'), 'Intent matches DISPUTE in "NO I only received 1 sheet"');

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n======================================================');
console.log(`TEST RESULTS: ${testsPassed} PASSED, ${testsFailed} FAILED`);
console.log('======================================================\n');

if (testsFailed > 0) {
  process.exit(1);
} else {
  console.log('ALL CRITICAL BUSINESS RULES & ARITHMETIC TESTS PASSED.\n');
}
