export interface LogEntryPayload {
  seq: number;
  epoch: number;
  opType: string;
  payloadJson: string;
  lamport: number;
  originNode: number;
  physicalTs: string;
}

export interface AppendEntriesReq {
  epoch: number;
  leaderId: number;
  prevSeq: number;
  prevEpoch: number;
  entries: LogEntryPayload[];
  leaderLastSeq: number;
}

export interface AppendEntriesRes {
  ok: boolean;
  lastSeq: number;
  epoch: number;
  reason?: 'STALE_EPOCH' | 'GAP' | 'CONFLICT' | 'OK';
}

export interface ReplicationNodeInfo {
  nodeId: number;
  role: string;
  lastSeq: number;
  matchSeq: number;
  lagEntries: number;
  lagMs: number;
  state: 'IN_SYNC' | 'LAGGING' | 'RECOVERING';
  checksum: string;
}
