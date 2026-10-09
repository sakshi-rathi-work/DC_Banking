import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { StatusBadge } from '../../components/common/status-badge';
import { NodeBadge } from '../../components/common/node-badge';
import { Server, Activity, ShieldCheck, Loader2, AlertCircle } from 'lucide-react';

export const ClusterOverviewPage: React.FC = () => {
  const { data: overview, isLoading, error } = useQuery({
    queryKey: ['cluster-overview'],
    queryFn: async () => {
      const res = await api.getClusterOverview();
      return res.data;
    },
    refetchInterval: 1500,
  });

  const nodes = overview?.nodes || [];
  const leader = overview?.leader;
  const load = overview?.load;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Cluster Overview</h2>
        <p className="text-sm text-slate-400 mt-1">Live state of peer bank nodes, consensus, and load</p>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>Failed to connect to cluster nodes: {String((error as any)?.message || 'Gateway unreachable')}</span>
        </div>
      )}

      {isLoading && !overview && (
        <div className="p-8 flex items-center justify-center gap-3 text-slate-400 text-sm">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
          <span>Polling cluster status...</span>
        </div>
      )}

      {/* Cluster Nodes Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {nodes.map((node) => {
          const isLeader = node.role === 'LEADER';
          return (
            <div
              key={node.nodeId}
              className={`glass-panel p-6 rounded-2xl relative overflow-hidden border transition ${
                isLeader ? 'border-indigo-500/50 shadow-lg shadow-indigo-500/10' : 'border-slate-800'
              }`}
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-2.5">
                  <span className="p-2.5 rounded-xl bg-slate-800 text-slate-300">
                    <Server className="w-5 h-5" />
                  </span>
                  <div>
                    <h3 className="font-bold text-white text-base">Node {node.nodeId}</h3>
                    <p className="text-xs text-slate-500 font-mono">Port 5005{node.nodeId}</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <StatusBadge status={node.status || 'HEALTHY'} type="health" />
                  <StatusBadge status={node.role || 'FOLLOWER'} type="role" />
                </div>
              </div>

              <div className="space-y-3 pt-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-800/80">
                  <span className="text-slate-400">Epoch</span>
                  <span className="font-mono text-white font-semibold">{node.epoch ?? '--'}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/80">
                  <span className="text-slate-400">Lamport Clock</span>
                  <span className="font-mono text-sky-400 font-semibold">L={node.lamport ?? '--'}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/80">
                  <span className="text-slate-400">Last Sequence</span>
                  <span className="font-mono text-white font-semibold">#{node.lastSeq ?? 0}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/80">
                  <span className="text-slate-400">Event Loop Lag</span>
                  <span className="font-mono text-amber-400 font-semibold">
                    {typeof node.eventLoopLagMs === 'number' ? `${node.eventLoopLagMs.toFixed(2)} ms` : '--'}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-400">Fault Mode</span>
                  <span className="font-mono text-slate-300">{node.faultMode || 'NONE'}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Cluster Details: Consensus & Load Balancing */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Consensus & Replication Summary */}
        <div className="glass-panel p-6 rounded-2xl space-y-4">
          <div className="flex items-center gap-2 text-indigo-400 font-bold text-base">
            <ShieldCheck className="w-5 h-5" />
            <h3>Consensus & Leader State</h3>
          </div>

          <div className="space-y-3 text-sm">
            <div className="flex justify-between py-2 border-b border-slate-800">
              <span className="text-slate-400">Active Leader:</span>
              <span className="text-white font-semibold">
                {leader ? <NodeBadge nodeId={leader.nodeId} /> : 'Electing...'}
              </span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-800">
              <span className="text-slate-400">Current Epoch:</span>
              <span className="text-white font-mono font-semibold">{leader?.epoch ?? 0}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-800">
              <span className="text-slate-400">Elections Triggerable:</span>
              <span className="text-emerald-400 font-medium">Bully & Ring Supported</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-slate-400">Heartbeat Interval:</span>
              <span className="text-white font-mono">1000 ms</span>
            </div>
          </div>
        </div>

        {/* Load Balancer Overview */}
        <div className="glass-panel p-6 rounded-2xl space-y-4">
          <div className="flex items-center gap-2 text-sky-400 font-bold text-base">
            <Activity className="w-5 h-5" />
            <h3>Gateway Load Balancer (Least Connections)</h3>
          </div>

          <div className="space-y-3 text-sm">
            <div className="flex justify-between py-2 border-b border-slate-800">
              <span className="text-slate-400">Total Active Requests:</span>
              <span className="text-white font-mono font-bold">{load?.activeRequestsTotal ?? (load?.nodes ? load.nodes.reduce((s: number, n: any) => s + (n.activeRequests ?? 0), 0) : 0)}</span>
            </div>

            <div className="space-y-2 pt-1">
              <span className="text-xs uppercase text-slate-500 font-semibold">Node Load Distribution:</span>
              {load?.nodes?.map((n: any) => {
                const share = typeof n.sharePct === 'number' ? n.sharePct : typeof n.sharePercent === 'number' ? n.sharePercent : 0;
                const totalReqs = n.totalRequests ?? n.totalServed ?? 0;
                return (
                  <div key={n.nodeId} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300">Node {n.nodeId} ({totalReqs} reqs)</span>
                      <span className="text-sky-400 font-mono font-semibold">{share.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-sky-500 rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(share, 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
