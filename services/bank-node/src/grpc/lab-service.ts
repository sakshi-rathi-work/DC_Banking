import { randomUUID } from 'node:crypto';
import * as grpc from '@grpc/grpc-js';
import { type LamportClock, withGrpcInterceptors } from '@bank/shared';
import type { ElectionManager } from '../election/election-manager.js';
import type { AlgorithmType } from '../election/types.js';


import type { FaultManager, FaultMode } from '../cluster/fault-manager.js';
import type { BerkeleyClockSync } from '../clock/berkeley-sync.js';
import type { PeerManager } from '../cluster/peer-manager.js';
import { performance } from 'node:perf_hooks';

import { simulateWork, setArtificialLatency } from '../lab/simulate-work.js';

export interface LabServiceOptions {
  nodeId: number;
  clock: LamportClock;
  electionManager: ElectionManager;
  faultManager?: FaultManager;
  berkeleySync?: BerkeleyClockSync;
  peerManager?: PeerManager;
  onConfigChange?: (config: { electionAlgorithm?: string; consistencyMode?: string; replicationDelayMs?: number; artificialLatencyMs?: number }) => void;
}

export function createLabServiceHandlers(opts: LabServiceOptions) {
  const { nodeId, clock, electionManager, faultManager, berkeleySync, peerManager, onConfigChange } = opts;

  return {
    TriggerElection: withGrpcInterceptors(
      async (
        call: grpc.ServerUnaryCall<{ algorithm?: string; initiatorNodeId?: number }, unknown>,
        callback: grpc.sendUnaryData<unknown>,
      ) => {
        try {
          const alg = (call.request.algorithm || 'bully').toLowerCase() as AlgorithmType;
          electionManager.setAlgorithm(alg);
          await electionManager.initiateElection('API_TRIGGER');

          callback(null, {
            electionId: randomUUID(),
            algorithm: alg,
            accepted: true,
          });
        } catch (err) {
          callback(err as grpc.ServiceError, null);
        }
      },
      clock,
    ),

    SetConfig: withGrpcInterceptors(
      (
        call: grpc.ServerUnaryCall<
          { electionAlgorithm?: string; consistencyMode?: string; replicationDelayMs?: number; artificialLatencyMs?: number },
          unknown
        >,
        callback: grpc.sendUnaryData<unknown>,
      ) => {
        const req = call.request;
        if (req.electionAlgorithm) {
          electionManager.setAlgorithm(req.electionAlgorithm.toLowerCase() as AlgorithmType);
        }

        if (req.artificialLatencyMs !== undefined) {
          setArtificialLatency(req.artificialLatencyMs);
        }

        if (onConfigChange) {
          onConfigChange({
            electionAlgorithm: req.electionAlgorithm,
            consistencyMode: req.consistencyMode,
            replicationDelayMs: req.replicationDelayMs,
            artificialLatencyMs: req.artificialLatencyMs,
          });
        }

        callback(null, {});
      },
      clock,
    ),

    SetFaultMode: withGrpcInterceptors((call: grpc.ServerUnaryCall<{ mode?: string }, unknown>, callback) => {
      const mode = (call.request?.mode || 'NONE').toUpperCase() as FaultMode;
      if (faultManager) {
        faultManager.setMode(mode);
      }
      callback(null, {});
    }, clock),

    TriggerClockSync: withGrpcInterceptors(async (_call, callback) => {
      try {
        if (!berkeleySync) {
          callback(null, { roundId: '', master: nodeId, averageMs: 0, nodes: [] });
          return;
        }
        const result = await berkeleySync.runSyncRound();
        callback(null, result);
      } catch (err) {
        callback(err as grpc.ServiceError, null);
      }
    }, clock),
    SimulateWork: withGrpcInterceptors(
      async (
        call: grpc.ServerUnaryCall<{ workMs?: number }, unknown>,
        callback: grpc.sendUnaryData<unknown>,
      ) => {
        try {
          const requestedMs = call.request?.workMs ?? 0;
          const actualMs = await simulateWork(requestedMs);
          callback(null, {
            nodeId,
            workMs: requestedMs,
            actualMs,
            lamport: clock.getValue(),
          });
        } catch (err) {
          callback(err as grpc.ServiceError, null);
        }
      },
      clock,
    ),
    CpuTask: withGrpcInterceptors(
      async (
        call: grpc.ServerUnaryCall<{ mode?: string; iterations?: number; parallel?: number }, unknown>,
        callback: grpc.sendUnaryData<unknown>,
      ) => {
        try {
          const { lagMonitor } = await import('../concurrency/lag-monitor.js');
          const mode = (call.request?.mode || 'MAIN').toUpperCase();
          const iterations = call.request?.iterations ?? 1_000_000;
          const parallel = Math.min(call.request?.parallel ?? 1, 8);

          lagMonitor.reset();

          const runCpuWork = (iters: number): number => {
            let x = 0;
            for (let i = 0; i < iters; i++) x += Math.sqrt(i) * Math.sin(i);
            return x;
          };

          const t0 = Date.now();
          const taskDurationsMs: number[] = [];

          if (mode === 'WORKER') {
            // Simulate worker pool: run in parallel using Promise.all with async chunks
            const chunkSize = Math.ceil(iterations / parallel);
            const tasks = Array.from({ length: parallel }, () =>
              new Promise<number>((resolve) => {
                const t = Date.now();
                runCpuWork(chunkSize);
                resolve(Date.now() - t);
              }),
            );
            const durations = await Promise.all(tasks);
            taskDurationsMs.push(...durations);
          } else {
            // Main thread — blocks event loop
            const t = Date.now();
            runCpuWork(iterations);
            taskDurationsMs.push(Date.now() - t);
          }

          const durationMs = Date.now() - t0;
          const lagStats = lagMonitor.getStats();

          callback(null, {
            nodeId,
            mode,
            durationMs,
            eventLoopLagP99Ms: lagStats.p99Ms,
            taskDurationsMs,
          });
        } catch (err) {
          callback(err as grpc.ServiceError, null);
        }
      },
      clock,
    ),
    PeerPing: withGrpcInterceptors(
      async (
        call: grpc.ServerUnaryCall<{ targetNodeId?: number }, unknown>,
        callback: grpc.sendUnaryData<unknown>,
      ) => {
        try {
          const targetNodeId = call.request?.targetNodeId ?? nodeId;
          const hops: Array<{
            fromNode: number;
            toNode: number;
            method: string;
            lamportSend: number;
            lamportRecv: number;
            latencyMs: number;
          }> = [];

          if (targetNodeId === nodeId) {
            const lamportSend = clock.tick();
            const lamportRecv = clock.tick();
            hops.push({
              fromNode: nodeId,
              toNode: nodeId,
              method: 'Ping (Local Loopback)',
              lamportSend,
              lamportRecv,
              latencyMs: 0.1,
            });
          } else if (peerManager) {
            const client = peerManager.getPeerClient(targetNodeId);
            if (!client) {
              return callback({
                code: grpc.status.UNAVAILABLE,
                details: `Peer Node ${targetNodeId} not found in peer directory`,
              }, null);
            }

            const t0 = performance.now();
            const lamportSend = clock.tick();
            await new Promise<void>((resolve, reject) => {
              const meta = new grpc.Metadata();
              meta.set('x-lamport-clock', String(lamportSend));
              meta.set('x-sender-node', String(nodeId));
              client.ping(
                { fromNode: nodeId, lamport: lamportSend, sentAt: Date.now() },
                meta,
                (err: any, res: any) => {
                  if (err) return reject(err);
                  const t1 = performance.now();
                  if (res?.lamport) {
                    clock.receive(Number(res.lamport));
                  }
                  const lamportRecv = clock.tick();
                  hops.push({
                    fromNode: nodeId,
                    toNode: targetNodeId,
                    method: 'Ping',
                    lamportSend,
                    lamportRecv,
                    latencyMs: Math.max(0.1, Number((t1 - t0).toFixed(2))),
                  });
                  resolve();
                },
              );
            });
          }

          callback(null, { hops });
        } catch (err) {
          callback(err as grpc.ServiceError, null);
        }
      },
      clock,
    ),
  };
}
