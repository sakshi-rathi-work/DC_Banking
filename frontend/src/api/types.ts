export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T;
  meta?: {
    requestId?: string;
    servedBy?: number;
    processedBy?: number;
    lamport?: number;
    epoch?: number;
  };
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface Account {
  id: string;
  userId: string;
  accountNumber: string;
  nickname?: string;
  balancePaise: number;
  currency: string;
  status: 'ACTIVE' | 'FROZEN' | 'CLOSED';
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  reference: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER';
  sourceAccountId?: string;
  destinationAccountId?: string;
  amountPaise: number;
  status: 'COMMITTED' | 'REJECTED';
  rejectReason?: string;
  note?: string;
  sourceBalanceAfter?: number;
  destinationBalanceAfter?: number;
  entryNode: number;
  processedByNode: number;
  epoch: number;
  logSeq: number;
  lamport: number;
  physicalTs: string;
  createdAt: string;
}

export interface NodeStatus {
  nodeId: number;
  priority: number;
  status: string;
  role: 'LEADER' | 'FOLLOWER' | 'CANDIDATE' | 'UNKNOWN';
  leaderReady: boolean;
  epoch: number;
  leaderId: number;
  lastSeq: number;
  lamport: number;
  activeRequests: number;
  eventLoopLagMs: number;
  lastHeartbeatAgeMs: number;
  reachable: boolean;
  faultMode?: 'NONE' | 'CRASH' | 'PARTITION';
}

export interface ClusterOverview {
  clusterSize: number;
  nodes: NodeStatus[];
  leader: { nodeId: number; epoch: number } | null;
  load: LoadMetrics;
  replication: unknown;
}

export interface LoadMetrics {
  activeRequestsTotal: number;
  nodes: Array<{
    nodeId: number;
    address: string;
    activeRequests: number;
    totalServed: number;
    sharePercent: number;
    ewmaLatencyMs: number;
    consecutiveFailures: number;
    healthy: boolean;
  }>;
}

export interface ClockState {
  nodeId?: number;
  syncedTimeUs: number;
  hardwareTimeUs: number;
  adjustmentMs: number;
  offsetFromMasterMs: number;
  groundTruthErrorMs: number;
  lamport: number;
  lastSyncAt: string;
}

export interface ClockHistoryRound {
  roundId: string;
  masterNodeId: number;
  averageOffsetMs: number;
  startedAt: string;
  finishedAt: string;
  nodes: Array<{
    nodeId: number;
    offsetBeforeMs: number;
    adjustmentMs: number;
    residualAfterMs: number;
    skipped: boolean;
  }>;
}

export interface ElectionRecord {
  electionId: string;
  algorithm: string;
  trigger: string;
  initiator: number;
  winner: number;
  epoch: number;
  participants: number[];
  messagesJson: string;
  outcome: string;
  startedAt: string;
  finishedAt: string;
}

export interface SystemEvent {
  lamport: number;
  nodeId: number;
  physicalTs: string;
  service: string;
  eventType: string;
  severity: string;
  requestId?: string;
  transactionId?: string;
  peerNodeId?: number;
  detailsJson?: string;
}
