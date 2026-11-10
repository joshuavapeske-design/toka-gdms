import { AlertTriangle, CheckCircle, Clock, Phone, User, ExternalLink } from 'lucide-react';
import Link from 'next/link';

export default function DisputesPage() {
  // In production, fetch active and resolved disputes from Supabase
  const disputes: Array<{
    id: string;
    deliveryId: string;
    deliveryReference: string;
    customerName: string;
    customerPhone: string;
    customerNotes: string;
    createdAt: string;
    isActive: boolean;
    investigatedBy?: string;
    resolutionNotes?: string;
  }> = [];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          Customer Disputes & Claims
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Delivery discrepancies reported by customers via SMS or field reports. Requires management review.
        </p>
      </div>

      {/* Info Card */}
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
        <h2 className="text-xs font-bold text-red-900 mb-1">Anti-Fraud Escalation Protocol</h2>
        <p className="text-xs text-red-700 leading-relaxed">
          When a customer replies &quot;2&quot; (or indicates a problem) via SMS, the system locks the delivery
          confirmation status to &quot;Disputed&quot; and flags the delivery for immediate review.
          Disputes cannot be deleted or hidden by field staff.
        </p>
      </div>

      {disputes.length === 0 ? (
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
              className="bg-white rounded-xl border border-red-200 p-4 shadow-xs"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-900">
                      {dispute.deliveryReference}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] font-bold bg-red-100 text-red-700 rounded-full">
                      Action Required
                    </span>
                  </div>
                  <div className="text-xs text-slate-700 font-semibold mt-1">
                    {dispute.customerName}
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
                <strong>Customer Message:</strong> &quot;{dispute.customerNotes}&quot;
              </div>

              <div className="mt-3 flex items-center justify-between text-[10px] text-slate-400">
                <span>Reported: {new Date(dispute.createdAt).toLocaleString('en-KE')}</span>
                <button className="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-md transition">
                  Investigate & Resolve
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

