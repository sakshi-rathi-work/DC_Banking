import React, { useState, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../../api/client';
import { NodeBadge } from '../../components/common/node-badge';
import { Compass, Filter, RefreshCw, Zap, Info } from 'lucide-react';

export const LogicalClockLabPage: React.FC = () => {
  const [filterType, setFilterType] = useState<string>('');
  const [emitResult, setEmitResult] = useState<string | null>(null);
  const emitRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: eventsData, isLoading, refetch } = useQuery({
    queryKey: ['system-events', filterType],
    queryFn: async () => {
      const res = await api.getEvents(40, filterType || undefined);
      return res.data?.events || [];
    },
    refetchInterval: 2000,
  });

  // Emit a Lamport event by triggering an RPC ping between node 1 and node 2
  const emitMutation = useMutation({
    mutationFn: async () => {
      const from = Math.ceil(Math.random() * 3);
      const to = from === 3 ? 1 : from + 1;
      const res = await api.traceCall(from, to);
      return { from, to, data: res.data };
    },
    onSuccess: ({ from, to, data }) => {
      const hops = data?.hops || [];
      const hop = hops.find((h: any) => h.from === from || h.to === to);
      setEmitResult(
        `✓ Event emitted: Node ${from} → Node ${to} | Lamport send=${hop?.lamportSend ?? '?'}, recv=${hop?.lamportRecv ?? '?'}`
      );
      if (emitRef.current) clearTimeout(emitRef.current);
      emitRef.current = setTimeout(() => setEmitResult(null), 5000);
      refetch();
    },
  });

  const events = eventsData || [];

  return (
    <div className="space-y-6">
      {/* 1. Header */}
      <div>
        <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs uppercase tracking-wider mb-1">
          <Compass className="w-4 h-4" />
          <span>Lab Module 4</span>
        </div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Logical Clocks &amp; Causality (Lamport)</h2>
        <p className="text-sm text-slate-400 mt-1">
          Demonstrates logical clock ticking on local events, piggybacking on gRPC messages, and total order via <code>(lamport, node_id)</code>.
        </p>
      </div>

      {/* Lamport Algorithm Info */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-indigo-950/40 border border-indigo-800/60">
        <Info className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
        <div className="text-xs text-slate-300 space-y-1">
          <p><strong className="text-indigo-300">Lamport Clock Rules:</strong></p>
          <ul className="list-disc list-inside text-slate-400 space-y-0.5 pl-2">
            <li>On a <em>local event</em>: increment clock by 1 → <code className="text-amber-300">L = L + 1</code></li>
            <li>On <em>send</em>: increment clock, attach value → <code className="text-amber-300">L = L + 1; send(L)</code></li>
            <li>On <em>receive</em>: update clock → <code className="text-amber-300">L = max(local, received) + 1</code></li>
          </ul>
          <p className="text-slate-400">Total ordering: events are sorted by the tuple <code className="text-sky-300">(lamport, node_id)</code> — ensuring a consistent global ordering even across concurrent events.</p>
        </div>
      </div>

      {/* 2. Emit Event + Filter Controls */}
      <div className="glass-panel p-4 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-semibold uppercase text-slate-400">Filter Event:</span>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs"
          >
            <option value="">All Events</option>
            <option value="NODE_STARTED">NODE_STARTED</option>
            <option value="ELECTION_STARTED">ELECTION_STARTED</option>
            <option value="LEADER_ELECTED">LEADER_ELECTED</option>
            <option value="CLOCK_SYNC_ROUND">CLOCK_SYNC_ROUND</option>
            <option value="TXN_COMMITTED">TXN_COMMITTED</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => emitMutation.mutate()}
            disabled={emitMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-xs font-medium text-white transition disabled:opacity-50"
          >
            <Zap className="w-3.5 h-3.5" />
            {emitMutation.isPending ? 'Emitting...' : 'Emit RPC Event'}
          </button>

          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {emitResult && (
        <div className="px-4 py-2 rounded-lg bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs font-mono">
          {emitResult}
        </div>
      )}
      {emitMutation.isError && (
        <div className="px-4 py-2 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-300 text-xs">
          Emit error: {String((emitMutation.error as any)?.message || 'Unknown')}
        </div>
      )}

      {/* 3. Event Causality Timeline */}
      <div className="glass-panel p-6 rounded-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-white text-base">Causality Ordered Event Timeline</h3>
          <span className="text-xs text-slate-500">Sorted by (L, node_id) — total Lamport order</span>
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-slate-500 animate-pulse text-xs">Loading event timeline...</div>
        ) : events.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-xs">No events recorded. Click "Emit RPC Event" or trigger an election.</div>
        ) : (
          <div className="relative pl-6 space-y-4 border-l-2 border-slate-800">
            {events.map((evt: any, idx: number) => {
              const physTs = new Date(evt.physicalTs);
              const lamportTuple = `(L=${evt.lamport}, N=${evt.nodeId})`;
              return (
                <div key={idx} className="relative group">
                  {/* Timeline Node Dot */}
                  <div className="absolute -left-[31px] top-1.5 w-3.5 h-3.5 rounded-full bg-indigo-500 border-2 border-slate-950" />

                  <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-indigo-400 bg-indigo-950/80 px-2 py-0.5 rounded border border-indigo-800">
                          {lamportTuple}
                        </span>
                        <NodeBadge nodeId={evt.nodeId} />
                        <span className="font-bold text-white">{evt.eventType}</span>
                      </div>

                      <div className="flex items-center gap-3 text-slate-500 font-mono">
                        <span title="Physical timestamp (ms precision)">
                          {physTs.toLocaleTimeString()}.{String(physTs.getMilliseconds()).padStart(3, '0')}
                        </span>
                      </div>
                    </div>

                    <div className="text-slate-400 text-xs flex items-center gap-4">
                      <span>Service: <span className="text-slate-300">{evt.service}</span></span>
                      {evt.peerNodeId && <span>Peer: <span className="text-amber-400">Node {evt.peerNodeId}</span></span>}
                      {evt.requestId && <span className="font-mono truncate max-w-xs text-slate-500">Req: {evt.requestId.slice(0, 12)}...</span>}
                    </div>

                    {evt.details && Object.keys(evt.details).length > 0 && (
                      <div className="text-[10px] text-slate-500 font-mono bg-slate-900/60 rounded px-2 py-1 mt-1 truncate">
                        {JSON.stringify(evt.details).slice(0, 120)}{JSON.stringify(evt.details).length > 120 ? '...' : ''}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. Expected Result Note */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400">
        <strong className="text-slate-300">Expected Result: </strong>
        Whenever an event is logged or an RPC occurs, the sender increments its Lamport clock and attaches it to the message metadata. The receiver updates its clock to <code>max(local, remote) + 1</code>. Events are totally ordered by the tuple <code>(lamport, node_id)</code> — even across nodes with no shared wall clock.
      </div>
    </div>
  );
};
