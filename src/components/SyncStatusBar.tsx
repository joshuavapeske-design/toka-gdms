'use client';

import { useEffect, useState } from 'react';
import { Wifi, WifiOff, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { getOfflineOutboxStatusCounts } from '@/lib/offline/db';
import { syncPendingDeliveries, initAutoSync } from '@/lib/offline/sync';

export function SyncStatusBar() {
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [needsReviewCount, setNeedsReviewCount] = useState(0);
  const [localSavedCount, setLocalSavedCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncMessage, setLastSyncMessage] = useState<string | null>(null);

  useEffect(() => {
    setIsOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);

    const checkPending = async () => {
      try {
        const counts = await getOfflineOutboxStatusCounts();
        setPendingCount(counts.pending);
        setNeedsReviewCount(counts.needsReview);
        setLocalSavedCount(counts.localSaved);
      } catch {
        // Ignored if indexedDB is initializing
      }
    };

    checkPending();
    const interval = setInterval(checkPending, 5000);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const cleanupAutoSync = initAutoSync((result) => {
      checkPending();
      if (result.successCount > 0) {
        setLastSyncMessage(`Synced ${result.successCount} deliveries.`);
        setTimeout(() => setLastSyncMessage(null), 4000);
      }
    });

    return () => {
      clearInterval(interval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (cleanupAutoSync) cleanupAutoSync();
    };
  }, []);

  const handleManualSync = async () => {
    if (!isOnline || isSyncing) return;
    setIsSyncing(true);
    try {
      const res = await syncPendingDeliveries();
      const counts = await getOfflineOutboxStatusCounts();
      setPendingCount(counts.pending);
      setNeedsReviewCount(counts.needsReview);
      setLocalSavedCount(counts.localSaved);
      if (res.successCount > 0) {
        setLastSyncMessage(`Synced ${res.successCount} delivery records.`);
      } else if (res.failureCount > 0) {
        setLastSyncMessage(`Sync failed: ${res.errors[0]?.error || 'Error'}`);
      }
      setTimeout(() => setLastSyncMessage(null), 4000);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="bg-slate-900 text-white text-xs px-4 py-2 flex items-center justify-between border-b border-slate-800">
      <div className="flex items-center gap-2">
        {isOnline ? (
          <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
            <Wifi className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Connected</span>
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-amber-400 font-medium">
            <WifiOff className="w-3.5 h-3.5" />
            <span>Working Offline</span>
          </span>
        )}

        {pendingCount > 0 && (
          <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full font-semibold">
            {pendingCount} Pending Sync
          </span>
        )}
        {needsReviewCount > 0 && (
          <span className="bg-red-500/20 text-red-300 border border-red-500/30 px-2 py-0.5 rounded-full font-semibold">
            {needsReviewCount} Needs Review
          </span>
        )}
        {localSavedCount > 0 && (
          <span className="bg-slate-700 text-slate-200 border border-slate-600 px-2 py-0.5 rounded-full font-semibold">
            {localSavedCount} Browser Only
          </span>
        )}

        {lastSyncMessage && (
          <span className="text-slate-300 italic hidden md:inline">
            {lastSyncMessage}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {pendingCount > 0 && isOnline && (
          <button
            onClick={handleManualSync}
            disabled={isSyncing}
            className="flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white rounded font-medium transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
          </button>
        )}
        <span className="text-slate-400 font-mono">TOKA GDMS v0.1</span>
      </div>
    </div>
  );
}
