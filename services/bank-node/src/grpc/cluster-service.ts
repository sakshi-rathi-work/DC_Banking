import * as grpc from '@grpc/grpc-js';
import { type LamportClock, withGrpcInterceptors, processIncomingServerMetadata } from '@bank/shared';
import type { FailureDetector, IncomingHeartbeat } from '../cluster/failure-detector.js';
import type { ElectionManager } from '../election/election-manager.js';
import type { LogApplier } from '../replication/applier.js';
import type { CatchupService } from '../replication/catchup.js';
import type { SnapshotService } from '../replication/snapshot.js';
import type { AppendEntriesReq } from '../replication/types.js';
import type { ElectionMsgPayload, CoordinatorMsgPayload, RingTokenPayload, RingCoordinatorPayload } from '../election/types.js';
import type { BerkeleyClockSync } from '../clock/berkeley-sync.js';

export interface ClusterServiceOptions {
  nodeId: number;
  getEpoch: () => number;
  clock: LamportClock;
  failureDetector: FailureDetector;
  electionManager?: ElectionManager;
  applier?: LogApplier;
  catchupService?: CatchupService;
  snapshotService?: SnapshotService;
  berkeleySync?: BerkeleyClockSync;
  faultManager?: import('../cluster/fault-manager.js').FaultManager;
}

export function createClusterServiceHandlers(opts: ClusterServiceOptions) {
  const { nodeId, getEpoch, clock, failureDetector, electionManager, applier, catchupService, snapshotService, berkeleySync, faultManager } = opts;

  function checkClusterFault(callback: grpc.sendUnaryData<any>): boolean {
    if (faultManager?.isCrashed()) {
      callback({ code: grpc.status.UNAVAILABLE, details: 'Node is simulated crashed' }, null);
      return true;
    }
    if (faultManager?.isPartitioned()) {
      callback({ code: grpc.status.UNAVAILABLE, details: 'Node is network partitioned' }, null);
      return true;
    }
    return false;
  }

  return {
    Heartbeat: withGrpcInterceptors(
      (call: grpc.ServerUnaryCall<IncomingHeartbeat, unknown>, callback: grpc.sendUnaryData<unknown>) => {
        if (checkClusterFault(callback)) return;
        const req = call.request;

        if (req && req.nodeId) {
          if (req.lamport) {
            clock.receive(req.lamport);
          }
          failureDetector.recordHeartbeat(req);
        }

        const ack = {
          nodeId,
          epoch: getEpoch(),
          lamport: clock.tick(),
        };

        callback(null, ack);
      },
      clock,
    ),

    Ping: withGrpcInterceptors(
      (
        call: grpc.ServerUnaryCall<{ fromNode: number; lamport: number }, unknown>,
        callback: grpc.sendUnaryData<unknown>,
      ) => {
        if (checkClusterFault(callback)) return;
        if (call.request?.lamport) {
          clock.receive(call.request.lamport);
        }

        const reply = {
          nodeId,
          lamport: clock.tick(),
          status: 'HEALTHY',
          receivedAt: Date.now(),
        };

        callback(null, reply);
      },
      clock,
    ),

    // Bully election handlers
    Election: withGrpcInterceptors(async (call: grpc.ServerUnaryCall<ElectionMsgPayload, unknown>, callback: grpc.sendUnaryData<unknown>) => {
      if (checkClusterFault(callback)) return;
      if (!electionManager) {
        return callback({ code: grpc.status.UNIMPLEMENTED, details: 'ElectionManager not configured' }, null);
      }
      try {
        const reply = await electionManager.handleBullyElectionMsg(call.request);
        callback(null, reply);
      } catch (err) {
        callback(err as grpc.ServiceError, null);
      }
    }, clock),

    Coordinator: withGrpcInterceptors(async (call: grpc.ServerUnaryCall<CoordinatorMsgPayload, unknown>, callback: grpc.sendUnaryData<unknown>) => {
      if (checkClusterFault(callback)) return;
      if (!electionManager) {
        return callback({ code: grpc.status.UNIMPLEMENTED, details: 'ElectionManager not configured' }, null);
      }
      try {
        await electionManager.handleBullyCoordinatorMsg(call.request);
        callback(null, {});
      } catch (err) {
        callback(err as grpc.ServiceError, null);
      }
    }, clock),

    // Ring election handlers
    RingElection: withGrpcInterceptors((call: grpc.ServerUnaryCall<RingTokenPayload, unknown>, callback: grpc.sendUnaryData<unknown>) => {
      if (checkClusterFault(callback)) return;
      if (!electionManager) {
        return callback({ code: grpc.status.UNIMPLEMENTED, details: 'ElectionManager not configured' }, null);
      }
      callback(null, {});
      setImmediate(() => {
        electionManager.handleRingTokenMsg(call.request);
      });
    }, clock),

    RingCoordinator: withGrpcInterceptors((call: grpc.ServerUnaryCall<RingCoordinatorPayload, unknown>, callback: grpc.sendUnaryData<unknown>) => {
      if (checkClusterFault(callback)) return;
      if (!electionManager) {
        return callback({ code: grpc.status.UNIMPLEMENTED, details: 'ElectionManager not configured' }, null);
      }
      callback(null, {});
      setImmediate(() => {
        electionManager.handleRingCoordinatorMsg(call.request);
      });
    }, clock),

    // Replication handlers
    AppendEntries: withGrpcInterceptors(async (call: grpc.ServerUnaryCall<AppendEntriesReq, unknown>, callback: grpc.sendUnaryData<unknown>) => {
      if (checkClusterFault(callback)) return;
      if (!applier) {
        return callback({ code: grpc.status.UNIMPLEMENTED, details: 'LogApplier not configured' }, null);
      }
      try {
        const result = await applier.applyEntries(call.request, getEpoch());
        callback(null, result);
      } catch (err) {
        callback(err as grpc.ServiceError, null);
      }
    }, clock),

    GetLogEntries: withGrpcInterceptors(async (call: grpc.ServerUnaryCall<{ fromSeq?: number; maxEntries?: number }, unknown>, callback: grpc.sendUnaryData<unknown>) => {
      if (!catchupService) {
        return callback({ code: grpc.status.UNIMPLEMENTED, details: 'CatchupService not configured' }, null);
      }
      try {
        const req = call.request || {};
        const result = await catchupService.getLogEntries(req.fromSeq || 1, req.maxEntries || 100);
        callback(null, result);
      } catch (err) {
        callback(err as grpc.ServiceError, null);
      }
    }, clock),

    GetSnapshot: async (call: grpc.ServerWritableStream<unknown, unknown>) => {
      processIncomingServerMetadata(call.metadata, clock);
      if (!snapshotService) {
        call.destroy(new Error('SnapshotService not configured'));
        return;
      }
      try {
        const chunks = await snapshotService.createSnapshotChunks();
        for (const chunk of chunks) {
          call.write(chunk);
        }
        call.end();
      } catch (err) {
        call.destroy(err as Error);
      }
    },

    // Berkeley clock sync — real implementations
    GetTime: withGrpcInterceptors(
      (_call: grpc.ServerUnaryCall<{ roundId?: string }, unknown>, callback: grpc.sendUnaryData<unknown>) => {
        if (!berkeleySync) {
          // Fallback: return raw Date.now() in microseconds
          callback(null, { syncedTimeUs: Date.now() * 1000 });
          return;
        }
        const syncedTimeUs = Number(berkeleySync.getSyncedTimeUs());
        callback(null, { syncedTimeUs });
      },
      clock,
    ),

    AdjustClock: withGrpcInterceptors(
      (call: grpc.ServerUnaryCall<{ roundId?: string; adjustMs?: number }, unknown>, callback: grpc.sendUnaryData<unknown>) => {
        if (!berkeleySync) {
          callback(null, { adjustmentBeforeMs: 0, adjustmentAfterMs: 0 });
          return;
        }
        const adjustMs = call.request?.adjustMs ?? 0;
        const { before, after } = berkeleySync.setAdjustmentMs(adjustMs);
        callback(null, { adjustmentBeforeMs: before, adjustmentAfterMs: after });
      },
      clock,
    ),
  };
}
