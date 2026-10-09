import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { NodeBadge } from '../../components/common/node-badge';
import { Sliders, Play, Zap, Activity, Loader2 } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';

export const LoadBalancingLabPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [reqCount, setReqCount] = useState(60);
  const [concurrency, setConcurrency] = useState(15);
  const [selectedNodeId, setSelectedNodeId] = useState(2);
  const [latencyMs, setLatencyMs] = useState(300);
  const [loadResult, setLoadResult] = useState<any>(null);

  const { data: loadData, isLoading: loadDataLoading, error: loadDataError } = useQuery({
    queryKey: ['system-load'],
    queryFn: async () => { const res = await api.getLoadMetrics(); return res.data; },
    refetchInterval: 1200,
  });

  const loadMutation = useMutation({
    mutationFn: async () => api.runSyntheticLoad(reqCount, concurrency, 40),
    onSuccess: (res) => { setLoadResult((res as any).data); queryClient.invalidateQueries({ queryKey: ['system-load'] }); },
  });

  const latencyMutation = useMutation({
    mutationFn: async () => api.setNodeLatency(selectedNodeId, latencyMs),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['system-load'] }); },
  });

  const nodes = loadData?.nodes || [];
  const chartData = nodes.map((n: any) => ({
    name: `Node ${n.nodeId}`,
    sharePercent: Number((n.sharePct ?? n.sharePercent ?? 0).toFixed(1)),
    totalServed: n.totalRequests ?? n.totalServed ?? 0,
    ewmaLatencyMs: Number((n.ewmaLatencyMs ?? 0).toFixed(1)),
  }));

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs uppercase tracking-wider mb-1">
          <Sliders className="w-4 h-4" /><span>Lab Module 8</span>
        </div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Least Connections Load Balancer Lab</h2>
        <p className="text-sm text-slate-400 mt-1">Demonstrates dynamic traffic routing favoring nodes with fewest active in-flight requests and lowest EWMA latency.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="glass-panel p-6 rounded-2xl space-y-4">
          <div className="flex items-center gap-2 text-indigo-400 font-bold text-base"><Zap className="w-5 h-5" /><h3>Generate Synthetic Traffic</h3></div>
          <p className="text-xs text-slate-400">Fires concurrent requests through the Gateway load balancer.</p>
          <div className="grid grid-cols-2 gap-4 pt-1">
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Total Requests</label>
              <input type="number" min={10} max={500} value={reqCount} onChange={(e) => setReqCount(Number(e.target.value))} className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Concurrency</label>
              <input type="number" min={2} max={50} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white text-sm" />
            </div>
          </div>
          <button onClick={() => loadMutation.mutate()} disabled={loadMutation.isPending} className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition shadow-sm disabled:opacity-50 flex items-center justify-center gap-2">
            {loadMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {loadMutation.isPending ? 'Dispatching Traffic...' : 'Send Synthetic Batch'}
          </button>
          {loadMutation.isError && <p className="text-xs text-rose-400">{String((loadMutation.error as any)?.message || 'Request failed')}</p>}
          {loadResult && (
            <div className="p-3 rounded-lg bg-slate-800 border border-slate-700 text-xs font-mono space-y-1">
              <div className="flex justify-between"><span className="text-slate-400">Sent:</span><span className="text-white">{loadResult.totalSent}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Success / Failed:</span><span><span className="text-emerald-400">{loadResult.successful}</span> / <span className="text-rose-400">{loadResult.failed}</span></span></div>
              <div className="flex justify-between"><span className="text-slate-400">p50 / p90 / p99:</span><span className="text-sky-400">{loadResult.latencyPercentiles?.p50?.toFixed(1)} / {loadResult.latencyPercentiles?.p90?.toFixed(1)} / {loadResult.latencyPercentiles?.p99?.toFixed(1)} ms</span></div>
            </div>
          )}
        </div>

        <div className="glass-panel p-6 rounded-2xl space-y-4">
          <div className="flex items-center gap-2 text-amber-400 font-bold text-base"><Activity className="w-5 h-5" /><h3>Inject Artificial Node Latency</h3></div>
          <p className="text-xs text-slate-400">Slow down a specific node. Observe the load balancer shifting traffic to faster peers.</p>
          <div className="space-y-3 pt-1">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Target Node:</span>
              <div className="flex gap-2">
                {[1, 2, 3].map((nid) => (
                  <button key={nid} onClick={() => setSelectedNodeId(nid)} className={`px-2.5 py-0.5 rounded text-xs font-semibold ${selectedNodeId === nid ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-400'}`}>Node {nid}</button>
                ))}
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1"><span className="text-slate-400">Artificial Delay:</span><span className="text-amber-400 font-mono font-bold">{latencyMs} ms</span></div>
              <input type="range" min={0} max={1000} step={50} value={latencyMs} onChange={(e) => setLatencyMs(Number(e.target.value))} className="w-full accent-amber-500" />
            </div>
            <button onClick={() => latencyMutation.mutate()} disabled={latencyMutation.isPending} className="w-full py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-medium text-white transition flex items-center justify-center gap-2">
              {latencyMutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
              {latencyMutation.isPending ? 'Injecting...' : `Set Node ${selectedNodeId} Latency`}
            </button>
            {latencyMutation.isSuccess && <p className="text-xs text-emerald-400 text-center">✓ Latency applied to Node {selectedNodeId}</p>}
            {latencyMutation.isError && <p className="text-xs text-rose-400 text-center">{String((latencyMutation.error as any)?.message || 'Failed')}</p>}
          </div>
        </div>
      </div>

      <div className="glass-panel p-6 rounded-2xl space-y-4">
        <h3 className="font-bold text-white text-base">Live Traffic Share (%) Across Nodes</h3>
        {loadDataError ? (
          <div className="py-6 text-center text-rose-400 text-xs">Failed to load metrics. Is the gateway running?</div>
        ) : loadDataLoading && nodes.length === 0 ? (
          <div className="py-6 flex items-center justify-center gap-2 text-slate-500 text-xs"><Loader2 className="w-4 h-4 animate-spin" /> Loading live metrics...</div>
        ) : nodes.length === 0 ? (
          <div className="py-6 text-center text-slate-500 text-xs">No traffic data yet. Send a synthetic batch to populate the chart.</div>
        ) : (
          <div className="h-56 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <XAxis dataKey="name" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" unit="%" domain={[0, 100]} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }} />
                <Bar dataKey="sharePercent" fill="#6366f1" name="Traffic Share (%)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {nodes.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            {nodes.map((n: any) => (
              <div key={n.nodeId} className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/60 space-y-2 text-xs font-mono">
                <div className="flex justify-between items-center"><NodeBadge nodeId={n.nodeId} /><span className={n.healthy ? 'text-emerald-400' : 'text-rose-400'}>{n.healthy ? 'HEALTHY' : 'UNHEALTHY'}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Active In-Flight:</span><span className="text-white font-bold">{n.activeRequests ?? 0}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Total Served:</span><span className="text-white font-bold">{n.totalRequests ?? n.totalServed ?? 0}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">EWMA Latency:</span><span className="text-sky-400 font-bold">{(n.ewmaLatencyMs ?? 0).toFixed(1)} ms</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Share:</span><span className="text-indigo-400 font-bold">{(n.sharePct ?? n.sharePercent ?? 0).toFixed(1)}%</span></div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400">
        <strong className="text-slate-300">Expected Result: </strong>
        When all nodes have equal latency, traffic distributes uniformly (~33% each). Injecting 500ms on Node 2 stretches its active connections, prompting the Least Connections algorithm to divert traffic to faster peers.
      </div>
    </div>
  );
};
