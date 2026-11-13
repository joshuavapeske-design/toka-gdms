// TOKA GDMS — Offline-to-Server Synchronization Engine

import { getPendingDeliveries, updateDeliverySyncStatus, type QueuedOfflineDelivery } from './db';

export interface SyncResult {
  totalProcessed: number;
  successCount: number;
  failureCount: number;
  errors: Array<{ clientTxId: string; error: string }>;
}

/**
 * Idempotently syncs all pending offline deliveries to the server
 */
let activeSync: Promise<SyncResult> | null = null;

export async function syncPendingDeliveries(): Promise<SyncResult> {
  if (activeSync) return activeSync;
  const current = performSync();
  activeSync = current;
  try {
    return await current;
  } finally {
    if (activeSync === current) activeSync = null;
  }
}

async function performSync(): Promise<SyncResult> {
  const pending = await getPendingDeliveries();
  const result: SyncResult = {
    totalProcessed: pending.length,
    successCount: 0,
    failureCount: 0,
    errors: [],
  };

  if (pending.length === 0) return result;

  for (const delivery of pending) {
    try {
      await updateDeliverySyncStatus(delivery.clientTxId, 'syncing');

      const response = await fetch('/api/sync/deliveries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(delivery),
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok && data.success && data.simulated) {
        const message = 'Demo simulation only: this delivery was not persisted to the business database.';
        await updateDeliverySyncStatus(delivery.clientTxId, 'local_saved', message);
        result.failureCount++;
        result.errors.push({ clientTxId: delivery.clientTxId, error: message });
      } else if (response.ok && data.success) {
        await updateDeliverySyncStatus(delivery.clientTxId, 'synced');
        result.successCount++;
      } else {
        const errorMsg = data.error || `Sync failed with HTTP ${response.status}`;
        const needsReview =
          response.status === 409 ||
          /INSUFFICIENT_STOCK|INVALID_ASSIGNMENT|INACTIVE_ASSIGNMENT|UNAUTHORIZED_SHIFT|SHIFT_OUTSIDE_CAPTURE_WINDOW|VEHICLE_UNAVAILABLE|SHIFT_CONFLICT|INVALID_SHIFT_START|INVALID_SHIFT_END|CREDIT_NOT_AUTHORIZED|CREDIT_LIMIT_EXCEEDED|UNAUTHORIZED_PRICE|DISCOUNT_NOT_AUTHORIZED|VEHICLE_STOCK_LOCATION_NOT_FOUND|CUSTOMER_NOT_FOUND|PRODUCT_NOT_FOUND/i.test(errorMsg);
        const retryable =
          response.status === 408 ||
          response.status === 425 ||
          response.status === 429 ||
          response.status === 401 ||
          response.status === 403 ||
          response.status >= 500;
        const nextStatus = needsReview ? 'needs_review' : retryable ? 'pending' : 'failed';
        await updateDeliverySyncStatus(delivery.clientTxId, nextStatus, errorMsg);
        result.failureCount++;
        result.errors.push({
          clientTxId: delivery.clientTxId,
          error: needsReview ? `Needs review: ${errorMsg}` : retryable ? `Retry pending: ${errorMsg}` : errorMsg,
        });
      }
    } catch (err: any) {
      const errorMsg = err.message || 'Network request failed';
      await updateDeliverySyncStatus(delivery.clientTxId, 'pending', errorMsg);
      result.failureCount++;
      result.errors.push({ clientTxId: delivery.clientTxId, error: errorMsg });
    }
  }

  return result;
}

/**
 * Initializes automatic synchronization listeners when network connectivity returns
 */
export function initAutoSync(onSyncComplete?: (result: SyncResult) => void) {
  if (typeof window === 'undefined') return;

  const handleOnline = async () => {
    console.log('[GDMS Offline Sync] Network connection restored. Initiating automatic sync...');
    try {
      const result = await syncPendingDeliveries();
      if (onSyncComplete) onSyncComplete(result);
    } catch (err) {
      console.error('[GDMS Offline Sync] Auto-sync failed:', err);
    }
  };

  window.addEventListener('online', handleOnline);

  return () => {
    window.removeEventListener('online', handleOnline);
  };
}
