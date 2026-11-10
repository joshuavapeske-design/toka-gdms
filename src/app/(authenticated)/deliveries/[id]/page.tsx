import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ChevronLeft,
  Calendar,
  User,
  MapPin,
  Clock,
  CheckCircle2,
  AlertTriangle,
  CreditCard,
  Layers,
} from 'lucide-react';
import { formatKES } from '@/lib/decimal';
import { createServerSupabaseClient } from '@/lib/supabase/server';

interface DeliveryDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function DeliveryDetailPage({ params }: DeliveryDetailPageProps) {
  const { id } = await params;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  let delivery: any = null;

  if (supabaseUrl && !supabaseUrl.includes('placeholder')) {
    try {
      const supabase = await createServerSupabaseClient();
      const { data, error } = await supabase
        .from('deliveries')
        .select(`
          *,
          customers (*),
          profiles:created_by (full_name, phone_number),
          delivery_items (*, products (*)),
          payment_declarations (*),
          customer_confirmations (*),
          customer_disputes (*)
        `)
        .eq('id', id)
        .maybeSingle();

      if (!error && data) {
        delivery = data;
      }
    } catch (err) {
      console.error('[DELIVERY DETAIL ERROR]', err);
    }
  }

  // If delivery is not found in database, trigger 404
  if (!delivery) {
    notFound();
  }

  const customer = delivery.customers;
  const items = delivery.delivery_items || [];
  const payments = delivery.payment_declarations || [];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
      {/* Back button & Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/deliveries"
          className="p-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 transition"
        >
          <ChevronLeft className="w-4 h-4 text-slate-600" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-black text-slate-900 tracking-tight">
              {delivery.delivery_reference}
            </h1>
            <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
              {delivery.operational_status}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5 font-mono">
            TX: {delivery.client_tx_id}
          </p>
        </div>
      </div>

      {/* Grid: Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="text-[10px] text-slate-400 uppercase font-semibold">Total Invoice</div>
          <div className="text-base font-extrabold text-slate-900 mt-1">
            {formatKES(delivery.total_amount)}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="text-[10px] text-slate-400 uppercase font-semibold">Declared Received</div>
          <div className="text-base font-extrabold text-emerald-600 mt-1">
            {formatKES(delivery.total_declared_paid)}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="text-[10px] text-slate-400 uppercase font-semibold">Outstanding Due</div>
          <div
            className={`text-base font-extrabold mt-1 ${
              Number(delivery.outstanding_balance) > 0 ? 'text-red-600' : 'text-emerald-600'
            }`}
          >
            {formatKES(delivery.outstanding_balance)}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="text-[10px] text-slate-400 uppercase font-semibold">Customer SMS</div>
          <div className="text-xs font-bold mt-1">
            {delivery.customer_confirmation_status === 'confirmed' ? (
              <span className="text-emerald-600 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Confirmed
              </span>
            ) : delivery.customer_confirmation_status === 'disputed' ? (
              <span className="text-red-600 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> Disputed
              </span>
            ) : (
              <span className="text-amber-600 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> Pending
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Customer & Delivery Context */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
            Customer Information
          </h2>
          <div className="text-sm font-bold text-slate-900">{customer?.name}</div>
          <div className="text-xs text-slate-600 mt-0.5">
            Account: {customer?.account_number} · Phone: {customer?.primary_phone}
          </div>
          <div className="text-xs text-slate-500 flex items-center gap-1 mt-1">
            <MapPin className="w-3.5 h-3.5 text-slate-400" />
            <span>{customer?.delivery_area || 'Not specified'}</span>
          </div>
        </div>

        <div>
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
            Execution Details
          </h2>
          <div className="text-xs text-slate-700 flex items-center gap-1.5">
            <User className="w-3.5 h-3.5 text-slate-400" />
            <span>Handler: {delivery.profiles?.full_name || 'Field Operative'}</span>
          </div>
          <div className="text-xs text-slate-700 flex items-center gap-1.5 mt-1">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span>Time: {new Date(delivery.created_at).toLocaleString('en-KE')}</span>
          </div>
          {delivery.delivery_lat && (
            <div className="text-xs text-slate-700 flex items-center gap-1.5 mt-1">
              <MapPin className="w-3.5 h-3.5 text-emerald-500" />
              <span>
                GPS: {Number(delivery.delivery_lat).toFixed(6)}, {Number(delivery.delivery_lng).toFixed(6)}
                {delivery.gps_accuracy_m && ` (±${Math.round(delivery.gps_accuracy_m)}m)`}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Delivered Glass Items Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-blue-600" />
            Delivered Glass Products
          </h2>
          <span className="text-[10px] font-semibold text-slate-500">
            {items.length} Line Item{items.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/50 border-b border-slate-100 text-slate-400 uppercase text-[10px] font-bold">
              <tr>
                <th className="px-4 py-2.5">Product</th>
                <th className="px-4 py-2.5">Unit</th>
                <th className="px-4 py-2.5 text-right">Qty</th>
                <th className="px-4 py-2.5 text-right">FSE</th>
                <th className="px-4 py-2.5 text-right">Unit Price</th>
                <th className="px-4 py-2.5 text-right">Line Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item: any, idx: number) => (
                <tr key={item.id || idx} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3">
                    <div className="font-bold text-slate-800">
                      {item.products?.name || 'Glass Product'}
                    </div>
                    <div className="text-[10px] text-slate-400">{item.products?.sku}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">
                      {item.selling_unit ? item.selling_unit.replace('_', ' ') : 'FULL SHEET'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-slate-800">{item.quantity}</td>
                  <td className="px-4 py-3 text-right font-mono text-blue-600 font-semibold">
                    {Number(item.full_sheet_equivalent).toFixed(1)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600">
                    {formatKES(item.applied_unit_price)}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-slate-900">
                    {formatKES(item.line_total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment Declarations */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
            <CreditCard className="w-3.5 h-3.5 text-emerald-600" />
            Declared Payment Collections
          </h2>
          <span className="text-[10px] font-semibold text-slate-500">
            {payments.length} Declaration{payments.length !== 1 ? 's' : ''}
          </span>
        </div>

        {payments.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400">
            No payments declared for this delivery. Full invoice amount recorded on customer credit ledger.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {payments.map((p: any, idx: number) => (
              <div key={p.id || idx} className="px-4 py-3 flex items-center justify-between text-xs">
                <div>
                  <span className="font-bold text-slate-800 capitalize">
                    {p.channel ? p.channel.replace(/_/g, ' ') : 'Payment'}
                  </span>
                  {p.external_ref && (
                    <span className="ml-2 font-mono text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                      Ref: {p.external_ref}
                    </span>
                  )}
                  {p.notes && <div className="text-[11px] text-slate-400 mt-0.5">{p.notes}</div>}
                </div>
                <div className="font-extrabold text-emerald-600">{formatKES(p.declared_amount)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
