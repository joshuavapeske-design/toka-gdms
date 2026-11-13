'use client';

import { useEffect, useState } from 'react';
import { Truck, Package, AlertTriangle, DollarSign, TrendingUp, Clock, Users, Layers, Loader2, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { formatKES } from '@/lib/decimal';
import { getPendingDeliveries } from '@/lib/offline/db';

interface DashboardStats {
  todayDeliveries: number;
  todayRevenue: number;
  activeDisputes: number;
  outstandingCredit: number;
  lowStockAlerts: number | null;
  activeVehicles: number;
  totalCustomers: number;
}

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  href,
  accent = 'blue',
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  href?: string;
  accent?: 'blue' | 'emerald' | 'amber' | 'red' | 'purple' | 'slate';
}) {
  const accentClasses = {
    blue: 'bg-blue-50 text-blue-600 border-blue-200',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-200',
    amber: 'bg-amber-50 text-amber-600 border-amber-200',
    red: 'bg-red-50 text-red-600 border-red-200',
    purple: 'bg-purple-50 text-purple-600 border-purple-200',
    slate: 'bg-slate-50 text-slate-600 border-slate-200',
  };
  const content = (
    <div className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{title}</p>
          <p className="text-2xl font-extrabold text-slate-900 mt-1">{value}</p>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        <div className={`p-2 rounded-lg border ${accentClasses[accent]}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [pendingSync, setPendingSync] = useState(0);
  const [simulated, setSimulated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function loadDashboard() {
      try {
        const [response, pending] = await Promise.all([
          fetch('/api/data/dashboard', { cache: 'no-store' }),
          getPendingDeliveries().catch(() => []),
        ]);
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'Unable to load dashboard.');
        if (!active) return;
        setStats(result.data);
        setSimulated(Boolean(result.simulated));
        setPendingSync(pending.length);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load dashboard.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadDashboard();
    return () => { active = false; };
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="mb-6">
        <h1 className="text-xl font-extrabold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {new Date().toLocaleDateString('en-KE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Africa/Nairobi' })}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        <Link href="/deliveries/new" className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg shadow-sm transition">
          <Truck className="w-4 h-4" /> New Delivery
        </Link>
        <Link href="/deliveries" className="inline-flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold rounded-lg border border-slate-200 shadow-sm transition">
          <Clock className="w-4 h-4" /> View Deliveries
        </Link>
        <Link href="/inventory" className="inline-flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold rounded-lg border border-slate-200 shadow-sm transition">
          <Package className="w-4 h-4" /> Check Stock
        </Link>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto" />
          <p className="text-sm text-slate-500 mt-3">Loading business statistics...</p>
        </div>
      ) : error ? (
        <div className="mb-4 flex items-start gap-2 p-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      ) : stats ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
            <StatCard title="Today's Deliveries" value={stats.todayDeliveries} subtitle="Created today" icon={Truck} href="/deliveries" accent="blue" />
            <StatCard title="Today's Revenue" value={formatKES(stats.todayRevenue)} subtitle="Declared at delivery" icon={TrendingUp} accent="emerald" />
            <StatCard title="Active Disputes" value={stats.activeDisputes} subtitle="Require investigation" icon={AlertTriangle} href="/disputes" accent={stats.activeDisputes > 0 ? 'red' : 'slate'} />
            <StatCard title="Outstanding Credit" value={formatKES(stats.outstandingCredit)} subtitle="Customer receivables" icon={DollarSign} href="/collections" accent={stats.outstandingCredit > 0 ? 'amber' : 'slate'} />
            <StatCard title="Low Stock Alerts" value={stats.lowStockAlerts === null ? 'Not set' : stats.lowStockAlerts} subtitle="Configure stock thresholds to enable" icon={Package} href="/inventory" accent="slate" />
            <StatCard title="Pending Sync" value={pendingSync} subtitle="Saved in this browser" icon={Clock} accent={pendingSync > 0 ? 'amber' : 'slate'} />
            <StatCard title="Active Shifts" value={stats.activeVehicles} subtitle="Vehicle assignments active today" icon={Layers} accent="purple" />
            <StatCard title="Customers" value={stats.totalCustomers} subtitle="Active accounts" icon={Users} href="/customers" accent="blue" />
          </div>
          <div className={`rounded-xl border p-4 ${simulated ? 'bg-amber-50 border-amber-200' : 'bg-blue-50 border-blue-200'}`}>
            <h3 className={`text-sm font-bold ${simulated ? 'text-amber-900' : 'text-blue-900'}`}>{simulated ? 'Local Demo Mode' : 'Connected Business Data'}</h3>
            <p className={`text-xs mt-0.5 ${simulated ? 'text-amber-800' : 'text-blue-700'}`}>
              {simulated ? 'These figures are demonstration placeholders. No shared business database is connected.' : 'Statistics are calculated from records your signed-in account is authorized to view. Low-stock alerts are unavailable until thresholds are configured.'}
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
