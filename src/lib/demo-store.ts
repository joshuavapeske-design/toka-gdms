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

const INITIAL_VEHICLES: SimulatedVehicle[] = [];

const INITIAL_ASSIGNMENTS: SimulatedAssignment[] = [];

const INITIAL_DELIVERIES: SimulatedDelivery[] = [];

const INITIAL_DISPUTES: SimulatedDispute[] = [];

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

