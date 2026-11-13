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
export async function syncPendingDeliveries(): Promise<SyncResult> {
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

      const data = await response.json();

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
          /INSUFFICIENT_STOCK|INVALID_ASSIGNMENT|INACTIVE_ASSIGNMENT|UNAUTHORIZED_SHIFT|CREDIT_NOT_AUTHORIZED|CREDIT_LIMIT_EXCEEDED|UNAUTHORIZED_PRICE|DISCOUNT_NOT_AUTHORIZED|VEHICLE_STOCK_LOCATION_NOT_FOUND|CUSTOMER_NOT_FOUND|PRODUCT_NOT_FOUND/i.test(errorMsg);
        await updateDeliverySyncStatus(delivery.clientTxId, needsReview ? 'needs_review' : 'failed', errorMsg);
        result.failureCount++;
        result.errors.push({ clientTxId: delivery.clientTxId, error: needsReview ? `Needs review: ${errorMsg}` : errorMsg });
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
