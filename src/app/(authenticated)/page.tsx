'use client';

import { useState, useEffect } from 'react';
import {
  Truck,
  Package,
  AlertTriangle,
  DollarSign,
  TrendingUp,
  Clock,
  Users,
  Layers,
  ShieldCheck,
  Calendar,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { formatKES } from '@/lib/decimal';
import Decimal from 'decimal.js';

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
    red: 'bg-rose-50 text-rose-600 border-rose-200',
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

  if (href) {
    return <Link href={href}>{content}</Link>;
  }
  return content;
}

export default function DashboardPage() {
  const [stats, setStats] = useState({
    todayDeliveries: 0,
    todayRevenue: 0,
    activeDisputes: 0,
    outstandingCredit: 0,
    lowStockAlerts: 0,
    activeVehicles: 0,
    totalCustomers: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDashboard() {
      try {
        setLoading(true);
        const [delRes, dispRes, custRes, assignRes] = await Promise.all([
          fetch('/api/sync/deliveries'),
          fetch('/api/disputes'),
          fetch('/api/data/customers'),
          fetch('/api/assignments'),
        ]);

        let deliveries: any[] = [];
        let disputes: any[] = [];
        let customers: any[] = [];
        let assignments: any[] = [];

        if (delRes.ok) {
          const dData = await delRes.json();
          deliveries = dData.data || [];
        }
        if (dispRes.ok) {
          const dpData = await dispRes.json();
          disputes = dpData.data || [];
        }
        if (custRes.ok) {
          const cData = await custRes.json();
          customers = cData.data || [];
        }
        if (assignRes.ok) {
          const aData = await assignRes.json();
          assignments = aData.data || [];
        }

        const rev = deliveries.reduce(
          (acc, d) => acc.plus(d.totalDeclaredPaid || 0),
          new Decimal(0)
        ).toNumber();

        const credit = deliveries.reduce(
          (acc, d) => acc.plus(d.outstandingBalance || 0),
          new Decimal(0)
        ).toNumber();

        const activeDisputeCount = disputes.filter((dp) => dp.isActive !== false).length;
        const activeShiftsCount = assignments.filter((a) => a.isActive !== false).length;

        setStats({
          todayDeliveries: deliveries.length,
          todayRevenue: rev,
          activeDisputes: activeDisputeCount,
          outstandingCredit: credit,
          lowStockAlerts: 0,
          activeVehicles: activeShiftsCount,
          totalCustomers: customers.length,
        });
      } catch (err) {
        console.error('Failed to load dashboard metrics:', err);
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">Executive Overview</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {new Date().toLocaleDateString('en-KE', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })} · Real-time operational & financial telemetry
          </p>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2">
        <Link
          href="/deliveries/new"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg shadow-sm transition"
        >
          <Truck className="w-4 h-4" />
          New Delivery
        </Link>
        <Link
          href="/deliveries"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold rounded-lg border border-slate-200 shadow-sm transition"
        >
          <Clock className="w-4 h-4" />
          Audit Deliveries
        </Link>
        <Link
          href="/inventory"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold rounded-lg border border-slate-200 shadow-sm transition"
        >
          <Package className="w-4 h-4" />
          Stock (FSE)
        </Link>
        <Link
          href="/assignments"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold rounded-lg border border-slate-200 shadow-sm transition"
        >
          <Calendar className="w-4 h-4" />
          Daily Shifts
        </Link>
        <Link
          href="/remittances"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold rounded-lg border border-slate-200 shadow-sm transition"
        >
          <ShieldCheck className="w-4 h-4" />
          Remittance Settlement
        </Link>
      </div>

      {/* Stats Grid */}
      {loading ? (
        <div className="py-12 flex justify-center items-center text-slate-400 gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          <span>Refreshing system telemetry...</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            title="Total Deliveries"
            value={stats.todayDeliveries}
            subtitle="Completed runs"
            icon={Truck}
            href="/deliveries"
            accent="blue"
          />
          <StatCard
            title="Total Revenue"
            value={formatKES(stats.todayRevenue)}
            subtitle="Declared received"
            icon={TrendingUp}
            accent="emerald"
          />
          <StatCard
            title="Active Disputes"
            value={stats.activeDisputes}
            subtitle="Require investigation"
            icon={AlertTriangle}
            href="/disputes"
            accent={stats.activeDisputes > 0 ? 'red' : 'slate'}
          />
          <StatCard
            title="Outstanding Credit"
            value={formatKES(stats.outstandingCredit)}
            subtitle="Receivables ledger"
            icon={DollarSign}
            href="/collections"
            accent={stats.outstandingCredit > 0 ? 'amber' : 'slate'}
          />
          <StatCard
            title="Active Shifts"
            value={stats.activeVehicles}
            subtitle="Vehicles on route"
            icon={Layers}
            href="/assignments"
            accent="purple"
          />
          <StatCard
            title="Customers"
            value={stats.totalCustomers}
            subtitle="Registered workshops"
            icon={Users}
            href="/customers"
            accent="blue"
          />
        </div>
      )}
    </div>
  );
}
