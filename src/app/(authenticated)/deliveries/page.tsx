import Link from 'next/link';
import {
  Truck,
  PlusCircle,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Filter,
} from 'lucide-react';
import { formatKES } from '@/lib/decimal';

// Status badge component
function StatusBadge({ status, type }: { status: string; type: 'operational' | 'payment' | 'confirmation' }) {
  const styles: Record<string, string> = {
    // Operational
    draft: 'bg-slate-100 text-slate-600 border-slate-200',
    submitted: 'bg-blue-50 text-blue-700 border-blue-200',
    dispatched: 'bg-purple-50 text-purple-700 border-purple-200',
    delivered: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    cancelled: 'bg-red-50 text-red-600 border-red-200',
    correction_pending: 'bg-amber-50 text-amber-700 border-amber-200',
    // Payment
    unpaid: 'bg-red-50 text-red-600 border-red-200',
    partially_paid: 'bg-amber-50 text-amber-700 border-amber-200',
    fully_paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    credit: 'bg-orange-50 text-orange-700 border-orange-200',
    // Confirmation
    pending: 'bg-slate-100 text-slate-600 border-slate-200',
    confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    disputed: 'bg-red-50 text-red-600 border-red-200',
    no_response: 'bg-slate-50 text-slate-500 border-slate-200',
  };

  const label = status.replace(/_/g, ' ');

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded border capitalize ${
        styles[status] || 'bg-slate-100 text-slate-600 border-slate-200'
      }`}
    >
      {label}
    </span>
  );
}

export default function DeliveriesPage() {
  // Placeholder: In production, fetch deliveries from Supabase server-side
  const deliveries: Array<{
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
  }> = [];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
            <Truck className="w-5 h-5 text-blue-600" />
            Deliveries
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">All delivery records</p>
        </div>
        <Link
          href="/deliveries/new"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg shadow-sm transition"
        >
          <PlusCircle className="w-4 h-4" />
          New Delivery
        </Link>
      </div>

      {/* Filter bar placeholder */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 mb-4 flex flex-wrap gap-2 items-center">
        <Filter className="w-4 h-4 text-slate-400" />
        <select className="text-xs px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md">
          <option value="">All Statuses</option>
          <option value="submitted">Submitted</option>
          <option value="dispatched">Dispatched</option>
          <option value="delivered">Delivered</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select className="text-xs px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md">
          <option value="">All Payment</option>
          <option value="unpaid">Unpaid</option>
          <option value="partially_paid">Partially Paid</option>
          <option value="fully_paid">Fully Paid</option>
          <option value="credit">Credit</option>
        </select>
        <input
          type="date"
          className="text-xs px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-md"
          defaultValue={new Date().toISOString().split('T')[0]}
        />
      </div>

      {/* Delivery list */}
      {deliveries.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Truck className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-700">No Deliveries Yet</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Deliveries will appear here once you connect to Supabase and create your first delivery record.
          </p>
          <Link
            href="/deliveries/new"
            className="inline-flex items-center gap-1 mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            Create First Delivery
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {deliveries.map((d) => (
            <Link
              key={d.id}
              href={`/deliveries/${d.id}`}
              className="block bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-900">{d.deliveryReference}</span>
                    <StatusBadge status={d.operationalStatus} type="operational" />
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5">{d.customerName}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    by {d.createdByName} · {new Date(d.createdAt).toLocaleString('en-KE')}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-extrabold text-slate-900">{formatKES(d.totalAmount)}</div>
                  <div className="flex gap-1 mt-1 justify-end">
                    <StatusBadge status={d.paymentStatus} type="payment" />
                    <StatusBadge status={d.customerConfirmationStatus} type="confirmation" />
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

