'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle, Phone, ExternalLink, Loader2, X } from 'lucide-react';
import { formatKES } from '@/lib/decimal';
import Link from 'next/link';

interface DisputeRecord {
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
  investigatorName?: string;
  resolutionNotes?: string;
  resolvedAt?: string;
  createdAt: string;
}

export default function DisputesPage() {
  const [disputes, setDisputes] = useState<DisputeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [selectedDispute, setSelectedDispute] = useState<DisputeRecord | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ success: boolean; text: string } | null>(null);

  const loadDisputes = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/disputes');
      if (res.ok) {
        const data = await res.json();
        if (data.data) setDisputes(data.data);
      }
    } catch (err) {
      console.error('Failed to load disputes:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDisputes();
  }, []);

  const handleResolve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDispute || !resolutionNotes.trim()) return;

    setSubmitting(true);
    setStatusMessage(null);

    try {
      const res = await fetch('/api/disputes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          disputeId: selectedDispute.id,
          resolutionNotes: resolutionNotes.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok && data.success && data.simulated) {
        setStatusMessage({ success: true, text: 'DEMO ONLY: dispute resolution was simulated. No dispute record was changed in the business database.' });
        setShowResolveModal(false);
      } else if (res.ok && data.success) {
        setStatusMessage({ success: true, text: `Dispute for ${selectedDispute.deliveryReference} resolved successfully.` });
        setShowResolveModal(false);
        setResolutionNotes('');
        await loadDisputes();
      } else {
        setStatusMessage({ success: false, text: data.error || 'Failed to resolve dispute' });
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
      <div className="mb-6">
        <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          Customer Disputes & Claims
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Delivery discrepancies reported by customers via two-way SMS. Mandatory management investigation and resolution.
        </p>
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

      {/* Info Card */}
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
        <h2 className="text-xs font-bold text-red-900 mb-1">Anti-Fraud Escalation Protocol</h2>
        <p className="text-xs text-red-700 leading-relaxed">
          When a customer replies &quot;2&quot; via SMS, the system immediately locks the delivery status to &quot;Disputed&quot;
          and alerts management. Subsequent reason codes categorize the claim without overwriting the dispute.
          Disputes can only be closed through authorized investigation and recorded resolution.
        </p>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto" />
          <p className="text-sm text-slate-500 mt-3">Loading dispute records...</p>
        </div>
      ) : disputes.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-700">No Active Disputes</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            All customer deliveries are confirmed or pending response. Any customer delivery disputes reported via SMS will automatically appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {disputes.map((dispute) => (
            <div
              key={dispute.id}
              className={`bg-white rounded-xl border p-4 shadow-xs transition ${
                dispute.isActive ? 'border-red-200' : 'border-slate-200 bg-slate-50/50'
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-900">
                      {dispute.deliveryReference}
                    </span>
                    {dispute.isActive ? (
                      <span className="px-2 py-0.5 text-[10px] font-bold bg-red-100 text-red-700 rounded-full">
                        Action Required
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-700 rounded-full">
                        Resolved
                      </span>
                    )}
                    <span className="px-2 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-700 rounded capitalize">
                      {dispute.disputeCategory.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="text-xs text-slate-700 font-semibold mt-1">
                    {dispute.customerName} · Invoice: {formatKES(dispute.totalAmount)}
                  </div>
                  <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                    <Phone className="w-3 h-3" />
                    <span>{dispute.customerPhone}</span>
                  </div>
                </div>

                <Link
                  href={`/deliveries/${dispute.deliveryId}`}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800"
                >
                  View Delivery <ExternalLink className="w-3 h-3" />
                </Link>
              </div>

              <div className="mt-3 p-3 bg-red-50/50 rounded-lg border border-red-100 text-xs text-red-900">
                <strong>Customer SMS:</strong> &quot;{dispute.customerNotes}&quot;
              </div>

              {dispute.resolutionNotes && (
                <div className="mt-2 p-3 bg-emerald-50/50 rounded-lg border border-emerald-100 text-xs text-emerald-900">
                  <strong>Resolution Notes:</strong> {dispute.resolutionNotes}
                  <div className="text-[10px] text-emerald-700 mt-0.5">
                    Resolved by {dispute.investigatorName || 'Manager'} on {new Date(dispute.resolvedAt!).toLocaleString('en-KE')}
                  </div>
                </div>
              )}

              <div className="mt-3 flex items-center justify-between text-[10px] text-slate-400">
                <span>Reported: {new Date(dispute.createdAt).toLocaleString('en-KE')}</span>
                {dispute.isActive && (
                  <button
                    onClick={() => {
                      setSelectedDispute(dispute);
                      setShowResolveModal(true);
                    }}
                    className="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-md transition text-xs"
                  >
                    Investigate & Resolve
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Modal: Investigate & Resolve ── */}
      {showResolveModal && selectedDispute && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-extrabold text-slate-900">Investigate & Resolve Dispute</h2>
              <button onClick={() => setShowResolveModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mb-4 bg-slate-50 p-3 rounded-lg text-xs space-y-1">
              <div><strong>Delivery:</strong> {selectedDispute.deliveryReference}</div>
              <div><strong>Customer:</strong> {selectedDispute.customerName} ({selectedDispute.customerPhone})</div>
              <div><strong>Category:</strong> {selectedDispute.disputeCategory.replace(/_/g, ' ')}</div>
              <div><strong>Customer Complaint:</strong> &quot;{selectedDispute.customerNotes}&quot;</div>
            </div>
            <form onSubmit={handleResolve} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Resolution Investigation Notes</label>
                <textarea
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  required
                  rows={3}
                  placeholder="Detail the investigation findings, customer contact details, and agreed correction or closure..."
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg outline-none resize-none"
                />
              </div>

              <div className="pt-3 flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setShowResolveModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 text-xs font-bold rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-sm disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Resolve Dispute'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
