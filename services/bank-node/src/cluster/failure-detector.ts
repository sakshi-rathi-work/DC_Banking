import { createLogger } from '@bank/shared';
import type { EventSink } from '../observability/event-sink.js';

const logger = createLogger({ service: 'failure-detector' });

export interface NodeConfigInfo {
  electionAlgorithm: string;
  consistencyMode: string;
  version: number;
}

export interface PeerState {
  nodeId: number;
  status: 'HEALTHY' | 'SUSPECT' | 'DOWN';
  role: string;
  epoch: number;
  leaderId: number;
  lastHeartbeatAt: number;
  lastSeq: number;
  lamport: number;
  activeRequests: number;
  eventLoopLagMs: number;
  config?: NodeConfigInfo;
}

export interface IncomingHeartbeat {
  nodeId: number;
  status: string;
  role: string;
  epoch: number;
  leaderId: number;
  lastSeq: number;
  lamport: number;
  activeRequests?: number;
  eventLoopLagMs?: number;
  config?: NodeConfigInfo;
  sentAtMs?: number;
}

export class FailureDetector {
  private selfNodeId: number;
  private timeoutMs: number;
  private peerStates = new Map<number, PeerState>();
  private eventSink?: EventSink;

  constructor(selfNodeId: number, timeoutMs = 3000, eventSink?: EventSink) {
    this.selfNodeId = selfNodeId;
    this.timeoutMs = timeoutMs;
    this.eventSink = eventSink;
  }

  public setEventSink(eventSink: EventSink): void {
    this.eventSink = eventSink;
  }

  public async recordHeartbeat(hb: IncomingHeartbeat): Promise<void> {
    const now = Date.now();
    const existing = this.peerStates.get(hb.nodeId);
    const wasDown = existing?.status === 'DOWN';

    const updatedState: PeerState = {
      nodeId: hb.nodeId,
      status: 'HEALTHY',
      role: hb.role || 'FOLLOWER',
      epoch: hb.epoch || 0,
      leaderId: hb.leaderId || 0,
      lastHeartbeatAt: now,
      lastSeq: hb.lastSeq || 0,
      lamport: hb.lamport || 0,
      activeRequests: hb.activeRequests || 0,
      eventLoopLagMs: hb.eventLoopLagMs || 0,
      config: hb.config,
    };

    this.peerStates.set(hb.nodeId, updatedState);

    if (wasDown) {
      logger.info(`Node ${hb.nodeId} RECOVERED (received heartbeat)`, { nodeId: hb.nodeId });
      if (this.eventSink) {
        await this.eventSink.logEvent({
          service: 'cluster-membership',
          eventType: 'NODE_RECOVERED',
          severity: 'INFO',
          peerNodeId: hb.nodeId,
          details: { peerNodeId: hb.nodeId, epoch: hb.epoch },
        });
      }
    }
  }

  public async checkFailures(): Promise<void> {
    const now = Date.now();

    for (const [nodeId, state] of this.peerStates.entries()) {
      if (state.status !== 'DOWN') {
        const age = now - state.lastHeartbeatAt;
        if (age > this.timeoutMs) {
          state.status = 'DOWN';
          logger.warn(`Node ${nodeId} FAILURE DETECTED (no heartbeat for ${age}ms)`, {
            nodeId,
            ageMs: age,
          });

          if (this.eventSink) {
            await this.eventSink.logEvent({
              service: 'cluster-membership',
              eventType: 'NODE_FAILURE_DETECTED',
              severity: 'WARN',
              peerNodeId: nodeId,
              details: { peerNodeId: nodeId, ageMs: age, timeoutMs: this.timeoutMs },
            });
          }
        }
      }
    }
  }


  public getPeerState(nodeId: number): PeerState | undefined {
    return this.peerStates.get(nodeId);
  }

  public getAllPeerStates(): PeerState[] {
    return Array.from(this.peerStates.values());
  }

  public getHealthyPeerNodeIds(): number[] {
    return Array.from(this.peerStates.values())
      .filter((s) => s.status === 'HEALTHY')
      .map((s) => s.nodeId);
  }
}
