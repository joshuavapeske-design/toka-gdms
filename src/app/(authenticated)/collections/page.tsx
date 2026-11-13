'use client';

import { useState, useEffect } from 'react';
import { DollarSign, PlusCircle, CheckCircle2, Clock, ArrowRight, Loader2, X } from 'lucide-react';
import { formatKES } from '@/lib/decimal';
import type { Customer } from '@/types';

interface CollectionRecord {
  id: string;
  collectionReference: string;
  customerId: string;
  customerName: string;
  customerAccountNumber?: string;
  collectedByName: string;
  channel: string;
  totalAmount: number;
  allocatedAmount: number;
  unallocatedAmount: number;
  isFullyAllocated: boolean;
  externalRef?: string;
  notes?: string;
  collectionDate: string;
}

export default function CollectionsPage() {
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [showAllocateModal, setShowAllocateModal] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState<CollectionRecord | null>(null);

  // Form states
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [channel, setChannel] = useState<'cash' | 'mpesa_company_till' | 'mpesa_employee_phone' | 'bank_transfer'>('cash');
  const [amount, setAmount] = useState('');
  const [externalRef, setExternalRef] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ success: boolean; text: string } | null>(null);

  // Allocation form state
  const [allocationDeliveryId, setAllocationDeliveryId] = useState('');
  const [allocationAmount, setAllocationAmount] = useState('');

  const loadData = async () => {
    try {
      setLoading(true);
      const [colRes, custRes] = await Promise.all([
        fetch('/api/collections'),
        fetch('/api/data/customers'),
      ]);

      if (colRes.ok) {
        const colData = await colRes.json();
        if (colData.data) setCollections(colData.data);
      }
      if (custRes.ok) {
        const custData = await custRes.json();
        if (custData.data) setCustomers(custData.data);
      }
    } catch (err) {
      console.error('Failed to load collections:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRecordCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomerId || !amount || parseFloat(amount) <= 0) return;

    setSubmitting(true);
    setStatusMessage(null);

    try {
      const res = await fetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: selectedCustomerId,
          channel,
          amount: parseFloat(amount),
          externalRef: externalRef.trim() || null,
          notes: notes.trim() || null,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success && data.simulated) {
        setStatusMessage({ success: true, text: 'DEMO ONLY: the collection response was simulated. No money receipt or collection record was saved to the business database.' });
        setShowRecordModal(false);
      } else if (res.ok && data.success) {
        setStatusMessage({ success: true, text: `Collection ${data.collection_reference || data.collectionReference || 'record'} recorded successfully.` });
        setShowRecordModal(false);
        setAmount('');
        setExternalRef('');
        setNotes('');
        await loadData();
      } else {
        setStatusMessage({ success: false, text: data.error || 'Failed to record collection' });
      }
    } catch (err: any) {
      setStatusMessage({ success: false, text: err.message || 'Network error' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleAllocate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCollection || !allocationDeliveryId || !allocationAmount || parseFloat(allocationAmount) <= 0) return;

    setSubmitting(true);
    setStatusMessage(null);

    try {
      const res = await fetch('/api/collections/allocate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collectionId: selectedCollection.id,
          deliveryId: allocationDeliveryId,
          amount: parseFloat(allocationAmount),
        }),
      });

      const data = await res.json();
      if (res.ok && data.success && data.simulated) {
        setStatusMessage({ success: true, text: 'DEMO ONLY: allocation was simulated. No collection, invoice balance or customer credit account was changed.' });
        setShowAllocateModal(false);
      } else if (res.ok && data.success) {
        setStatusMessage({ success: true, text: `Allocated ${formatKES(data.allocated_amount ?? data.allocatedAmount)} to invoice.` });
        setShowAllocateModal(false);
        setAllocationDeliveryId('');
        setAllocationAmount('');
        await loadData();
      } else {
        setStatusMessage({ success: false, text: data.error || 'Failed to allocate collection' });
      }
    } catch (err: any) {
      setStatusMessage({ success: false, text: err.message || 'Network error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-blue-600" />
            Customer Collections
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Cash and M-Pesa collections from customers. Explicitly allocated to outstanding delivery invoices.
          </p>
        </div>
        <button
          onClick={() => setShowRecordModal(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg shadow-sm transition"
        >
          <PlusCircle className="w-4 h-4" />
          Record Collection
        </button>
      </div>

      {statusMessage && (
        <div
          className={`mb-4 p-3 rounded-lg border text-xs ${
            statusMessage.success
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {statusMessage.text}
        </div>
      )}

      {/* Info Notice */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
        <div className="text-xs text-amber-800">
          <strong>Accounting Invariant:</strong> Unallocated collections are strictly preserved as unapplied customer credit.
          They never automatically reduce invoice balances until explicitly allocated by an authorized user.
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto" />
          <p className="text-sm text-slate-500 mt-3">Loading collections ledger...</p>
        </div>
      ) : collections.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <DollarSign className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-700">No Collections Recorded</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Use the &quot;Record Collection&quot; button above to log payments received from customers in the field or office.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {collections.map((c) => (
            <div
              key={c.id}
              className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-900">{c.collectionReference}</span>
                    {c.isFullyAllocated ? (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded">
                        <CheckCircle2 className="w-3 h-3" /> Fully Allocated
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 rounded">
                        <Clock className="w-3 h-3" /> Unallocated: {formatKES(c.unallocatedAmount)}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-700 font-semibold mt-1">{c.customerName}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    Channel: {c.channel.replace(/_/g, ' ')} · Recorded by {c.collectedByName} · {c.collectionDate}
                    {c.externalRef && <span className="ml-2 font-mono">Ref: {c.externalRef}</span>}
                  </div>
                  {c.notes && <div className="text-xs text-slate-500 mt-1 italic">&quot;{c.notes}&quot;</div>}
                </div>
                <div className="text-right">
                  <div className="text-sm font-extrabold text-slate-900">{formatKES(c.totalAmount)}</div>
                  {!c.isFullyAllocated && (
                    <button
                      onClick={() => {
                        setSelectedCollection(c);
                        setAllocationAmount(c.unallocatedAmount.toString());
                        setShowAllocateModal(true);
                      }}
                      className="mt-2 inline-flex items-center gap-1 px-3 py-1 bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 text-xs font-semibold rounded-md transition"
                    >
                      Allocate <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Modal: Record Collection ── */}
      {showRecordModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-extrabold text-slate-900">Record Customer Collection</h2>
              <button onClick={() => setShowRecordModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleRecordCollection} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Customer</label>
                <select
                  value={selectedCustomerId}
                  onChange={(e) => setSelectedCustomerId(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg outline-none"
                >
                  <option value="">Select customer...</option>
                  {customers.map((cust) => (
                    <option key={cust.id} value={cust.id}>
                      {cust.name} ({cust.accountNumber})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Payment Channel</label>
                <select
                  value={channel}
                  onChange={(e) => setChannel(e.target.value as any)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg outline-none"
                >
                  <option value="cash">Cash</option>
                  <option value="mpesa_company_till">Company M-Pesa Till</option>
                  <option value="mpesa_employee_phone">Employee Personal M-Pesa</option>
                  <option value="bank_transfer">Bank Transfer</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Amount (KES)</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                  placeholder="0.00"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">External Reference (optional)</label>
                <input
                  type="text"
                  value={externalRef}
                  onChange={(e) => setExternalRef(e.target.value)}
                  placeholder="e.g. M-Pesa transaction code"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Notes (optional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Any relevant context..."
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg outline-none resize-none"
                />
              </div>

              <div className="pt-3 flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setShowRecordModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 text-xs font-bold rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Record Collection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Allocate Collection ── */}
      {showAllocateModal && selectedCollection && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-extrabold text-slate-900">Allocate Collection</h2>
              <button onClick={() => setShowAllocateModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mb-4 bg-slate-50 p-3 rounded-lg text-xs space-y-1">
              <div><strong>Collection:</strong> {selectedCollection.collectionReference}</div>
              <div><strong>Customer:</strong> {selectedCollection.customerName}</div>
              <div><strong>Unallocated Available:</strong> {formatKES(selectedCollection.unallocatedAmount)}</div>
            </div>
            <form onSubmit={handleAllocate} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Delivery UUID / Invoice ID</label>
                <input
                  type="text"
                  value={allocationDeliveryId}
                  onChange={(e) => setAllocationDeliveryId(e.target.value)}
                  required
                  placeholder="Paste Delivery ID..."
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Amount to Allocate (KES)</label>
                <input
                  type="number"
                  min="0.01"
                  max={selectedCollection.unallocatedAmount}
                  step="0.01"
                  value={allocationAmount}
                  onChange={(e) => setAllocationAmount(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg outline-none"
                />
              </div>

              <div className="pt-3 flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setShowAllocateModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 text-xs font-bold rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-sm disabled:opacity-50"
                >
                  {submitting ? 'Allocating...' : 'Confirm Allocation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
