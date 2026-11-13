'use client';

import { useState, useEffect } from 'react';
import { DollarSign, ShieldCheck, AlertTriangle, CheckCircle2, AlertCircle, Loader2, User, Clock, ArrowRight } from 'lucide-react';
import Decimal from 'decimal.js';

interface Turnover {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  shiftDate: string;
  cashDeclared: number;
  personalMpesaDeclared: number;
  cashRemitted: number;
  mpesaForwarded: number;
  variance: number;
  settledWithCashierId: string | null;
  cashierName: string | null;
  settledAt: string | null;
  notes?: string | null;
  createdAt: string;
}

export default function RemittancesPage() {
  const [turnovers, setTurnovers] = useState<Turnover[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTurnover, setSelectedTurnover] = useState<Turnover | null>(null);
  const [cashRemittedInput, setCashRemittedInput] = useState<number>(0);
  const [mpesaForwardedInput, setMpesaForwardedInput] = useState<number>(0);
  const [notesInput, setNotesInput] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchTurnovers = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/turnovers');
      if (res.ok) {
        const data = await res.json();
        setTurnovers(data.data || []);
      }
    } catch (err) {
      console.error('Failed to load turnover liabilities:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTurnovers();
  }, []);

  const openSettleModal = (item: Turnover) => {
    setSelectedTurnover(item);
    // Pre-populate with declared amounts as default target
    setCashRemittedInput(item.cashDeclared);
    setMpesaForwardedInput(item.personalMpesaDeclared);
    setNotesInput(item.notes || '');
    setStatusMessage(null);
  };

  const handleSettle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTurnover) return;

    try {
      setSubmitting(true);
      setStatusMessage(null);

      const res = await fetch('/api/turnovers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          turnoverId: selectedTurnover.id,
          cashRemitted: Number(cashRemittedInput),
          mpesaForwarded: Number(mpesaForwardedInput),
          notes: notesInput,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to settle remittance');
      }

      setStatusMessage({ type: 'success', text: data.message || 'Remittance settled successfully.' });
      setSelectedTurnover(null);
      await fetchTurnovers();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'An error occurred during settlement.' });
    } finally {
      setSubmitting(false);
    }
  };

  // Computations
  const totalOutstandingLiability = turnovers.reduce((acc, t) => {
    return t.settledAt ? acc : acc.plus(new Decimal(t.cashDeclared).plus(t.personalMpesaDeclared));
  }, new Decimal(0)).toNumber();

  const totalCashDeclared = turnovers.reduce((acc, t) => acc.plus(t.cashDeclared), new Decimal(0)).toNumber();
  const totalMpesaDeclared = turnovers.reduce((acc, t) => acc.plus(t.personalMpesaDeclared), new Decimal(0)).toNumber();
  const totalRemittedAll = turnovers.reduce((acc, t) => acc.plus(new Decimal(t.cashRemitted).plus(t.mpesaForwarded)), new Decimal(0)).toNumber();

  // Modal live variance calculation
  const modalTotalDeclared = selectedTurnover
    ? new Decimal(selectedTurnover.cashDeclared).plus(selectedTurnover.personalMpesaDeclared)
    : new Decimal(0);
  const modalTotalRemitted = new Decimal(cashRemittedInput || 0).plus(mpesaForwardedInput || 0);
  const modalLiveVariance = modalTotalRemitted.minus(modalTotalDeclared);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Cashier Remittance & Settlement</h1>
        <p className="text-sm text-slate-500 mt-1">
          Reconcile driver and field salesperson turnover liabilities against physical cash handed over and M-Pesa forwarded.
        </p>
      </div>

      {/* Status Banner */}
      {statusMessage && (
        <div
          className={`p-4 rounded-lg flex items-center gap-3 text-sm ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          {statusMessage.type === 'success' ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Unsettled Liabilities</span>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900">
            KES {totalOutstandingLiability.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
          </div>
          <p className="text-xs text-slate-400 mt-1">Awaiting cashier handover</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Cash Declared</span>
            <DollarSign className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold text-slate-900">
            KES {totalCashDeclared.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
          </div>
          <p className="text-xs text-slate-400 mt-1">Physical driver cash collected</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Personal M-Pesa</span>
            <DollarSign className="h-4 w-4 text-blue-600" />
          </div>
          <div className="text-2xl font-bold text-slate-900">
            KES {totalMpesaDeclared.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
          </div>
          <p className="text-xs text-slate-400 mt-1">Sent to employee personal phone</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Remitted</span>
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold text-emerald-700">
            KES {totalRemittedAll.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
          </div>
          <p className="text-xs text-slate-400 mt-1">Verified and received by cashier</p>
        </div>
      </div>

      {/* Turnover List Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-slate-500" />
            <h2 className="text-base font-semibold text-slate-900">Employee Shift Turnovers</h2>
          </div>
          <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
            {turnovers.length} Records
          </span>
        </div>

        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
            <p className="text-sm">Loading employee turnover records...</p>
          </div>
        ) : turnovers.length === 0 ? (
          <div className="py-12 text-center text-slate-500">
            <DollarSign className="h-10 w-10 mx-auto text-slate-300 mb-2" />
            <p className="text-sm">No turnover records recorded yet.</p>
            <p className="text-xs text-slate-400 mt-1">Turnover records are automatically created when drivers collect cash or personal M-Pesa during deliveries.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/75 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  <th className="py-3 px-4">Employee</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4 text-right">Cash Declared</th>
                  <th className="py-3 px-4 text-right">Pers. M-Pesa</th>
                  <th className="py-3 px-4 text-right">Total Liability</th>
                  <th className="py-3 px-4 text-right">Remitted</th>
                  <th className="py-3 px-4 text-right">Variance</th>
                  <th className="py-3 px-4">Settlement Status</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {turnovers.map((t) => {
                  const totalLiability = new Decimal(t.cashDeclared).plus(t.personalMpesaDeclared).toNumber();
                  const totalRemitted = new Decimal(t.cashRemitted).plus(t.mpesaForwarded).toNumber();
                  const isSettled = t.settledAt !== null;

                  return (
                    <tr key={t.id} className="hover:bg-slate-50/50 transition">
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-slate-400" />
                          <div>
                            <div className="font-semibold text-slate-900">{t.employeeName}</div>
                            <span className="text-xs text-slate-500 capitalize">{t.employeeRole}</span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap text-slate-700">
                        {t.shiftDate}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap text-right font-medium text-slate-900">
                        KES {t.cashDeclared.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap text-right font-medium text-slate-900">
                        KES {t.personalMpesaDeclared.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap text-right font-bold text-slate-900">
                        KES {totalLiability.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap text-right text-emerald-700 font-medium">
                        KES {totalRemitted.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap text-right">
                        {t.variance === 0 ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800">
                            KES 0.00
                          </span>
                        ) : t.variance < 0 ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-rose-100 text-rose-800">
                            KES {t.variance.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800">
                            +KES {t.variance.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {isSettled ? (
                          <div className="text-xs">
                            <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Settled
                            </span>
                            {t.cashierName && (
                              <div className="text-slate-400 mt-0.5">by {t.cashierName}</div>
                            )}
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                            <Clock className="h-3 w-3" />
                            Pending Handover
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap text-right">
                        <button
                          onClick={() => openSettleModal(t)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 transition"
                        >
                          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                          {isSettled ? 'Re-adjust' : 'Reconcile'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Remittance Settlement Modal */}
      {selectedTurnover && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 relative animate-in fade-in zoom-in duration-150">
            <h3 className="text-lg font-semibold text-slate-900 mb-1">
              Reconcile Employee Remittance
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Enter physical cash counted and verified M-Pesa forwarded by {selectedTurnover.employeeName} for shift date {selectedTurnover.shiftDate}.
            </p>

            <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 mb-4 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">Employee Cash Declared:</span>
                <span className="font-semibold text-slate-900">
                  KES {selectedTurnover.cashDeclared.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Employee Personal M-Pesa Declared:</span>
                <span className="font-semibold text-slate-900">
                  KES {selectedTurnover.personalMpesaDeclared.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-200">
                <span className="font-bold text-slate-700">Total Liability To Remit:</span>
                <span className="font-bold text-slate-900">
                  KES {modalTotalDeclared.toNumber().toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            <form onSubmit={handleSettle} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Physical Cash Handed Over (KES)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={cashRemittedInput}
                  onChange={(e) => setCashRemittedInput(parseFloat(e.target.value) || 0)}
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  M-Pesa Forwarded to Company Till/Paybill (KES)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={mpesaForwardedInput}
                  onChange={(e) => setMpesaForwardedInput(parseFloat(e.target.value) || 0)}
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                />
              </div>

              {/* Live Variance Calculation Display */}
              <div className="p-3 rounded-lg border text-xs">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-semibold text-slate-700">Total Actual Received:</span>
                  <span className="font-bold text-slate-900">
                    KES {modalTotalRemitted.toNumber().toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between items-center pt-1 border-t border-slate-200">
                  <span className="font-bold text-slate-700">Calculated Variance:</span>
                  <span
                    className={`font-bold ${
                      modalLiveVariance.isZero()
                        ? 'text-emerald-700'
                        : modalLiveVariance.isNegative()
                        ? 'text-rose-700'
                        : 'text-amber-700'
                    }`}
                  >
                    {modalLiveVariance.isNegative() ? '' : '+'}
                    KES {modalLiveVariance.toNumber().toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                {modalLiveVariance.isNegative() && (
                  <p className="text-[11px] text-rose-600 mt-2 font-medium">
                    ⚠️ Shortfall of KES {modalLiveVariance.abs().toNumber().toLocaleString('en-KE', { minimumFractionDigits: 2 })} will remain logged against {selectedTurnover.employeeName} until resolved.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Cashier Notes / Reconciliation Remarks (Optional)
                </label>
                <textarea
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  placeholder="e.g. Verified denominations, envelope sealed, receipts checked."
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  rows={2}
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSelectedTurnover(null)}
                  disabled={submitting}
                  className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-300 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition disabled:opacity-50"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Confirm Remittance
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
