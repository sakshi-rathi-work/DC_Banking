import { randomUUID } from 'node:crypto';
import type {
  NodePriorityInfo,
  ElectionMsgPayload,
  ElectionReplyPayload,
  CoordinatorMsgPayload,
} from './types.js';

export interface BullyOptions {
  selfNodeId: number;
  selfPriority: number;
  clusterNodes: NodePriorityInfo[]; // including self
}

export class BullyElectionCore {
  private selfNodeId: number;
  private selfPriority: number;
  private clusterNodes: NodePriorityInfo[];
  private currentEpoch: number = 0;
  private currentLeaderId: number | null = null;
  private isElecting: boolean = false;
  private currentElectionId: string | null = null;
  private okReceived: boolean = false;

  constructor(opts: BullyOptions) {
    this.selfNodeId = opts.selfNodeId;
    this.selfPriority = opts.selfPriority;
    this.clusterNodes = opts.clusterNodes;
  }

  public setClusterNodes(nodes: NodePriorityInfo[]): void {
    this.clusterNodes = nodes;
  }

  public getHigherPriorityNodes(): NodePriorityInfo[] {
    return this.clusterNodes.filter(
      (n) => n.priority > this.selfPriority || (n.priority === this.selfPriority && n.nodeId > this.selfNodeId),
    );
  }

  public getOtherNodes(): NodePriorityInfo[] {
    return this.clusterNodes.filter((n) => n.nodeId !== this.selfNodeId);
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

  public getIsElecting(): boolean {
    return this.isElecting;
  }

  /**
   * Initiate Bully Election.
   */
  public startElection(triggerEpoch?: number): {
    electionId: string;
    epoch: number;
    higherNodes: NodePriorityInfo[];
    isHighest: boolean;
  } {
    this.isElecting = true;
    this.okReceived = false;
    this.currentElectionId = randomUUID();

    if (triggerEpoch !== undefined && triggerEpoch > this.currentEpoch) {
      this.currentEpoch = triggerEpoch;
    } else {
      this.currentEpoch += 1;
    }

    const higherNodes = this.getHigherPriorityNodes();
    const isHighest = higherNodes.length === 0;

    return {
      electionId: this.currentElectionId,
      epoch: this.currentEpoch,
      higherNodes,
      isHighest,
    };
  }

  /**
   * Handle incoming ElectionMsg from peer node.
   */
  public handleElectionMsg(msg: ElectionMsgPayload): {
    shouldReplyOk: boolean;
    reply: ElectionReplyPayload;
    shouldStartOwnElection: boolean;
  } {
    this.setEpoch(msg.epoch);

    const isCallerLower =
      msg.fromPriority < this.selfPriority ||
      (msg.fromPriority === this.selfPriority && msg.fromNode < this.selfNodeId);

    const shouldReplyOk = isCallerLower;
    const reply: ElectionReplyPayload = {
      ok: shouldReplyOk,
      nodeId: this.selfNodeId,
      epoch: this.currentEpoch,
    };

    // If a lower node triggers an election, we reply OK and start our own election if not already electing
    let shouldStartOwnElection = false;
    if (isCallerLower && !this.isElecting) {
      shouldStartOwnElection = true;
    }

    return {
      shouldReplyOk,
      reply,
      shouldStartOwnElection,
    };
  }

  /**
   * Handle incoming ElectionReply from higher node.
   */
  public handleElectionReply(reply: ElectionReplyPayload): {
    wasExpecting: boolean;
    okReceived: boolean;
  } {
    this.setEpoch(reply.epoch);

    if (this.isElecting && reply.ok) {
      this.okReceived = true;
      return { wasExpecting: true, okReceived: true };
    }

    return { wasExpecting: this.isElecting, okReceived: this.okReceived };
  }

  /**
   * Called when OK timeout fires (e.g. 1500ms after starting election).
   */
  public evaluateOkTimeout(): {
    wonElection: boolean;
    winner: number;
    epoch: number;
    electionId: string | null;
    otherNodes: NodePriorityInfo[];
  } {
    if (!this.isElecting) {
      return { wonElection: false, winner: this.currentLeaderId || 0, epoch: this.currentEpoch, electionId: null, otherNodes: [] };
    }

    if (!this.okReceived) {
      // Won election! Declare self leader
      this.isElecting = false;
      this.currentLeaderId = this.selfNodeId;
      return {
        wonElection: true,
        winner: this.selfNodeId,
        epoch: this.currentEpoch,
        electionId: this.currentElectionId,
        otherNodes: this.getOtherNodes(),
      };
    } else {
      // Waiting for higher node coordinator announcement
      return {
        wonElection: false,
        winner: 0,
        epoch: this.currentEpoch,
        electionId: this.currentElectionId,
        otherNodes: [],
      };
    }
  }

  /**
   * Handle incoming CoordinatorMsg.
   */
  public handleCoordinatorMsg(msg: CoordinatorMsgPayload): {
    accepted: boolean;
    previousLeader: number | null;
    newLeader: number;
    epoch: number;
    wasLeaderPreempted: boolean;
  } {
    const wasLeaderPreempted = this.isLeader() && msg.leaderId !== this.selfNodeId;
    const previousLeader = this.currentLeaderId;

    if (msg.epoch >= this.currentEpoch) {
      this.currentEpoch = msg.epoch;
      this.currentLeaderId = msg.leaderId;
      this.isElecting = false;
      this.okReceived = false;

      return {
        accepted: true,
        previousLeader,
        newLeader: msg.leaderId,
        epoch: msg.epoch,
        wasLeaderPreempted,
      };
    }

    return {
      accepted: false,
      previousLeader,
      newLeader: previousLeader || 0,
      epoch: this.currentEpoch,
      wasLeaderPreempted: false,
    };
  }
}
