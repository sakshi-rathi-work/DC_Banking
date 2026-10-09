import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuth } from '../../context/auth-context';
import { NodeBadge } from '../common/node-badge';
import { Crown, LogOut, User as UserIcon } from 'lucide-react';

export const Topbar: React.FC = () => {
  const { user, logout } = useAuth();

  const { data: leaderData } = useQuery({
    queryKey: ['system-leader'],
    queryFn: async () => {
      const res = await api.getLeader();
      return res.data;
    },
    refetchInterval: 2000,
  });

  const leaderId = leaderData?.leaderId || 0;
  const epoch = leaderData?.epoch || 0;
  const isReady = leaderData?.ready ?? false;

  return (
    <header className="h-16 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md px-6 flex items-center justify-between shrink-0">
      {/* Left: Cluster Leader Pill */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/80 border border-slate-700 text-xs shadow-inner">
          <Crown className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-slate-400">Cluster Leader:</span>
          {leaderId > 0 ? (
            <div className="flex items-center gap-1.5">
              <NodeBadge nodeId={leaderId} />
              <span className="text-slate-400 tabular-nums">Epoch {epoch}</span>
              {isReady && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="Leader Ready" />}
            </div>
          ) : (
            <span className="text-amber-400 font-medium animate-pulse">Electing Leader...</span>
          )}
        </div>
      </div>

      {/* Right: User Profile & Logout */}
      <div className="flex items-center gap-4">
        {user ? (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <div className="w-8 h-8 rounded-full bg-indigo-900/80 border border-indigo-700 text-indigo-300 flex items-center justify-center font-semibold text-xs">
                {user.name.slice(0, 2).toUpperCase()}
              </div>
              <span className="font-medium hidden sm:inline">{user.name}</span>
            </div>
            <button
              onClick={logout}
              title="Logout"
              className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <UserIcon className="w-4 h-4" />
            <span>Not Authenticated</span>
          </div>
        )}
      </div>
    </header>
  );
};
