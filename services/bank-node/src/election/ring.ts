import { randomUUID } from 'node:crypto';
import type {
  NodePriorityInfo,
  RingTokenPayload,
  RingCoordinatorPayload,
  RingCandidatePayload,
} from './types.js';

export interface RingOptions {
  selfNodeId: number;
  selfPriority: number;
  clusterNodes: NodePriorityInfo[];
}

export class RingElectionCore {
  private selfNodeId: number;
  private selfPriority: number;
  private clusterNodes: NodePriorityInfo[];
  private currentEpoch: number = 0;
  private currentLeaderId: number | null = null;
  private isElecting: boolean = false;

  constructor(opts: RingOptions) {
    this.selfNodeId = opts.selfNodeId;
    this.selfPriority = opts.selfPriority;
    // Sorted by nodeId ascending to establish physical ring order
    this.clusterNodes = [...opts.clusterNodes].sort((a, b) => a.nodeId - b.nodeId);
  }

  public setClusterNodes(nodes: NodePriorityInfo[]): void {
    this.clusterNodes = [...nodes].sort((a, b) => a.nodeId - b.nodeId);
  }

  public getEpoch(): number {
    return this.currentEpoch;
  }

  public setEpoch(epoch: number): void {
    this.currentEpoch = Math.max(this.currentEpoch, epoch);
  }

  public getLeaderId(): number | null {
    return this.currentLeaderId;
  }

  public isLeader(): boolean {
    return this.currentLeaderId === this.selfNodeId;
  }

  /**
   * Find next successor in ring after startingFromNodeId, excluding skipped nodes.
   */
  public getNextSuccessor(startingFromNodeId: number, skippedNodes: number[] = []): NodePriorityInfo | null {
    if (this.clusterNodes.length <= 1) return null;

    const total = this.clusterNodes.length;
    const startIndex = this.clusterNodes.findIndex((n) => n.nodeId === startingFromNodeId);
    if (startIndex === -1) return null;

    for (let offset = 1; offset < total; offset++) {
      const idx = (startIndex + offset) % total;
      const candidate = this.clusterNodes[idx]!;
      if (candidate.nodeId !== this.selfNodeId && !skippedNodes.includes(candidate.nodeId)) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Initiate Ring Election.
   */
  public startElection(triggerEpoch?: number): {
    token: RingTokenPayload;
    nextSuccessor: NodePriorityInfo | null;
  } {
    this.isElecting = true;
    if (triggerEpoch !== undefined && triggerEpoch > this.currentEpoch) {
      this.currentEpoch = triggerEpoch;
    } else {
      this.currentEpoch += 1;
    }

    const token: RingTokenPayload = {
      electionId: randomUUID(),
      initiator: this.selfNodeId,
      candidates: [{ id: this.selfNodeId, priority: this.selfPriority }],
      skipped: [],
    };

    const nextSuccessor = this.getNextSuccessor(this.selfNodeId, []);
    return { token, nextSuccessor };
  }

  /**
   * Process incoming RingToken.
   */
  public handleToken(token: RingTokenPayload): {
    complete: boolean;
    winner?: number;
    participants?: number[];
    coordinatorMsg?: RingCoordinatorPayload;
    updatedToken?: RingTokenPayload;
    nextSuccessor?: NodePriorityInfo | null;
  } {
    // 1. Check if token has completed full ring cycle back to initiator
    if (token.initiator === this.selfNodeId && token.candidates.length > 1) {
      // Find winner: candidate with highest priority (break ties by highest ID)
      const winner = selectRingWinner(token.candidates);
      this.isElecting = false;
      this.currentLeaderId = winner.id;

      const coordinatorMsg: RingCoordinatorPayload = {
        electionId: token.electionId,
        initiator: this.selfNodeId,
        winner: winner.id,
        epoch: this.currentEpoch,
        participants: token.candidates.map((c) => c.id),
      };

      return {
        complete: true,
        winner: winner.id,
        participants: token.candidates.map((c) => c.id),
        coordinatorMsg,
      };
    }

    // 2. Add self to candidates if not present
    this.isElecting = true;
    const candidates = [...token.candidates];
    if (!candidates.some((c) => c.id === this.selfNodeId)) {
      candidates.push({ id: this.selfNodeId, priority: this.selfPriority });
    }

    const updatedToken: RingTokenPayload = {
      ...token,
      candidates,
    };

    const nextSuccessor = this.getNextSuccessor(this.selfNodeId, updatedToken.skipped);

    return {
      complete: false,
      updatedToken,
      nextSuccessor,
    };
  }

  /**
   * Handle hop failure timeout (target node unreachable).
   * Adds unreachable node to skipped list and finds next successor.
   */
  public handleHopTimeout(token: RingTokenPayload, failedNodeId: number): {
    updatedToken: RingTokenPayload;
    nextSuccessor: NodePriorityInfo | null;
  } {
    const skipped = Array.from(new Set([...token.skipped, failedNodeId]));
    const updatedToken: RingTokenPayload = {
      ...token,
      skipped,
    };

    const nextSuccessor = this.getNextSuccessor(this.selfNodeId, skipped);
    return { updatedToken, nextSuccessor };
  }

  /**
   * Handle RingCoordinatorMsg.
   */
  public handleCoordinatorMsg(msg: RingCoordinatorPayload): {
    accepted: boolean;
    winner: number;
    wasLeaderPreempted: boolean;
    nextSuccessor: NodePriorityInfo | null;
  } {
    const wasLeaderPreempted = this.isLeader() && msg.winner !== this.selfNodeId;

    this.setEpoch(msg.epoch);
    this.currentLeaderId = msg.winner;
    this.isElecting = false;

    // Forward coordinator message to next node in ring unless message originated from self or completed
    const shouldForward = msg.initiator !== this.selfNodeId;
    const nextSuccessor = shouldForward ? this.getNextSuccessor(this.selfNodeId, []) : null;

    return {
      accepted: true,
      winner: msg.winner,
      wasLeaderPreempted,
      nextSuccessor,
    };
  }
}

export function selectRingWinner(candidates: RingCandidatePayload[]): RingCandidatePayload {
  if (candidates.length === 0) {
    throw new Error('Ring candidates list is empty');
  }

  return candidates.reduce((prev, curr) => {
    if (curr.priority > prev.priority) return curr;
    if (curr.priority === prev.priority && curr.id > prev.id) return curr;
    return prev;
  });
}
