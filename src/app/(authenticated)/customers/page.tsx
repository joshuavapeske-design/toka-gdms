'use client';

import { useState, useEffect } from 'react';
import { Users, Plus, Search, Phone, MapPin, CreditCard, ShieldCheck, X, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { formatKES } from '@/lib/decimal';
import type { Customer } from '@/types';
import { useAuth } from '@/components/AuthProvider';

export default function CustomersPage() {
  const { user } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<{ success: boolean; text: string } | null>(null);

  const [accountNumber, setAccountNumber] = useState('');
  const [name, setName] = useState('');
  const [primaryPhone, setPrimaryPhone] = useState('+254');
  const [altPhone, setAltPhone] = useState('');
  const [deliveryArea, setDeliveryArea] = useState('');
  const [isCreditEligible, setIsCreditEligible] = useState(false);
  const [creditLimit, setCreditLimit] = useState('0');

  const canManageCustomers = user?.role === 'owner' || user?.role === 'manager';

  async function loadCustomers() {
    try {
      const res = await fetch('/api/data/customers', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Unable to load customers.');
      if (json.data) setCustomers(json.data);
    } catch (err) {
      console.error('Failed to load customers:', err);
      setNotice({ success: false, text: err instanceof Error ? err.message : 'Unable to load customers.' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCustomers();
  }, []);

  const handleCreateCustomer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setNotice(null);

    try {
      const response = await fetch('/api/data/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountNumber: accountNumber.trim(),
          name: name.trim(),
          primaryPhone: primaryPhone.trim(),
          altPhone: altPhone.trim() || undefined,
          deliveryArea: deliveryArea.trim(),
          isCreditEligible,
          creditLimit: isCreditEligible ? Number(creditLimit) : 0,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Unable to create customer.');

      setNotice({ success: true, text: `Customer ${result.data.name} was added to the connected TOKA database.` });
      setShowCreateModal(false);
      setAccountNumber('');
      setName('');
      setPrimaryPhone('+254');
      setAltPhone('');
      setDeliveryArea('');
      setIsCreditEligible(false);
      setCreditLimit('0');
      await loadCustomers();
    } catch (err) {
      setNotice({ success: false, text: err instanceof Error ? err.message : 'Unable to create customer.' });
    } finally {
      setCreating(false);
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            Customers & Credit Directory
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Registered customer accounts, authorized credit limits, and delivery locations
          </p>
        </div>
        {canManageCustomers && (
          <button onClick={() => { setNotice(null); setShowCreateModal(true); }} className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg shadow-sm transition">
            <Plus className="w-4 h-4" /> Add Customer
          </button>
        )}
      </div>

      {notice && (
        <div className={`mb-4 flex items-start gap-2 p-3 rounded-lg border text-xs ${notice.success ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {notice.success ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
          {notice.text}
        </div>
      )}

      <div className="mb-6">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by customer name, account number, phone, or area..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none shadow-xs"
          />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Loading customer directory...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-700">No Customers Found</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            {search ? 'Try adjusting your search criteria.' : 'No customer records are currently loaded.'}
          </p>
          {canManageCustomers && !search && <button onClick={() => setShowCreateModal(true)} className="mt-4 inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold"><Plus className="w-3.5 h-3.5" /> Add First Customer</button>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((customer) => (
            <div key={customer.id} className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-shadow flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">{customer.accountNumber}</span>
                    <h3 className="text-sm font-bold text-slate-900 mt-1.5">{customer.name}</h3>
                  </div>
                  {customer.isCreditEligible ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200"><ShieldCheck className="w-3 h-3" /> Credit Approved</span>
                  ) : (
                    <span className="text-[10px] font-semibold text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">Cash Only</span>
                  )}
                </div>
                <div className="mt-3 space-y-1 text-xs text-slate-600">
                  <div className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 text-slate-400" /><span>{customer.primaryPhone}</span></div>
                  <div className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-slate-400" /><span>{customer.deliveryArea}</span></div>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-semibold">Credit Limit</div>
                  <div className="text-xs font-bold text-slate-800">{formatKES(customer.creditLimit)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-slate-400 uppercase font-semibold">Balance Due</div>
                  <div className={`text-xs font-extrabold ${(customer.currentBalance || 0) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatKES(customer.currentBalance || 0)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 p-5">
              <div>
                <h2 className="text-base font-extrabold text-slate-900">Add Customer Account</h2>
                <p className="mt-0.5 text-xs text-slate-500">New account will be stored in the shared staging database.</p>
              </div>
              <button type="button" onClick={() => setShowCreateModal(false)} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreateCustomer} className="space-y-3 p-5">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">Account Number</label>
                <input required minLength={3} maxLength={30} value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="e.g. CUST-005" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">Business / Customer Name</label>
                <input required minLength={2} maxLength={160} value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">Primary Phone (E.164)</label>
                  <input required value={primaryPhone} onChange={(e) => setPrimaryPhone(e.target.value)} placeholder="+2547XXXXXXXX" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">Alternative Phone</label>
                  <input value={altPhone} onChange={(e) => setAltPhone(e.target.value)} placeholder="+2547XXXXXXXX" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">Delivery Area</label>
                <input required minLength={2} maxLength={160} value={deliveryArea} onChange={(e) => setDeliveryArea(e.target.value)} placeholder="Estate, road or delivery zone" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </div>
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-xs font-semibold text-slate-700">
                <input type="checkbox" checked={isCreditEligible} onChange={(e) => { setIsCreditEligible(e.target.checked); if (!e.target.checked) setCreditLimit('0'); }} />
                Customer is approved for credit
              </label>
              {isCreditEligible && (
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">Approved Credit Limit (KES)</label>
                  <input type="number" min="0" step="0.01" required value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowCreateModal(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700">Cancel</button>
                <button type="submit" disabled={creating} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {creating ? 'Saving...' : 'Create Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
