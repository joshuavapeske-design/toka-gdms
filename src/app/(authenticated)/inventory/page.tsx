import { Layers, Package, ArrowUpDown } from 'lucide-react';
import { calculateStockFse } from '@/lib/decimal';

// Placeholder stock data — will be fetched from Supabase in production
const PLACEHOLDER_PRODUCTS = [
  {
    productId: '22222222-2222-2222-2222-222222222201',
    productName: '4mm Clear Sheet Glass',
    sku: 'GL-CLR-04-2418',
    locationId: '33333333-3333-3333-3333-333333333301',
    locationName: 'Main Central Warehouse',
    fullSheets: 10,
    halfSheets: 0,
  },
  {
    productId: '22222222-2222-2222-2222-222222222202',
    productName: '5mm Clear Sheet Glass',
    sku: 'GL-CLR-05-2418',
    locationId: '33333333-3333-3333-3333-333333333301',
    locationName: 'Main Central Warehouse',
    fullSheets: 9,
    halfSheets: 1,
  },
];

export default function InventoryPage() {
  // In production, fetch from Supabase stock_movements aggregate or materialized view
  const stockBalances = PLACEHOLDER_PRODUCTS.map((p) => ({
    ...p,
    fseTotal: calculateStockFse(p.fullSheets, p.halfSheets),
  }));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
          <Layers className="w-5 h-5 text-blue-600" />
          Inventory — Full Sheet Equivalents (FSE)
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Stock levels across all locations. FSE = Full Sheets + (Half Sheets × 0.5)
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
              {stockBalances.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12">
                    <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                    <p className="text-sm font-semibold text-slate-500">No Stock Data</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Connect to Supabase to view live inventory levels.
                    </p>
                  </td>
                </tr>
              ) : (
                stockBalances.map((sb) => (
                  <tr key={`${sb.productId}-${sb.locationId}`} className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="px-4 py-3">
                      <div className="text-sm font-semibold text-slate-800">{sb.productName}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{sb.sku}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">{sb.locationName}</td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-slate-800">{sb.fullSheets}</td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-slate-800">{sb.halfSheets}</td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`text-sm font-extrabold ${
                          sb.fseTotal <= 5
                            ? 'text-red-600'
                            : sb.fseTotal <= 15
                              ? 'text-amber-600'
                              : 'text-emerald-600'
                        }`}
                      >
                        {sb.fseTotal.toFixed(1)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
