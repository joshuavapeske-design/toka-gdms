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
  User,
  DollarSign,
  Wallet,
  ShieldCheck,
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
  vehiclePlate?: string;
  driverName?: string;
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
  createdByRole?: string;
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
      d.customerPhone.includes(search) ||
      (d.createdByName && d.createdByName.toLowerCase().includes(search.toLowerCase())) ||
      (d.vehiclePlate && d.vehiclePlate.toLowerCase().includes(search.toLowerCase()));

    if (!matchesSearch) return false;

    if (statusFilter === 'all') return true;
    if (statusFilter === 'my_vehicle') return true; // highlights all vehicle runs today
    if (statusFilter === 'pending') return d.customerConfirmationStatus === 'pending';
    if (statusFilter === 'confirmed') return d.customerConfirmationStatus === 'confirmed';
    if (statusFilter === 'disputed') return d.customerConfirmationStatus === 'disputed';
    return true;
  });

  // Driver vehicle sales and cash reconciliation calculation
  const totalVehicleCash = deliveries.reduce((sum, d) => {
    const cash = (d.payments || []).filter((p) => p.channel === 'cash').reduce((s, p) => s + p.declaredAmount, 0);
    return sum + cash;
  }, 0);

  const totalVehicleMpesa = deliveries.reduce((sum, d) => {
    const mp = (d.payments || []).filter((p) => p.channel.includes('mpesa')).reduce((s, p) => s + p.declaredAmount, 0);
    return sum + mp;
  }, 0);

  const sellerBreakdown = deliveries.reduce((acc: Record<string, { count: number; total: number }>, d) => {
    const seller = d.createdByName || 'Field Sales Rep';
    if (!acc[seller]) acc[seller] = { count: 0, total: 0 };
    acc[seller].count += 1;
    acc[seller].total += d.totalAmount;
    return acc;
  }, {});

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
            <Truck className="w-5 h-5 text-blue-600" />
            Field Sales & Vehicle Deliveries
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time delivery tracking: Driver visibility into who made each sale, physical stock delivered, and cash in hand.
          </p>
        </div>
        <Link
          href="/deliveries/new"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg shadow-sm transition"
        >
          <PlusCircle className="w-4 h-4" />
          Record Sale from Vehicle
        </Link>
      </div>

      {/* Driver's Live Reconciliation & Attribution Manifest */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-xl p-5 border border-slate-800 shadow-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <Truck className="w-5 h-5 text-emerald-400" />
              <h2 className="text-base font-bold text-white">Driver's Vehicle Sales & Cash Manifest</h2>
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-xs font-mono font-bold">
                KBZ 123X · Isuzu FRR 10-Tonne
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Driver David Ochieng view: Live manifest of all orders sold from this vehicle, who sold each piece, and cash collected on the truck.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-[10px] uppercase font-bold text-slate-400">Truck Cash in Hand</div>
              <div className="text-lg font-extrabold text-emerald-400">{formatKES(totalVehicleCash)}</div>
            </div>
            <div className="text-right border-l border-slate-800 pl-4">
              <div className="text-[10px] uppercase font-bold text-slate-400">Total Till M-Pesa</div>
              <div className="text-lg font-extrabold text-blue-400">{formatKES(totalVehicleMpesa)}</div>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="text-xs font-semibold text-slate-300 mb-2">Sales Attribution By Crew Member (Who Sold):</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {Object.entries(sellerBreakdown).map(([seller, info]) => (
              <div key={seller} className="bg-slate-800/80 rounded-lg p-3 border border-slate-700 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-blue-400" />
                    {seller}
                  </div>
                  <div className="text-sm font-extrabold text-emerald-400 mt-0.5">
                    {formatKES(info.total)}
                  </div>
                </div>
                <span className="text-[11px] bg-blue-500/20 text-blue-300 px-2 py-1 rounded-full font-bold">
                  {info.count} {info.count === 1 ? 'sale' : 'sales'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 flex flex-col sm:flex-row gap-3 items-center justify-between shadow-xs">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by ref, customer, seller, or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto">
          <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <div className="flex gap-1">
            {[
              { id: 'all', label: 'All Sales' },
              { id: 'my_vehicle', label: '🚚 My Vehicle Run' },
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
                {/* Left: Reference, Customer, Prominent Seller Attribution */}
                <div className="space-y-1.5">
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

                  {/* Explicit Seller Attribution for Driver & Management */}
                  <div className="flex items-center gap-2 flex-wrap text-xs pt-0.5">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-900 font-bold border border-blue-200">
                      <User className="w-3 h-3 text-blue-700" />
                      Sold by: {d.createdByName} {d.createdByRole ? `(${d.createdByRole})` : ''}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-medium text-[11px]">
                      <Truck className="w-3 h-3 text-slate-500" />
                      {d.vehiclePlate || 'Truck KBZ 123X'}
                    </span>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-500 text-[11px]">
                      {new Date(d.createdAt).toLocaleString('en-KE', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                  </div>

                  {/* Glass items delivered preview */}
                  {d.items && d.items.length > 0 && (
                    <div className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-md p-2 mt-1">
                      <div className="font-semibold text-slate-700 text-[11px] mb-1">Sheets Delivered from Vehicle:</div>
                      <div className="flex flex-wrap gap-1.5">
                        {d.items.map((it, idx) => (
                          <span key={idx} className="bg-white px-2 py-0.5 rounded border border-slate-200 text-[11px] font-medium text-slate-800">
                            {it.quantity}x {it.productName} ({it.sellingUnit.replace('_', ' ')})
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Payment channels breakdown */}
                  {d.payments && d.payments.length > 0 && (
                    <div className="flex items-center gap-2 text-[11px] text-slate-500 pt-0.5">
                      <Wallet className="w-3 h-3 text-emerald-600" />
                      <span className="font-medium text-slate-600">Collected:</span>
                      {d.payments.map((p, idx) => (
                        <span key={idx} className="font-semibold text-slate-700">
                          {p.channel.replace(/_/g, ' ')} ({formatKES(p.declaredAmount)})
                        </span>
                      ))}
                    </div>
                  )}

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
