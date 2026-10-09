import * as grpc from '@grpc/grpc-js';
import { type LamportClock, withGrpcInterceptors, processIncomingServerMetadata } from '@bank/shared';
import type { FailureDetector, IncomingHeartbeat } from '../cluster/failure-detector.js';
import type { ElectionManager } from '../election/election-manager.js';
import type { LogApplier } from '../replication/applier.js';
import type { CatchupService } from '../replication/catchup.js';
import type { SnapshotService } from '../replication/snapshot.js';
import type { AppendEntriesReq } from '../replication/types.js';
import type { ElectionMsgPayload, CoordinatorMsgPayload, RingTokenPayload, RingCoordinatorPayload } from '../election/types.js';

export interface ClusterServiceOptions {
  nodeId: number;
  getEpoch: () => number;
  clock: LamportClock;
  failureDetector: FailureDetector;
  electionManager?: ElectionManager;
  applier?: LogApplier;
  catchupService?: CatchupService;
  snapshotService?: SnapshotService;
}

export function createClusterServiceHandlers(opts: ClusterServiceOptions) {
  const { nodeId, getEpoch, clock, failureDetector, electionManager, applier, catchupService, snapshotService } = opts;

  return {
    Heartbeat: withGrpcInterceptors(
      (call: grpc.ServerUnaryCall<IncomingHeartbeat, unknown>, callback: grpc.sendUnaryData<unknown>) => {
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
      if (!electionManager) {
        return callback({ code: grpc.status.UNIMPLEMENTED, details: 'ElectionManager not configured' }, null);
      }
      callback(null, {});
      setImmediate(() => {
        electionManager.handleRingTokenMsg(call.request);
      });
    }, clock),

    RingCoordinator: withGrpcInterceptors((call: grpc.ServerUnaryCall<RingCoordinatorPayload, unknown>, callback: grpc.sendUnaryData<unknown>) => {
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

    // Stubs for Berkeley clock sync
    GetTime: withGrpcInterceptors((_call, callback) => {
      callback({ code: grpc.status.UNIMPLEMENTED, details: 'GetTime RPC not yet active' }, null);
    }, clock),

    AdjustClock: withGrpcInterceptors((_call, callback) => {
      callback({ code: grpc.status.UNIMPLEMENTED, details: 'AdjustClock RPC not yet active' }, null);
    }, clock),
  };
}
