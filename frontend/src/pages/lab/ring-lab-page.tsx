import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { NodeBadge } from '../../components/common/node-badge';
import { StatusBadge } from '../../components/common/status-badge';
import { Repeat, Play, ArrowRight, History, Loader2, Crown, AlertTriangle, RotateCcw, Zap } from 'lucide-react';

export const RingLabPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [initiatorNodeId, setInitiatorNodeId] = useState(2);

  const { data: nodes = [] } = useQuery({
    queryKey: ['system-nodes'],
    queryFn: async () => { const res = await api.getNodes(); return res.data || []; },
    refetchInterval: 1500,
  });

  const { data: electionsData } = useQuery({
    queryKey: ['system-elections'],
    queryFn: async () => { const res = await api.getElections(10); return res.data?.elections || []; },
    refetchInterval: 2000,
  });

  const electionMutation = useMutation({
    mutationFn: async () => { await api.triggerElection('ring', initiatorNodeId); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-nodes'] });
      queryClient.invalidateQueries({ queryKey: ['system-elections'] });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['system-elections'] });
        queryClient.invalidateQueries({ queryKey: ['system-nodes'] });
      }, 1500);
    },
  });

  const faultMutation = useMutation({
    mutationFn: async ({ nodeId, mode }: { nodeId: number; mode: 'NONE' | 'CRASH' }) => {
      await api.setFaultMode(nodeId, mode);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-nodes'] });
      queryClient.invalidateQueries({ queryKey: ['system-elections'] });
    },
  });

  const ringElections = (electionsData || []).filter((e: any) => e.algorithm?.toLowerCase() === 'ring');
  const latestRingElection = ringElections[0];
  const leaderNode = nodes.find((n: any) => n.role === 'LEADER');

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs uppercase tracking-wider mb-1">
          <Repeat className="w-4 h-4" /><span>Lab Module 6</span>
        </div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Ring Leader Election Lab</h2>
        <p className="text-sm text-slate-400 mt-1">Demonstrates token-passing election across an overlay logical ring with automatic dead-successor skipping.</p>
      </div>

      {/* Current Leader Banner */}
      {leaderNode && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-950/40 border border-emerald-700/60">
          <Crown className="w-5 h-5 text-amber-400 shrink-0" />
          <div className="text-sm">
            <span className="text-slate-300">Current Cluster Leader: </span>
            <span className="font-bold text-white">Node {leaderNode.nodeId}</span>
            <span className="text-slate-400 ml-2">· Epoch {leaderNode.epoch ?? 0}</span>
          </div>
        </div>
      )}

      {/* Latest Ring Election Result */}
      {latestRingElection && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-indigo-950/40 border border-indigo-700/60">
          <Zap className="w-4 h-4 text-indigo-400 shrink-0" />
          <div className="text-sm">
            <span className="text-slate-400">Last Ring Election: </span>
            <span className="font-bold text-white">Node {latestRingElection.winner} elected as leader</span>
            <span className="text-slate-400"> · Epoch {latestRingElection.epoch} · Initiated by Node {latestRingElection.initiator}</span>
          </div>
        </div>
      )}

      {/* Ring Topology */}
      <div className="glass-panel p-6 rounded-2xl space-y-4">
        <h3 className="font-bold text-white text-base">Logical Ring Topology (1 → 2 → 3 → 1)</h3>
        <div className="flex flex-wrap items-center justify-center gap-3 py-4">
          {[{ id: 1, succ: 'N2' }, { id: 2, succ: 'N3' }, { id: 3, succ: 'N1' }].map((node, i) => {
            const live = nodes.find((n: any) => n.nodeId === node.id);
            const isLeader = live?.role === 'LEADER';
            const isCrashed = live?.faultMode === 'CRASH';
            const isInitiator = initiatorNodeId === node.id;
            return (
              <React.Fragment key={node.id}>
                <div className={`flex items-center gap-2 p-3 rounded-xl border transition ${
                  isCrashed
                    ? 'border-rose-700 bg-rose-950/20 opacity-70'
                    : isLeader
                    ? 'border-indigo-500 bg-indigo-950/30'
                    : isInitiator
                    ? 'border-amber-500 bg-amber-950/20'
                    : 'border-slate-800 bg-slate-900'
                }`}>
                  <NodeBadge nodeId={node.id} />
                  {isLeader && !isCrashed && <span className="text-[10px] text-indigo-300 font-bold px-1.5 py-0.5 bg-indigo-900 rounded">LEADER</span>}
                  {isCrashed && <span className="text-[10px] text-rose-300 font-bold px-1.5 py-0.5 bg-rose-900 rounded">CRASHED</span>}
                  {isInitiator && electionMutation.isPending && <Loader2 className="w-3 h-3 text-amber-400 animate-spin" />}
                  <ArrowRight className="w-3 h-3 text-slate-500" />
                  <span className="text-xs text-slate-400 font-mono">→ {node.succ}</span>
                </div>
                {i < 2 && <ArrowRight className="w-5 h-5 text-indigo-400" />}
              </React.Fragment>
            );
          })}
        </div>
        {electionMutation.isPending && (
          <div className="flex items-center justify-center gap-2 text-amber-400 text-xs animate-pulse py-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Token circulating ring from Node {initiatorNodeId}...
          </div>
        )}
      </div>

      {/* Trigger */}
      <div className="glass-panel p-6 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="font-bold text-white text-base">Trigger Ring Election</h3>
          <p className="text-xs text-slate-400 mt-0.5">Select the initiating node to circulate the election token around the logical ring.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 uppercase font-semibold">Initiator:</span>
            <select value={initiatorNodeId} onChange={(e) => setInitiatorNodeId(Number(e.target.value))} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-sm">
              <option value={1}>Node 1</option><option value={2}>Node 2</option><option value={3}>Node 3</option>
            </select>
          </div>
          <button onClick={() => electionMutation.mutate()} disabled={electionMutation.isPending} className="flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition shadow-sm disabled:opacity-50 shrink-0">
            {electionMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {electionMutation.isPending ? 'Circulating...' : 'Start Ring Election'}
          </button>
        </div>
      </div>
      {electionMutation.isError && (
        <div className="px-4 py-2 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-300 text-xs">
          Election failed: {String((electionMutation.error as any)?.message || 'Unknown error')}
        </div>
      )}

      {/* Live Ring Member States with Crash/Recover */}
      <div className="glass-panel p-6 rounded-2xl space-y-4">
        <h3 className="font-bold text-white text-base">Live Ring Member States</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {nodes.map((node: any) => {
            const isLeader = node.role === 'LEADER';
            const isCrashed = node.faultMode === 'CRASH';
            return (
              <div key={node.nodeId} className={`p-4 rounded-xl border space-y-3 ${
                isCrashed
                  ? 'border-rose-700/60 bg-rose-950/20'
                  : isLeader
                  ? 'border-indigo-500/60 bg-indigo-950/20'
                  : 'border-slate-800 bg-slate-900/40'
              }`}>
                <div className="flex justify-between items-center">
                  <NodeBadge nodeId={node.nodeId} />
                  <div className="flex items-center gap-1.5">
                    {isCrashed && <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />}
                    <StatusBadge status={isCrashed ? 'DOWN' : (node.role || 'FOLLOWER')} type="role" />
                  </div>
                </div>
                <div className="text-xs font-mono space-y-1 text-slate-300">
                  <div className="flex justify-between"><span className="text-slate-400">Epoch:</span><span>{node.epoch ?? 0}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Leader ID:</span><span className="text-amber-400">{node.leaderId || '--'}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Fault Mode:</span><span className={isCrashed ? 'text-rose-400 font-bold' : 'text-emerald-400'}>{node.faultMode || 'NONE'}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Reachable:</span><span className={node.reachable ? 'text-emerald-400' : 'text-rose-400'}>{node.reachable ? 'YES' : 'NO'}</span></div>
                </div>

                {/* Crash/Recover buttons */}
                <div className="pt-2 border-t border-slate-700/60 flex gap-2">
                  {!isCrashed ? (
                    <button
                      onClick={() => faultMutation.mutate({ nodeId: node.nodeId, mode: 'CRASH' })}
                      disabled={faultMutation.isPending}
                      className="flex-1 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-600 text-white text-xs font-semibold transition flex items-center justify-center gap-1 disabled:opacity-50"
                    >
                      <AlertTriangle className="w-3 h-3" />
                      Crash Node
                    </button>
                  ) : (
                    <button
                      onClick={() => faultMutation.mutate({ nodeId: node.nodeId, mode: 'NONE' })}
                      disabled={faultMutation.isPending}
                      className="flex-1 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition flex items-center justify-center gap-1 disabled:opacity-50"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Recover Node
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Ring Election Log */}
      <div className="glass-panel p-6 rounded-2xl space-y-4">
        <div className="flex items-center gap-2 text-indigo-400 font-bold text-base">
          <History className="w-4 h-4" /><h3>Ring Election Log</h3>
        </div>
        {ringElections.length === 0 ? (
          <div className="py-8 text-center text-slate-500 text-xs">No ring election records yet. Trigger an election above to view results.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="uppercase text-slate-500 border-b border-slate-800">
                <tr>
                  <th className="pb-3">Initiator</th><th className="pb-3">Winner</th><th className="pb-3">Epoch</th><th className="pb-3">Outcome</th><th className="pb-3">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {ringElections.map((el: any) => (
                  <tr key={el.electionId} className="hover:bg-slate-800/30">
                    <td className="py-3"><NodeBadge nodeId={el.initiator} /></td>
                    <td className="py-3">
                      <div className="flex items-center gap-1.5">
                        <NodeBadge nodeId={el.winner} />
                        {el.winner && <Crown className="w-3 h-3 text-amber-400" />}
                      </div>
                    </td>
                    <td className="py-3 text-white font-bold">{el.epoch}</td>
                    <td className="py-3"><span className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${
                      el.outcome === 'ELECTED'
                        ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                        : 'bg-amber-950 text-amber-300 border-amber-800'
                    }`}>{el.outcome}</span></td>
                    <td className="py-3 text-slate-500">{new Date(el.startedAt).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400">
        <strong className="text-slate-300">Expected Result: </strong>
        The initiator generates a token and sends it clockwise. Each hop appends its ID. Once the token returns to the initiator, the participant with maximum priority is elected and a <code>RingCoordinator</code> message circulates the ring.
        Crash a node to see the token skip that node and elect from the remaining active members.
      </div>
    </div>
  );
};
