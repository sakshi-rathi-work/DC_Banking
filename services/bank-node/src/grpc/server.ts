import { Server, type ServiceDefinition } from '@grpc/grpc-js';
import type pg from 'pg';
import type { LamportClock } from '@bank/shared';
import { loadBankProto, loadClusterProto, loadObservabilityProto, loadLabProto } from './proto-loader.js';
import { createBankServiceHandlers } from './bank-service.js';
import { createClusterServiceHandlers } from './cluster-service.js';
import { createObservabilityServiceHandlers } from './observability-service.js';
import { createLabServiceHandlers } from './lab-service.js';
import type { FailureDetector } from '../cluster/failure-detector.js';
import type { EventSink } from '../observability/event-sink.js';
import type { RpcTraceBuffer } from '../observability/rpc-trace-buffer.js';
import type { PeerManager } from '../cluster/peer-manager.js';
import type { ElectionManager } from '../election/election-manager.js';
import type { Replicator } from '../replication/replicator.js';
import type { LogApplier } from '../replication/applier.js';
import type { CatchupService } from '../replication/catchup.js';
import type { SnapshotService } from '../replication/snapshot.js';
import type { IntegrityChecker } from '../replication/integrity.js';
import type { BerkeleyClockSync } from '../clock/berkeley-sync.js';
import type { FaultManager } from '../cluster/fault-manager.js';

export interface CreateGrpcServerOptions {
  pool: pg.Pool;
  jwtSecret: string;
  nodeId: number;
  priority?: number;
  role?: string;
  getEpoch: () => number;
  getLamport: () => number;
  getLeaderId?: () => number;
  getLastSeq?: () => number;
  isLeader?: () => boolean;
  peerManager?: PeerManager;
  electionManager?: ElectionManager;
  replicator?: Replicator;
  applier?: LogApplier;
  catchupService?: CatchupService;
  snapshotService?: SnapshotService;
  integrityChecker?: IntegrityChecker;
  clock?: LamportClock;
  failureDetector?: FailureDetector;
  eventSink?: EventSink;
  rpcTraceBuffer?: RpcTraceBuffer;
  berkeleySync?: BerkeleyClockSync;
  faultManager?: FaultManager;
}

/**
 * Create and configure a gRPC Server instance with BankService, ClusterService,
 * ObservabilityService, and LabService registered.
 */
export function createGrpcServer(opts: CreateGrpcServerOptions): Server {
  const server = new Server();

  // 1. BankService
  const bankProto = loadBankProto() as unknown as {
    bank: { v1: { BankService: { service: ServiceDefinition } } };
  };
  const bankServiceDef = bankProto.bank.v1.BankService.service;
  const bankHandlers = createBankServiceHandlers(opts);
  server.addService(bankServiceDef, bankHandlers);

  // 2. ClusterService, ObservabilityService & LabService (if dependencies provided)
  if (opts.clock && opts.failureDetector && opts.eventSink && opts.rpcTraceBuffer) {
    const clusterProto = loadClusterProto() as unknown as {
      bank: { v1: { ClusterService: { service: ServiceDefinition } } };
    };
    const clusterServiceDef = clusterProto.bank.v1.ClusterService.service;
    const clusterHandlers = createClusterServiceHandlers({
      nodeId: opts.nodeId,
      getEpoch: opts.getEpoch,
      clock: opts.clock,
      failureDetector: opts.failureDetector,
      electionManager: opts.electionManager,
      applier: opts.applier,
      catchupService: opts.catchupService,
      snapshotService: opts.snapshotService,
      berkeleySync: opts.berkeleySync,
    });
    server.addService(clusterServiceDef, clusterHandlers);

    const observabilityProto = loadObservabilityProto() as unknown as {
      bank: { v1: { ObservabilityService: { service: ServiceDefinition } } };
    };
    const observabilityServiceDef = observabilityProto.bank.v1.ObservabilityService.service;
    const observabilityHandlers = createObservabilityServiceHandlers({
      nodeId: opts.nodeId,
      priority: opts.priority ?? opts.nodeId,
      role: opts.role ?? 'FOLLOWER',
      getEpoch: opts.getEpoch,
      getLeaderId: opts.getLeaderId ?? (() => opts.nodeId),
      getLastSeq: opts.getLastSeq ?? (() => 0),
      clock: opts.clock,
      failureDetector: opts.failureDetector,
      eventSink: opts.eventSink,
      rpcTraceBuffer: opts.rpcTraceBuffer,
      replicator: opts.replicator,
      integrityChecker: opts.integrityChecker,
      berkeleySync: opts.berkeleySync,
      pool: opts.pool,
    });
    server.addService(observabilityServiceDef, observabilityHandlers);

    if (opts.electionManager) {
      const labProto = loadLabProto() as unknown as {
        bank: { v1: { LabService: { service: ServiceDefinition } } };
      };
      const labServiceDef = labProto.bank.v1.LabService.service;
      const labHandlers = createLabServiceHandlers({
        nodeId: opts.nodeId,
        clock: opts.clock,
        electionManager: opts.electionManager,
        faultManager: opts.faultManager,
        berkeleySync: opts.berkeleySync,
        peerManager: opts.peerManager,
        onConfigChange: (cfg) => {
          if (cfg.consistencyMode && opts.replicator) {
            opts.replicator.setConsistencyMode(cfg.consistencyMode.toLowerCase() as 'strong' | 'eventual');
          }
          if (cfg.replicationDelayMs !== undefined && opts.replicator) {
            opts.replicator.setReplicationDelayMs(cfg.replicationDelayMs);
          }
        },
      });
      server.addService(labServiceDef, labHandlers);
    }
  }

  return server;
}
