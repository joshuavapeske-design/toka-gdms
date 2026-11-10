import { DollarSign, PlusCircle, CheckCircle2, Clock, ArrowRight } from 'lucide-react';
import { formatKES } from '@/lib/decimal';
import Link from 'next/link';

export default function CollectionsPage() {
  // Placeholder — fetched from Supabase in production
  const collections: Array<{
    id: string;
    collectionReference: string;
    customerName: string;
    channel: string;
    totalAmount: number;
    allocatedAmount: number;
    unallocatedAmount: number;
    isFullyAllocated: boolean;
    collectionDate: string;
    collectedByName: string;
  }> = [];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-blue-600" />
            Collections
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Cash and M-Pesa collections from customers. Allocate to outstanding invoices.
          </p>
        </div>
        <button
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg shadow-sm transition"
        >
          <PlusCircle className="w-4 h-4" />
          Record Collection
        </button>
      </div>

      {/* Info */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
        <div className="text-xs text-amber-800">
          <strong>Important:</strong> Unallocated collections are never automatically applied to invoices.
          Each collection must be manually allocated by an authorized user (accountant or manager).
        </div>
      </div>

      {collections.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <DollarSign className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-700">No Collections Yet</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Collections will appear here once cash collectors or field staff record payments received from customers.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
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
                        <CheckCircle2 className="w-3 h-3" /> Allocated
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 rounded">
                        <Clock className="w-3 h-3" /> Unallocated: {formatKES(c.unallocatedAmount)}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5">{c.customerName}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {c.channel.replace(/_/g, ' ')} · by {c.collectedByName} · {c.collectionDate}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-extrabold text-slate-900">{formatKES(c.totalAmount)}</div>
                  {!c.isFullyAllocated && (
                    <button className="mt-1 inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-600 hover:text-blue-800">
                      Allocate <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

