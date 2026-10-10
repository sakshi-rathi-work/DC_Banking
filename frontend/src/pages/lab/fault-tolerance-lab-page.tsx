import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { NodeBadge } from '../../components/common/node-badge';
import { StatusBadge } from '../../components/common/status-badge';
import { ConfirmButton } from '../../components/common/confirm-button';
import { ShieldAlert, RotateCcw, Crown, AlertTriangle, Wifi, WifiOff, Info } from 'lucide-react';

export const FaultToleranceLabPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [log, setLog] = useState<string[]>([]);

  const addLog = (msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setLog((prev) => [`[${ts}] ${msg}`, ...prev].slice(0, 20));
  };

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
      return { nodeId, mode };
    },
    onSuccess: ({ nodeId, mode }) => {
      queryClient.invalidateQueries({ queryKey: ['system-nodes'] });
      if (mode === 'CRASH') {
        addLog(`✗ Node ${nodeId} CRASHED — heartbeat stopped, peers will detect timeout within ~3s and trigger election`);
      } else if (mode === 'PARTITION') {
        addLog(`⚡ Node ${nodeId} PARTITIONED — network traffic dropped, database intact`);
      } else {
        addLog(`✓ Node ${nodeId} RESTORED to healthy state`);
      }
      // Poll again after a delay to catch election
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['system-nodes'] }), 3000);
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['system-nodes'] }), 6000);
    },
    onError: (err: any, { nodeId, mode }) => {
      addLog(`ERROR: Failed to set Node ${nodeId} to ${mode}: ${err?.message || 'Unknown error'}`);
    },
  });

  const leaderNode = nodes.find((n: any) => n.role === 'LEADER');
  const crashedNodes = nodes.filter((n: any) => n.faultMode === 'CRASH');
  const partitionedNodes = nodes.filter((n: any) => n.faultMode === 'PARTITION');

  return (
    <div className="space-y-6">
      {/* 1. Header */}
      <div>
        <div className="flex items-center gap-2 text-rose-400 font-bold text-xs uppercase tracking-wider mb-1">
          <ShieldAlert className="w-4 h-4" />
          <span>Lab Module 9</span>
        </div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Fault Tolerance &amp; Chaos Injection</h2>
        <p className="text-sm text-slate-400 mt-1">
          Demonstrates automatic primary-backup failover, heartbeat failure detection, and partition resilience.
        </p>
      </div>

      {/* How It Works */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-rose-950/20 border border-rose-800/40">
        <Info className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
        <div className="text-xs text-slate-300 space-y-1">
          <p><strong className="text-rose-300">Crash Node:</strong> Sets FaultManager to CRASH mode — gRPC heartbeats are blocked, bank operations return UNAVAILABLE, health endpoint returns HTTP 503. Peer failure detectors detect the timeout (~3s) and trigger a new election.</p>
          <p><strong className="text-amber-300">Partition:</strong> Drops outgoing heartbeats and cluster RPC packets while keeping the local database intact. The node appears unreachable to peers but continues processing local requests.</p>
          <p><strong className="text-emerald-300">Restore:</strong> Reverts FaultManager to NONE — node rejoins the cluster, heartbeats resume, and the leader re-synchronizes the node via AppendEntries catch-up.</p>
        </div>
      </div>

      {/* Cluster Status Summary */}
      <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-800/60 border border-slate-700 text-sm">
        {leaderNode ? (
          <div className="flex items-center gap-2">
            <Crown className="w-4 h-4 text-amber-400" />
            <span className="text-slate-300">Current Leader:</span>
            <span className="font-bold text-white">Node {leaderNode.nodeId}</span>
            <span className="text-slate-400">· Epoch {leaderNode.epoch ?? 0}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-amber-400">
            <AlertTriangle className="w-4 h-4" />
            <span>Election in progress — no stable leader</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-3 text-xs">
          {crashedNodes.length > 0 && (
            <span className="flex items-center gap-1 text-rose-400">
              <WifiOff className="w-3.5 h-3.5" />
              {crashedNodes.length} crashed
            </span>
          )}
          {partitionedNodes.length > 0 && (
            <span className="flex items-center gap-1 text-amber-400">
              <WifiOff className="w-3.5 h-3.5" />
              {partitionedNodes.length} partitioned
            </span>
          )}
          {crashedNodes.length === 0 && partitionedNodes.length === 0 && (
            <span className="flex items-center gap-1 text-emerald-400">
              <Wifi className="w-3.5 h-3.5" />
              All nodes healthy
            </span>
          )}
        </div>
      </div>

      {/* 2. Live Node Chaos Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {nodes.map((node: any) => {
          const isHealthy = node.reachable && node.status !== 'DOWN' && node.status !== 'UNREACHABLE';
          const isCrashed = node.faultMode === 'CRASH';
          const isPartitioned = node.faultMode === 'PARTITION';
          const isLeader = node.role === 'LEADER';

          return (
            <div
              key={node.nodeId}
              className={`glass-panel p-6 rounded-2xl border flex flex-col justify-between space-y-4 transition-all ${
                isCrashed
                  ? 'border-rose-700 bg-rose-950/20 shadow-rose-900/20 shadow-lg'
                  : isPartitioned
                  ? 'border-amber-700 bg-amber-950/20'
                  : isLeader
                  ? 'border-indigo-600/60 bg-indigo-950/10'
                  : 'border-slate-800'
              }`}
            >
              <div>
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2">
                    <NodeBadge nodeId={node.nodeId} />
                    <span className="font-bold text-white text-base">Node {node.nodeId}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {isLeader && !isCrashed && <Crown className="w-4 h-4 text-amber-400" />}
                    <StatusBadge status={isCrashed ? 'DOWN' : (node.role || 'FOLLOWER')} type="role" />
                  </div>
                </div>

                <div className="space-y-2 text-xs font-mono text-slate-300">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Health State:</span>
                    <span className={`font-bold ${isHealthy && !isCrashed ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {isCrashed ? 'CRASHED' : isPartitioned ? 'PARTITIONED' : isHealthy ? 'RUNNING' : 'FAILED / UNREACHABLE'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Fault Injection Mode:</span>
                    <span className={`font-bold ${isCrashed ? 'text-rose-400' : isPartitioned ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {node.faultMode || 'NONE'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Epoch:</span>
                    <span>{node.epoch ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Heartbeat Age:</span>
                    <span className={node.lastHeartbeatAgeMs > 3000 ? 'text-rose-400' : 'text-slate-400'}>
                      {node.lastHeartbeatAgeMs ?? 0} ms
                    </span>
                  </div>
                </div>

                {isCrashed && (
                  <div className="mt-3 p-2 rounded-lg bg-rose-950/40 border border-rose-800/40 text-xs text-rose-300">
                    ✗ Node offline — heartbeats stopped. Peers will trigger election in ~3s.
                  </div>
                )}
                {isPartitioned && (
                  <div className="mt-3 p-2 rounded-lg bg-amber-950/40 border border-amber-800/40 text-xs text-amber-300">
                    ⚡ Network partitioned — RPC traffic blocked, DB intact.
                  </div>
                )}
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
                    onConfirm={() => { void faultMutation.mutateAsync({ nodeId: node.nodeId, mode: 'CRASH' }); }}
                  />

                  <ConfirmButton
                    label="Partition"
                    title={`Simulate Network Partition on Node ${node.nodeId}?`}
                    description="Drops outgoing and incoming peer RPC packets while keeping the local database intact."
                    variant="warning"
                    disabled={isPartitioned || faultMutation.isPending}
                    onConfirm={() => { void faultMutation.mutateAsync({ nodeId: node.nodeId, mode: 'PARTITION' }); }}
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

      {/* 3. Event Log */}
      {log.length > 0 && (
        <div className="glass-panel p-5 rounded-2xl space-y-2">
          <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wide">Fault Injection Activity Log</h3>
          <div className="space-y-1 font-mono text-xs max-h-48 overflow-y-auto">
            {log.map((entry, i) => (
              <div key={i} className={`${
                entry.includes('CRASHED') ? 'text-rose-300' :
                entry.includes('PARTITION') ? 'text-amber-300' :
                entry.includes('RESTORED') || entry.includes('✓') ? 'text-emerald-300' :
                entry.includes('ERROR') ? 'text-rose-400' :
                'text-slate-400'
              }`}>{entry}</div>
            ))}
          </div>
        </div>
      )}

      {/* 4. Expected Result Note */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400">
        <strong className="text-slate-300">Expected Result: </strong>
        Crashing the current Leader prompts peer failure detectors to flag missed heartbeats after ~3000ms. Surviving nodes elect a new Leader with an incremented epoch. Banking transactions through the Gateway continue uninterrupted via automatic failover. The fault mode is applied in-process on the target node via gRPC <code>SetFaultMode</code> — no container restart required.
      </div>
    </div>
  );
};
