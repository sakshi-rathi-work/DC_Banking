import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { NodeBadge } from '../../components/common/node-badge';
import { Clock, RefreshCw, Info } from 'lucide-react';

export const PhysicalClockLabPage: React.FC = () => {
  const queryClient = useQueryClient();

  // Fetch leader to target sync at the correct node
  const { data: leaderData } = useQuery({
    queryKey: ['system-leader'],
    queryFn: async () => {
      const res = await api.getLeader();
      return res.data;
    },
    refetchInterval: 3000,
  });

  // Polling live clock states across all 3 nodes
  const { data: clocks = [] } = useQuery({
    queryKey: ['system-clocks'],
    queryFn: async () => {
      const res = await api.getClocks();
      return res.data || [];
    },
    refetchInterval: 1500,
  });

  // Polling sync history rounds
  const { data: historyData } = useQuery({
    queryKey: ['system-clocks-history'],
    queryFn: async () => {
      const res = await api.getClockHistory(10);
      return res.data?.rounds || [];
    },
    refetchInterval: 2500,
  });

  const activeMasterId = leaderData?.leaderId ?? 1;

  const syncMutation = useMutation({
    mutationFn: async () => {
      // Always trigger on the active leader (Berkeley master)
      return api.triggerClockSync(activeMasterId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-clocks'] });
      queryClient.invalidateQueries({ queryKey: ['system-clocks-history'] });
    },
  });

  const rounds = historyData || [];

  return (
    <div className="space-y-6">
      {/* 1. Header */}
      <div>
        <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs uppercase tracking-wider mb-1">
          <Clock className="w-4 h-4" />
          <span>Lab Module 3</span>
        </div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Physical Clock Synchronization (Berkeley)</h2>
        <p className="text-sm text-slate-400 mt-1">
          Demonstrates periodic Berkeley clock synchronization, simulated hardware clock skew/drift, RTT compensation, and verification sweeps.
        </p>
      </div>

      {/* Algorithm Info Banner */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-indigo-950/40 border border-indigo-800/60">
        <Info className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
        <div className="text-xs text-slate-300 space-y-1">
          <p><strong className="text-indigo-300">Berkeley Algorithm:</strong> The master node (current cluster leader) polls all follower clocks, computes a fault-tolerant average offset (discarding outliers), then sends each node a relative ±ms adjustment — no absolute time source needed.</p>
          <p className="text-slate-400">Periodic auto-sync runs every <code className="text-amber-300">10 seconds</code> on the leader. Click <em>Synchronize Now</em> for an immediate on-demand round.</p>
          <p className="text-slate-400">Active Berkeley Master: <span className="text-indigo-300 font-bold">Node {activeMasterId}</span> {leaderData?.leaderId ? '(Leader)' : '(Default)'}</p>
        </div>
      </div>

      {/* 2. Action Panel */}
      <div className="glass-panel p-6 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="font-bold text-white text-base">Berkeley Master Trigger</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Leader (Node {activeMasterId}) queries peer physical times, calculates fault-tolerant average, and dispatches relative adjustments.
          </p>
        </div>
        <button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition shadow-sm disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
          {syncMutation.isPending ? 'Synchronizing...' : 'Synchronize Now'}
        </button>
      </div>

      {syncMutation.isError && (
        <div className="px-4 py-2 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-300 text-xs">
          Sync error: {String((syncMutation.error as any)?.message || 'Failed to trigger synchronization')}
        </div>
      )}

      {syncMutation.isSuccess && (
        <div className="px-4 py-2 rounded-lg bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs">
          ✓ Berkeley synchronization round completed. Clock adjustments dispatched to all follower nodes.
        </div>
      )}

      {/* 3. Live State: Current Node Clock Offsets */}
      <div className="glass-panel p-6 rounded-2xl space-y-4">
        <h3 className="font-bold text-white text-base">Current Node Physical Clocks</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {clocks.map((c: any, idx: number) => {
            const nodeId = c.nodeId || idx + 1;
            const syncedDate = new Date(c.syncedTimeUs ? c.syncedTimeUs / 1000 : Date.now());
            const isMaster = nodeId === activeMasterId;

            return (
              <div key={nodeId} className={`p-4 rounded-xl border space-y-3 ${isMaster ? 'bg-indigo-950/30 border-indigo-600/50' : 'bg-slate-800/60 border-slate-700/60'}`}>
                <div className="flex justify-between items-center">
                  <NodeBadge nodeId={nodeId} />
                  <div className="flex items-center gap-1.5">
                    {isMaster && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900 text-indigo-300 font-bold border border-indigo-700">MASTER</span>
                    )}
                    <span className="text-xs font-mono text-slate-400">L={c.lamport ?? 0}</span>
                  </div>
                </div>

                <div>
                  <span className="text-xs text-slate-400 block">Synced Physical Time</span>
                  <span className="text-base font-bold text-white font-mono">
                    {syncedDate.toLocaleTimeString()}.{String(syncedDate.getMilliseconds()).padStart(3, '0')}
                  </span>
                </div>

                <div className="space-y-1 pt-1 text-xs font-mono">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Cumulative Adjustment:</span>
                    <span className={`font-bold ${Math.abs(c.adjustmentMs ?? 0) > 100 ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {c.adjustmentMs ? `${c.adjustmentMs >= 0 ? '+' : ''}${c.adjustmentMs.toFixed(2)} ms` : '±0.00 ms'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Offset from Master:</span>
                    <span className="text-sky-400">{c.offsetFromMasterMs ? `${c.offsetFromMasterMs.toFixed(2)} ms` : '0.00 ms'}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {clocks.length === 0 && (
          <div className="py-6 text-center text-slate-500 text-xs">Waiting for clock data from nodes...</div>
        )}
      </div>

      {/* 4. Round History Table */}
      <div className="glass-panel p-6 rounded-2xl space-y-4">
        <h3 className="font-bold text-white text-base">Berkeley Synchronization Round History</h3>

        {rounds.length === 0 ? (
          <div className="py-8 text-center text-slate-500 text-xs">
            No synchronization rounds recorded yet. Click "Synchronize Now" to trigger a round, or wait for the automatic 10-second periodic sync.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="uppercase text-slate-500 border-b border-slate-800 pb-2">
                <tr>
                  <th className="pb-3">Round ID</th>
                  <th className="pb-3">Master Node</th>
                  <th className="pb-3">Average Offset</th>
                  <th className="pb-3">Node 1 (Before / Adj / Residual)</th>
                  <th className="pb-3">Node 2 (Before / Adj / Residual)</th>
                  <th className="pb-3">Node 3 (Before / Adj / Residual)</th>
                  <th className="pb-3">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {rounds.map((r: any) => (
                  <tr key={r.roundId} className="hover:bg-slate-800/30">
                    <td className="py-3 text-slate-400">{r.roundId.slice(0, 8)}...</td>
                    <td className="py-3">
                      <NodeBadge nodeId={r.masterNodeId || r.master || 1} />
                    </td>
                    <td className="py-3 text-sky-400">{(r.averageMs ?? r.averageOffsetMs ?? 0).toFixed(2)} ms</td>
                    {[1, 2, 3].map((nid) => {
                      const nData = r.nodes?.find((n: any) => n.nodeId === nid);
                      const adj = nData?.adjustMs ?? nData?.adjustmentMs ?? 0;
                      return (
                        <td key={nid} className="py-3">
                          {nData ? (
                            <span className="text-slate-300">
                              {nData.offsetBeforeMs?.toFixed(1)} / {adj.toFixed(1)} /{' '}
                              <strong className="text-emerald-400">{nData.residualAfterMs?.toFixed(1)} ms</strong>
                            </span>
                          ) : (
                            <span className="text-slate-600">--</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="py-3 text-slate-500">
                      {r.startedAt ? new Date(r.startedAt).toLocaleTimeString() : new Date().toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 5. Expected Result Note */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400">
        <strong className="text-slate-300">Expected Result: </strong>
        Before synchronization, simulated hardware clocks may skew by seconds. After a Berkeley round, the coordinator measures pairwise verification residuals (<code className="text-emerald-400">residualAfterMs &lt; 50ms</code>), proving tight clock synchronization across distributed nodes. The leader automatically runs sync every 10 seconds — only one master runs at a time to avoid conflicting adjustments.
      </div>
    </div>
  );
};
