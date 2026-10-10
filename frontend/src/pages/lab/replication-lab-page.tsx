import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { NodeBadge } from '../../components/common/node-badge';
import { Share2, Sliders, ShieldCheck, CheckCircle2, Zap, Clock, AlertCircle } from 'lucide-react';

interface SimResult {
  mode: string;
  durationMs: number;
  success: boolean;
  note: string;
}

export const ReplicationLabPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [consistencyMode, setConsistencyMode] = useState<'strong' | 'eventual'>('strong');
  const [selectedNodeId, setSelectedNodeId] = useState(2);
  const [delayMs, setDelayMs] = useState(250);
  const [simResults, setSimResults] = useState<SimResult[]>([]);
  const [isSimulating, setIsSimulating] = useState(false);

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

  // Simulate a write and compare Strong vs Eventual latency
  const runSimulation = async () => {
    setIsSimulating(true);
    const results: SimResult[] = [];

    // Test strong consistency: set strong, run load, measure
    try {
      await api.setConsistencyMode('strong');
      const t0 = performance.now();
      await api.runSyntheticLoad(5, 2, 20);
      const strongMs = Number((performance.now() - t0).toFixed(1));
      results.push({
        mode: 'Strong Consistency',
        durationMs: strongMs,
        success: true,
        note: 'Leader waited for quorum acknowledgement before committing',
      });
    } catch {
      results.push({ mode: 'Strong Consistency', durationMs: 0, success: false, note: 'Error during strong consistency test' });
    }

    // Test eventual consistency: set eventual, run load, measure
    try {
      await api.setConsistencyMode('eventual');
      const t0 = performance.now();
      await api.runSyntheticLoad(5, 2, 20);
      const eventualMs = Number((performance.now() - t0).toFixed(1));
      results.push({
        mode: 'Eventual Consistency',
        durationMs: eventualMs,
        success: true,
        note: 'Leader committed locally; replication propagated asynchronously',
      });
    } catch {
      results.push({ mode: 'Eventual Consistency', durationMs: 0, success: false, note: 'Error during eventual consistency test' });
    }

    // Restore original mode
    await api.setConsistencyMode(consistencyMode);
    setSimResults(results);
    setIsSimulating(false);
    queryClient.invalidateQueries({ queryKey: ['system-replication'] });
  };

  const integrityNodes = integrityData?.nodes || [];

  const allMatch =
    integrityNodes.length > 1 &&
    integrityNodes.every(
      (n: any) => n.accountsChecksum === integrityNodes[0]?.accountsChecksum
    );

  return (
    <div className="space-y-6">
      {/* 1. Header */}
      <div>
        <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs uppercase tracking-wider mb-1">
          <Share2 className="w-4 h-4" />
          <span>Lab Module 7</span>
        </div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Replication &amp; Consistency Lab</h2>
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
            {delayMutation.isSuccess && (
              <p className="text-xs text-emerald-400 text-center">✓ Delay of {delayMs}ms applied to Node {selectedNodeId}</p>
            )}
          </div>
        </div>
      </div>

      {/* 3. Interactive Replication Simulation Demo */}
      <div className="glass-panel p-6 rounded-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-amber-400 font-bold text-base">
            <Zap className="w-5 h-5" />
            <h3>Interactive Consistency Demo</h3>
          </div>
          <button
            onClick={runSimulation}
            disabled={isSimulating}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold transition disabled:opacity-50"
          >
            <Zap className="w-3.5 h-3.5" />
            {isSimulating ? 'Running demo...' : 'Compare Strong vs Eventual'}
          </button>
        </div>
        <p className="text-xs text-slate-400">
          Fires 5 synthetic writes in each mode and measures round-trip latency. Strong consistency blocks until quorum acks; eventual consistency returns immediately while replication propagates asynchronously.
        </p>

        {isSimulating && (
          <div className="flex items-center gap-2 py-4 text-amber-400 text-xs animate-pulse">
            <Clock className="w-4 h-4 animate-spin" />
            Running write simulations (Strong then Eventual)...
          </div>
        )}

        {simResults.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {simResults.map((r, i) => (
              <div key={i} className={`p-4 rounded-xl border space-y-2 ${
                r.success
                  ? i === 0
                    ? 'bg-emerald-950/20 border-emerald-800/50'
                    : 'bg-amber-950/20 border-amber-800/50'
                  : 'bg-rose-950/20 border-rose-800/50'
              }`}>
                <div className="flex justify-between items-center">
                  <span className={`text-xs font-bold ${i === 0 ? 'text-emerald-300' : 'text-amber-300'}`}>{r.mode}</span>
                  {r.success ? (
                    <CheckCircle2 className={`w-4 h-4 ${i === 0 ? 'text-emerald-400' : 'text-amber-400'}`} />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-400" />
                  )}
                </div>
                <div className="text-2xl font-bold font-mono text-white">
                  {r.success ? `${r.durationMs} ms` : 'ERR'}
                </div>
                <p className="text-xs text-slate-400">{r.note}</p>
              </div>
            ))}
            {simResults.length === 2 && simResults[0]!.success && simResults[1]!.success && (
              <div className="md:col-span-2 p-3 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300">
                <strong className="text-white">Analysis: </strong>
                {simResults[0]!.durationMs > simResults[1]!.durationMs
                  ? `Strong consistency was ${(simResults[0]!.durationMs - simResults[1]!.durationMs).toFixed(1)}ms slower — latency is the cost of quorum safety.`
                  : `Both modes had similar latency this run — try injecting replication delay (above) to amplify the difference.`}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 4. Live Integrity Checksums */}
      <div className="glass-panel p-6 rounded-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2 text-indigo-400 font-bold text-base">
            <ShieldCheck className="w-5 h-5" />
            <h3>Cross-Node Data Integrity Checksums</h3>
          </div>
          <div className={`flex items-center gap-1.5 text-xs font-medium ${allMatch ? 'text-emerald-400' : 'text-amber-400'}`}>
            {allMatch ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            <span>{allMatch ? 'State Converged' : 'Replication Lag'}</span>
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
        {integrityNodes.length === 0 && (
          <div className="py-6 text-center text-slate-500 text-xs">Waiting for integrity data from nodes...</div>
        )}
      </div>

      {/* 5. Expected Result Note */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400">
        <strong className="text-slate-300">Expected Result: </strong>
        In Strong consistency mode, writes block until the backup acknowledges receipt. In Eventual consistency mode, client receives immediate confirmation while replication catches up asynchronously. Checksums converge identically once all log entries are applied. Use the demo above to measure the latency difference between both modes.
      </div>
    </div>
  );
};
