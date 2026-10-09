import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { NodeBadge } from '../../components/common/node-badge';
import { StatusBadge } from '../../components/common/status-badge';
import { ConfirmButton } from '../../components/common/confirm-button';
import { ShieldAlert, RotateCcw } from 'lucide-react';

export const FaultToleranceLabPage: React.FC = () => {
  const queryClient = useQueryClient();

  const { data: nodes = [] } = useQuery({
    queryKey: ['system-nodes'],
    queryFn: async () => {
      const res = await api.getNodes();
      return res.data || [];
    },
    refetchInterval: 1200,
  });

  const faultMutation = useMutation({
    mutationFn: async ({ nodeId, mode }: { nodeId: number; mode: 'NONE' | 'CRASH' | 'PARTITION' }) => {
      await api.setFaultMode(nodeId, mode);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-nodes'] });
    },
  });

  return (
    <div className="space-y-6">
      {/* 1. Header */}
      <div>
        <div className="flex items-center gap-2 text-rose-400 font-bold text-xs uppercase tracking-wider mb-1">
          <ShieldAlert className="w-4 h-4" />
          <span>Lab Module 9</span>
        </div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Fault Tolerance & Chaos Injection</h2>
        <p className="text-sm text-slate-400 mt-1">
          Demonstrates automatic primary-backup failover, heartbeat failure detection, and partition resilience.
        </p>
      </div>

      {/* 2. Live Node Chaos Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {nodes.map((node) => {
          const isHealthy = node.reachable && node.status === 'HEALTHY';
          const isCrashed = node.faultMode === 'CRASH';
          const isPartitioned = node.faultMode === 'PARTITION';

          return (
            <div
              key={node.nodeId}
              className={`glass-panel p-6 rounded-2xl border flex flex-col justify-between space-y-4 ${
                isCrashed
                  ? 'border-rose-700 bg-rose-950/20'
                  : isPartitioned
                  ? 'border-amber-700 bg-amber-950/20'
                  : 'border-slate-800'
              }`}
            >
              <div>
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2">
                    <NodeBadge nodeId={node.nodeId} />
                    <span className="font-bold text-white text-base">Node {node.nodeId}</span>
                  </div>
                  <StatusBadge status={node.role || 'FOLLOWER'} type="role" />
                </div>

                <div className="space-y-2 text-xs font-mono text-slate-300">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Health State:</span>
                    <span className={isHealthy ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                      {isHealthy ? 'RUNNING' : 'FAILED / UNREACHABLE'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Fault Injection Mode:</span>
                    <span className="text-amber-400 font-bold">{node.faultMode || 'NONE'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Heartbeat Age:</span>
                    <span className="text-slate-400">{node.lastHeartbeatAgeMs ?? 0} ms</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-slate-800 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <ConfirmButton
                    label="Crash Node"
                    title={`Soft-Crash Node ${node.nodeId}?`}
                    description="Simulates process termination. Peer failure detectors will register heartbeat timeouts and trigger failover."
                    variant="danger"
                    disabled={isCrashed || faultMutation.isPending}
                    onConfirm={() => faultMutation.mutateAsync({ nodeId: node.nodeId, mode: 'CRASH' })}
                  />

                  <ConfirmButton
                    label="Partition"
                    title={`Simulate Network Partition on Node ${node.nodeId}?`}
                    description="Drops outgoing and incoming peer RPC packets while keeping the local database intact."
                    variant="warning"
                    disabled={isPartitioned || faultMutation.isPending}
                    onConfirm={() => faultMutation.mutateAsync({ nodeId: node.nodeId, mode: 'PARTITION' })}
                  />
                </div>

                {(isCrashed || isPartitioned) && (
                  <button
                    onClick={() => faultMutation.mutate({ nodeId: node.nodeId, mode: 'NONE' })}
                    disabled={faultMutation.isPending}
                    className="w-full py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Restore Node to Healthy
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 3. Expected Result Note */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400">
        <strong className="text-slate-300">Expected Result: </strong>
        Crashing the current Leader prompts peer failure detectors to flag missed heartbeats after 2000ms. Surviving nodes elect a new Leader with an incremented epoch. Banking transactions through the Gateway continue uninterrupted via automatic failover.
      </div>
    </div>
  );
};
