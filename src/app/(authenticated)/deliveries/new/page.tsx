'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Truck,
  ChevronLeft,
  Plus,
  Trash2,
  MapPin,
  Send,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import type { Customer, Product, DeliveryItem, PaymentDeclaration, SellingUnit, PaymentChannel, VehicleAssignment } from '@/types';
import {
  calculateFse,
  calculateLineTotal,
  calculateDeliveryTotals,
  calculatePaymentBalances,
  formatKES,
} from '@/lib/decimal';
import { generateClientTxId, generateDeliveryReference } from '@/lib/uuid';
import { queueOfflineDelivery, getOfflineDb, type QueuedOfflineDelivery } from '@/lib/offline/db';
import Link from 'next/link';

// ──────────────────── Item row type (form state, not persisted) ────────────
interface DraftItem {
  key: string;
  productId: string;
  sellingUnit: SellingUnit;
  quantity: number;
  appliedUnitPrice: number;
  officialUnitPrice: number;
  isSpecialPrice: boolean;
}

// ──────────────────── Payment row type ─────────────────────────────────────
interface DraftPayment {
  key: string;
  channel: PaymentChannel;
  declaredAmount: number;
  externalRef: string;
}

const PAYMENT_CHANNELS: { value: PaymentChannel; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'mpesa_company_till', label: 'Company M-Pesa' },
  { value: 'mpesa_employee_phone', label: 'Employee Personal M-Pesa' },
  { value: 'credit', label: 'Credit (Authorized)' },
];

export default function NewDeliveryPage() {
  const { user } = useAuth();
  const router = useRouter();

  // ─── Data caches ─────────────────────────────────────────────────────
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [activeAssignment, setActiveAssignment] = useState<VehicleAssignment | null>(null);
  const [loadingData, setLoadingData] = useState(true);

  // ─── Form state ──────────────────────────────────────────────────────
  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [payments, setPayments] = useState<DraftPayment[]>([]);
  const [notes, setNotes] = useState('');
  const [gpsLat, setGpsLat] = useState<number | null>(null);
  const [gpsLng, setGpsLng] = useState<number | null>(null);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'acquiring' | 'acquired' | 'error'>('idle');

  // ─── Submission state ────────────────────────────────────────────────
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message: string } | null>(null);

  // ─── Load cached data (IndexedDB is optional; online APIs remain primary) ───
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      let db: Awaited<ReturnType<typeof getOfflineDb>> | null = null;

      // Read local caches when available, but do not block online loading if
      // IndexedDB is disabled, unavailable or fails to open.
      try {
        db = await getOfflineDb();
        const [cachedCustomers, cachedProducts, cachedShift] = await Promise.all([
          db.getAll('cachedCustomers'),
          db.getAll('cachedProducts'),
          db.get('activeShift', 'current'),
        ]);

        if (!cancelled) {
          if (cachedCustomers.length > 0) setCustomers(cachedCustomers);
          if (cachedProducts.length > 0) setProducts(cachedProducts);
          if (cachedShift) setActiveAssignment(cachedShift);
        }
      } catch {
        db = null;
      }

      if (typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          const [custRes, prodRes, assignRes] = await Promise.all([
            fetch('/api/data/customers', { cache: 'no-store' }),
            fetch('/api/data/products', { cache: 'no-store' }),
            fetch('/api/data/assignments', { cache: 'no-store' }),
          ]);

          if (cancelled) return;

          if (custRes.ok) {
            const custData = await custRes.json();
            if (custData.success && Array.isArray(custData.data)) {
              setCustomers(custData.data);
              if (db) {
                try {
                  const tx = db.transaction('cachedCustomers', 'readwrite');
                  for (const customer of custData.data) tx.store.put(customer);
                  await tx.done;
                } catch (cacheError) {
                  console.warn('[GDMS CACHE] Customer list loaded but could not be cached:', cacheError);
                }
              }
            }
          }

          if (prodRes.ok) {
            const prodData = await prodRes.json();
            if (prodData.success && Array.isArray(prodData.data)) {
              setProducts(prodData.data);
              if (db) {
                try {
                  const tx = db.transaction('cachedProducts', 'readwrite');
                  for (const product of prodData.data) tx.store.put(product);
                  await tx.done;
                } catch (cacheError) {
                  console.warn('[GDMS CACHE] Product list loaded but could not be cached:', cacheError);
                }
              }
            }
          }

          if (assignRes.ok) {
            const assignData = await assignRes.json();
            if (assignData.success) {
              // A confirmed null response means no active shift exists. Remove any
              // stale browser cache instead of silently using yesterday's assignment.
              setActiveAssignment(assignData.data || null);
              if (db) {
                try {
                  if (assignData.data) await db.put('activeShift', assignData.data, 'current');
                  else await db.delete('activeShift', 'current');
                } catch (cacheError) {
                  console.warn('[GDMS CACHE] Active shift could not be cached:', cacheError);
                }
              }
            }
          }
        } catch (error) {
          console.warn('[GDMS DATA] Online catalog refresh failed; any available local cache remains in use:', error);
        }
      }
    }

    void loadData().finally(() => {
      if (!cancelled) setLoadingData(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // ─── GPS capture ─────────────────────────────────────────────────────
  const captureGps = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsStatus('error');
      return;
    }
    setGpsStatus('acquiring');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsLat(pos.coords.latitude);
        setGpsLng(pos.coords.longitude);
        setGpsAccuracy(pos.coords.accuracy);
        setGpsStatus('acquired');
      },
      () => {
        setGpsStatus('error');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  }, []);

  // ─── Item management ─────────────────────────────────────────────────
  const addItem = () => {
    setItems((prev) => [
      ...prev,
      {
        key: crypto.randomUUID?.() || Date.now().toString(),
        productId: products[0]?.id || '',
        sellingUnit: 'FULL_SHEET',
        quantity: 1,
        appliedUnitPrice: products[0]?.standardFullSheetPrice || 0,
        officialUnitPrice: products[0]?.standardFullSheetPrice || 0,
        isSpecialPrice: false,
      },
    ]);
  };

  const updateItem = (key: string, updates: Partial<DraftItem>) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.key !== key) return item;
        const updated = { ...item, ...updates };

        // When product or selling unit changes, update the official price
        if (updates.productId || updates.sellingUnit) {
          const product = products.find((p) => p.id === updated.productId);
          if (product) {
            const officialPrice =
              updated.sellingUnit === 'FULL_SHEET'
                ? product.standardFullSheetPrice
                : product.standardHalfSheetPrice;
            updated.officialUnitPrice = officialPrice;
            // Switching product or selling unit must not carry a special price
            // from the previous item into a different glass specification.
            updated.appliedUnitPrice = officialPrice;
            updated.isSpecialPrice = false;
          }
        }

        return updated;
      })
    );
  };

  const removeItem = (key: string) => {
    setItems((prev) => prev.filter((i) => i.key !== key));
  };

  // ─── Payment management ──────────────────────────────────────────────
  const addPayment = () => {
    setPayments((prev) => [
      ...prev,
      {
        key: crypto.randomUUID?.() || Date.now().toString(),
        channel: 'cash',
        declaredAmount: 0,
        externalRef: '',
      },
    ]);
  };

  const updatePayment = (key: string, updates: Partial<DraftPayment>) => {
    setPayments((prev) =>
      prev.map((p) => (p.key === key ? { ...p, ...updates } : p))
    );
  };

  const removePayment = (key: string) => {
    setPayments((prev) => prev.filter((p) => p.key !== key));
  };

  // ─── Calculations ────────────────────────────────────────────────────
  const deliveryTotals = calculateDeliveryTotals(
    items.map((i) => ({ quantity: i.quantity, appliedUnitPrice: i.appliedUnitPrice })),
    0
  );

  const paymentBalances = calculatePaymentBalances(
    deliveryTotals.total,
    payments.filter((p) => p.channel !== 'credit').map((p) => ({ declaredAmount: p.declaredAmount }))
  );

  const creditAmount = payments
    .filter((p) => p.channel === 'credit')
    .reduce((sum, p) => sum + p.declaredAmount, 0);

  const selectedCustomer = customers.find((c) => c.id === customerId);

  // ─── Validation ──────────────────────────────────────────────────────
  const validationErrors: string[] = [];
  if (!customerId) validationErrors.push('Select a customer');
  if (items.length === 0) validationErrors.push('Add at least one item');
  if (items.some((i) => i.quantity < 1)) validationErrors.push('All item quantities must be ≥ 1');
  if (items.some((i) => i.appliedUnitPrice <= 0)) validationErrors.push('All prices must be > 0');

  const totalPaymentDeclared = payments.reduce((sum, p) => sum + p.declaredAmount, 0);
  if (totalPaymentDeclared > deliveryTotals.total && deliveryTotals.total > 0) {
    validationErrors.push('Total payments exceed invoice amount');
  }

  const explicitCreditAmount = payments.filter((payment) => payment.channel === 'credit')
    .reduce((sum, payment) => sum + payment.declaredAmount, 0);
  if (Math.abs(explicitCreditAmount - paymentBalances.outstandingBalance) > 0.01) {
    validationErrors.push(`Add an explicit credit declaration equal to the remaining balance (${formatKES(paymentBalances.outstandingBalance)}), or record additional money received.`);
  }

  const isValid = validationErrors.length === 0;

  // ─── Submit delivery ─────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!isValid || isSubmitting) return;
    if (!activeAssignment) {
      setSubmitResult({ success: false, message: 'No active vehicle shift is assigned. Contact a manager before recording this delivery.' });
      return;
    }
    setIsSubmitting(true);
    setSubmitResult(null);

    const clientTxId = generateClientTxId();
    const deliveryReference = generateDeliveryReference();

    const deliveryItems: DeliveryItem[] = items.map((i) => ({
      productId: i.productId,
      productName: products.find((p) => p.id === i.productId)?.name,
      sku: products.find((p) => p.id === i.productId)?.sku,
      sellingUnit: i.sellingUnit,
      quantity: i.quantity,
      fullSheetEquivalent: calculateFse(i.sellingUnit, i.quantity),
      officialUnitPrice: i.officialUnitPrice,
      appliedUnitPrice: i.appliedUnitPrice,
      isSpecialPrice: i.isSpecialPrice,
      lineTotal: calculateLineTotal(i.quantity, i.appliedUnitPrice),
    }));

    const paymentDeclarations: PaymentDeclaration[] = payments
      .filter((p) => p.declaredAmount > 0)
      .map((p) => ({
        channel: p.channel,
        declaredAmount: p.declaredAmount,
        declaredBy: user?.id || '',
        externalRef: p.externalRef || undefined,
      }));

    const deliveryPayload: QueuedOfflineDelivery = {
      clientTxId,
      deliveryReference,
      customerId,
      customerName: selectedCustomer?.name || '',
      customerPhone: selectedCustomer?.primaryPhone || '',
      vehicleAssignmentId: activeAssignment.id,
      vehicleId: activeAssignment?.vehicleId,
      employeeId: user?.id,
      items: deliveryItems,
      payments: paymentDeclarations,
      subtotalAmount: deliveryTotals.subtotal,
      discountAmount: deliveryTotals.discount,
      totalAmount: deliveryTotals.total,
      totalDeclaredPaid: paymentBalances.totalDeclaredPaid,
      outstandingBalance: paymentBalances.outstandingBalance,
      notes: notes.trim() || null,
      deliveryLat: gpsLat,
      deliveryLng: gpsLng,
      gpsAccuracyM: gpsAccuracy,
      deviceCapturedAt: new Date().toISOString(),
      syncStatus: 'pending',
      retryCount: 0,
    };

    try {
      if (navigator.onLine) {
        // Direct server submission
        const response = await fetch('/api/sync/deliveries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(deliveryPayload),
        });

        if (response.ok) {
          const data = await response.json().catch(() => ({}));
          if (!data.success) {
            setSubmitResult({ success: false, message: data.error || 'The server did not accept this delivery.' });
            return;
          }
          if (data.simulated) {
            deliveryPayload.syncStatus = 'local_saved';
            try {
              await queueOfflineDelivery(deliveryPayload);
            } catch (storageError) {
              console.error('[GDMS DEMO OUTBOX] Browser-only demo record could not be retained locally:', storageError);
            }
            setSubmitResult({ success: true, message: `DEMO ONLY: Delivery ${deliveryReference} was ${'saved in this browser only'} and was NOT saved to the TOKA business database.` });
            return;
          }
          deliveryPayload.syncStatus = 'synced';
          deliveryPayload.syncedAt = new Date().toISOString();
          try {
            await queueOfflineDelivery(deliveryPayload);
          } catch (storageError) {
            // The server transaction has already committed. A local cache failure
            // must never tell the user that the business delivery failed or invite
            // them to submit a duplicate transaction.
            console.warn('[GDMS DELIVERY CACHE] Delivery committed, but local history cache could not be updated:', storageError);
          }
          setSubmitResult({ success: true, message: `Delivery ${deliveryReference} submitted successfully.` });
          setTimeout(() => router.push('/deliveries'), 1500);
          return;
        } else {
          // Explicit server rejection (HTTP 4xx/5xx) — show actual server validation error
          const errorData = await response.json().catch(() => ({}));
          setSubmitResult({
            success: false,
            message: errorData.error || `Server rejected delivery (HTTP ${response.status})`,
          });
          return;
        }
      }

      // Offline network mode
      deliveryPayload.isOfflineSubmission = true;
      deliveryPayload.syncStatus = 'pending';
      await queueOfflineDelivery(deliveryPayload);
      setSubmitResult({
        success: true,
        message: `Offline mode: Delivery ${deliveryReference} saved locally in outbox. Will sync when reconnected.`,
      });
      setTimeout(() => router.push('/deliveries'), 1500);
    } catch (err: any) {
      if (!navigator.onLine || err.name === 'TypeError') {
        deliveryPayload.isOfflineSubmission = true;
        deliveryPayload.syncStatus = 'pending';
        try {
          await queueOfflineDelivery(deliveryPayload);
          setSubmitResult({
            success: true,
            message: `Network offline. Delivery ${deliveryReference} saved locally and queued for synchronization.`,
          });
          setTimeout(() => router.push('/deliveries'), 1500);
        } catch (dbErr: any) {
          setSubmitResult({
            success: false,
            message: `IndexedDB error: ${dbErr.message || 'Failed to save offline record'}`,
          });
        }
      } else {
        setSubmitResult({
          success: false,
          message: `Submission error: ${err.message || 'Unknown network error'}`,
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Filtered customer list ──────────────────────────────────────────
  const filteredCustomers = customerSearch.trim()
    ? customers.filter(
        (c) =>
          c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
          c.accountNumber.toLowerCase().includes(customerSearch.toLowerCase()) ||
          c.primaryPhone.includes(customerSearch)
      )
    : customers;

  if (loadingData) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto" />
        <p className="text-sm text-slate-500 mt-3">Loading delivery data...</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/deliveries"
          className="p-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 transition"
        >
          <ChevronLeft className="w-4 h-4 text-slate-600" />
        </Link>
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
            <Truck className="w-5 h-5 text-blue-600" />
            New Delivery
          </h1>
          <p className="text-xs text-slate-500">Record a glass delivery to a customer</p>
        </div>
      </div>

      {/* Active Shift Indicator */}
      <div className="mb-4 bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="font-bold text-slate-700">Active Shift:</span>
          <span className="text-slate-600">
            {activeAssignment
              ? `${activeAssignment.vehicleRegistrationPlate} · ${activeAssignment.routeName || 'Assigned Route'}`
              : 'No active vehicle assignment'}
          </span>
        </div>
        {activeAssignment && (
          <span className="text-[10px] font-mono bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-bold">
            {activeAssignment.vehicleModel || 'Active Vehicle'}
          </span>
        )}
      </div>

      {/* ─── Submit result message ─── */}
      {submitResult && (
        <div
          className={`mb-4 flex items-start gap-2 p-3 rounded-lg border text-xs ${
            submitResult.success
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {submitResult.success ? (
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          )}
          <span>{submitResult.message}</span>
        </div>
      )}

      {/* ─── SECTION 1: Customer ─── */}
      <section className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <h2 className="text-sm font-bold text-slate-800 mb-3">1. Customer</h2>

        <input
          type="text"
          placeholder="Search by name, account number, or phone..."
          value={customerSearch}
          onChange={(e) => setCustomerSearch(e.target.value)}
          className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none mb-2"
        />

        {!customerId ? (
          <div className="max-h-48 overflow-y-auto border border-slate-100 rounded-lg">
            {filteredCustomers.length === 0 ? (
              <p className="text-xs text-slate-400 p-3 text-center">
                {customers.length === 0
                  ? 'No customers cached. Connect to server to load customers.'
                  : 'No customers match your search.'}
              </p>
            ) : (
              filteredCustomers.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setCustomerId(c.id);
                    setCustomerSearch('');
                  }}
                  className="w-full text-left px-3 py-2.5 hover:bg-blue-50 border-b border-slate-50 last:border-0 transition"
                >
                  <div className="text-sm font-semibold text-slate-800">{c.name}</div>
                  <div className="text-xs text-slate-500">
                    {c.accountNumber} · {c.primaryPhone} · {c.deliveryArea}
                  </div>
                </button>
              ))
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div>
              <div className="text-sm font-bold text-blue-900">{selectedCustomer?.name}</div>
              <div className="text-xs text-blue-700">
                {selectedCustomer?.accountNumber} · {selectedCustomer?.primaryPhone}
              </div>
            </div>
            <button
              onClick={() => setCustomerId('')}
              className="text-xs text-blue-600 hover:text-blue-800 font-semibold"
            >
              Change
            </button>
          </div>
        )}
      </section>

      {/* ─── SECTION 2: Items ─── */}
      <section className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-800">2. Glass Items</h2>
          <button
            onClick={addItem}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Item
          </button>
        </div>

        {items.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-6">
            No items added. Click &quot;Add Item&quot; to begin.
          </p>
        ) : (
          <div className="space-y-3">
            {items.map((item, idx) => (
              <div key={item.key} className="border border-slate-200 rounded-lg p-3 bg-slate-50/50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-500">Item {idx + 1}</span>
                  <button
                    onClick={() => removeItem(item.key)}
                    className="text-red-400 hover:text-red-600 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Product selector */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Product</label>
                    <select
                      value={item.productId}
                      onChange={(e) => updateItem(item.key, { productId: e.target.value })}
                      className="w-full px-2 py-1.5 text-sm bg-white border border-slate-200 rounded-md"
                    >
                      <option value="">Select product</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.sku})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Selling Unit</label>
                    <select
                      value={item.sellingUnit}
                      onChange={(e) =>
                        updateItem(item.key, { sellingUnit: e.target.value as SellingUnit })
                      }
                      className="w-full px-2 py-1.5 text-sm bg-white border border-slate-200 rounded-md"
                    >
                      <option value="FULL_SHEET">Full Sheet (default)</option>
                      <option value="HALF_SHEET">Half Sheet (ordered sales only)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Quantity</label>
                    <input
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) => updateItem(item.key, { quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                      className="w-full px-2 py-1.5 text-sm bg-white border border-slate-200 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Catalog Unit Price (KES)</label>
                    <input
                      type="number"
                      value={item.appliedUnitPrice}
                      readOnly
                      aria-readonly="true"
                      className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md bg-slate-50 text-slate-700"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Line Total</label>
                    <div className="px-2 py-1.5 text-sm font-bold text-slate-800 bg-slate-100 border border-slate-200 rounded-md">
                      {formatKES(calculateLineTotal(item.quantity, item.appliedUnitPrice))}
                    </div>
                  </div>
                </div>

                        {/* FSE indicator */}
                <div className="mt-1.5 text-[10px] text-slate-500">
                  FSE: {calculateFse(item.sellingUnit, item.quantity).toFixed(1)}
                </div>
              </div>
            ))}
          </div>
        )}

        {items.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-200 text-right">
            <div className="text-xs text-slate-500">Subtotal</div>
            <div className="text-lg font-extrabold text-slate-900">
              {formatKES(deliveryTotals.subtotal)}
            </div>
          </div>
        )}
      </section>

      {/* ─── SECTION 3: Payment Declarations ─── */}
      <section className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-800">3. Payment Declarations</h2>
          <button
            onClick={addPayment}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Payment
          </button>
        </div>

        {payments.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-4">
            No payments declared. This delivery will be recorded as fully on credit.
          </p>
        ) : (
          <div className="space-y-3">
            {payments.map((pay) => (
              <div key={pay.key} className="border border-slate-200 rounded-lg p-3 bg-slate-50/50">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Channel</label>
                    <select
                      value={pay.channel}
                      onChange={(e) =>
                        updatePayment(pay.key, { channel: e.target.value as PaymentChannel })
                      }
                      className="w-full px-2 py-1.5 text-sm bg-white border border-slate-200 rounded-md"
                    >
                      {PAYMENT_CHANNELS.map((ch) => (
                        <option key={ch.value} value={ch.value}>
                          {ch.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Amount (KES)</label>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={pay.declaredAmount || ''}
                      onChange={(e) =>
                        updatePayment(pay.key, {
                          declaredAmount: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="w-full px-2 py-1.5 text-sm bg-white border border-slate-200 rounded-md"
                    />
                  </div>
                  <div className="flex items-end gap-1">
                    <div className="flex-1">
                      <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Ref (optional)</label>
                      <input
                        type="text"
                        value={pay.externalRef}
                        onChange={(e) => updatePayment(pay.key, { externalRef: e.target.value })}
                        placeholder="M-Pesa code..."
                        className="w-full px-2 py-1.5 text-sm bg-white border border-slate-200 rounded-md"
                      />
                    </div>
                    <button
                      onClick={() => removePayment(pay.key)}
                      className="p-1.5 text-red-400 hover:text-red-600 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Payment summary */}
        {items.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-200 space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Invoice Total:</span>
              <span className="font-bold text-slate-800">{formatKES(deliveryTotals.total)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Declared Paid (cash/M-Pesa):</span>
              <span className="font-bold text-emerald-600">
                {formatKES(paymentBalances.totalDeclaredPaid)}
              </span>
            </div>
            {creditAmount > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Credit:</span>
                <span className="font-bold text-amber-600">{formatKES(creditAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Outstanding:</span>
              <span className="font-bold text-red-600">
                {formatKES(paymentBalances.outstandingBalance)}
              </span>
            </div>
          </div>
        )}
      </section>

      {/* ─── SECTION 4: GPS Location ─── */}
      <section className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <h2 className="text-sm font-bold text-slate-800 mb-3">4. Delivery Location</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={captureGps}
            disabled={gpsStatus === 'acquiring'}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-lg transition disabled:opacity-50"
          >
            {gpsStatus === 'acquiring' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <MapPin className="w-4 h-4" />
            )}
            {gpsStatus === 'acquired' ? 'Recapture GPS' : 'Capture GPS'}
          </button>

          {gpsStatus === 'acquired' && gpsLat && gpsLng && (
            <span className="text-xs text-emerald-600 font-medium">
              ✓ {gpsLat.toFixed(6)}, {gpsLng.toFixed(6)}
              {gpsAccuracy && <span className="text-slate-400"> (±{Math.round(gpsAccuracy)}m)</span>}
            </span>
          )}
          {gpsStatus === 'error' && (
            <span className="text-xs text-red-500">GPS unavailable. Delivery will proceed without location.</span>
          )}
        </div>
      </section>

      {/* ─── SECTION 5: Notes ─── */}
      <section className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <h2 className="text-sm font-bold text-slate-800 mb-2">5. Notes (optional)</h2>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Any relevant delivery notes..."
          className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
        />
      </section>

      {/* ─── Validation errors ─── */}
      {validationErrors.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-3">
          <div className="text-xs font-bold text-amber-800 mb-1">Before submitting:</div>
          <ul className="list-disc list-inside text-xs text-amber-700 space-y-0.5">
            {validationErrors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ─── Submit button ─── */}
      <button
        onClick={handleSubmit}
        disabled={!isValid || isSubmitting}
        className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-bold rounded-xl shadow-lg shadow-blue-600/20 transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Submitting...
          </>
        ) : (
          <>
            <Send className="w-4 h-4" />
            Submit Delivery
          </>
        )}
      </button>

      <p className="text-[10px] text-slate-400 text-center mt-2">
        Delivery will be saved {navigator.onLine ? 'to server' : 'offline for later sync'}.
        Once submitted, this record cannot be deleted.
      </p>
    </div>
  );
}

