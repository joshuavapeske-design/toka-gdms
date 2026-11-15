'use client';

import { useState, useEffect } from 'react';
import { Layers, Package, ArrowUpDown, Loader2, Plus, Truck, X, CheckCircle2, AlertCircle } from 'lucide-react';
import type { Product } from '@/types';

interface StockBalance {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  color?: string;
  thicknessMm?: number;
  stockLocationId: string;
  locationName: string;
  locationType: string;
  fullSheets: number;
  halfSheets: number;
  fse: number;
  updatedAt: string;
}

interface StockLocation {
  id: string;
  name: string;
  locationType: 'warehouse' | 'truck' | 'transit';
  vehicleId?: string | null;
}

export default function InventoryPage() {
  const [balances, setBalances] = useState<StockBalance[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal States
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Receive Form
  const [recvProductId, setRecvProductId] = useState('');
  const [recvLocationId, setRecvLocationId] = useState('');
  const [recvFullSheets, setRecvFullSheets] = useState(10);
  const [recvHalfSheets, setRecvHalfSheets] = useState(0);
  const [recvNotes, setRecvNotes] = useState('');

  // Dispatch Form
  const [dispProductId, setDispProductId] = useState('');
  const [dispFromLocId, setDispFromLocId] = useState('');
  const [dispToLocId, setDispToLocId] = useState('');
  const [dispFullSheets, setDispFullSheets] = useState(5);
  const [dispHalfSheets, setDispHalfSheets] = useState(0);
  const [dispNotes, setDispNotes] = useState('');

  const fetchInventory = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/inventory');
      if (res.ok) {
        const data = await res.json();
        if (data.data) {
          setBalances(data.data);
        }
      }
    } catch (err) {
      console.error('Failed to load inventory balances:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInventory();

    // Fetch products & locations for dropdowns
    async function loadAuxData() {
      try {
        const [prodRes, locRes] = await Promise.all([
          fetch('/api/data/products'),
          fetch('/api/inventory/locations'),
        ]);

        if (prodRes.ok) {
          const pData = await prodRes.json();
          if (pData.data) {
            setProducts(pData.data);
            if (pData.data.length > 0) {
              setRecvProductId(pData.data[0].id);
              setDispProductId(pData.data[0].id);
            }
          }
        }

        if (locRes.ok) {
          const lData = await locRes.json();
          if (lData.data) {
            setLocations(lData.data);
            const warehouse = lData.data.find((l: StockLocation) => l.locationType === 'warehouse');
            const truck = lData.data.find((l: StockLocation) => l.locationType === 'truck');
            if (warehouse) {
              setRecvLocationId(warehouse.id);
              setDispFromLocId(warehouse.id);
            }
            if (truck) {
              setDispToLocId(truck.id);
            }
          }
        }
      } catch (err) {
        console.error('Failed to load auxiliary data:', err);
      }
    }
    loadAuxData();
  }, []);

  const handleReceiveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setStatusMessage(null);

    try {
      const res = await fetch('/api/inventory/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: recvProductId,
          stockLocationId: recvLocationId,
          fullSheets: Number(recvFullSheets),
          halfSheets: Number(recvHalfSheets),
          notes: recvNotes,
        }),
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Failed to receive stock');
      }

      setStatusMessage({ type: 'success', text: result.message || 'Stock received successfully' });
      setShowReceiveModal(false);
      setRecvNotes('');
      await fetchInventory();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to submit stock receipt' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDispatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setStatusMessage(null);

    try {
      const res = await fetch('/api/inventory/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: dispProductId,
          fromLocationId: dispFromLocId,
          toLocationId: dispToLocId,
          fullSheets: Number(dispFullSheets),
          halfSheets: Number(dispHalfSheets),
          notes: dispNotes,
        }),
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Failed to dispatch stock');
      }

      setStatusMessage({ type: 'success', text: result.message || 'Stock dispatched successfully' });
      setShowDispatchModal(false);
      setDispNotes('');
      await fetchInventory();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to dispatch stock' });
    } finally {
      setSubmitting(false);
    }
  };

  const warehouses = locations.filter((l) => l.locationType === 'warehouse');
  const trucks = locations.filter((l) => l.locationType === 'truck');

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header with Action Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
            <Layers className="w-5 h-5 text-blue-600" />
            Vehicle Fleet Glass & Route Inventory
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Sales & Vehicle Stock Accounting: Track glass sheets loaded on delivery trucks for daily route sales, deductions from customer deliveries, and depot reserves.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setStatusMessage(null);
              setShowReceiveModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            Load Sheets onto Truck / Bay
          </button>

          <button
            onClick={() => {
              setStatusMessage(null);
              setShowDispatchModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm transition"
          >
            <Truck className="w-4 h-4" />
            Transfer Stock to Vehicle
          </button>
        </div>
      </div>

      {/* Feedback banner */}
      {statusMessage && (
        <div
          className={`p-3.5 rounded-xl border mb-4 flex items-center justify-between text-xs font-medium ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-red-50 text-red-800 border-red-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
          <button onClick={() => setStatusMessage(null)} className="text-slate-400 hover:text-slate-600">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* FSE Rule Explanation */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4">
        <div className="flex items-start gap-2">
          <Package className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
          <div className="text-xs text-blue-800">
            <strong>Confirmed TOKA Rule:</strong> Full Sheet is the default sale unit. Half Sheets are produced ONLY upon customer order.
            Splitting 1 Full Sheet yields 2 physical Half Sheets (1 delivered, 1 retained in physical stock).
            <br />
            <strong>Formula:</strong> FSE = Full Sheets + (Half Sheets &times; 0.5).
          </div>
        </div>
      </div>

      {/* Stock Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-12 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto" />
            <p className="text-sm text-slate-500 mt-3">Loading inventory balances...</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider px-4 py-3">
                    Product & SKU
                  </th>
                  <th className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider px-4 py-3">
                    Stock Location
                  </th>
                  <th className="text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider px-4 py-3">
                    Physical Full Sheets
                  </th>
                  <th className="text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider px-4 py-3">
                    Physical Half Sheets
                  </th>
                  <th className="text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider px-4 py-3">
                    <span className="flex items-center justify-end gap-1">
                      FSE Total
                      <ArrowUpDown className="w-3 h-3" />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {balances.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-12">
                      <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                      <p className="text-sm font-semibold text-slate-700">No Inventory Recorded</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Use "Receive Supplier Stock" above to record initial factory sheets.
                      </p>
                    </td>
                  </tr>
                ) : (
                  balances.map((sb) => (
                    <tr key={`${sb.productId}-${sb.stockLocationId}`} className="border-b border-slate-100 hover:bg-slate-50/50">
                      <td className="px-4 py-3">
                        <div className="text-sm font-semibold text-slate-800">{sb.productName}</div>
                        <div className="text-[10px] text-slate-400">
                          {sb.sku} {sb.color && `· ${sb.color}`} {sb.thicknessMm ? `· ${sb.thicknessMm}mm` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                            sb.locationType === 'truck'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {sb.locationName}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-bold text-slate-800">
                        {sb.fullSheets}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-bold text-slate-800">
                        {sb.halfSheets}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-black text-blue-600 font-mono">
                        {Number(sb.fse).toFixed(1)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Receive Stock Modal */}
      {showReceiveModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Plus className="w-5 h-5 text-emerald-600" />
                Load Glass Sheets (Truck or Depot)
              </h2>
              <button onClick={() => setShowReceiveModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleReceiveSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Product</label>
                <select
                  value={recvProductId}
                  onChange={(e) => setRecvProductId(e.target.value)}
                  className="w-full text-xs rounded-lg border border-slate-200 p-2.5 bg-slate-50 focus:bg-white focus:ring-1 focus:ring-emerald-500"
                  required
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Destination Location (Truck Bay or Depot)</label>
                <select
                  value={recvLocationId}
                  onChange={(e) => setRecvLocationId(e.target.value)}
                  className="w-full text-xs rounded-lg border border-slate-200 p-2.5 bg-slate-50 focus:bg-white"
                  required
                >
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.locationType === 'truck' ? '🚚 ' : '🏢 '}{loc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Full Sheets</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={recvFullSheets}
                    onChange={(e) => setRecvFullSheets(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full text-xs rounded-lg border border-slate-200 p-2.5"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Half Sheets</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={recvHalfSheets}
                    onChange={(e) => setRecvHalfSheets(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full text-xs rounded-lg border border-slate-200 p-2.5"
                    required
                  />
                </div>
              </div>

              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 text-xs text-emerald-800 flex justify-between font-semibold">
                <span>Calculated Incoming FSE:</span>
                <span>{(recvFullSheets + recvHalfSheets * 0.5).toFixed(1)} FSE</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Supplier Delivery Notes / Waybill</label>
                <textarea
                  value={recvNotes}
                  onChange={(e) => setRecvNotes(e.target.value)}
                  placeholder="e.g. Supplier container shipment ref #4820"
                  className="w-full text-xs rounded-lg border border-slate-200 p-2.5 h-16 resize-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowReceiveModal(false)}
                  className="flex-1 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || (recvFullSheets === 0 && recvHalfSheets === 0)}
                  className="flex-1 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg shadow-sm"
                >
                  {submitting ? 'Recording...' : 'Record Receipt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dispatch Stock Modal */}
      {showDispatchModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Truck className="w-5 h-5 text-blue-600" />
                Dispatch Stock to Vehicle Bay
              </h2>
              <button onClick={() => setShowDispatchModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleDispatchSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Product</label>
                <select
                  value={dispProductId}
                  onChange={(e) => setDispProductId(e.target.value)}
                  className="w-full text-xs rounded-lg border border-slate-200 p-2.5 bg-slate-50 focus:bg-white"
                  required
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Source Depot / Warehouse</label>
                <select
                  value={dispFromLocId}
                  onChange={(e) => setDispFromLocId(e.target.value)}
                  className="w-full text-xs rounded-lg border border-slate-200 p-2.5 bg-slate-50 focus:bg-white"
                  required
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Destination Vehicle Rack</label>
                <select
                  value={dispToLocId}
                  onChange={(e) => setDispToLocId(e.target.value)}
                  className="w-full text-xs rounded-lg border border-slate-200 p-2.5 bg-slate-50 focus:bg-white"
                  required
                >
                  {trucks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Full Sheets to Load</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={dispFullSheets}
                    onChange={(e) => setDispFullSheets(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full text-xs rounded-lg border border-slate-200 p-2.5"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Half Sheets to Load</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={dispHalfSheets}
                    onChange={(e) => setDispHalfSheets(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full text-xs rounded-lg border border-slate-200 p-2.5"
                    required
                  />
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5 text-xs text-blue-800 flex justify-between font-semibold">
                <span>Total FSE to Transfer:</span>
                <span>{(dispFullSheets + dispHalfSheets * 0.5).toFixed(1)} FSE</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Dispatch / Rack Loading Notes</label>
                <textarea
                  value={dispNotes}
                  onChange={(e) => setDispNotes(e.target.value)}
                  placeholder="e.g. Loaded for Morning Shift — Driver David Ochieng"
                  className="w-full text-xs rounded-lg border border-slate-200 p-2.5 h-16 resize-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowDispatchModal(false)}
                  className="flex-1 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || (dispFullSheets === 0 && dispHalfSheets === 0)}
                  className="flex-1 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg shadow-sm"
                >
                  {submitting ? 'Dispatching...' : 'Dispatch to Truck'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
