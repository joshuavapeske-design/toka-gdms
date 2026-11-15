// TOKA GDMS — In-Memory Demo Store for Offline & Development Simulation
import Decimal from 'decimal.js';

export interface SimulatedDelivery {
  id: string;
  deliveryReference: string;
  clientTxId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  vehicleAssignmentId: string;
  totalAmount: number;
  totalDeclaredPaid: number;
  outstandingBalance: number;
  operationalStatus: 'submitted' | 'dispatched' | 'delivered' | 'cancelled';
  paymentStatus: 'unpaid' | 'partially_paid' | 'fully_paid' | 'credit';
  customerConfirmationStatus: 'pending' | 'confirmed' | 'disputed' | 'no_response';
  smsPayload: string;
  items: Array<{
    productId: string;
    productName: string;
    sellingUnit: string;
    quantity: number;
    appliedUnitPrice: number;
    lineTotal: number;
    fse: number;
  }>;
  payments: Array<{
    channel: string;
    declaredAmount: number;
    externalRef?: string | null;
  }>;
  createdAt: string;
  createdByName: string;
  createdByRole?: string;
  vehiclePlate?: string;
  driverName?: string;
  notes?: string | null;
}

export interface SimulatedVehicle {
  id: string;
  registrationPlate: string;
  makeModel: string;
  tonnageCapacity: number;
  ownershipType: 'owned' | 'leased' | 'contracted';
  status: 'active' | 'maintenance' | 'grounded';
  isActive: boolean;
  stockLocationId: string;
  onboardStock: Array<{
    productId: string;
    productName: string;
    sku: string;
    fullSheets: number;
    halfSheets: number;
    fseTotal: number;
  }>;
}

export interface SimulatedAssignment {
  id: string;
  vehicleId: string;
  vehiclePlate: string;
  vehicleModel: string;
  routeId: string;
  routeCode: string;
  routeName: string;
  driverId: string;
  driverName: string;
  salespersonId: string;
  salespersonName: string;
  secondarySalespersonId?: string | null;
  secondarySalespersonName?: string | null;
  crewIds?: string[];
  crewNames?: string[];
  shiftDate: string;
  startedAt: string;
  endedAt: string | null;
  isActive: boolean;
  createdAt: string;
  onboardStock?: Array<{
    productId: string;
    productName: string;
    sku: string;
    fullSheets: number;
    halfSheets: number;
    fseTotal: number;
  }>;
}

export interface SimulatedDispute {
  id: string;
  deliveryId: string;
  deliveryReference: string;
  totalAmount: number;
  customerId: string;
  customerName: string;
  customerPhone: string;
  disputeCategory: string;
  customerNotes: string;
  isActive: boolean;
  investigatorName?: string | null;
  resolutionNotes?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
}

// Global in-memory storage (persists across hot-reloads via globalThis in development)
declare global {
  var __tokaDemoDeliveries: SimulatedDelivery[] | undefined;
  var __tokaDemoDisputes: SimulatedDispute[] | undefined;
  var __tokaDemoVehicles: SimulatedVehicle[] | undefined;
  var __tokaDemoAssignments: SimulatedAssignment[] | undefined;
}

const INITIAL_VEHICLES: SimulatedVehicle[] = [
  {
    id: '77777777-7777-7777-7777-777777777701',
    registrationPlate: 'KBZ 123X',
    makeModel: 'Isuzu FRR 10-Tonne Glass Carrier',
    tonnageCapacity: 10.0,
    ownershipType: 'owned',
    status: 'active',
    isActive: true,
    stockLocationId: '33333333-3333-3333-3333-333333333303',
    onboardStock: [
      {
        productId: '33333333-3333-3333-3333-333333333301',
        productName: '4mm Clear Float Glass (2440 x 1830 mm)',
        sku: 'GL-CF-4MM',
        fullSheets: 30,
        halfSheets: 4,
        fseTotal: 32.0,
      },
      {
        productId: '33333333-3333-3333-3333-333333333302',
        productName: '5mm Clear Float Glass (2440 x 1830 mm)',
        sku: 'GL-CF-5MM',
        fullSheets: 20,
        halfSheets: 2,
        fseTotal: 21.0,
      },
      {
        productId: '33333333-3333-3333-3333-333333333304',
        productName: '5mm Tinted Bronze Glass (2440 x 1830 mm)',
        sku: 'GL-TB-5MM',
        fullSheets: 10,
        halfSheets: 0,
        fseTotal: 10.0,
      },
    ],
  },
  {
    id: '77777777-7777-7777-7777-777777777702',
    registrationPlate: 'KDG 456Y',
    makeModel: 'Mitsubishi Fuso 7-Tonne Flatbed',
    tonnageCapacity: 7.0,
    ownershipType: 'owned',
    status: 'active',
    isActive: true,
    stockLocationId: '33333333-3333-3333-3333-333333333304',
    onboardStock: [
      {
        productId: '33333333-3333-3333-3333-333333333301',
        productName: '4mm Clear Float Glass (2440 x 1830 mm)',
        sku: 'GL-CF-4MM',
        fullSheets: 15,
        halfSheets: 2,
        fseTotal: 16.0,
      },
    ],
  },
];

const INITIAL_ASSIGNMENTS: SimulatedAssignment[] = [
  {
    id: '55555555-5555-5555-5555-555555555501',
    vehicleId: '77777777-7777-7777-7777-777777777701',
    vehiclePlate: 'KBZ 123X',
    vehicleModel: 'Isuzu FRR 10-Tonne Glass Carrier',
    routeId: '66666666-6666-6666-6666-666666666601',
    routeCode: 'RT-01',
    routeName: 'Industrial Area - Gikomba Express',
    driverId: '00000000-0000-0000-0000-000000000004',
    driverName: 'David Ochieng',
    salespersonId: '00000000-0000-0000-0000-000000000003',
    salespersonName: 'Grace Muthoni',
    secondarySalespersonId: '00000000-0000-0000-0000-000000000007',
    secondarySalespersonName: 'Mary Wanjiku',
    crewIds: [
      '00000000-0000-0000-0000-000000000004',
      '00000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000007',
    ],
    crewNames: ['David Ochieng (Driver)', 'Grace Muthoni (Sales Lead)', 'Mary Wanjiku (Sales 2)'],
    shiftDate: new Date().toISOString().split('T')[0],
    startedAt: new Date().toISOString(),
    endedAt: null,
    isActive: true,
    createdAt: new Date().toISOString(),
  },
];

const INITIAL_DELIVERIES: SimulatedDelivery[] = [
  {
    id: 'del-demo-001',
    deliveryReference: 'GD-202611-0010',
    clientTxId: '11111111-1111-1111-1111-111111111101',
    customerId: '44444444-4444-4444-4444-444444444401',
    customerName: 'Apex Glaziers & Aluminum Works',
    customerPhone: '+254712345678',
    vehicleAssignmentId: '55555555-5555-5555-5555-555555555501',
    totalAmount: 13000.0,
    totalDeclaredPaid: 11000.0,
    outstandingBalance: 2000.0,
    operationalStatus: 'delivered',
    paymentStatus: 'partially_paid',
    customerConfirmationStatus: 'pending',
    smsPayload:
      'TOKA GLASS: Delivery GD-202611-0010 recorded. Total: KES 13,000.00, Paid: KES 11,000.00, Due: KES 2,000.00. Reply 1 to CONFIRM or 2 to DISPUTE. Help: 0700000000',
    items: [
      {
        productId: '33333333-3333-3333-3333-333333333301',
        productName: '4mm Clear Float Glass (2440 x 1830 mm)',
        sellingUnit: 'FULL_SHEET',
        quantity: 2,
        appliedUnitPrice: 3200.0,
        lineTotal: 6400.0,
        fse: 2.0,
      },
      {
        productId: '33333333-3333-3333-3333-333333333302',
        productName: '5mm Clear Float Glass (2440 x 1830 mm)',
        sellingUnit: 'HALF_SHEET',
        quantity: 1,
        appliedUnitPrice: 2200.0,
        lineTotal: 2200.0,
        fse: 0.5,
      },
      {
        productId: '33333333-3333-3333-3333-333333333303',
        productName: '6mm Clear Float Glass (2440 x 1830 mm)',
        sellingUnit: 'FULL_SHEET',
        quantity: 1,
        appliedUnitPrice: 5200.0,
        lineTotal: 5200.0,
        fse: 1.0,
      },
    ],
    payments: [
      { channel: 'cash', declaredAmount: 4000.0 },
      { channel: 'mpesa_company_till', declaredAmount: 5000.0, externalRef: 'QWE123RTY' },
      { channel: 'mpesa_employee_phone', declaredAmount: 2000.0, externalRef: 'EMP987XYZ' },
    ],
    createdAt: new Date(Date.now() - 3600000 * 3).toISOString(),
    createdByName: 'Grace Muthoni (Salesperson)',
    notes: 'Delivered to Road C workshop.',
  },
  {
    id: 'del-demo-002',
    deliveryReference: 'GD-202611-0011',
    clientTxId: '11111111-1111-1111-1111-111111111102',
    customerId: '44444444-4444-4444-4444-444444444402',
    customerName: 'Nairobi Modern Hardware',
    customerPhone: '+254723456789',
    vehicleAssignmentId: '55555555-5555-5555-5555-555555555501',
    totalAmount: 16000.0,
    totalDeclaredPaid: 16000.0,
    outstandingBalance: 0.0,
    operationalStatus: 'delivered',
    paymentStatus: 'fully_paid',
    customerConfirmationStatus: 'confirmed',
    smsPayload:
      'TOKA GLASS: Delivery GD-202611-0011 recorded. Total: KES 16,000.00, Paid: KES 16,000.00, Due: KES 0.00. Reply 1 to CONFIRM or 2 to DISPUTE. Help: 0700000000',
    items: [
      {
        productId: '33333333-3333-3333-3333-333333333301',
        productName: '4mm Clear Float Glass (2440 x 1830 mm)',
        sellingUnit: 'FULL_SHEET',
        quantity: 5,
        appliedUnitPrice: 3200.0,
        lineTotal: 16000.0,
        fse: 5.0,
      },
    ],
    payments: [{ channel: 'mpesa_company_till', declaredAmount: 16000.0, externalRef: 'MPESA9922' }],
    createdAt: new Date(Date.now() - 3600000 * 5).toISOString(),
    createdByName: 'Grace Muthoni (Salesperson)',
    notes: 'Paid in full via company Till.',
  },
];

const INITIAL_DISPUTES: SimulatedDispute[] = [
  {
    id: 'disp-demo-001',
    deliveryId: 'del-demo-003',
    deliveryReference: 'GD-202611-0008',
    totalAmount: 10400.0,
    customerId: '44444444-4444-4444-4444-444444444403',
    customerName: 'Westlands Premium Interiors',
    customerPhone: '+254734567890',
    disputeCategory: 'damaged_glass_or_quality',
    customerNotes: 'One 6mm sheet arrived chipped on the top right edge.',
    isActive: true,
    investigatorName: null,
    resolutionNotes: null,
    resolvedAt: null,
    createdAt: new Date(Date.now() - 3600000 * 12).toISOString(),
  },
];

if (!globalThis.__tokaDemoDeliveries) {
  globalThis.__tokaDemoDeliveries = [...INITIAL_DELIVERIES];
}

if (!globalThis.__tokaDemoDisputes) {
  globalThis.__tokaDemoDisputes = [...INITIAL_DISPUTES];
}

if (!globalThis.__tokaDemoVehicles) {
  globalThis.__tokaDemoVehicles = [...INITIAL_VEHICLES];
}

if (!globalThis.__tokaDemoAssignments) {
  globalThis.__tokaDemoAssignments = [...INITIAL_ASSIGNMENTS];
}

export const demoStore = {
  getDeliveries(): SimulatedDelivery[] {
    return globalThis.__tokaDemoDeliveries || [];
  },

  addDelivery(del: SimulatedDelivery) {
    if (!globalThis.__tokaDemoDeliveries) globalThis.__tokaDemoDeliveries = [];
    globalThis.__tokaDemoDeliveries.unshift(del);

    // Also deduct stock from the assigned vehicle if present
    if (del.vehicleAssignmentId) {
      const assignment = this.getAssignments().find((a) => a.id === del.vehicleAssignmentId);
      if (assignment) {
        const vehicles = this.getVehicles();
        const vehicle = vehicles.find((v) => v.id === assignment.vehicleId);
        if (vehicle && vehicle.onboardStock) {
          for (const item of del.items) {
            const stockItem = vehicle.onboardStock.find((s) => s.productId === item.productId);
            if (stockItem) {
              if (item.sellingUnit === 'FULL_SHEET') {
                stockItem.fullSheets = Math.max(0, stockItem.fullSheets - item.quantity);
              } else {
                stockItem.halfSheets = Math.max(0, stockItem.halfSheets - item.quantity);
              }
              stockItem.fseTotal = stockItem.fullSheets + stockItem.halfSheets * 0.5;
            }
          }
        }
      }
    }
  },

  getVehicles(): SimulatedVehicle[] {
    return globalThis.__tokaDemoVehicles || [];
  },

  addVehicle(v: {
    registrationPlate: string;
    makeModel: string;
    tonnageCapacity: number;
    ownershipType?: 'owned' | 'leased' | 'contracted';
  }): SimulatedVehicle {
    if (!globalThis.__tokaDemoVehicles) globalThis.__tokaDemoVehicles = [];
    const newVeh: SimulatedVehicle = {
      id: `veh-${Date.now()}`,
      registrationPlate: v.registrationPlate.toUpperCase(),
      makeModel: v.makeModel,
      tonnageCapacity: v.tonnageCapacity,
      ownershipType: v.ownershipType || 'owned',
      status: 'active',
      isActive: true,
      stockLocationId: `loc-${Date.now()}`,
      onboardStock: [
        {
          productId: '33333333-3333-3333-3333-333333333301',
          productName: '4mm Clear Float Glass (2440 x 1830 mm)',
          sku: 'GL-CF-4MM',
          fullSheets: 0,
          halfSheets: 0,
          fseTotal: 0,
        },
        {
          productId: '33333333-3333-3333-3333-333333333302',
          productName: '5mm Clear Float Glass (2440 x 1830 mm)',
          sku: 'GL-CF-5MM',
          fullSheets: 0,
          halfSheets: 0,
          fseTotal: 0,
        },
      ],
    };
    globalThis.__tokaDemoVehicles.push(newVeh);
    return newVeh;
  },

  loadVehicleStock(load: {
    vehicleId: string;
    productId: string;
    fullSheets: number;
    halfSheets: number;
    notes?: string;
  }) {
    const vehicles = this.getVehicles();
    const veh = vehicles.find((v) => v.id === load.vehicleId);
    if (!veh) throw new Error('Vehicle not found');

    if (!veh.onboardStock) veh.onboardStock = [];
    let item = veh.onboardStock.find((s) => s.productId === load.productId);
    if (!item) {
      item = {
        productId: load.productId,
        productName: 'Glass Product',
        sku: 'GL-SPEC',
        fullSheets: 0,
        halfSheets: 0,
        fseTotal: 0,
      };
      veh.onboardStock.push(item);
    }
    item.fullSheets += load.fullSheets;
    item.halfSheets += load.halfSheets;
    item.fseTotal = item.fullSheets + item.halfSheets * 0.5;
    return veh;
  },

  getAssignments(): SimulatedAssignment[] {
    return globalThis.__tokaDemoAssignments || [];
  },

  addAssignment(assign: SimulatedAssignment) {
    if (!globalThis.__tokaDemoAssignments) globalThis.__tokaDemoAssignments = [];
    globalThis.__tokaDemoAssignments.unshift(assign);
  },

  getDisputes(): SimulatedDispute[] {
    return globalThis.__tokaDemoDisputes || [];
  },

  resolveDispute(disputeId: string, notes: string): boolean {
    const list = globalThis.__tokaDemoDisputes || [];
    const item = list.find((d) => d.id === disputeId);
    if (!item) return false;
    item.isActive = false;
    item.resolutionNotes = notes;
    item.resolvedAt = new Date().toISOString();
    item.investigatorName = 'Owner / Manager';
    return true;
  },

  processInboundSms(senderPhone: string, text: string): {
    status: 'confirmed' | 'disputed' | 'unmatched';
    deliveryReference?: string;
    message: string;
  } {
    const deliveries = globalThis.__tokaDemoDeliveries || [];
    const normalizedPhone = senderPhone.replace(/[\s-]/g, '');

    // Match delivery by phone (pending first) or by explicit reference in message
    const refMatch = text.match(/GD-\d{6}-\d{4}/i);
    let matchedDelivery: SimulatedDelivery | undefined;

    if (refMatch) {
      const explicitRef = refMatch[0].toUpperCase();
      matchedDelivery = deliveries.find(
        (d) => d.deliveryReference === explicitRef && (d.customerPhone === normalizedPhone || !normalizedPhone)
      );
    }

    if (!matchedDelivery) {
      matchedDelivery = deliveries.find(
        (d) => d.customerPhone === normalizedPhone && d.customerConfirmationStatus === 'pending'
      );
    }

    if (!matchedDelivery) {
      matchedDelivery = deliveries.find((d) => d.customerPhone === normalizedPhone);
    }

    if (!matchedDelivery) {
      return {
        status: 'unmatched',
        message: 'No matching delivery found for phone number ' + senderPhone,
      };
    }

    const cleanText = text.trim().toLowerCase();
    const isConfirm = cleanText === '1' || cleanText.startsWith('1 ') || cleanText.includes('confirm') || cleanText.includes('yes');
    const isDispute = cleanText === '2' || cleanText.startsWith('2 ') || cleanText.includes('dispute') || cleanText.includes('no');

    if (isConfirm) {
      matchedDelivery.customerConfirmationStatus = 'confirmed';
      return {
        status: 'confirmed',
        deliveryReference: matchedDelivery.deliveryReference,
        message: `Delivery ${matchedDelivery.deliveryReference} successfully confirmed by customer.`,
      };
    }

    if (isDispute) {
      matchedDelivery.customerConfirmationStatus = 'disputed';

      // Parse dispute category/reason
      let category = 'wrong_items_or_quantities';
      if (cleanText.includes('broken') || cleanText.includes('chip') || cleanText.includes('damage')) {
        category = 'damaged_glass_or_quality';
      } else if (cleanText.includes('price') || cleanText.includes('overcharge') || cleanText.includes('amount')) {
        category = 'incorrect_pricing_or_discount';
      } else if (cleanText.includes('paid') || cleanText.includes('receipt')) {
        category = 'already_paid_or_disputed_payment';
      }

      // Add to simulated disputes
      const newDispute: SimulatedDispute = {
        id: `disp-${Date.now()}`,
        deliveryId: matchedDelivery.id,
        deliveryReference: matchedDelivery.deliveryReference,
        totalAmount: matchedDelivery.totalAmount,
        customerId: matchedDelivery.customerId,
        customerName: matchedDelivery.customerName,
        customerPhone: matchedDelivery.customerPhone,
        disputeCategory: category,
        customerNotes: text,
        isActive: true,
        investigatorName: null,
        resolutionNotes: null,
        resolvedAt: null,
        createdAt: new Date().toISOString(),
      };

      if (!globalThis.__tokaDemoDisputes) globalThis.__tokaDemoDisputes = [];
      globalThis.__tokaDemoDisputes.unshift(newDispute);

      return {
        status: 'disputed',
        deliveryReference: matchedDelivery.deliveryReference,
        message: `Delivery ${matchedDelivery.deliveryReference} disputed by customer and recorded in Disputes portal.`,
      };
    }

    return {
      status: 'unmatched',
      deliveryReference: matchedDelivery.deliveryReference,
      message: 'Unrecognized reply format. Please reply 1 to CONFIRM or 2 to DISPUTE.',
    };
  },
};

