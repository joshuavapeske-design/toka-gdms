import {
  Truck,
  Package,
  AlertTriangle,
  DollarSign,
  TrendingUp,
  Clock,
  Users,
  Layers,
} from 'lucide-react';
import Link from 'next/link';
import { formatKES } from '@/lib/decimal';

// Summary card component
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

  if (href) {
    return <Link href={href}>{content}</Link>;
  }
  return content;
}

export default function DashboardPage() {
  // In production, these would be fetched server-side from Supabase.
  // For now, show the layout with placeholder data.
  const stats = {
    todayDeliveries: 0,
    todayRevenue: 0,
    pendingSync: 0,
    activeDisputes: 0,
    outstandingCredit: 0,
    lowStockAlerts: 0,
    activeVehicles: 0,
    totalCustomers: 0,
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-extrabold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {new Date().toLocaleDateString('en-KE', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </p>
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2 mb-6">
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
          View Deliveries
        </Link>
        <Link
          href="/inventory"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold rounded-lg border border-slate-200 shadow-sm transition"
        >
          <Package className="w-4 h-4" />
          Check Stock
        </Link>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <StatCard
          title="Today's Deliveries"
          value={stats.todayDeliveries}
          subtitle="Completed today"
          icon={Truck}
          href="/deliveries"
          accent="blue"
        />
        <StatCard
          title="Today's Revenue"
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
          subtitle="Total receivables"
          icon={DollarSign}
          href="/collections"
          accent={stats.outstandingCredit > 0 ? 'amber' : 'slate'}
        />
        <StatCard
          title="Low Stock Alerts"
          value={stats.lowStockAlerts}
          subtitle="Products below threshold"
          icon={Package}
          href="/inventory"
          accent={stats.lowStockAlerts > 0 ? 'red' : 'emerald'}
        />
        <StatCard
          title="Pending Sync"
          value={stats.pendingSync}
          subtitle="Offline deliveries"
          icon={Clock}
          accent={stats.pendingSync > 0 ? 'amber' : 'slate'}
        />
        <StatCard
          title="Active Vehicles"
          value={stats.activeVehicles}
          subtitle="On route today"
          icon={Layers}
          accent="purple"
        />
        <StatCard
          title="Customers"
          value={stats.totalCustomers}
          subtitle="Active accounts"
          icon={Users}
          href="/customers"
          accent="blue"
        />
      </div>

      {/* Info banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <div className="p-1.5 bg-blue-100 rounded-lg">
            <Package className="w-4 h-4 text-blue-600" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-blue-900">System Status</h3>
            <p className="text-xs text-blue-700 mt-0.5">
              Connect your Supabase project to see live data. Dashboard statistics will populate
              automatically once the database is connected.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

