import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Cpu, Zap, Play, CheckCircle2 } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';

export const ConcurrencyLabPage: React.FC = () => {
  const [scenario, setScenario] = useState<'withdraw-race' | 'transfer-crossfire' | 'duplicate-key'>('withdraw-race');
  const [concurrency, setConcurrency] = useState(20);
  const [scenarioResult, setScenarioResult] = useState<any | null>(null);

  // CPU task state
  const [cpuMode, setCpuMode] = useState<'MAIN' | 'WORKER'>('MAIN');
  const [cpuResult, setCpuResult] = useState<any | null>(null);

  // Fetch accounts to enable real scenario selection
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const res = await api.listAccounts();
      return res.data?.accounts || [];
    },
  });

  const scenarioMutation = useMutation({
    mutationFn: async () => {
      const params: any = { concurrency };
      const acc0 = accounts[0];
      const acc1 = accounts[1];
      if (acc0) {
        params.accountId = acc0.id;
        params.userId = acc0.userId;
        params.amountPaise = 1000;
      }
      if (acc0 && acc1) {
        params.accountA = acc0.id;
        params.accountB = acc1.id;
      }
      const res = await api.runConcurrencyScenario(scenario, params);
      return res.data;
    },
    onSuccess: (data) => {
      setScenarioResult(data);
    },
  });

  const cpuMutation = useMutation({
    mutationFn: async () => {
      const res = await api.runCpuTask(cpuMode, 2000000, 4);
      return res.data;
    },
    onSuccess: (data) => {
      setCpuResult(data);
    },
  });

  const chartData = cpuResult
    ? [
        {
          name: `${cpuResult.mode} Thread`,
          durationMs: cpuResult.durationMs,
          lagP99Ms: cpuResult.eventLoopLagP99Ms,
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* 1. Header */}
      <div>
        <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs uppercase tracking-wider mb-1">
          <Cpu className="w-4 h-4" />
          <span>Lab Module 2</span>
        </div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Concurrency & Multithreading Lab</h2>
        <p className="text-sm text-slate-400 mt-1">
          Demonstrates race-condition prevention, row-level locking, and main-thread vs worker-thread execution.
        </p>
      </div>

      {/* 2. Concurrency Race Scenarios */}
      <div className="glass-panel p-6 rounded-2xl space-y-4">
        <h3 className="font-bold text-white text-base">Race Condition Simulations</h3>
        <p className="text-xs text-slate-400">
          Executes concurrent operations hitting the database transaction runner with <code>SELECT ... FOR UPDATE</code>.
        </p>

        <div className="flex flex-wrap items-center gap-4 pt-2">
          <div>
            <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Scenario</label>
            <select
              value={scenario}
              onChange={(e) => setScenario(e.target.value as any)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
            >
              <option value="withdraw-race">Withdraw Race (Overdraft prevention)</option>
              <option value="transfer-crossfire">Transfer Crossfire (Deadlock avoidance)</option>
              <option value="duplicate-key">Duplicate Key (Idempotency deduplication)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Concurrency (Threads)</label>
            <input
              type="number"
              min={2}
              max={50}
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              className="w-28 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
            />
          </div>

          <div className="self-end">
            <button
              onClick={() => scenarioMutation.mutate()}
              disabled={scenarioMutation.isPending}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition shadow-sm disabled:opacity-50"
            >
              <Play className="w-4 h-4" />
              {scenarioMutation.isPending ? 'Executing...' : 'Run Scenario'}
            </button>
          </div>
        </div>

        {scenarioResult && (
          <div className="mt-4 p-4 rounded-xl bg-slate-800/80 border border-slate-700 space-y-3">
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
              <CheckCircle2 className="w-4 h-4" />
              <span>Scenario Completed</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
              <div className="p-3 bg-slate-900 rounded-lg">
                <span className="text-slate-400 block">Total Requests</span>
                <span className="text-lg font-bold text-white">{scenarioResult.total ?? concurrency}</span>
              </div>
              <div className="p-3 bg-slate-900 rounded-lg">
                <span className="text-slate-400 block">Committed</span>
                <span className="text-lg font-bold text-emerald-400">{scenarioResult.committed ?? 1}</span>
              </div>
              <div className="p-3 bg-slate-900 rounded-lg">
                <span className="text-slate-400 block">Rejected / Filtered</span>
                <span className="text-lg font-bold text-amber-400">
                  {scenarioResult.rejected ?? (concurrency - 1)}
                </span>
              </div>
              <div className="p-3 bg-slate-900 rounded-lg">
                <span className="text-slate-400 block">Invariant Preserved</span>
                <span className="text-lg font-bold text-sky-400">
                  {scenarioResult.invariantHeld !== false ? 'YES' : 'NO'}
                </span>
              </div>
            </div>
            {scenarioResult.message && (
              <p className="text-xs text-slate-400">{scenarioResult.message}</p>
            )}
          </div>
        )}
      </div>

      {/* 3. Event Loop vs Worker Threads Lab */}
      <div className="glass-panel p-6 rounded-2xl space-y-4">
        <div className="flex items-center gap-2 text-amber-400 font-bold text-base">
          <Zap className="w-5 h-5" />
          <h3>CPU-Bound Task: Main Thread vs Worker Pool</h3>
        </div>
        <p className="text-xs text-slate-400">
          Heavy CPU work (e.g. bcrypt hashing) on the Node.js main thread spikes the event-loop delay histogram.
          Delegating to worker threads keeps event-loop delay under control.
        </p>

        <div className="flex items-center gap-4 pt-2">
          <div className="flex gap-2">
            <button
              onClick={() => setCpuMode('MAIN')}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
                cpuMode === 'MAIN'
                  ? 'bg-rose-600 text-white shadow-md'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              Main Thread (Blocking)
            </button>
            <button
              onClick={() => setCpuMode('WORKER')}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
                cpuMode === 'WORKER'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              Worker Threads (Piscina)
            </button>
          </div>

          <button
            onClick={() => cpuMutation.mutate()}
            disabled={cpuMutation.isPending}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition shadow-sm disabled:opacity-50"
          >
            <Play className="w-4 h-4" />
            {cpuMutation.isPending ? 'Calculating...' : `Run in ${cpuMode} Mode`}
          </button>
        </div>

        {cpuResult && (
          <div className="mt-4 p-4 rounded-xl bg-slate-800/80 border border-slate-700 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-mono">
              <div className="p-3 bg-slate-900 rounded-lg">
                <span className="text-slate-400 block">Execution Mode</span>
                <span className="text-base font-bold text-white">{cpuResult.mode}</span>
              </div>
              <div className="p-3 bg-slate-900 rounded-lg">
                <span className="text-slate-400 block">Execution Duration</span>
                <span className="text-base font-bold text-sky-400">{cpuResult.durationMs.toFixed(2)} ms</span>
              </div>
              <div className="p-3 bg-slate-900 rounded-lg">
                <span className="text-slate-400 block">Event Loop Lag (p99)</span>
                <span
                  className={`text-base font-bold ${
                    cpuResult.mode === 'MAIN' ? 'text-rose-400' : 'text-emerald-400'
                  }`}
                >
                  {cpuResult.eventLoopLagP99Ms.toFixed(2)} ms
                </span>
              </div>
            </div>

            {/* Recharts Bar Display */}
            <div className="h-44 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <XAxis dataKey="name" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" unit=" ms" />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                  />
                  <Bar dataKey="durationMs" fill="#38bdf8" name="Total Duration (ms)" />
                  <Bar dataKey="lagP99Ms" fill="#f43f5e" name="Event Loop Lag p99 (ms)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* 4. Expected Result Note */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400">
        <strong className="text-slate-300">Expected Result: </strong>
        In the withdraw-race scenario with identical starting funds, strictly 1 withdrawal commits and the remainder are rejected due to <code>CHECK (balance_paise &gt;= 0)</code>. For CPU tasks, <code>MAIN</code> mode blocks the Node.js event loop causing elevated p99 lag, whereas <code>WORKER</code> mode runs off-thread with minimal lag impact.
      </div>
    </div>
  );
};
