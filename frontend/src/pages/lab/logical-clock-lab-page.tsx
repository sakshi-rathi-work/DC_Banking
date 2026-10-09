import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { NodeBadge } from '../../components/common/node-badge';
import { Compass, Filter, RefreshCw } from 'lucide-react';

export const LogicalClockLabPage: React.FC = () => {
  const [filterType, setFilterType] = useState<string>('');

  const { data: eventsData, isLoading, refetch } = useQuery({
    queryKey: ['system-events', filterType],
    queryFn: async () => {
      const res = await api.getEvents(40, filterType || undefined);
      return res.data?.events || [];
    },
    refetchInterval: 2000,
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
        <h2 className="text-2xl font-bold text-white tracking-tight">Logical Clocks & Causality (Lamport)</h2>
        <p className="text-sm text-slate-400 mt-1">
          Demonstrates logical clock ticking on local events, piggybacking on gRPC messages, and total order via <code>(lamport, node_id)</code>.
        </p>
      </div>

      {/* 2. Filter & Controls */}
      <div className="glass-panel p-4 rounded-xl flex items-center justify-between gap-4">
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

        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* 3. Event Causality Timeline */}
      <div className="glass-panel p-6 rounded-2xl space-y-4">
        <h3 className="font-bold text-white text-base">Causality Ordered Event Timeline</h3>

        {isLoading ? (
          <div className="py-12 text-center text-slate-500 animate-pulse text-xs">Loading event timeline...</div>
        ) : events.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-xs">No events recorded.</div>
        ) : (
          <div className="relative pl-6 space-y-4 border-l-2 border-slate-800">
            {events.map((evt, idx) => (
              <div key={idx} className="relative group">
                {/* Timeline Node Dot */}
                <div className="absolute -left-[31px] top-1.5 w-3.5 h-3.5 rounded-full bg-indigo-500 border-2 border-slate-950" />

                <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-indigo-400 bg-indigo-950/80 px-2 py-0.5 rounded border border-indigo-800">
                        L={evt.lamport}
                      </span>
                      <NodeBadge nodeId={evt.nodeId} />
                      <span className="font-bold text-white">{evt.eventType}</span>
                    </div>

                    <span className="text-slate-500 font-mono">
                      {new Date(evt.physicalTs).toLocaleTimeString()}
                    </span>
                  </div>

                  <div className="text-slate-400 text-xs flex items-center gap-4">
                    <span>Service: {evt.service}</span>
                    {evt.peerNodeId && <span>Peer: Node {evt.peerNodeId}</span>}
                    {evt.requestId && <span className="font-mono truncate max-w-xs">Req: {evt.requestId}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 4. Expected Result Note */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400">
        <strong className="text-slate-300">Expected Result: </strong>
        Whenever an event is logged or an RPC occurs, the sender increments its Lamport clock and attaches it to the message metadata. The receiver updates its clock to <code>max(local, remote) + 1</code>. Events are totally ordered by the tuple <code>(lamport, node_id)</code>.
      </div>
    </div>
  );
};
