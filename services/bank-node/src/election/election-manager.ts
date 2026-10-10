import type pg from 'pg';
import { createLogger, type LamportClock } from '@bank/shared';
import { BullyElectionCore } from './bully.js';
import { RingElectionCore } from './ring.js';
import type { LeaderPrep } from './leader-prep.js';
import type { FailureDetector } from '../cluster/failure-detector.js';
import type { PeerManager } from '../cluster/peer-manager.js';
import type { EventSink } from '../observability/event-sink.js';
import type { AlgorithmType, NodePriorityInfo, ElectionMsgPayload, CoordinatorMsgPayload, RingTokenPayload, RingCoordinatorPayload } from './types.js';

const logger = createLogger({ service: 'election-manager' });

export interface ElectionManagerOptions {
  selfNodeId: number;
  selfPriority: number;
  algorithm: AlgorithmType;
  peersStr?: string;
  pool?: pg.Pool;
  clock: LamportClock;
  failureDetector: FailureDetector;
  peerManager: PeerManager;
  eventSink?: EventSink;
  leaderPrep?: LeaderPrep;
  preemptOnRecovery?: boolean;
  onLeaderChange?: (leaderId: number, isSelf: boolean) => void;
}

export class ElectionManager {
  private selfNodeId: number;
  private selfPriority: number;
  private algorithm: AlgorithmType;
  private pool?: pg.Pool;
  private clock: LamportClock;
  private failureDetector: FailureDetector;
  private peerManager: PeerManager;
  private eventSink?: EventSink;
  private leaderPrep?: LeaderPrep;
  private preemptOnRecovery: boolean;
  private onLeaderChange?: (leaderId: number, isSelf: boolean) => void;

  private bullyCore: BullyElectionCore;
  private ringCore: RingElectionCore;
  private currentLeaderId: number = 0;
  private currentEpoch: number = 0;
  private okTimer: NodeJS.Timeout | null = null;
  private ringHopTimer: NodeJS.Timeout | null = null;

  constructor(opts: ElectionManagerOptions) {
    this.selfNodeId = opts.selfNodeId;
    this.selfPriority = opts.selfPriority;
    this.algorithm = opts.algorithm;
    this.pool = opts.pool;
    this.clock = opts.clock;
    this.failureDetector = opts.failureDetector;
    this.peerManager = opts.peerManager;
    this.eventSink = opts.eventSink;
    this.leaderPrep = opts.leaderPrep;
    this.preemptOnRecovery = opts.preemptOnRecovery ?? true;
    this.onLeaderChange = opts.onLeaderChange;

    const clusterNodes = this.getClusterNodeInfos();
    this.bullyCore = new BullyElectionCore({ selfNodeId: opts.selfNodeId, selfPriority: opts.selfPriority, clusterNodes });
    this.ringCore = new RingElectionCore({ selfNodeId: opts.selfNodeId, selfPriority: opts.selfPriority, clusterNodes });
  }

  public getAlgorithm(): AlgorithmType {
    return this.algorithm;
  }

  public setAlgorithm(alg: AlgorithmType): void {
    if (this.algorithm !== alg) {
      logger.info(`Switching election algorithm from ${this.algorithm} to ${alg}`);
      this.algorithm = alg;
    }
  }

  public getLeaderId(): number {
    return this.currentLeaderId || this.selfNodeId;
  }

  public isLeader(): boolean {
    return this.currentLeaderId === this.selfNodeId;
  }

  public getEpoch(): number {
    return this.currentEpoch;
  }

  public setEpoch(epoch: number): void {
    this.currentEpoch = Math.max(this.currentEpoch, epoch);
    this.bullyCore.setEpoch(this.currentEpoch);
    this.ringCore.setEpoch(this.currentEpoch);
  }

  private getClusterNodeInfos(): NodePriorityInfo[] {
    const peers = this.peerManager.getPeerConfigs();
    const nodes: NodePriorityInfo[] = [{ nodeId: this.selfNodeId, priority: this.selfPriority }];
    for (const p of peers) {
      nodes.push({ nodeId: p.nodeId, priority: p.nodeId, address: p.address });
    }
    return nodes;
  }

  private updateClusterNodes(): void {
    const nodes = this.getClusterNodeInfos();
    this.bullyCore.setClusterNodes(nodes);
    this.ringCore.setClusterNodes(nodes);
  }

  /**
   * Persist epoch and leader state to database & log history.
   */
  public async persistState(leaderId: number, epoch: number, electionId?: string, trigger = 'HEARTBEAT_TIMEOUT', participants: number[] = [], outcome = 'ELECTED'): Promise<void> {
    const prevLeaderId = this.currentLeaderId;
    this.currentEpoch = epoch;
    this.currentLeaderId = leaderId;
    this.setEpoch(epoch);

    if (prevLeaderId !== leaderId && this.onLeaderChange) {
      try {
        this.onLeaderChange(leaderId, leaderId === this.selfNodeId);
      } catch (err) {
        logger.error('Error in onLeaderChange handler', { err });
      }
    }

    if (this.pool) {
      try {
        await this.pool.query(
          `UPDATE node_state SET epoch = $1, leader_id = $2, updated_at = now() WHERE node_id = $3`,
          [epoch, leaderId, this.selfNodeId],
        );

        if (electionId) {
          await this.pool.query(
            `INSERT INTO election_history (
              election_id, algorithm, trigger, initiator, winner, epoch, participants, messages, outcome, finished_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
            ON CONFLICT (election_id) DO UPDATE SET winner = $5, epoch = $6, outcome = $9, finished_at = now()`,
            [
              electionId,
              this.algorithm,
              trigger,
              this.selfNodeId,
              leaderId,
              epoch,
              participants.length > 0 ? participants : [this.selfNodeId],
              JSON.stringify([]),
              outcome,
            ],
          );
        }
      } catch (err) {
        logger.error('Failed to persist election state to database', { err });
      }
    }
  }

  /**
   * Initiate Election using configured algorithm.
   */
  public async initiateElection(trigger = 'MANUAL'): Promise<void> {
    this.updateClusterNodes();

    if (this.algorithm === 'bully') {
      await this.initiateBullyElection(trigger);
    } else {
      await this.initiateRingElection(trigger);
    }
  }

  // ===== BULLY PROTOCOL =====

  private async initiateBullyElection(trigger: string): Promise<void> {
    const init = this.bullyCore.startElection();
    this.setEpoch(init.epoch);

    logger.info(`Node ${this.selfNodeId} initiated Bully election (ID: ${init.electionId}, Epoch: ${init.epoch})`, { trigger });

    this.eventSink?.logEvent({
      service: 'election-manager',
      eventType: 'ELECTION_STARTED',
      severity: 'INFO',
      details: { algorithm: 'bully', trigger, epoch: init.epoch, electionId: init.electionId },
    });

    if (init.isHighest) {
      // Highest priority node wins immediately
      await this.onBullyWin(init.electionId, init.epoch, trigger);
      return;
    }

    // Send ElectionMsg to all higher nodes
    const payload: ElectionMsgPayload = {
      electionId: init.electionId,
      fromNode: this.selfNodeId,
      fromPriority: this.selfPriority,
      epoch: init.epoch,
    };

    for (const higherNode of init.higherNodes) {
      const client = this.peerManager.getPeerClient(higherNode.nodeId);
      if (client) {
        const metadata = this.clock ? new (await import('@grpc/grpc-js')).Metadata() : new (await import('@grpc/grpc-js')).Metadata();
        metadata.set('x-lamport', this.clock.tick().toString());

        client.election(payload, metadata, { deadline: Date.now() + 1000 }, (err, res) => {
          if (!err && res && typeof res === 'object') {
            const reply = res as { ok: boolean; nodeId: number; epoch: number };
            this.handleBullyReply(reply);
          }
        });
      }
    }

    // Set OK timeout (1500ms)
    if (this.okTimer) clearTimeout(this.okTimer);
    this.okTimer = setTimeout(async () => {
      const evalRes = this.bullyCore.evaluateOkTimeout();
      if (evalRes.wonElection) {
        await this.onBullyWin(evalRes.electionId || init.electionId, evalRes.epoch, trigger);
      }
    }, 1500);
  }

  private handleBullyReply(reply: { ok: boolean; nodeId: number; epoch: number }): void {
    const res = this.bullyCore.handleElectionReply(reply);
    if (res.okReceived && this.okTimer) {
      clearTimeout(this.okTimer);
      this.okTimer = null;
    }
  }

  private async onBullyWin(electionId: string, epoch: number, trigger: string): Promise<void> {
    if (this.okTimer) {
      clearTimeout(this.okTimer);
      this.okTimer = null;
    }

    await this.persistState(this.selfNodeId, epoch, electionId, trigger, [this.selfNodeId], 'ELECTED');

    if (this.leaderPrep) {
      await this.leaderPrep.prepareLeader();
    }

    logger.info(`Node ${this.selfNodeId} WON Bully election! Leader declared (Epoch: ${epoch})`);

    this.eventSink?.logEvent({
      service: 'election-manager',
      eventType: 'LEADER_ELECTED',
      severity: 'INFO',
      details: { winner: this.selfNodeId, epoch, algorithm: 'bully' },
    });

    this.eventSink?.logEvent({
      service: 'election-manager',
      eventType: 'FAILOVER_COMPLETED',
      severity: 'INFO',
      details: { newLeader: this.selfNodeId, epoch },
    });

    // Broadcast CoordinatorMsg to all other nodes
    const coordPayload: CoordinatorMsgPayload = {
      electionId,
      leaderId: this.selfNodeId,
      epoch,
    };

    const peerIds = this.peerManager.getAllPeerNodeIds();
    for (const peerId of peerIds) {
      const client = this.peerManager.getPeerClient(peerId);
      if (client) {
        const metadata = new (await import('@grpc/grpc-js')).Metadata();
        metadata.set('x-lamport', this.clock.tick().toString());
        client.coordinator(coordPayload, metadata, { deadline: Date.now() + 1000 }, () => {});
      }
    }
  }

  public async handleBullyElectionMsg(msg: ElectionMsgPayload): Promise<{ ok: boolean; nodeId: number; epoch: number }> {
    const { reply, shouldStartOwnElection } = this.bullyCore.handleElectionMsg(msg);
    this.setEpoch(reply.epoch);

    if (shouldStartOwnElection) {
      setImmediate(() => {
        this.initiateElection('PEER_ELECTION_RECEIVED');
      });
    }

    return reply;
  }

  public async handleBullyCoordinatorMsg(msg: CoordinatorMsgPayload): Promise<void> {
    const res = this.bullyCore.handleCoordinatorMsg(msg);
    if (res.accepted) {
      await this.persistState(res.newLeader, res.epoch, msg.electionId, 'COORDINATOR_RECEIVED', [res.newLeader], 'ACCEPTED');
      logger.info(`Node ${this.selfNodeId} accepted Coordinator Node ${res.newLeader} (Epoch: ${res.epoch})`);
    }
  }

  // ===== RING PROTOCOL =====

  private async initiateRingElection(trigger: string): Promise<void> {
    const init = this.ringCore.startElection();
    this.setEpoch(init.token.candidates[0]?.priority || this.currentEpoch);

    logger.info(`Node ${this.selfNodeId} initiated Ring election (ID: ${init.token.electionId})`, { trigger });

    this.eventSink?.logEvent({
      service: 'election-manager',
      eventType: 'ELECTION_STARTED',
      severity: 'INFO',
      details: { algorithm: 'ring', trigger, epoch: this.currentEpoch, electionId: init.token.electionId },
    });

    if (init.nextSuccessor) {
      await this.sendRingToken(init.token, init.nextSuccessor.nodeId);
    }
  }

  public async handleRingTokenMsg(token: RingTokenPayload): Promise<void> {
    const res = this.ringCore.handleToken(token);

    if (res.complete && res.coordinatorMsg) {
      // Ring traversal complete!
      await this.onRingWin(res.coordinatorMsg);
    } else if (res.updatedToken && res.nextSuccessor) {
      // Forward token asynchronously (non-blocking)
      setImmediate(() => {
        this.sendRingToken(res.updatedToken!, res.nextSuccessor!.nodeId);
      });
    }
  }

  private async sendRingToken(token: RingTokenPayload, targetNodeId: number): Promise<void> {
    const client = this.peerManager.getPeerClient(targetNodeId);
    if (!client) {
      // Successor unavailable, handle hop timeout immediately
      const hopRes = this.ringCore.handleHopTimeout(token, targetNodeId);
      if (hopRes.nextSuccessor) {
        await this.sendRingToken(hopRes.updatedToken, hopRes.nextSuccessor.nodeId);
      }
      return;
    }

    const metadata = new (await import('@grpc/grpc-js')).Metadata();
    metadata.set('x-lamport', this.clock.tick().toString());

    client.ringElection(token, metadata, { deadline: Date.now() + 800 }, (err) => {
      if (err) {
        // Target node timed out or failed to respond
        const hopRes = this.ringCore.handleHopTimeout(token, targetNodeId);
        if (hopRes.nextSuccessor) {
          this.sendRingToken(hopRes.updatedToken, hopRes.nextSuccessor.nodeId);
        }
      }
    });
  }

  private async onRingWin(msg: RingCoordinatorPayload): Promise<void> {
    await this.persistState(msg.winner, msg.epoch, msg.electionId, 'RING_COMPLETE', msg.participants, 'ELECTED');

    if (msg.winner === this.selfNodeId && this.leaderPrep) {
      await this.leaderPrep.prepareLeader();
    }

    logger.info(`Node ${this.selfNodeId} completed Ring election! Winner: Node ${msg.winner}`);

    this.eventSink?.logEvent({
      service: 'election-manager',
      eventType: 'LEADER_ELECTED',
      severity: 'INFO',
      details: { winner: msg.winner, epoch: msg.epoch, algorithm: 'ring' },
    });

    // Forward RingCoordinatorMsg around the ring
    const peerIds = this.peerManager.getAllPeerNodeIds();
    for (const peerId of peerIds) {
      const client = this.peerManager.getPeerClient(peerId);
      if (client) {
        const metadata = new (await import('@grpc/grpc-js')).Metadata();
        metadata.set('x-lamport', this.clock.tick().toString());
        client.ringCoordinator(msg, metadata, { deadline: Date.now() + 800 }, () => {});
      }
    }
  }

  public async handleRingCoordinatorMsg(msg: RingCoordinatorPayload): Promise<void> {
    const res = this.ringCore.handleCoordinatorMsg(msg);
    if (res.accepted) {
      await this.persistState(res.winner, msg.epoch, msg.electionId, 'RING_COORDINATOR_RECEIVED', msg.participants, 'ACCEPTED');
    }
  }
}
