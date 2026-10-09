import * as grpc from '@grpc/grpc-js';
import type pg from 'pg';
import { type LamportClock, withGrpcInterceptors } from '@bank/shared';
import type { FailureDetector } from '../cluster/failure-detector.js';
import type { EventSink } from '../observability/event-sink.js';
import type { RpcTraceBuffer } from '../observability/rpc-trace-buffer.js';
import type { Replicator } from '../replication/replicator.js';
import type { IntegrityChecker } from '../replication/integrity.js';
import type { BerkeleyClockSync } from '../clock/berkeley-sync.js';
import { lagMonitor } from '../concurrency/lag-monitor.js';

export interface ObservabilityServiceOptions {
  nodeId: number;
  priority: number;
  role: string;
  getEpoch: () => number;
  getLeaderId: () => number;
  getLastSeq: () => number;
  clock: LamportClock;
  failureDetector: FailureDetector;
  eventSink: EventSink;
  rpcTraceBuffer: RpcTraceBuffer;
  replicator?: Replicator;
  integrityChecker?: IntegrityChecker;
  berkeleySync?: BerkeleyClockSync;
  pool?: pg.Pool;
}

export function createObservabilityServiceHandlers(opts: ObservabilityServiceOptions) {
  const {
    nodeId,
    priority,
    role,
    getEpoch,
    getLeaderId,
    getLastSeq,
    clock,
    failureDetector,
    eventSink,
    rpcTraceBuffer,
    replicator,
    integrityChecker,
    berkeleySync,
    pool,
  } = opts;

  return {
    GetStatus: withGrpcInterceptors((_call: grpc.ServerUnaryCall<unknown, unknown>, callback: grpc.sendUnaryData<unknown>) => {
      const peerStates = failureDetector.getAllPeerStates();
      let lastHeartbeatAge = 0;
      if (peerStates.length > 0) {
        const latest = Math.max(...peerStates.map((p) => p.lastHeartbeatAt));
        lastHeartbeatAge = Date.now() - latest;
      }

      const status = {
        nodeId,
        priority,
        status: 'HEALTHY',
        role,
        leaderReady: true,
        epoch: getEpoch(),
        leaderId: getLeaderId(),
        lastSeq: getLastSeq(),
        lamport: clock.getValue(),
        activeRequests: 0,
        eventLoopLagMs: Math.round(lagMonitor.getP99Ms() * 100) / 100,
        lastHeartbeatAgeMs: lastHeartbeatAge,
        reachable: true,
        faultMode: 'NONE',
      };

      callback(null, status);
    }, clock),

    GetEvents: withGrpcInterceptors(
      async (
        call: grpc.ServerUnaryCall<
          { since?: number; limit?: number; type?: string; node?: number; requestId?: string },
          unknown
        >,
        callback: grpc.sendUnaryData<unknown>,
      ) => {
        try {
          const req = call.request || {};
          const events = await eventSink.getEvents({
            since: req.since,
            limit: req.limit,
            type: req.type,
            node: req.node,
            requestId: req.requestId,
          });

          callback(null, { events });
        } catch (err) {
          callback(err as grpc.ServiceError, null);
        }
      },
      clock,
    ),

    GetRpcTrace: withGrpcInterceptors(
      (
        call: grpc.ServerUnaryCall<{ limit?: number; requestId?: string }, unknown>,
        callback: grpc.sendUnaryData<unknown>,
      ) => {
        const req = call.request || {};
        const traces = rpcTraceBuffer.getTraces(req.limit, req.requestId);
        callback(null, { traces });
      },
      clock,
    ),

    GetElections: withGrpcInterceptors(
      async (call: grpc.ServerUnaryCall<{ limit?: number }, unknown>, callback: grpc.sendUnaryData<unknown>) => {
        try {
          if (!pool) {
            callback(null, { elections: [] });
            return;
          }
          const limit = Math.min(call.request?.limit ?? 20, 100);
          const res = await pool.query(
            `SELECT election_id as "electionId", algorithm, trigger, initiator, winner, epoch, 
                    participants, messages::text as "messagesJson", outcome, 
                    started_at::text as "startedAt", finished_at::text as "finishedAt"
             FROM election_history
             ORDER BY started_at DESC
             LIMIT $1`,
            [limit],
          );
          callback(null, {
            elections: res.rows.map((r) => ({
              electionId: r.electionId,
              algorithm: r.algorithm,
              trigger: r.trigger,
              initiator: r.initiator,
              winner: r.winner ?? 0,
              epoch: Number(r.epoch ?? 0),
              participants: r.participants ?? [],
              messagesJson: r.messagesJson ?? '[]',
              outcome: r.outcome,
              startedAt: r.startedAt ?? '',
              finishedAt: r.finishedAt ?? '',
            })),
          });
        } catch (err) {
          callback(err as grpc.ServiceError, null);
        }
      },
      clock,
    ),

    GetClockState: withGrpcInterceptors((_call, callback) => {
      if (berkeleySync) {
        callback(null, {
          syncedTimeUs: Number(berkeleySync.getSyncedTimeUs()),
          hardwareTimeUs: Number(berkeleySync.getHardwareTimeUs()),
          adjustmentMs: berkeleySync.getAdjustmentMs(),
          offsetFromMasterMs: berkeleySync.getOffsetFromMasterMs(),
          groundTruthErrorMs: berkeleySync.getGroundTruthErrorMs(),
          lamport: clock.getValue(),
          lastSyncAt: berkeleySync.getLastSyncAt() || new Date().toISOString(),
        });
      } else {
        const nowUs = Date.now() * 1000;
        callback(null, {
          syncedTimeUs: nowUs,
          hardwareTimeUs: nowUs,
          adjustmentMs: 0,
          offsetFromMasterMs: 0,
          groundTruthErrorMs: 0,
          lamport: clock.getValue(),
          lastSyncAt: new Date().toISOString(),
        });
      }
    }, clock),

    GetClockHistory: withGrpcInterceptors((_call, callback) => {
      if (berkeleySync) {
        callback(null, { rounds: berkeleySync.getHistory() });
      } else {
        callback(null, { rounds: [] });
      }
    }, clock),

    GetReplicationState: withGrpcInterceptors((_call, callback) => {
      const nodes = replicator ? replicator.getBackupStates() : [];
      callback(null, {
        mode: replicator ? replicator.getConsistencyMode().toUpperCase() : 'STRONG',
        leaderId: getLeaderId(),
        leaderSeq: getLastSeq(),
        nodes,
      });
    }, clock),

    GetIntegrity: withGrpcInterceptors(async (_call, callback) => {
      try {
        if (integrityChecker) {
          const localIntegrity = await integrityChecker.getLocalIntegrity();
          callback(null, {
            nodes: [localIntegrity],
            inSync: true,
          });
        } else {
          callback(null, {
            nodes: [
              {
                nodeId,
                lastSeq: getLastSeq(),
                accountCount: 0,
                txnCount: 0,
                totalBalancePaise: 0,
                accountsChecksum: '',
              },
            ],
            inSync: true,
          });
        }
      } catch (err) {
        callback(err as grpc.ServiceError, null);
      }
    }, clock),
  };
}
