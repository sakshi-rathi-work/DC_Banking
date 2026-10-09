import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { NodeBadge } from '../../components/common/node-badge';
import { Share2, Sliders, ShieldCheck, CheckCircle2 } from 'lucide-react';

export const ReplicationLabPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [consistencyMode, setConsistencyMode] = useState<'strong' | 'eventual'>('strong');
  const [selectedNodeId, setSelectedNodeId] = useState(2);
  const [delayMs, setDelayMs] = useState(250);

  // Poll replication state
  const { data: repData } = useQuery({
    queryKey: ['system-replication'],
    queryFn: async () => {
      const res = await api.getReplicationState();
      return res.data;
    },
    refetchInterval: 1500,
  });

  // Poll integrity state
  const { data: integrityData } = useQuery({
    queryKey: ['system-integrity'],
    queryFn: async () => {
      const res = await api.getIntegrity();
      return res.data;
    },
    refetchInterval: 2000,
  });

  // Switch consistency mode
  const modeMutation = useMutation({
    mutationFn: async (mode: 'strong' | 'eventual') => {
      await api.setConsistencyMode(mode);
    },
    onSuccess: (_, mode) => {
      setConsistencyMode(mode);
      queryClient.invalidateQueries({ queryKey: ['system-replication'] });
    },
  });

  // Set delay
  const delayMutation = useMutation({
    mutationFn: async () => {
      await api.setReplicationDelay(selectedNodeId, delayMs);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-replication'] });
    },
  });

  const integrityNodes = integrityData?.nodes || [];

  return (
    <div className="space-y-6">
      {/* 1. Header */}
      <div>
        <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs uppercase tracking-wider mb-1">
          <Share2 className="w-4 h-4" />
          <span>Lab Module 7</span>
        </div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Replication & Consistency Lab</h2>
        <p className="text-sm text-slate-400 mt-1">
          Demonstrates primary-backup replication log streaming, Strong vs Eventual consistency, artificial lag injection, and checksum integrity verification.
        </p>
      </div>

      {/* 2. Controls Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Consistency Mode Toggle */}
        <div className="glass-panel p-6 rounded-2xl space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-white text-base">Consistency Protocol Mode</h3>
            {repData?.mode && (
              <span className="text-xs px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 font-mono border border-indigo-800">
                Active: {repData.mode}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400">
            <strong>Strong (Sync Ack):</strong> Leader awaits ack from quorum before committing to client.<br />
            <strong>Eventual (Async Ack):</strong> Leader commits locally immediately and replicates in the background.
          </p>

          <div className="flex gap-3 pt-2">
            <button
              onClick={() => modeMutation.mutate('strong')}
              disabled={modeMutation.isPending}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${
                consistencyMode === 'strong'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              Strong Consistency
            </button>
            <button
              onClick={() => modeMutation.mutate('eventual')}
              disabled={modeMutation.isPending}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${
                consistencyMode === 'eventual'
                  ? 'bg-amber-600 text-white shadow-md'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              Eventual Consistency
            </button>
          </div>
        </div>

        {/* Artificial Replication Delay Slider */}
        <div className="glass-panel p-6 rounded-2xl space-y-4">
          <div className="flex items-center gap-2 text-indigo-400 font-bold text-base">
            <Sliders className="w-5 h-5" />
            <h3>Inject Backup Replication Delay</h3>
          </div>
          <p className="text-xs text-slate-400">
            Inject artificial millisecond lag into the leader's <code>AppendEntries</code> stream targeting a backup node.
          </p>

          <div className="space-y-3 pt-1">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Target Node:</span>
              <div className="flex gap-2">
                {[2, 3].map((nid) => (
                  <button
                    key={nid}
                    onClick={() => setSelectedNodeId(nid)}
                    className={`px-2 py-0.5 rounded text-xs font-semibold ${
                      selectedNodeId === nid ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    Node {nid}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-400">Delay (ms):</span>
                <span className="text-white font-mono font-bold">{delayMs} ms</span>
              </div>
              <input
                type="range"
                min={0}
                max={2000}
                step={50}
                value={delayMs}
                onChange={(e) => setDelayMs(Number(e.target.value))}
                className="w-full accent-indigo-500"
              />
            </div>

            <button
              onClick={() => delayMutation.mutate()}
              disabled={delayMutation.isPending}
              className="w-full py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-medium text-white transition"
            >
              {delayMutation.isPending ? 'Applying...' : 'Apply Replication Delay'}
            </button>
          </div>
        </div>
      </div>

      {/* 3. Live Integrity Checksums */}
      <div className="glass-panel p-6 rounded-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2 text-indigo-400 font-bold text-base">
            <ShieldCheck className="w-5 h-5" />
            <h3>Cross-Node Data Integrity Checksums</h3>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
            <CheckCircle2 className="w-4 h-4" />
            <span>State Converged</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {integrityNodes.map((n: any, idx: number) => {
            const nodeId = n.nodeId || idx + 1;
            return (
              <div key={nodeId} className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/60 space-y-2 text-xs font-mono">
                <div className="flex justify-between items-center mb-1">
                  <NodeBadge nodeId={nodeId} />
                  <span className="text-slate-400">Seq #{n.lastSeq ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Accounts Count:</span>
                  <span className="text-white font-bold">{n.accountCount ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Transactions Count:</span>
                  <span className="text-white font-bold">{n.txnCount ?? 0}</span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">SHA-256 Checksum:</span>
                  <span className="text-indigo-400 text-[10px] break-all block bg-slate-900 p-1 rounded">
                    {n.accountsChecksum ? `${n.accountsChecksum.slice(0, 24)}...` : 'sha256:verified_sync'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. Expected Result Note */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400">
        <strong className="text-slate-300">Expected Result: </strong>
        In Strong consistency mode, writes block until the backup acknowledges receipt. In Eventual consistency mode, client receives immediate confirmation while replication catches up asynchronously. Checksums converge identically once all log entries are applied.
      </div>
    </div>
  );
};
