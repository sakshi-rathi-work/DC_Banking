import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { NodeBadge } from '../../components/common/node-badge';
import { StatusBadge } from '../../components/common/status-badge';
import { Crown, Play, History } from 'lucide-react';

export const BullyLabPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [initiatorNodeId, setInitiatorNodeId] = useState(1);

  // Poll nodes status
  const { data: nodes = [] } = useQuery({
    queryKey: ['system-nodes'],
    queryFn: async () => {
      const res = await api.getNodes();
      return res.data || [];
    },
    refetchInterval: 1500,
  });

  // Poll election history
  const { data: electionsData } = useQuery({
    queryKey: ['system-elections'],
    queryFn: async () => {
      const res = await api.getElections(10);
      return res.data?.elections || [];
    },
    refetchInterval: 2000,
  });

  const electionMutation = useMutation({
    mutationFn: async () => {
      await api.triggerElection('bully', initiatorNodeId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-nodes'] });
      queryClient.invalidateQueries({ queryKey: ['system-elections'] });
    },
  });

  const elections = electionsData || [];

  return (
    <div className="space-y-6">
      {/* 1. Header */}
      <div>
        <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs uppercase tracking-wider mb-1">
          <Crown className="w-4 h-4" />
          <span>Lab Module 5</span>
        </div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Bully Leader Election Lab</h2>
        <p className="text-sm text-slate-400 mt-1">
          Demonstrates priority-based Bully consensus where the highest priority reachable node asserts leadership.
        </p>
      </div>

      {/* 2. Action Panel */}
      <div className="glass-panel p-6 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="font-bold text-white text-base">Trigger Bully Election</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Select the initiating node to broadcast Bully election messages to higher-priority peers.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 uppercase font-semibold">Initiator:</span>
            <select
              value={initiatorNodeId}
              onChange={(e) => setInitiatorNodeId(Number(e.target.value))}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-sm"
            >
              <option value={1}>Node 1 (Priority 1)</option>
              <option value={2}>Node 2 (Priority 2)</option>
              <option value={3}>Node 3 (Priority 3)</option>
            </select>
          </div>

          <button
            onClick={() => electionMutation.mutate()}
            disabled={electionMutation.isPending}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition shadow-sm disabled:opacity-50 shrink-0"
          >
            <Play className="w-4 h-4" />
            {electionMutation.isPending ? 'Electing...' : 'Start Election'}
          </button>
        </div>
      </div>

      {/* 3. Live State: Current Cluster Roles */}
      <div className="glass-panel p-6 rounded-2xl space-y-4">
        <h3 className="font-bold text-white text-base">Current Cluster Node Roles</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {nodes.map((node) => {
            const isLeader = node.role === 'LEADER';
            return (
              <div
                key={node.nodeId}
                className={`p-4 rounded-xl border space-y-3 ${
                  isLeader
                    ? 'bg-indigo-950/40 border-indigo-500/50 shadow-md'
                    : 'bg-slate-800/60 border-slate-700/60'
                }`}
              >
                <div className="flex justify-between items-center">
                  <NodeBadge nodeId={node.nodeId} />
                  <StatusBadge status={node.role || 'FOLLOWER'} type="role" />
                </div>
                <div className="text-xs font-mono space-y-1 text-slate-300">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Node Priority:</span>
                    <span>{node.priority ?? node.nodeId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Leader Epoch:</span>
                    <span>{node.epoch ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Reachable:</span>
                    <span className={node.reachable ? 'text-emerald-400' : 'text-rose-400'}>
                      {node.reachable ? 'YES' : 'NO'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. Election History Table */}
      <div className="glass-panel p-6 rounded-2xl space-y-4">
        <div className="flex items-center gap-2 text-indigo-400 font-bold text-base">
          <History className="w-4 h-4" />
          <h3>Election Log & Outcomes</h3>
        </div>

        {elections.length === 0 ? (
          <div className="py-8 text-center text-slate-500 text-xs">
            No election records logged yet. Trigger an election above to view results.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="uppercase text-slate-500 border-b border-slate-800 pb-2">
                <tr>
                  <th className="pb-3">Algorithm</th>
                  <th className="pb-3">Trigger</th>
                  <th className="pb-3">Initiator</th>
                  <th className="pb-3">Elected Winner</th>
                  <th className="pb-3">Epoch</th>
                  <th className="pb-3">Outcome</th>
                  <th className="pb-3">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {elections.map((el) => (
                  <tr key={el.electionId} className="hover:bg-slate-800/30">
                    <td className="py-3 text-sky-400 uppercase font-semibold">{el.algorithm}</td>
                    <td className="py-3 text-slate-300">{el.trigger}</td>
                    <td className="py-3">
                      <NodeBadge nodeId={el.initiator} />
                    </td>
                    <td className="py-3">
                      <NodeBadge nodeId={el.winner} />
                    </td>
                    <td className="py-3 text-white font-bold">{el.epoch}</td>
                    <td className="py-3">
                      <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 text-[10px]">
                        {el.outcome}
                      </span>
                    </td>
                    <td className="py-3 text-slate-500">
                      {new Date(el.startedAt).toLocaleTimeString()}
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
        When initiated by Node 1, it contacts higher-priority nodes 2 and 3. Node 3 (highest priority) bullies lower nodes and declares itself Coordinator with an incremented epoch.
      </div>
    </div>
  );
};
