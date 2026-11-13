'use client';

import { useCallback, useEffect, useState } from 'react';
import { Layers, Package, ArrowUpDown, Loader2, ArrowDownToLine, Truck, X, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';

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

interface ProductOption {
  id: string;
  name: string;
  sku: string;
  thicknessMm: number;
  color: string;
}

interface StockLocationOption {
  id: string;
  name: string;
  locationType: string;
  vehicleId?: string | null;
  vehicleRegistrationPlate?: string | null;
  vehicleModel?: string | null;
}

type StockOperation = 'receive' | 'dispatch';

export default function InventoryPage() {
  const { user } = useAuth();
  const [balances, setBalances] = useState<StockBalance[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [warehouses, setWarehouses] = useState<StockLocationOption[]>([]);
  const [vehicleLocations, setVehicleLocations] = useState<StockLocationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [operation, setOperation] = useState<StockOperation>('receive');
  const [productId, setProductId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [vehicleLocationId, setVehicleLocationId] = useState('');
  const [fullSheets, setFullSheets] = useState('0');
  const [halfSheets, setHalfSheets] = useState('0');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ success: boolean; text: string } | null>(null);

  const canManageStock = user?.role === 'owner' || user?.role === 'manager';

  const loadInventory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/inventory', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Unable to load inventory.');
      setBalances(result.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load inventory.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOptions = useCallback(async () => {
    setOptionsLoading(true);
    try {
      const [productResponse, locationResponse] = await Promise.all([
        fetch('/api/data/products', { cache: 'no-store' }),
        fetch('/api/data/stock-locations', { cache: 'no-store' }),
      ]);
      const productResult = await productResponse.json();
      const locationResult = await locationResponse.json();
      if (productResponse.ok && productResult.success) setProducts(productResult.data || []);
      if (locationResponse.ok && locationResult.success) {
        setWarehouses(locationResult.data?.warehouses || []);
        setVehicleLocations(locationResult.data?.vehicles || []);
      }
    } catch (err) {
      console.error('Failed to load stock operation options:', err);
    } finally {
      setOptionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInventory();
    void loadOptions();
  }, [loadInventory, loadOptions]);

  const openStockModal = (nextOperation: StockOperation) => {
    setOperation(nextOperation);
    setProductId(products[0]?.id || '');
    setWarehouseId(warehouses[0]?.id || '');
    setVehicleLocationId(vehicleLocations[0]?.id || '');
    setFullSheets('0');
    setHalfSheets('0');
    setNotes('');
    setStatusMessage(null);
    setShowModal(true);
  };

  const handleStockSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    const full = Number(fullSheets);
    const half = Number(halfSheets);
    if (!Number.isSafeInteger(full) || !Number.isSafeInteger(half) || full < 0 || half < 0 || (full === 0 && half === 0)) {
      setStatusMessage({ success: false, text: 'Enter a positive whole-sheet or half-sheet quantity. Decimals are not allowed.' });
      return;
    }
    if (!productId || !warehouseId || (operation === 'dispatch' && !vehicleLocationId)) {
      setStatusMessage({ success: false, text: 'Select a product and all required stock locations.' });
      return;
    }

    setSubmitting(true);
    setStatusMessage(null);
    try {
      const payload = operation === 'receive'
        ? { operation, productId, locationId: warehouseId, fullSheets: full, halfSheets: half, notes: notes.trim() || undefined }
        : { operation, productId, warehouseId, vehicleLocationId, fullSheets: full, halfSheets: half, notes: notes.trim() || undefined };

      const response = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        setStatusMessage({ success: false, text: result.error || 'Stock movement was rejected.' });
        return;
      }

      setStatusMessage({
        success: true,
        text: operation === 'receive'
          ? 'Stock receipt recorded in the warehouse ledger.'
          : 'Stock dispatch recorded and transferred to the vehicle.',
      });
      setShowModal(false);
      await loadInventory();
    } catch (err) {
      setStatusMessage({ success: false, text: err instanceof Error ? err.message : 'Unable to record stock movement.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
            <Layers className="w-5 h-5 text-blue-600" />
            Inventory — Full Sheet Equivalents (FSE)
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Physical stock by glass specification and location. FSE = Full Sheets + (Half Sheets × 0.5)
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void loadInventory()} disabled={loading} className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-700 text-xs font-semibold rounded-lg disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          {canManageStock && (
            <>
              <button onClick={() => openStockModal('receive')} className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg">
                <ArrowDownToLine className="w-3.5 h-3.5" /> Receive Stock
              </button>
              <button onClick={() => openStockModal('dispatch')} className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg">
                <Truck className="w-3.5 h-3.5" /> Dispatch to Vehicle
              </button>
            </>
          )}
        </div>
      </div>

      {statusMessage && !showModal && (
        <div className={`mb-4 flex items-start gap-2 p-3 rounded-lg border text-xs ${statusMessage.success ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {statusMessage.success ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
          {statusMessage.text}
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4">
        <div className="flex items-start gap-2">
          <Package className="w-4 h-4 text-blue-600 mt-0.5" />
          <div className="text-xs text-blue-800">
            <strong>Physical stock rule:</strong> TOKA sells full sheets by default. Half sheets are produced and sold only upon a specific customer order.
            Splitting one full sheet produces two physical half sheets. If one is delivered, the remaining half stays in stock.
            <div className="mt-1"><strong>Formula:</strong> FSE = Full Sheets + (Half Sheets × 0.5). For example, 9 full sheets + 1 half sheet = 9.5 FSE.</div>
          </div>
        </div>
      </div>

      {!optionsLoading && canManageStock && warehouses.length === 0 && (
        <div className="mb-4 p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800">
          No active warehouse location is configured. Add or activate a warehouse stock location before receiving stock.
        </div>
      )}
      {!optionsLoading && canManageStock && vehicleLocations.length === 0 && (
        <div className="mb-4 p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800">
          No active vehicle stock locations are configured. Create a vehicle and its truck stock location before dispatching stock.
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-start gap-2 p-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
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
                  <th className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider px-4 py-3">Product & SKU</th>
                  <th className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider px-4 py-3">Location</th>
                  <th className="text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider px-4 py-3">Full Sheets</th>
                  <th className="text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider px-4 py-3">Half Sheets</th>
                  <th className="text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider px-4 py-3">
                    <span className="flex items-center justify-end gap-1">FSE Total <ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {balances.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-12">
                      <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                      <p className="text-sm font-semibold text-slate-700">No Inventory Balances Recorded</p>
                      <p className="text-xs text-slate-400 mt-0.5">Receive supplier stock into the warehouse, then dispatch the required quantities to an active vehicle.</p>
                    </td>
                  </tr>
                ) : balances.map((sb) => (
                  <tr key={`${sb.productId}-${sb.stockLocationId}`} className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="px-4 py-3">
                      <div className="text-sm font-semibold text-slate-800">{sb.productName}</div>
                      <div className="text-[10px] text-slate-400">{sb.sku} {sb.color && `· ${sb.color}`} {sb.thicknessMm ? `· ${sb.thicknessMm}mm` : ''}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 text-slate-700">{sb.locationName}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-slate-800">{sb.fullSheets}</td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-slate-800">{sb.halfSheets}</td>
                    <td className="px-4 py-3 text-right text-sm font-black text-blue-600 font-mono">{Number(sb.fse).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <div>
                <h2 className="text-base font-extrabold text-slate-900">{operation === 'receive' ? 'Receive Supplier Stock' : 'Dispatch Stock to Vehicle'}</h2>
                <p className="text-xs text-slate-500 mt-0.5">Records an immutable stock movement in the database.</p>
              </div>
              <button onClick={() => setShowModal(false)} aria-label="Close" className="p-1 text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleStockSubmit} className="p-5 space-y-3">
              {statusMessage && (
                <div className={`p-3 rounded-lg border text-xs ${statusMessage.success ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>{statusMessage.text}</div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Glass Product</label>
                <select value={productId} onChange={(event) => setProductId(event.target.value)} required className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white">
                  <option value="">Select product...</option>
                  {products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}
                </select>
              </div>

              {operation === 'receive' ? (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Destination Warehouse</label>
                  <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} required className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white">
                    <option value="">Select warehouse...</option>
                    {warehouses.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                  </select>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Source Warehouse</label>
                    <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} required className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white">
                      <option value="">Select warehouse...</option>
                      {warehouses.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Destination Vehicle</label>
                    <select value={vehicleLocationId} onChange={(event) => setVehicleLocationId(event.target.value)} required className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white">
                      <option value="">Select vehicle...</option>
                      {vehicleLocations.map((location) => <option key={location.id} value={location.id}>{location.vehicleRegistrationPlate || location.name} · {location.name}</option>)}
                    </select>
                  </div>
                </>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Full Sheets</label>
                  <input type="number" min="0" step="1" value={fullSheets} onChange={(event) => setFullSheets(event.target.value)} required className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Physical Half Sheets</label>
                  <input type="number" min="0" step="1" value={halfSheets} onChange={(event) => setHalfSheets(event.target.value)} required className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Notes (optional)</label>
                <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} maxLength={500} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg resize-none" placeholder={operation === 'receive' ? 'Supplier delivery note or reference...' : 'Dispatch note or loading reference...'} />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-xs font-bold text-slate-700 border border-slate-200 rounded-lg">Cancel</button>
                <button type="submit" disabled={submitting || optionsLoading || products.length === 0 || warehouses.length === 0 || (operation === 'dispatch' && vehicleLocations.length === 0)} className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50">
                  {submitting ? 'Recording...' : operation === 'receive' ? 'Confirm Receipt' : 'Confirm Dispatch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
