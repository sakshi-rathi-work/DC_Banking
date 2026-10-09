import type pg from 'pg';
import { AppError, type LamportClock, prepareClientMetadata } from '@bank/shared';
import type { LogEntryPayload, ReplicationNodeInfo } from './types.js';
import type { PeerManager } from '../cluster/peer-manager.js';
import type { FailureDetector } from '../cluster/failure-detector.js';

export class Replicator {
  private pool: pg.Pool;
  private selfNodeId: number;
  private clock: LamportClock;
  private peerManager: PeerManager;
  private failureDetector: FailureDetector;
  private consistencyMode: 'strong' | 'eventual' = 'strong';
  private replicationDelayMs: number = 0;

  private backupStates = new Map<number, ReplicationNodeInfo>();

  constructor(
    pool: pg.Pool,
    selfNodeId: number,
    clock: LamportClock,
    peerManager: PeerManager,
    failureDetector: FailureDetector,
    consistencyMode: 'strong' | 'eventual' = 'strong',
  ) {
    this.pool = pool;
    this.selfNodeId = selfNodeId;
    this.clock = clock;
    this.peerManager = peerManager;
    this.failureDetector = failureDetector;
    this.consistencyMode = consistencyMode;
  }

  public getConsistencyMode(): 'strong' | 'eventual' {
    return this.consistencyMode;
  }

  public setConsistencyMode(mode: 'strong' | 'eventual'): void {
    this.consistencyMode = mode;
  }

  public setReplicationDelayMs(delayMs: number): void {
    this.replicationDelayMs = Math.max(0, delayMs);
  }

  public getBackupStates(): ReplicationNodeInfo[] {
    return Array.from(this.backupStates.values());
  }

  /**
   * Called on Leader after writing a log entry.
   * Handles Strong vs Eventual replication rules.
   */
  public async replicateEntry(
    entry: LogEntryPayload,
    currentEpoch: number,
    timeoutMs = 2000,
  ): Promise<{ pendingReplication: boolean }> {
    const healthyPeers = this.failureDetector.getHealthyPeerNodeIds();

    if (this.consistencyMode === 'strong') {
      // 1. Pre-check: if 0 backups are UP, reject immediately with NO_QUORUM
      if (healthyPeers.length === 0) {
        throw new AppError(
          'NO_QUORUM',
          'Strong consistency requires majority quorum, but no backups are currently UP',
        );
      }

      // 2. Replicate to UP backups and await ACKs
      const ackCount = await this.shipToBackups(entry, currentEpoch, healthyPeers, timeoutMs);

      if (ackCount >= 1) {
        // At least 1 backup ACKed!
        return { pendingReplication: false };
      } else {
        // 0 ACKs within timeout -> return COMMITTED_PENDING_REPLICATION
        return { pendingReplication: true };
      }
    } else {
      // Eventual consistency mode: return immediately, replicate in background
      setImmediate(() => {
        this.shipToBackups(entry, currentEpoch, healthyPeers, 5000);
      });
      return { pendingReplication: false };
    }
  }

  private async shipToBackups(
    entry: LogEntryPayload,
    currentEpoch: number,
    peerIds: number[],
    timeoutMs: number,
  ): Promise<number> {
    if (this.replicationDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.replicationDelayMs));
    }

    let ackCount = 0;
    const promises = peerIds.map(async (peerId) => {
      const client = this.peerManager.getPeerClient(peerId);
      if (!client) return false;

      const state = this.backupStates.get(peerId) || {
        nodeId: peerId,
        role: 'FOLLOWER',
        lastSeq: 0,
        matchSeq: 0,
        lagEntries: 0,
        lagMs: 0,
        state: 'IN_SYNC',
        checksum: '',
      };

      const reqPayload = {
        epoch: currentEpoch,
        leaderId: this.selfNodeId,
        prevSeq: entry.seq - 1,
        prevEpoch: currentEpoch,
        entries: [entry],
        leaderLastSeq: entry.seq,
      };

      const metadata = prepareClientMetadata(this.clock, this.selfNodeId);

      return new Promise<boolean>((resolve) => {
        client.appendEntries(
          reqPayload,
          metadata,
          { deadline: Date.now() + timeoutMs },
          (err, response) => {
            if (!err && response && typeof response === 'object') {
              const res = response as { ok: boolean; lastSeq: number; reason?: string };
              if (res.ok) {
                state.matchSeq = res.lastSeq;
                state.lastSeq = res.lastSeq;
                state.state = 'IN_SYNC';
                state.lagEntries = Math.max(0, entry.seq - res.lastSeq);
                this.backupStates.set(peerId, state);
                return resolve(true);
              }
            }

            state.state = 'LAGGING';
            state.lagEntries = Math.max(0, entry.seq - state.matchSeq);
            this.backupStates.set(peerId, state);
            resolve(false);
          },
        );
      });
    });

    const results = await Promise.all(promises);
    ackCount = results.filter(Boolean).length;
    return ackCount;
  }
}
