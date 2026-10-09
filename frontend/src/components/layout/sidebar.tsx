import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  CreditCard,
  History,
  Network,
  Cpu,
  Clock,
  Compass,
  Crown,
  Repeat,
  Share2,
  Sliders,
  ShieldAlert,
  Radio,
} from 'lucide-react';

export const Sidebar: React.FC = () => {
  const bankingLinks = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/accounts', label: 'Accounts', icon: CreditCard },
    { to: '/transactions', label: 'Transactions', icon: History },
  ];

  const labLinks = [
    { to: '/cluster', label: 'Cluster Overview', icon: Network },
    { to: '/lab/rpc', label: '1. RPC Communication', icon: Radio },
    { to: '/lab/concurrency', label: '2. Concurrency Lab', icon: Cpu },
    { to: '/lab/physical-clock', label: '3. Physical Clock (Berkeley)', icon: Clock },
    { to: '/lab/logical-clock', label: '4. Logical Clock (Lamport)', icon: Compass },
    { to: '/lab/bully', label: '5. Bully Election', icon: Crown },
    { to: '/lab/ring', label: '6. Ring Election', icon: Repeat },
    { to: '/lab/replication', label: '7. Replication & Sync', icon: Share2 },
    { to: '/lab/load-balancing', label: '8. Load Balancing', icon: Sliders },
    { to: '/lab/fault-tolerance', label: '9. Fault Tolerance', icon: ShieldAlert },
  ];

  const getLinkClasses = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
      isActive
        ? 'bg-indigo-600 text-white shadow-sm'
        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
    }`;

  return (
    <aside className="w-64 border-r border-slate-800 bg-slate-900/95 flex flex-col shrink-0 h-screen overflow-y-auto">
      {/* Brand */}
      <div className="p-5 border-b border-slate-800 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-sky-400 flex items-center justify-center font-bold text-white shadow-md">
          DB
        </div>
        <div>
          <h1 className="font-bold text-white tracking-tight leading-none text-base">Distributed Bank</h1>
          <p className="text-xs text-slate-400 mt-0.5">Fault-Tolerant Core</p>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-6">
        {/* Banking Group */}
        <div>
          <p className="px-3 text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Banking</p>
          <div className="space-y-1">
            {bankingLinks.map((link) => {
              const Icon = link.icon;
              return (
                <NavLink key={link.to} to={link.to} end={link.to === '/'} className={getLinkClasses}>
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{link.label}</span>
                </NavLink>
              );
            })}
          </div>
        </div>

        {/* Distributed Lab Group */}
        <div>
          <p className="px-3 text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Distributed System</p>
          <div className="space-y-1">
            {labLinks.map((link) => {
              const Icon = link.icon;
              return (
                <NavLink key={link.to} to={link.to} className={getLinkClasses}>
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{link.label}</span>
                </NavLink>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Footer Info */}
      <div className="p-4 border-t border-slate-800 text-xs text-slate-400">
        <div className="flex items-center justify-between">
          <span>Cluster: 3 Nodes</span>
          <span className="text-emerald-400 font-medium">gRPC Active</span>
        </div>
      </div>
    </aside>
  );
};
