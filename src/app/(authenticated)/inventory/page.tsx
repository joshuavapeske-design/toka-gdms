'use client';

import { useState, useEffect } from 'react';
import { Layers, Package, ArrowUpDown, Loader2 } from 'lucide-react';
import { calculateStockFse } from '@/lib/decimal';

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

export default function InventoryPage() {
  const [balances, setBalances] = useState<StockBalance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchInventory() {
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
    }
    fetchInventory();
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
          <Layers className="w-5 h-5 text-blue-600" />
          Inventory — Full Sheet Equivalents (FSE)
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Live stock levels across all locations. FSE = Full Sheets + (Half Sheets × 0.5)
        </p>
      </div>

      {/* FSE legend */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4">
        <div className="flex items-start gap-2">
          <Package className="w-4 h-4 text-blue-600 mt-0.5" />
          <div className="text-xs text-blue-800">
            <strong>How FSE works:</strong> TOKA sells Full Sheets by default. Half Sheets are produced and sold ONLY upon specific customer order.
            Splitting 1 Full Sheet produces 2 physical Half Sheets (1 delivered, 1 remains in physical stock).
            <br />
            <strong>Formula:</strong> FSE = Full Sheets + (Half Sheets × 0.5) (e.g. 9 Full Sheets + 1 Half Sheet = 9.5 FSE).
          </div>
        </div>
      </div>

      {/* Stock table */}
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
                  <th className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider px-4 py-3">
                    Product & SKU
                  </th>
                  <th className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider px-4 py-3">
                    Location
                  </th>
                  <th className="text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider px-4 py-3">
                    Full Sheets
                  </th>
                  <th className="text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider px-4 py-3">
                    Half Sheets
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
                      <p className="text-sm font-semibold text-slate-700">No Inventory Balances Recorded</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Stock receipts into warehouse will create and update live inventory balance rows.
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
                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 text-slate-700">
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
    </div>
  );
}
