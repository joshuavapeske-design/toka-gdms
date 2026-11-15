'use client';

import { useState, useEffect } from 'react';
import { Users, Plus, Search, Phone, MapPin, CreditCard, ShieldCheck, Edit3, X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { formatKES } from '@/lib/decimal';
import type { Customer } from '@/types';

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Add Customer Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [submittingAdd, setSubmittingAdd] = useState(false);
  const [name, setName] = useState('');
  const [primaryPhone, setPrimaryPhone] = useState('');
  const [altPhone, setAltPhone] = useState('');
  const [deliveryArea, setDeliveryArea] = useState('');
  const [isCreditEligible, setIsCreditEligible] = useState(false);
  const [creditLimit, setCreditLimit] = useState<number>(0);

  // Edit Credit Terms Modal
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [submittingEdit, setSubmittingEdit] = useState(false);
  const [editEligible, setEditEligible] = useState(false);
  const [editCreditLimit, setEditCreditLimit] = useState<number>(0);

  const loadCustomers = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/data/customers');
      if (res.ok) {
        const json = await res.json();
        if (json.data) setCustomers(json.data);
      }
    } catch (err) {
      console.error('Failed to load customers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmittingAdd(true);
      setStatusMessage(null);

      const res = await fetch('/api/data/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          primaryPhone,
          altPhone: altPhone || undefined,
          deliveryArea,
          isCreditEligible: isCreditEligible || creditLimit > 0,
          creditLimit: Number(creditLimit) || 0,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to add customer');
      }

      setStatusMessage({ type: 'success', text: data.message || 'Customer created successfully.' });
      setShowAddModal(false);
      // Reset form
      setName('');
      setPrimaryPhone('');
      setAltPhone('');
      setDeliveryArea('');
      setIsCreditEligible(false);
      setCreditLimit(0);
      await loadCustomers();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to add customer' });
    } finally {
      setSubmittingAdd(false);
    }
  };

  const openEditCredit = (c: Customer) => {
    setEditingCustomer(c);
    setEditEligible(c.isCreditEligible);
    setEditCreditLimit(c.creditLimit);
    setStatusMessage(null);
  };

  const handleUpdateCredit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer) return;

    try {
      setSubmittingEdit(true);
      setStatusMessage(null);

      const res = await fetch('/api/data/customers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: editingCustomer.id,
          isCreditEligible: editEligible || editCreditLimit > 0,
          creditLimit: Number(editCreditLimit) || 0,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update credit terms');
      }

      setStatusMessage({ type: 'success', text: data.message || 'Customer credit terms updated.' });
      setEditingCustomer(null);
      await loadCustomers();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to update credit terms' });
    } finally {
      setSubmittingEdit(false);
    }
  };

  const filtered = search.trim()
    ? customers.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.accountNumber.toLowerCase().includes(search.toLowerCase()) ||
          c.primaryPhone.includes(search) ||
          c.deliveryArea.toLowerCase().includes(search.toLowerCase())
      )
    : customers;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            Customers & Credit Directory
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Universal Customer Registration: Any salesperson, driver, or crew member can register customers on the road. Higher management audits all new additions below.
          </p>
        </div>
        <button
          onClick={() => {
            setShowAddModal(true);
            setStatusMessage(null);
          }}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition"
        >
          <Plus className="w-4 h-4" />
          Add Customer on Route
        </button>
      </div>

      {/* Higher Management Audit: Recently Added Customers */}
      <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white rounded-xl p-5 border border-blue-800 shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-blue-800">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <h2 className="text-sm font-bold text-white">Higher Management Audit — New Customer Onboarding</h2>
            <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-bold">
              Owner & Manager Oversight
            </span>
          </div>
          <span className="text-xs text-blue-200">
            {customers.length} total customers registered
          </span>
        </div>

        <div className="mt-3">
          <div className="text-xs text-blue-200 mb-2 font-medium">
            Review newly onboarded customers added by field reps & drivers:
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {customers.slice(0, 3).map((nc) => (
              <div key={nc.id} className="bg-slate-800/80 rounded-lg p-3 border border-slate-700">
                <div className="flex items-start justify-between">
                  <div className="font-bold text-white text-xs truncate">{nc.name}</div>
                  <span className="text-[10px] font-mono text-blue-300 bg-blue-950/80 px-1.5 py-0.5 rounded border border-blue-800">
                    {nc.accountNumber}
                  </span>
                </div>
                <div className="text-[11px] text-slate-300 mt-1">
                  Location: <span className="font-medium text-white">{nc.deliveryArea}</span>
                </div>
                <div className="text-[11px] text-emerald-300 mt-0.5">
                  Added by: <span className="font-bold text-white">{nc.createdByName || 'Grace Muthoni (Salesperson)'}</span>
                </div>
                <div className="mt-2.5 pt-2 border-t border-slate-700 flex items-center justify-between">
                  <span className="text-[10px] text-slate-400">
                    {nc.isCreditEligible ? `Credit Limit: ${formatKES(nc.creditLimit)}` : 'Cash Terms (No Credit)'}
                  </span>
                  <button
                    onClick={() => openEditCredit(nc)}
                    className="text-[10px] text-blue-300 hover:text-white font-bold underline cursor-pointer"
                  >
                    Adjust Credit
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
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

      {/* Search Input */}
      <div>
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by customer name, account number, phone, or area..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none shadow-xs"
          />
        </div>
      </div>

      {/* Customers List / Grid */}
      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm flex flex-col items-center gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          Loading customer directory...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-700">No Customers Found</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            {search ? 'Try adjusting your search criteria.' : 'No customer records are currently loaded.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((customer) => (
            <div
              key={customer.id}
              className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-shadow flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                      {customer.accountNumber}
                    </span>
                    <h3 className="text-sm font-bold text-slate-900 mt-1.5">{customer.name}</h3>
                  </div>
                  {customer.isCreditEligible ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                      <ShieldCheck className="w-3 h-3" /> Credit Approved
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                      Cash Only
                    </span>
                  )}
                </div>

                <div className="mt-3 space-y-1 text-xs text-slate-600">
                  <div className="flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    <span>{customer.primaryPhone}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    <span>{customer.deliveryArea}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 pt-1">
                    Onboarded by: <span className="font-semibold text-slate-700">{customer.createdByName || 'Field Sales Rep'} {customer.createdByRole ? `(${customer.createdByRole})` : ''}</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-semibold">Credit Limit</div>
                  <div className="text-xs font-bold text-slate-800">
                    {formatKES(customer.creditLimit)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">Balance Due</div>
                    <div
                      className={`text-xs font-extrabold ${
                        (customer.currentBalance || 0) > 0 ? 'text-red-600' : 'text-emerald-600'
                      }`}
                    >
                      {formatKES(customer.currentBalance || 0)}
                    </div>
                  </div>
                  <button
                    onClick={() => openEditCredit(customer)}
                    title="Edit Credit Terms"
                    className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-blue-600 hover:border-blue-300 transition"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Customer Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 relative animate-in fade-in zoom-in duration-150">
            <h3 className="text-lg font-semibold text-slate-900 mb-1">Add New Customer</h3>
            <p className="text-xs text-slate-500 mb-4">
              Register a client workshop or glazier in the directory.
            </p>

            <form onSubmit={handleAddCustomer} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Business / Customer Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Apex Glaziers Ltd"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Primary Mobile Phone (SMS Notifications)
                </label>
                <input
                  type="text"
                  placeholder="e.g. +254712345678 or 0712345678"
                  value={primaryPhone}
                  onChange={(e) => setPrimaryPhone(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Alternate Phone (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. +254722000000"
                  value={altPhone}
                  onChange={(e) => setAltPhone(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Delivery Area / Workshop Address
                </label>
                <input
                  type="text"
                  placeholder="e.g. Industrial Area, Enterprise Road"
                  value={deliveryArea}
                  onChange={(e) => setDeliveryArea(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div className="pt-2 border-t border-slate-100">
                <div className="flex items-center gap-2 mb-3">
                  <input
                    type="checkbox"
                    id="isCreditEligible"
                    checked={isCreditEligible}
                    onChange={(e) => setIsCreditEligible(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label htmlFor="isCreditEligible" className="text-xs font-medium text-slate-700 cursor-pointer">
                    Eligible for Credit Deliveries
                  </label>
                </div>

                {isCreditEligible && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Authorized Credit Limit (KES)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1000"
                      value={creditLimit}
                      onChange={(e) => setCreditLimit(parseFloat(e.target.value) || 0)}
                      className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  disabled={submittingAdd}
                  className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-300 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingAdd}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition disabled:opacity-50"
                >
                  {submittingAdd && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save Customer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Credit Terms Modal */}
      {editingCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 relative animate-in fade-in zoom-in duration-150">
            <h3 className="text-lg font-semibold text-slate-900 mb-1">
              Adjust Credit Terms
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Modify credit eligibility and ceiling for <span className="font-semibold text-slate-800">{editingCustomer.name}</span> ({editingCustomer.accountNumber}).
            </p>

            <form onSubmit={handleUpdateCredit} className="space-y-4">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="editEligible"
                  checked={editEligible}
                  onChange={(e) => setEditEligible(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="editEligible" className="text-xs font-medium text-slate-700 cursor-pointer">
                  Credit Terms Approved
                </label>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Authorized Credit Ceiling (KES)
                </label>
                <input
                  type="number"
                  min="0"
                  step="5000"
                  value={editCreditLimit}
                  onChange={(e) => setEditCreditLimit(parseFloat(e.target.value) || 0)}
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
                <span className="text-slate-500">Current Outstanding Balance: </span>
                <span className="font-bold text-slate-900">
                  {formatKES(editingCustomer.currentBalance || 0)}
                </span>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingCustomer(null)}
                  disabled={submittingEdit}
                  className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-300 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingEdit}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition disabled:opacity-50"
                >
                  {submittingEdit && <Loader2 className="h-4 w-4 animate-spin" />}
                  Update Credit
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
