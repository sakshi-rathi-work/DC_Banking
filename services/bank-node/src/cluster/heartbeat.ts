import { createLogger, type LamportClock, prepareClientMetadata } from '@bank/shared';

import type { PeerManager } from './peer-manager.js';
import type { FailureDetector } from './failure-detector.js';

const logger = createLogger({ service: 'heartbeat-sender' });

export interface NodeStateProvider {
  getNodeId: () => number;
  getRole: () => string;
  getEpoch: () => number;
  getLeaderId: () => number;
  getLastSeq: () => number;
  getElectionAlgorithm: () => string;
  getConsistencyMode: () => string;
  getActiveRequests: () => number;
  getEventLoopLagMs: () => number;
}

import type { FaultManager } from './fault-manager.js';

export class HeartbeatLoop {
  private peerManager: PeerManager;
  private failureDetector: FailureDetector;
  private clock: LamportClock;
  private stateProvider: NodeStateProvider;
  private intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private faultManager?: FaultManager;

  constructor(
    peerManager: PeerManager,
    failureDetector: FailureDetector,
    clock: LamportClock,
    stateProvider: NodeStateProvider,
    intervalMs = 1000,
    faultManager?: FaultManager,
  ) {
    this.peerManager = peerManager;
    this.failureDetector = failureDetector;
    this.clock = clock;
    this.stateProvider = stateProvider;
    this.intervalMs = intervalMs;
    this.faultManager = faultManager;
  }

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick();
    }, this.intervalMs);
    logger.info(`Heartbeat sender loop started (interval: ${this.intervalMs}ms)`);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('Heartbeat sender loop stopped');
    }
  }

  public tick(): void {
    // If crashed, the node is completely dead — do not run failure detector or send heartbeats
    if (this.faultManager?.isCrashed()) {
      return;
    }

    // First, run failure detector check
    this.failureDetector.checkFailures();

    // If partitioned, suppress sending outgoing peer heartbeats
    if (this.faultManager?.isPartitioned()) {
      return;
    }

    // Send heartbeats to all peer clients
    const peerNodeIds = this.peerManager.getAllPeerNodeIds();
    const selfNodeId = this.stateProvider.getNodeId();

    const heartbeatMsg = {
      nodeId: selfNodeId,
      status: 'HEALTHY',
      role: this.stateProvider.getRole(),
      epoch: this.stateProvider.getEpoch(),
      leaderId: this.stateProvider.getLeaderId(),
      lastSeq: this.stateProvider.getLastSeq(),
      lastEntryEpoch: this.stateProvider.getEpoch(),
      lamport: this.clock.getValue(),
      config: {
        electionAlgorithm: this.stateProvider.getElectionAlgorithm(),
        consistencyMode: this.stateProvider.getConsistencyMode(),
        version: 1,
      },
      activeRequests: this.stateProvider.getActiveRequests(),
      eventLoopLagMs: this.stateProvider.getEventLoopLagMs(),
      sentAtMs: Date.now(),
    };

    for (const peerId of peerNodeIds) {
      const client = this.peerManager.getPeerClient(peerId);
      if (!client) continue;

      const metadata = prepareClientMetadata(this.clock, selfNodeId);
      const callOpts = { deadline: Date.now() + 800 }; // 800ms RPC timeout

      client.heartbeat(heartbeatMsg, metadata, callOpts, (err, response) => {
        if (err) {
          logger.debug(`Heartbeat to Node ${peerId} failed`, { code: err.code, message: err.message });
        } else if (response && typeof response === 'object') {
          const ack = response as { nodeId: number; epoch: number; lamport: number };
          if (ack.lamport) {
            this.clock.receive(ack.lamport);
          }
        }
      });
    }
  }
}
