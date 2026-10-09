import { randomUUID } from 'node:crypto';
import * as grpc from '@grpc/grpc-js';
import { type LamportClock, withGrpcInterceptors } from '@bank/shared';
import type { ElectionManager } from '../election/election-manager.js';
import type { AlgorithmType } from '../election/types.js';


import type { FaultManager, FaultMode } from '../cluster/fault-manager.js';

export interface LabServiceOptions {
  nodeId: number;
  clock: LamportClock;
  electionManager: ElectionManager;
  faultManager?: FaultManager;
  onConfigChange?: (config: { electionAlgorithm?: string; consistencyMode?: string }) => void;
}

export function createLabServiceHandlers(opts: LabServiceOptions) {
  const { nodeId, clock, electionManager, faultManager, onConfigChange } = opts;

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

        if (onConfigChange) {
          onConfigChange({
            electionAlgorithm: req.electionAlgorithm,
            consistencyMode: req.consistencyMode,
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

    TriggerClockSync: withGrpcInterceptors((_call, callback) => callback(null, {}), clock),
    SimulateWork: withGrpcInterceptors((_call, callback) => callback(null, { nodeId, workMs: 0, actualMs: 0, lamport: clock.getValue() }), clock),
    CpuTask: withGrpcInterceptors((_call, callback) => callback(null, { nodeId, mode: 'MAIN', durationMs: 0, eventLoopLagP99Ms: 0, taskDurationsMs: [] }), clock),
    PeerPing: withGrpcInterceptors((_call, callback) => callback(null, { hops: [] }), clock),
  };
}
