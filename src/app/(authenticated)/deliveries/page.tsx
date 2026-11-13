'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Truck, PlusCircle, Filter, Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import { formatKES } from '@/lib/decimal';
import { getOfflineDb, type QueuedOfflineDelivery } from '@/lib/offline/db';

interface DeliveryRecord {
  id: string;
  deliveryReference: string;
  customerName: string;
  totalAmount: number;
  totalDeclaredPaid: number;
  outstandingBalance: number;
  operationalStatus: string;
  paymentStatus: string;
  customerConfirmationStatus: string;
  createdAt: string;
  createdByName: string;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-600 border-slate-200',
    submitted: 'bg-blue-50 text-blue-700 border-blue-200',
    dispatched: 'bg-purple-50 text-purple-700 border-purple-200',
    delivered: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    cancelled: 'bg-red-50 text-red-600 border-red-200',
    correction_pending: 'bg-amber-50 text-amber-700 border-amber-200',
    unpaid: 'bg-red-50 text-red-600 border-red-200',
    partially_paid: 'bg-amber-50 text-amber-700 border-amber-200',
    fully_paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    credit: 'bg-orange-50 text-orange-700 border-orange-200',
    pending: 'bg-slate-100 text-slate-600 border-slate-200',
    confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    disputed: 'bg-red-50 text-red-600 border-red-200',
    no_response: 'bg-slate-50 text-slate-500 border-slate-200',
  };

  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded border capitalize ${styles[status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export default function DeliveriesPage() {
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [localRecords, setLocalRecords] = useState<QueuedOfflineDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [operationalFilter, setOperationalFilter] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');

  const loadDeliveries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/data/deliveries', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Unable to load delivery records.');
      }
      setDeliveries(result.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load delivery records.');
    }

    try {
      const db = await getOfflineDb();
      const records = await db.getAll('outbox');
      setLocalRecords(records.filter((record) => record.syncStatus !== 'synced')
        .sort((a, b) => b.deviceCapturedAt.localeCompare(a.deviceCapturedAt)));
    } catch {
      // IndexedDB is optional; remote delivery records remain available without it.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDeliveries();
  }, [loadDeliveries]);

  const filteredDeliveries = useMemo(() => deliveries.filter((delivery) => {
    if (operationalFilter && delivery.operationalStatus !== operationalFilter) return false;
    if (paymentFilter && delivery.paymentStatus !== paymentFilter) return false;
    if (dateFilter && new Date(delivery.createdAt).toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' }) !== dateFilter) return false;
    return true;
  }), [deliveries, operationalFilter, paymentFilter, dateFilter]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
            <Truck className="w-5 h-5 text-blue-600" />
            Deliveries
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">Delivery records visible to your account</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void loadDeliveries()} disabled={loading} className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-700 text-xs font-semibold rounded-lg disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <Link href="/deliveries/new" className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg shadow-sm transition">
            <PlusCircle className="w-4 h-4" /> New Delivery
          </Link>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-3 mb-4 flex flex-wrap gap-2 items-center">
        <Filter className="w-4 h-4 text-slate-400" />
        <select aria-label="Filter by delivery status" value={operationalFilter} onChange={(event) => setOperationalFilter(event.target.value)} className="text-xs px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md">
          <option value="">All Delivery Statuses</option>
          <option value="submitted">Submitted</option>
          <option value="dispatched">Dispatched</option>
          <option value="delivered">Delivered</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select aria-label="Filter by payment status" value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)} className="text-xs px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md">
          <option value="">All Payment Statuses</option>
          <option value="unpaid">Unpaid</option>
          <option value="partially_paid">Partially Paid</option>
          <option value="fully_paid">Fully Paid</option>
          <option value="credit">Credit</option>
        </select>
        <input aria-label="Filter by delivery date" type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} className="text-xs px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md" />
        <span className="text-[10px] text-slate-400 ml-auto">{filteredDeliveries.length} records</span>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 p-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      {localRecords.length > 0 && (
        <section className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-bold uppercase tracking-wide text-slate-600">This Device — Not Yet in the Business Database</h2>
            <span className="text-[10px] text-slate-400">{localRecords.length} local record{localRecords.length === 1 ? '' : 's'}</span>
          </div>
          <div className="space-y-2">
            {localRecords.map((record) => {
              const label = record.syncStatus === 'local_saved' ? 'Browser only' :
                record.syncStatus === 'needs_review' ? 'Needs review' :
                record.syncStatus === 'failed' ? 'Sync failed' : 'Pending sync';
              const tone = record.syncStatus === 'needs_review' || record.syncStatus === 'failed'
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-amber-50 border-amber-200 text-amber-800';
              return (
                <div key={record.clientTxId} className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-slate-900">{record.deliveryReference}</div>
                      <div className="text-xs text-slate-600 mt-0.5">{record.customerName || 'Customer not named'}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">Captured {new Date(record.deviceCapturedAt).toLocaleString('en-KE')}</div>
                    </div>
                    <div className="sm:text-right">
                      <div className="text-sm font-extrabold text-slate-900">{formatKES(record.totalAmount)}</div>
                      <span className={`inline-flex mt-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${tone}`}>{label}</span>
                    </div>
                  </div>
                  <p className="mt-2 text-[10px] text-slate-500">
                    {record.errorMessage || (record.syncStatus === 'local_saved'
                      ? 'Saved in this browser only. It has not been recorded in the shared TOKA database.'
                      : 'This record remains in the local outbox and has not been confirmed as synchronized.')}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto" />
          <p className="text-sm text-slate-500 mt-3">Loading delivery records...</p>
        </div>
      ) : filteredDeliveries.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Truck className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-700">{deliveries.length ? 'No Matching Deliveries' : 'No Deliveries Yet'}</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            {deliveries.length ? 'Change or clear the filters to see other records.' : 'Submitted deliveries will appear here when they are saved to the connected TOKA database. Browser-only demo records are not business records.'}
          </p>
          {!deliveries.length && (
            <Link href="/deliveries/new" className="inline-flex items-center gap-1 mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition">
              <PlusCircle className="w-3.5 h-3.5" /> Create First Delivery
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredDeliveries.map((delivery) => (
            <Link key={delivery.id} href={`/deliveries/${delivery.id}`} className="block bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-shadow">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-slate-900">{delivery.deliveryReference}</span>
                    <StatusBadge status={delivery.operationalStatus} />
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5">{delivery.customerName}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">by {delivery.createdByName} · {new Date(delivery.createdAt).toLocaleString('en-KE')}</div>
                </div>
                <div className="sm:text-right">
                  <div className="text-sm font-extrabold text-slate-900">{formatKES(delivery.totalAmount)}</div>
                  <div className="flex flex-wrap gap-1 mt-1 sm:justify-end">
                    <StatusBadge status={delivery.paymentStatus} />
                    <StatusBadge status={delivery.customerConfirmationStatus} />
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">Paid {formatKES(delivery.totalDeclaredPaid)} · Due {formatKES(delivery.outstandingBalance)}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
