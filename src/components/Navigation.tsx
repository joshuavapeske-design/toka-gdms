'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  Truck, 
  Package, 
  DollarSign, 
  AlertTriangle, 
  LayoutDashboard, 
  PlusCircle, 
  Layers,
  Route
} from 'lucide-react';
import type { UserRole } from '@/types';

interface NavigationProps {
  currentRole?: UserRole;
  userName?: string;
}

export function Navigation({ currentRole = 'salesperson', userName = 'Field Operative' }: NavigationProps) {
  const pathname = usePathname();

  const navLinks = [
    { href: '/', label: 'Overview', icon: LayoutDashboard, roles: ['owner', 'manager', 'accountant', 'salesperson'] },
    { href: '/fleet', label: 'Fleet & Shifts', icon: Route, roles: ['owner', 'manager'] },
    { href: '/deliveries/new', label: 'New Delivery', icon: PlusCircle, roles: ['owner', 'manager', 'salesperson', 'driver'] },
    { href: '/deliveries', label: 'Deliveries', icon: Truck, roles: ['owner', 'manager', 'salesperson', 'driver', 'accountant'] },
    { href: '/inventory', label: 'Stock (FSE)', icon: Layers, roles: ['owner', 'manager', 'salesperson', 'driver', 'accountant'] },
    { href: '/collections', label: 'Collections', icon: DollarSign, roles: ['owner', 'manager', 'cash_collector', 'accountant'] },
    { href: '/disputes', label: 'Disputes', icon: AlertTriangle, roles: ['owner', 'manager', 'accountant'] },
  ];

  const allowedLinks = navLinks.filter(l => l.roles.includes(currentRole));

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-14">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center text-white font-bold text-sm tracking-wider shadow-sm">
                TK
              </div>
              <div>
                <span className="font-extrabold text-slate-900 tracking-tight text-base sm:text-lg">TOKA GLASS</span>
                <span className="text-[10px] text-blue-600 font-bold ml-1.5 px-1.5 py-0.5 bg-blue-50 border border-blue-200 rounded uppercase">
                  {currentRole.replace('_', ' ')}
                </span>
              </div>
            </Link>

            <nav className="hidden md:flex items-center gap-1">
              {allowedLinks.map((link) => {
                const Icon = link.icon;
                const isActive = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                      isActive
                        ? 'bg-blue-50 text-blue-700 border border-blue-200 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{link.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <div className="text-xs font-semibold text-slate-800">{userName}</div>
              <div className="text-[10px] text-slate-400 capitalize">{currentRole.replace('_', ' ')}</div>
            </div>
            <div className="w-7 h-7 rounded-full bg-slate-200 border border-slate-300 flex items-center justify-center text-slate-700 text-xs font-bold">
              {userName.charAt(0)}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-2 py-1.5 z-40 flex justify-around">
        {allowedLinks.slice(0, 5).map((link) => {
          const Icon = link.icon;
          const isActive = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex flex-col items-center gap-0.5 py-1 px-2 rounded text-[10px] font-medium transition ${
                isActive ? 'text-blue-600 font-bold' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{link.label}</span>
            </Link>
          );
        })}
      </div>
    </header>
  );
}
