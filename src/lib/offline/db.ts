// TOKA GDMS — IndexedDB Local Storage Wrapper (idb)

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Customer, Product, VehicleAssignment, DeliveryItem, PaymentDeclaration } from '@/types';

export interface QueuedOfflineDelivery {
  clientTxId: string;
  deliveryReference: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  vehicleAssignmentId: string;
  vehicleId?: string;
  employeeId?: string;
  items: DeliveryItem[];
  payments: PaymentDeclaration[];
  subtotalAmount: number;
  discountAmount: number;
  totalAmount: number;
  totalDeclaredPaid: number;
  outstandingBalance: number;
  notes?: string | null;
  deliveryLat?: number | null;
  deliveryLng?: number | null;
  gpsAccuracyM?: number | null;
  deviceCapturedAt: string;
  isOfflineSubmission?: boolean;
  syncStatus: 'local_saved' | 'pending' | 'syncing' | 'synced' | 'needs_review' | 'failed';
  retryCount: number;
  errorMessage?: string;
  syncedAt?: string;
}

export interface OfflineLocationSample {
  id: string;
  latitude: number;
  longitude: number;
  accuracyM: number;
  capturedAt: string;
  synced: boolean;
}

interface TokaGdmsDbSchema extends DBSchema {
  outbox: {
    key: string; // clientTxId
    value: QueuedOfflineDelivery;
    indexes: { 'by-status': string };
  };
  cachedCustomers: {
    key: string; // id
    value: Customer;
  };
  cachedProducts: {
    key: string; // id
    value: Product;
  };
  activeShift: {
    key: string; // 'current'
    value: VehicleAssignment;
  };
  locationQueue: {
    key: string; // id
    value: OfflineLocationSample;
  };
}

const DB_NAME = 'toka_gdms_offline_db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<TokaGdmsDbSchema>> | null = null;

export function getOfflineDb(): Promise<IDBPDatabase<TokaGdmsDbSchema>> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('IndexedDB is only available in browser environments.'));
  }

  if (!dbPromise) {
    dbPromise = openDB<TokaGdmsDbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Delivery Outbox Store
        if (!db.objectStoreNames.contains('outbox')) {
          const outboxStore = db.createObjectStore('outbox', { keyPath: 'clientTxId' });
          outboxStore.createIndex('by-status', 'syncStatus');
        }

        // Cached Customers Store
        if (!db.objectStoreNames.contains('cachedCustomers')) {
          db.createObjectStore('cachedCustomers', { keyPath: 'id' });
        }

        // Cached Products Store
        if (!db.objectStoreNames.contains('cachedProducts')) {
          db.createObjectStore('cachedProducts', { keyPath: 'id' });
        }

        // Active Shift Context Store
        if (!db.objectStoreNames.contains('activeShift')) {
          db.createObjectStore('activeShift');
        }

        // Offline Location Telemetry Queue
        if (!db.objectStoreNames.contains('locationQueue')) {
          db.createObjectStore('locationQueue', { keyPath: 'id' });
        }
      },
    });
  }

  return dbPromise;
}

/**
 * Enqueues a newly created delivery into the IndexedDB outbox
 */
export async function queueOfflineDelivery(delivery: QueuedOfflineDelivery): Promise<void> {
  const db = await getOfflineDb();
  await db.put('outbox', delivery);
}

/**
 * Retrieves all pending outbox deliveries awaiting server synchronization
 */
export async function getPendingDeliveries(): Promise<QueuedOfflineDelivery[]> {
  const db = await getOfflineDb();
  return db.getAllFromIndex('outbox', 'by-status', 'pending');
}

/**
 * Updates synchronization status of a queued delivery
 */
export async function updateDeliverySyncStatus(
  clientTxId: string,
  status: 'local_saved' | 'pending' | 'syncing' | 'synced' | 'failed',
  errorMessage?: string
): Promise<void> {
  const db = await getOfflineDb();
  const tx = db.transaction('outbox', 'readwrite');
  const store = tx.objectStore('outbox');
  const item = await store.get(clientTxId);
  if (item) {
    item.syncStatus = status;
    if (errorMessage) item.errorMessage = errorMessage;
    if (status === 'synced') item.syncedAt = new Date().toISOString();
    await store.put(item);
  }
  await tx.done;
}

/**
 * Cache customer catalog for offline field lookup
 */
export async function cacheCustomers(customers: Customer[]): Promise<void> {
  const db = await getOfflineDb();
  const tx = db.transaction('cachedCustomers', 'readwrite');
  for (const c of customers) {
    await tx.store.put(c);
  }
  await tx.done;
}

/**
 * Cache product catalog with full-sheet and half-sheet pricing
 */
export async function cacheProducts(products: Product[]): Promise<void> {
  const db = await getOfflineDb();
  const tx = db.transaction('cachedProducts', 'readwrite');
  for (const p of products) {
    await tx.store.put(p);
  }
  await tx.done;
}
