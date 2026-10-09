import * as grpc from '@grpc/grpc-js';
import { type LamportClock, withGrpcInterceptors } from '@bank/shared';
import type { FailureDetector } from '../cluster/failure-detector.js';
import type { EventSink } from '../observability/event-sink.js';
import type { RpcTraceBuffer } from '../observability/rpc-trace-buffer.js';
import type { Replicator } from '../replication/replicator.js';
import type { IntegrityChecker } from '../replication/integrity.js';

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
        eventLoopLagMs: 0,
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

    GetElections: withGrpcInterceptors((_call, callback) => {
      callback(null, { elections: [] });
    }, clock),

    GetClockState: withGrpcInterceptors((_call, callback) => {
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
    }, clock),

    GetClockHistory: withGrpcInterceptors((_call, callback) => {
      callback(null, { rounds: [] });
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
