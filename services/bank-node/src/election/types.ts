export type AlgorithmType = 'bully' | 'ring';

export interface NodePriorityInfo {
  nodeId: number;
  priority: number;
  address?: string;
}

export interface ElectionMsgPayload {
  electionId: string;
  fromNode: number;
  fromPriority: number;
  epoch: number;
}

export interface ElectionReplyPayload {
  ok: boolean;
  nodeId: number;
  epoch: number;
}

export interface CoordinatorMsgPayload {
  electionId: string;
  leaderId: number;
  epoch: number;
}

export interface RingCandidatePayload {
  id: number;
  priority: number;
}

export interface RingTokenPayload {
  electionId: string;
  initiator: number;
  candidates: RingCandidatePayload[];
  skipped: number[];
}

export interface RingCoordinatorPayload {
  electionId: string;
  initiator: number;
  winner: number;
  epoch: number;
  participants: number[];
}
