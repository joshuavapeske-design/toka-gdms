# TOKA GDMS — Product Scope & Business Requirements (Final Confirmed Rules)

## 1. System Vision & Anti-Fraud Rationale

The TOKA Glass Distribution Management System (GDMS) is designed for commercial glass wholesale and retail distribution operations. Commercial glass distribution has high physical and financial risk characteristics:
- Glass is bulky, fragile, expensive, and delivered across routes by truck.
- Field teams operate away from headquarters with company vehicles and stock.
- Cash and mobile money (M-Pesa) are collected in the field by employees.
- Unscrupulous practices in this industry include:
  1. **Underreported Sales**: Recording 5 full sheets delivered while handing over 6, pocketing the difference.
  2. **Unauthorized Discounting**: Giving informal price reductions in exchange for cash kickbacks.
  3. **Ghost / Unrecorded Deliveries**: Dropping off stock to informal buyers without a recorded dispatch.
  4. **Payment Divergence**: Employees receiving M-Pesa to personal mobile numbers or pocketing cash, claiming the customer bought on credit.
  5. **Silent Historical Deletions**: Deleting or editing records days later when discrepancies arise.
  6. **Inventory Scrap Inflation**: Falsely reporting broken glass to explain missing sheets.

GDMS establishes an append-only, zero-trust, verifiable record for every sheet, every half sheet, every shilling, every route, and every customer transaction.

---

## 2. Confirmed Glass Sales & Inventory Model

### A. Core Sales Units: Full Sheets & Half Sheets
TOKA's operational business model is strictly defined:
1. **FULL SHEETS are sold by default.**
2. **HALF SHEETS are sold ONLY when specifically ordered by a customer.**
3. **PIECES**: Pre-cut standardized items (e.g., louvre blades, pre-cut standard mirrors) sold by item count.

> [!IMPORTANT]
> **No Arbitrary Custom Cutting**: TOKA does not run a custom dimension cutting shop ($L \times W$) with variable scrap thresholds. Do not implement complex multi-dimensional cutting algorithms or offcut management. Glass inventory is managed as **Full Sheets**, **Half Sheets**, and standardized **Pieces**.

### B. The Half-Sheet Split Transformation Rule
- Producing a half sheet means splitting one physical full sheet into exactly two physical halves.
- **Physical Inventory Transformation**:
  1. 1 Full Sheet is consumed from inventory.
  2. 2 Half Sheets are produced in physical stock.
  3. 1 Half Sheet is delivered to the ordering customer.
  4. 1 Half Sheet **MUST remain accounted for in physical stock**.
- **Non-negotiable Rule**: The remaining half sheet must **NEVER** be classified as scrap or discarded from inventory. It remains in physical inventory available for future half-sheet customer orders.
- A permanent, traceable `stock_transformation` record is created whenever a full sheet is split.

### C. Full-Sheet Equivalent (FSE) & Inventory Calculations
Physical inventory distinguishes full sheets and half sheets, and calculates Full-Sheet Equivalents (FSE) for management reporting:
- 1 Full Sheet = 2 Half Sheets ($1.0 \text{ FSE}$).
- 1 Half Sheet = 0.5 Full Sheet ($0.5 \text{ FSE}$).
- 2 Half Sheets = 1 Full Sheet Equivalent ($1.0 \text{ FSE}$).

$$\text{Total Full-Sheet Equivalent (FSE)} = \text{Full Sheets} + (\text{Half Sheets} \times 0.5)$$

#### Worked Transformation Example:
- **Opening Stock**: 10 Full Sheets ($10.0\text{ FSE}$), 0 Half Sheets.
- **Customer Order**: 1 Half Sheet of 5mm Clear Glass.
- **System Records**:
  1. 1 Full Sheet consumed for half-sheet preparation.
  2. 2 Half Sheets produced in stock.
  3. 1 Half Sheet dispatched/delivered to customer.
  4. 1 Half Sheet remains in physical inventory.
- **Resulting Stock**: 9 Full Sheets ($9.0\text{ FSE}$) + 1 Half Sheet ($0.5\text{ FSE}$) = **9.5 FSE remaining**.

### D. Product Specifications
Inventory and pricing are tracked per specific glass product defined by:
- **Category**: Float Glass, Tinted/Reflective, Mirror, Patterned/Obscure, Laminated/Safety.
- **Thickness**: e.g., 3mm, 4mm, 5mm, 6mm, 8mm, 10mm.
- **Color/Tint**: Clear, Bronze, Dark Grey, Euro Grey, Dark Blue, Green, Silver Mirror.
- **Standard Sheet Dimension**: Standard manufacturing pack size (e.g. $2440\text{mm} \times 1830\text{mm}$ or $3300\text{mm} \times 2140\text{mm}$) for product identification.

---

## 3. Financial & Credit Accounting Architecture

GDMS strictly separates:
1. **Invoice Total Amount ($I$)**: Total price of delivered goods based on authorized pricing.
2. **Cash Declared Received ($C_{\text{cash}}$)**: Physical cash received by field staff at delivery (an employee liability).
3. **Company M-Pesa Declared Received ($C_{\text{mpesa\_co}}$)**: Direct company Paybill/Till receipts.
4. **Employee-Personal M-Pesa Declared Received ($C_{\text{mpesa\_emp}}$)**: Funds sent to an employee's personal phone (an employee liability).
5. **Authorized Credit ($Cr_{\text{auth}}$)**: Goods released without immediate payment, within customer credit limits.
6. **Subsequent Collections ($Col$)**: Payments collected post-delivery by cash collectors.
7. **Collection Allocations ($Alloc$)**: Explicit distribution of a collection against specific open delivery invoices.
8. **Unallocated Collections ($Col_{\text{unalloc}}$)**: Customer money received but not yet tied to a specific delivery invoice.
9. **Outstanding Customer Debt ($B_{\text{cust}}$)**: Net remaining receivables owed by the customer.
10. **Accountant Reconciliation**: Verification that cash was banked or M-Pesa reached company statements.

> [!IMPORTANT]
> **Credit is an unpaid debt, NEVER money received.**  
> An unallocated collection remains visible as unapplied customer credit. It must **never** be arbitrarily applied to an invoice without an explicit allocation entry.

### A. Four Decoupled Status Dimensions
Every transaction independently tracks:
1. **Operational Status (`operational_status`)**: `draft`, `submitted`, `dispatched`, `delivered`, `cancelled`, `correction_pending`.
2. **Payment Progress Status (`payment_status`)**: `unpaid`, `partially_paid`, `fully_paid`, `credit`.
3. **Reconciliation Status (`reconciliation_status`)**: `pending_reconciliation`, `partially_reconciled`, `reconciled`, `discrepancy_flagged`.
4. **Customer Confirmation Status (`customer_confirmation_status`)**: `pending`, `confirmed`, `disputed`, `no_response`.

### B. Employee Daily Shift Liability
All cash and personal M-Pesa collected in the field constitute employee liabilities:
$$L_{\text{emp}} = \sum_{\text{shift}} C_{\text{cash}} + \sum_{\text{shift}} C_{\text{mpesa\_emp}}$$
Staff must physically remit cash and personal M-Pesa to the cashier before the shift can be formally closed.

---

## 4. User Roles and Operational Responsibilities

1. **Owner (`owner`)**: Full business oversight, master pricing, profit/audit visibility, administrative overrides.
2. **Manager (`manager`)**: Daily operations, customer management, route assignments, discount/credit approvals within limits, dispute review.
3. **Salesperson (`salesperson`)**: Customer sales, recording full/half sheet deliveries, declaring payment splits, requesting discounts/credit.
4. **Driver (`driver`)**: Vehicle operation, physical cargo sign-off, delivery location GPS stamping.
5. **Cash Collector (`cash_collector`)**: Dedicated debt collection, logging collections, allocating payments to open invoices.
6. **Accountant (`accountant`)**: Financial reconciliation of bank/Paybill statements, cashier turnover settlement, credit account audits.
7. **Customer**: External recipient interacting via Two-Way SMS to confirm or dispute delivery details.
