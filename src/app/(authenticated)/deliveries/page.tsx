'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Truck,
  PlusCircle,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Filter,
  Search,
  MessageSquare,
  Send,
  Loader2,
  AlertCircle,
  X,
  Smartphone,
  Info,
} from 'lucide-react';
import { formatKES } from '@/lib/decimal';

interface DeliveryItemData {
  productId: string;
  productName: string;
  sellingUnit: string;
  quantity: number;
  appliedUnitPrice: number;
  lineTotal: number;
  fse: number;
}

interface PaymentData {
  channel: string;
  declaredAmount: number;
  externalRef?: string | null;
}

interface DeliveryRecord {
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
  operationalStatus: string;
  paymentStatus: string;
  customerConfirmationStatus: 'pending' | 'confirmed' | 'disputed' | 'no_response';
  smsPayload?: string;
  items?: DeliveryItemData[];
  payments?: PaymentData[];
  createdAt: string;
  createdByName: string;
  notes?: string | null;
}

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
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    disputed: 'bg-rose-50 text-rose-700 border-rose-200',
    no_response: 'bg-slate-50 text-slate-500 border-slate-200',
  };

  const label = status.replace(/_/g, ' ');

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded border capitalize ${
        styles[status] || 'bg-slate-100 text-slate-600 border-slate-200'
      }`}
    >
      {label}
    </span>
  );
}

export default function DeliveriesPage() {
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Customer SMS Simulation Modal
  const [selectedForSms, setSelectedForSms] = useState<DeliveryRecord | null>(null);
  const [smsReplyText, setSmsReplyText] = useState('1');
  const [simulatingSms, setSimulatingSms] = useState(false);
  const [smsStatusBanner, setSmsStatusBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchDeliveries = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/sync/deliveries');
      if (res.ok) {
        const json = await res.json();
        setDeliveries(json.data || []);
      }
    } catch (err) {
      console.error('Failed to load deliveries:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDeliveries();
  }, []);

  const handleSimulateSmsReply = async (textToSend: string) => {
    if (!selectedForSms) return;
    try {
      setSimulatingSms(true);
      setSmsStatusBanner(null);

      const res = await fetch('/api/webhooks/sms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': process.env.NEXT_PUBLIC_AFRICAS_TALKING_WEBHOOK_SECRET || 'dev-secret',
        },
        body: JSON.stringify({
          from: selectedForSms.customerPhone || '+254712345678',
          text: textToSend,
          id: `msg-sim-${Date.now()}`,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'SMS webhook failed');
      }

      setSmsStatusBanner({
        type: 'success',
        message: data.message || `Customer reply "${textToSend}" processed successfully!`,
      });

      // Refresh list
      await fetchDeliveries();
    } catch (err: any) {
      setSmsStatusBanner({
        type: 'error',
        message: err.message || 'Failed to simulate customer SMS.',
      });
    } finally {
      setSimulatingSms(false);
    }
  };

  const filtered = deliveries.filter((d) => {
    const matchesSearch =
      d.deliveryReference.toLowerCase().includes(search.toLowerCase()) ||
      d.customerName.toLowerCase().includes(search.toLowerCase()) ||
      d.customerPhone.includes(search);

    if (!matchesSearch) return false;

    if (statusFilter === 'all') return true;
    if (statusFilter === 'pending') return d.customerConfirmationStatus === 'pending';
    if (statusFilter === 'confirmed') return d.customerConfirmationStatus === 'confirmed';
    if (statusFilter === 'disputed') return d.customerConfirmationStatus === 'disputed';
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
            <Truck className="w-5 h-5 text-blue-600" />
            Deliveries & Operational Audit
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Audit dispatched glass deliveries, inspect payment declarations, and verify two-way customer confirmations.
          </p>
        </div>
        <Link
          href="/deliveries/new"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg shadow-sm transition"
        >
          <PlusCircle className="w-4 h-4" />
          New Delivery
        </Link>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 flex flex-col sm:flex-row gap-3 items-center justify-between shadow-xs">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by ref (GD-XXXXXX-XXXX), customer, or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto">
          <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <div className="flex gap-1">
            {[
              { id: 'all', label: 'All Deliveries' },
              { id: 'pending', label: 'Pending SMS' },
              { id: 'confirmed', label: 'Customer Confirmed' },
              { id: 'disputed', label: 'Customer Disputed' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition whitespace-nowrap ${
                  statusFilter === tab.id
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Delivery List */}
      {loading ? (
        <div className="text-center py-16 text-slate-400 text-sm flex flex-col items-center gap-2">
          <Loader2 className="w-7 h-7 animate-spin text-blue-600" />
          Loading deliveries...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Truck className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-700">No Deliveries Found</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            {search || statusFilter !== 'all'
              ? 'No deliveries matched your current filters.'
              : 'Create a new glass delivery to begin tracking.'}
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
        <div className="space-y-3">
          {filtered.map((d) => (
            <div
              key={d.id}
              className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-sm transition"
            >
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                {/* Left: Reference, Customer & Meta */}
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base font-extrabold text-slate-900 font-mono">
                      {d.deliveryReference}
                    </span>
                    <StatusBadge status={d.operationalStatus} type="operational" />
                    <StatusBadge status={d.paymentStatus} type="payment" />
                    <StatusBadge status={d.customerConfirmationStatus} type="confirmation" />
                  </div>

                  <div className="text-sm font-bold text-slate-800">
                    {d.customerName}
                    <span className="text-xs text-slate-400 font-normal ml-2 font-mono">
                      ({d.customerPhone})
                    </span>
                  </div>

                  <div className="text-xs text-slate-500">
                    Recorded by <span className="font-semibold text-slate-700">{d.createdByName}</span> ·{' '}
                    {new Date(d.createdAt).toLocaleString('en-KE', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </div>

                  {d.notes && (
                    <div className="text-xs text-slate-500 italic bg-slate-50 px-2 py-1 rounded inline-block">
                      Note: {d.notes}
                    </div>
                  )}
                </div>

                {/* Right: Financial Totals & Customer SMS Test Action */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 lg:gap-6 border-t lg:border-t-0 pt-3 lg:pt-0">
                  <div className="grid grid-cols-3 gap-3 text-right">
                    <div>
                      <div className="text-[10px] text-slate-400 uppercase font-bold">Total</div>
                      <div className="text-xs font-bold text-slate-900">{formatKES(d.totalAmount)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400 uppercase font-bold">Paid</div>
                      <div className="text-xs font-bold text-emerald-700">
                        {formatKES(d.totalDeclaredPaid)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400 uppercase font-bold">Balance Due</div>
                      <div
                        className={`text-xs font-extrabold ${
                          d.outstandingBalance > 0 ? 'text-red-600' : 'text-slate-400'
                        }`}
                      >
                        {formatKES(d.outstandingBalance)}
                      </div>
                    </div>
                  </div>

                  {/* Simulate Customer SMS Button */}
                  <button
                    onClick={() => {
                      setSelectedForSms(d);
                      setSmsReplyText('1');
                      setSmsStatusBanner(null);
                    }}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 border border-slate-300 hover:border-blue-300 rounded-lg text-xs font-bold transition shadow-xs"
                    title="Simulate the customer receiving an SMS and replying"
                  >
                    <Smartphone className="w-4 h-4 text-blue-600" />
                    <span>Customer SMS Simulator</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Customer SMS Simulator Modal */}
      {selectedForSms && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 relative animate-in fade-in zoom-in duration-150">
            <button
              onClick={() => setSelectedForSms(null)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-2">
              <Smartphone className="w-5 h-5 text-blue-600" />
              <h3 className="text-base font-extrabold text-slate-900">
                Customer Two-Way SMS Verification
              </h3>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Simulate testing the customer experience: view the outbound notification sent to the customer, and simulate inbound SMS replies.
            </p>

            {/* Outbound SMS Payload Box */}
            <div className="bg-slate-900 text-slate-100 rounded-xl p-4 text-xs font-mono mb-4 shadow-inner space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-[11px] pb-1 border-b border-slate-800">
                <span>To: {selectedForSms.customerPhone} ({selectedForSms.customerName})</span>
                <span className="text-emerald-400">OUTBOUND SMS</span>
              </div>
              <p className="leading-relaxed text-slate-200">
                {selectedForSms.smsPayload ||
                  `TOKA GLASS: Delivery ${selectedForSms.deliveryReference} recorded. Total: ${formatKES(
                    selectedForSms.totalAmount
                  )}, Paid: ${formatKES(selectedForSms.totalDeclaredPaid)}, Due: ${formatKES(
                    selectedForSms.outstandingBalance
                  )}. Reply 1 to CONFIRM or 2 to DISPUTE. Help: 0700000000`}
              </p>
            </div>

            {/* Status Banner */}
            {smsStatusBanner && (
              <div
                className={`p-3 rounded-lg mb-4 text-xs flex items-center gap-2 ${
                  smsStatusBanner.type === 'success'
                    ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                    : 'bg-rose-50 border border-rose-200 text-rose-800'
                }`}
              >
                {smsStatusBanner.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                )}
                <span>{smsStatusBanner.message}</span>
              </div>
            )}

            {/* One-click Customer Reply Actions */}
            <div className="space-y-3">
              <div className="text-xs font-bold text-slate-700">Quick Test Customer Actions:</div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={simulatingSms}
                  onClick={() => handleSimulateSmsReply('1')}
                  className="flex items-center justify-center gap-2 px-3 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Reply &quot;1&quot; (Confirm Delivery)
                </button>

                <button
                  type="button"
                  disabled={simulatingSms}
                  onClick={() => handleSimulateSmsReply('2 Damaged 6mm sheet on delivery')}
                  className="flex items-center justify-center gap-2 px-3 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition disabled:opacity-50"
                >
                  <AlertTriangle className="w-4 h-4" />
                  Reply &quot;2&quot; (Dispute Damaged)
                </button>
              </div>

              {/* Custom SMS reply */}
              <div className="pt-2">
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Or Send Custom Inbound Customer SMS:
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={smsReplyText}
                    onChange={(e) => setSmsReplyText(e.target.value)}
                    placeholder="e.g. 1, 2, or NO price was wrong"
                    className="flex-1 text-xs border border-slate-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                  <button
                    type="button"
                    disabled={simulatingSms || !smsReplyText.trim()}
                    onClick={() => handleSimulateSmsReply(smsReplyText)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-lg transition disabled:opacity-50"
                  >
                    {simulatingSms ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    Send SMS
                  </button>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5 flex items-start gap-2 text-[11px] text-blue-800 mt-2">
                <Info className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                <span>
                  <strong>Anti-Fraud Verification:</strong> Inbound SMS replies are evaluated through the state machine. Replying 1 marks the delivery confirmed; replying 2 opens a formal investigation in the Disputes portal.
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
