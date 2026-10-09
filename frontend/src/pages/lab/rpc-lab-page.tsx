import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../api/client';
import { NodeBadge } from '../../components/common/node-badge';
import { Radio, ArrowRight, Play, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';

export const RpcLabPage: React.FC = () => {
  const [fromNode, setFromNode] = useState(1);
  const [toNode, setToNode] = useState(3);
  const [traceResult, setTraceResult] = useState<any | null>(null);

  const traceMutation = useMutation({
    mutationFn: async () => {
      const res = await api.traceCall(fromNode, toNode);
      return res.data;
    },
    onSuccess: (data) => {
      setTraceResult(data);
    },
  });

  return (
    <div className="space-y-6">
      {/* 1. Header */}
      <div>
        <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs uppercase tracking-wider mb-1">
          <Radio className="w-4 h-4" />
          <span>Lab Module 1</span>
        </div>
        <h2 className="text-2xl font-bold text-white tracking-tight">RPC Communication & Hop Tracing</h2>
        <p className="text-sm text-slate-400 mt-1">
          Demonstrates inter-process gRPC calls, distributed hop traversal, and pairwise latency tracking.
        </p>
      </div>

      {/* 2. Action Panel */}
      <div className="glass-panel p-6 rounded-2xl space-y-4">
        <h3 className="font-bold text-white text-base">Trace Inter-Node Call</h3>
        <p className="text-xs text-slate-400">
          The Gateway will invoke <code>PeerPing</code> on the source node, which in turn performs an internal gRPC ping to the destination node.
        </p>

        <div className="flex flex-wrap items-center gap-4 pt-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-semibold uppercase">From:</span>
            <select
              value={fromNode}
              onChange={(e) => setFromNode(Number(e.target.value))}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-sm"
            >
              <option value={1}>Node 1</option>
              <option value={2}>Node 2</option>
              <option value={3}>Node 3</option>
            </select>
          </div>

          <ArrowRight className="w-4 h-4 text-slate-500" />

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-semibold uppercase">To:</span>
            <select
              value={toNode}
              onChange={(e) => setToNode(Number(e.target.value))}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-sm"
            >
              <option value={1}>Node 1</option>
              <option value={2}>Node 2</option>
              <option value={3}>Node 3</option>
            </select>
          </div>

          <button
            onClick={() => traceMutation.mutate()}
            disabled={traceMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition shadow-sm disabled:opacity-50"
          >
            {traceMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {traceMutation.isPending ? 'Tracing Call...' : 'Execute Trace'}
          </button>
        </div>

        {/* In-flight indicator */}
        {traceMutation.isPending && (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-indigo-950/40 border border-indigo-800/60 text-indigo-300 text-xs">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span>gRPC call in flight: <strong>Gateway → Node {fromNode} → Node {toNode}</strong> — awaiting response...</span>
          </div>
        )}

        {/* Error state */}
        {traceMutation.isError && (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-300 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{String((traceMutation.error as any)?.message || 'RPC call failed')}</span>
          </div>
        )}
      </div>

      {/* 3. Live Results Panel */}
      {traceResult && (
        <div className="glass-panel p-6 rounded-2xl space-y-4 animate-in fade-in">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-2 text-emerald-400 font-bold">
              <CheckCircle2 className="w-5 h-5" />
              <span>Trace Completed Successfully</span>
            </div>
            <span className="text-sm font-mono text-slate-300">
              Total Roundtrip: <strong className="text-white">{traceResult.totalLatencyMs} ms</strong>
            </span>
          </div>

          <div className="space-y-3 pt-2">
            <p className="text-xs uppercase text-slate-400 font-semibold tracking-wider">Hops Breakdown:</p>
            <div className="space-y-2">
              {traceResult.hops?.map((hop: any, idx: number) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 text-sm"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-slate-700 text-slate-300 text-xs flex items-center justify-center font-bold">
                      {idx + 1}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">{hop.from === 0 ? 'Gateway' : `Node ${hop.from}`}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                      <NodeBadge nodeId={hop.to} />
                    </div>
                    <span className="text-xs font-mono bg-slate-900 px-2 py-0.5 rounded text-indigo-300">
                      {hop.method}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 text-xs font-mono">
                    {hop.lamportSend > 0 && (
                      <span className="text-sky-400">
                        Lamport: Send={hop.lamportSend} → Recv={hop.lamportRecv}
                      </span>
                    )}
                    <span className="text-emerald-400 font-bold">{hop.latencyMs} ms</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 4. Expected Result Note */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400">
        <strong className="text-slate-300">Expected Result: </strong>
        The Gateway triggers a gRPC call to the source bank node. The source node executes a <code>Ping</code> RPC to the target node over mutual gRPC channel credentials. The hop latency and advancing Lamport logical timestamps confirm cross-container communication.
      </div>
    </div>
  );
};
