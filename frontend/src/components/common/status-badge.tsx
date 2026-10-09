import React from 'react';

interface StatusBadgeProps {
  status: string;
  type?: 'role' | 'transaction' | 'health' | 'generic';
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, type = 'generic', className = '' }) => {
  const norm = (status || '').toUpperCase();

  let colorClasses = 'bg-slate-800 text-slate-300 border-slate-700';

  if (type === 'role') {
    if (norm === 'LEADER') colorClasses = 'bg-emerald-950/80 text-emerald-300 border-emerald-700';
    else if (norm === 'FOLLOWER') colorClasses = 'bg-sky-950/80 text-sky-300 border-sky-700';
    else if (norm === 'CANDIDATE') colorClasses = 'bg-amber-950/80 text-amber-300 border-amber-700 animate-pulse';
  } else if (type === 'transaction') {
    if (norm === 'COMMITTED') colorClasses = 'bg-emerald-950/80 text-emerald-300 border-emerald-700';
    else if (norm === 'REJECTED') colorClasses = 'bg-rose-950/80 text-rose-300 border-rose-700';
  } else if (type === 'health') {
    if (norm === 'HEALTHY' || norm === 'UP') colorClasses = 'bg-emerald-950/80 text-emerald-300 border-emerald-700';
    else if (norm === 'DOWN' || norm === 'UNREACHABLE') colorClasses = 'bg-rose-950/80 text-rose-300 border-rose-700';
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${colorClasses} ${className}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {norm}
    </span>
  );
};
