// TOKA GDMS — Domain Type Definitions (Strict Mode)

export type UserRole =
  | 'owner'
  | 'manager'
  | 'salesperson'
  | 'driver'
  | 'cash_collector'
  | 'accountant';

// Confirmed Sales Model: Full Sheet (default), Half Sheet (by customer order only)
export type SellingUnit = 'FULL_SHEET' | 'HALF_SHEET';

export type OperationalStatus =
  | 'draft'
  | 'submitted'
  | 'dispatched'
  | 'delivered'
  | 'cancelled'
  | 'correction_pending';

export type PaymentStatus =
  | 'unpaid'
  | 'partially_paid'
  | 'fully_paid'
  | 'credit';

export type ReconciliationStatus =
  | 'pending_reconciliation'
  | 'partially_reconciled'
  | 'reconciled'
  | 'discrepancy_flagged';

export type CustomerConfirmationStatus =
  | 'pending'
  | 'confirmed'
  | 'disputed'
  | 'no_response';

export type PaymentChannel =
  | 'cash'
  | 'mpesa_company_till'
  | 'mpesa_employee_phone'
  | 'bank_transfer'
  | 'credit';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export type StockLocationType = 'warehouse' | 'truck' | 'transit';

export type MovementType =
  | 'stock_receipt'
  | 'dispatch_to_truck'
  | 'delivery_to_customer'
  | 'return_from_truck'
  | 'broken_or_damaged'
  | 'split_full_to_half'
  | 'authorized_adjustment';

export type DisputeCategory =
  | 'wrong_items_or_quantities'
  | 'incorrect_price'
  | 'wrong_payment_declared'
  | 'delivery_never_received'
  | 'damaged_glass_uncredited'
  | 'other';

export type InboundSmsStatus =
  | 'received'
  | 'processed'
  | 'ambiguous'
  | 'invalid_reference'
  | 'unmatched'
  | 'failed';

// Domain Entities
export interface Profile {
  id: string;
  fullName: string;
  phoneNumber: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Customer {
  id: string;
  accountNumber: string;
  name: string;
  primaryPhone: string;
  altPhone?: string | null;
  deliveryArea: string;
  defaultGpsLat?: number | null;
  defaultGpsLng?: number | null;
  isCreditEligible: boolean;
  creditLimit: number;
  currentBalance?: number;
  isActive: boolean;
  createdBy: string;
  createdByName?: string;
  createdByRole?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  categoryId: string;
  categoryName?: string;
  sku: string;
  name: string;
  thicknessMm: number;
  color: string;
  standardDimensionLabel: string;
  standardFullSheetPrice: number;
  standardHalfSheetPrice: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Vehicle {
  id: string;
  registrationPlate: string;
  makeModel: string;
  tonnageCapacity: number;
  ownershipType?: 'owned' | 'leased' | 'contracted';
  status: 'active' | 'maintenance' | 'grounded';
  externalTrackerId?: string | null;
  isActive: boolean;
  createdAt: string;
  stockLocationId?: string;
  onboardStock?: StockBalance[];
}

export interface Route {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface VehicleAssignment {
  id: string;
  vehicleId: string;
  vehiclePlate?: string;
  vehicleRegistrationPlate?: string;
  vehicleModel?: string;
  routeId: string;
  routeCode?: string;
  routeName?: string;
  driverId: string;
  driverName?: string;
  salespersonId: string;
  salespersonName?: string;
  secondarySalespersonId?: string | null;
  secondarySalespersonName?: string | null;
  crewIds?: string[];
  crewNames?: string[];
  shiftDate: string;
  startedAt: string;
  endedAt?: string | null;
  isActive: boolean;
  createdAt: string;
  onboardStock?: StockBalance[];
}

export interface DeliveryItem {
  id?: string;
  deliveryId?: string;
  productId: string;
  productName?: string;
  sku?: string;
  sellingUnit: SellingUnit;
  quantity: number;
  fullSheetEquivalent: number;
  officialUnitPrice: number;
  appliedUnitPrice: number;
  isSpecialPrice: boolean;
  priceApprovalId?: string | null;
  lineTotal: number;
  createdAt?: string;
}

export interface PaymentDeclaration {
  id?: string;
  deliveryId?: string;
  channel: PaymentChannel;
  declaredAmount: number;
  declaredBy: string;
  externalRef?: string | null;
  notes?: string | null;
  createdAt?: string;
}

export interface Delivery {
  id: string;
  deliveryReference: string;
  clientTxId: string;
  customerId: string;
  customerName?: string;
  customerPhone?: string;
  createdBy: string;
  createdByName?: string;
  createdByRole?: string;
  vehicleAssignmentId: string;
  vehiclePlate?: string;
  driverName?: string;
  
  operationalStatus: OperationalStatus;
  paymentStatus: PaymentStatus;
  reconciliationStatus: ReconciliationStatus;
  customerConfirmationStatus: CustomerConfirmationStatus;

  subtotalAmount: number;
  discountAmount: number;
  totalAmount: number;
  totalDeclaredPaid: number;
  outstandingBalance: number;

  deliveryLat?: number | null;
  deliveryLng?: number | null;
  gpsAccuracyM?: number | null;
  deviceCapturedAt?: string | null;
  submittedAt?: string | null;
  syncedAt: string;
  isOfflineSubmission: boolean;
  
  notes?: string | null;
  items?: DeliveryItem[];
  payments?: PaymentDeclaration[];
  createdAt: string;
  updatedAt: string;
}

export interface Collection {
  id: string;
  collectionReference: string;
  customerId: string;
  customerName?: string;
  collectedBy: string;
  collectedByName?: string;
  channel: PaymentChannel;
  totalAmount: number;
  allocatedAmount: number;
  unallocatedAmount: number;
  externalRef?: string | null;
  notes?: string | null;
  collectionDate: string;
  isFullyAllocated: boolean;
  reconciledBy?: string | null;
  reconciledAt?: string | null;
  createdAt: string;
}

export interface PaymentAllocation {
  id: string;
  collectionId: string;
  deliveryId: string;
  deliveryReference?: string;
  allocatedAmount: number;
  allocatedBy: string;
  createdAt: string;
}

export interface StockTransformation {
  id: string;
  productId: string;
  productName?: string;
  stockLocationId: string;
  locationName?: string;
  fullSheetsConsumed: number;
  halfSheetsProduced: number;
  operatorId: string;
  operatorName?: string;
  notes?: string | null;
  createdAt: string;
}

export interface StockLocation {
  id: string;
  name: string;
  locationType: StockLocationType;
  vehicleId?: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface StockBalance {
  productId: string;
  productName: string;
  sku: string;
  locationId: string;
  locationName: string;
  fullSheets: number;
  halfSheets: number;
  fseTotal: number; // fullSheets + (halfSheets * 0.5)
}

export interface EmployeeTurnover {
  id: string;
  employeeId: string;
  employeeName?: string;
  shiftDate: string;
  cashDeclared: number;
  personalMpesaDeclared: number;
  cashRemitted: number;
  mpesaForwarded: number;
  variance: number;
  settledWithCashierId?: string | null;
  settledAt?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface CustomerDispute {
  id: string;
  deliveryId: string;
  deliveryReference?: string;
  customerId: string;
  customerName?: string;
  inboundSmsId?: string | null;
  disputeCategory?: DisputeCategory | null;
  customerNotes?: string | null;
  isActive: boolean;
  investigatedBy?: string | null;
  resolutionNotes?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
}
