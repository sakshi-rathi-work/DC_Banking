import * as grpc from '@grpc/grpc-js';
import type pg from 'pg';
import { createLogger } from '@bank/shared';
import type { FailureDetector } from '../cluster/failure-detector.js';
import type { PeerManager } from '../cluster/peer-manager.js';
import type { LogApplier } from '../replication/applier.js';

const logger = createLogger({ service: 'leader-prep' });

export class LeaderPrep {
  private selfNodeId: number;
  private failureDetector: FailureDetector;
  private peerManager?: PeerManager;
  private applier?: LogApplier;
  private pool?: pg.Pool;
  private isReady: boolean = false;

  constructor(
    selfNodeId: number,
    failureDetector: FailureDetector,
    peerManager?: PeerManager,
    applier?: LogApplier,
    pool?: pg.Pool,
  ) {
    this.selfNodeId = selfNodeId;
    this.failureDetector = failureDetector;
    this.peerManager = peerManager;
    this.applier = applier;
    this.pool = pool;
  }

  public isLeaderReady(): boolean {
    return this.isReady;
  }

  public setLeaderReady(ready: boolean): void {
    this.isReady = ready;
  }

  /**
   * Prepare leader node:
   * 1. Verify quorum (majority of cluster nodes active)
   * 2. Reconcile missing replication log entries from healthy survivor peers
   */
  public async prepareLeader(totalClusterSize = 3, currentEpoch = 1): Promise<boolean> {
    logger.info(`Starting leader preparation for Node ${this.selfNodeId}...`);

    const healthyPeers = this.failureDetector.getHealthyPeerNodeIds();
    const activeCount = healthyPeers.length + 1;
    const majorityThreshold = Math.floor(totalClusterSize / 2) + 1;

    if (activeCount < majorityThreshold) {
      logger.warn(`Leader preparation failed: quorum not met (${activeCount}/${totalClusterSize} active, needed ${majorityThreshold})`);
      this.isReady = false;
      return false;
    }

    // Reconcile logs from survivor peers if peerManager and applier/pool exist
    if (this.peerManager && this.applier && this.pool) {
      try {
        await this.reconcilePeerLogs(healthyPeers, currentEpoch);
      } catch (err) {
        logger.error('Log reconciliation during leader preparation failed', { err });
      }
    }

    this.isReady = true;
    logger.info(`Leader preparation successful for Node ${this.selfNodeId} (Quorum: ${activeCount}/${totalClusterSize})`);
    return true;
  }

  private async reconcilePeerLogs(healthyPeers: number[], currentEpoch: number): Promise<void> {
    if (!this.pool || !this.applier) return;

    let localLastSeq = 0;
    const res = await this.pool.query('SELECT last_seq FROM node_state WHERE node_id = $1', [this.selfNodeId]);
    if (res.rows.length > 0 && res.rows[0]?.last_seq !== undefined) {
      localLastSeq = parseInt(res.rows[0].last_seq, 10) || 0;
    }

    for (const peerId of healthyPeers) {
      const client = this.peerManager?.getPeerClient(peerId);
      if (!client || !client.getLogEntries) continue;

      try {
        await new Promise<void>((resolve) => {
          const md = new grpc.Metadata();
          client.getLogEntries!(
            { fromSeq: localLastSeq + 1, maxEntries: 100 },
            md,
            { deadline: Date.now() + 1000 },
            async (err: unknown, response: unknown) => {
              if (!err && response && typeof response === 'object') {
                const respObj = response as { entries?: Array<{ seq: number; epoch: number; opType: string; payloadJson: string; lamport: number; originNode: number; physicalTs: string }> };
                if (respObj.entries && respObj.entries.length > 0) {
                  logger.info(`Reconciling ${respObj.entries.length} missing log entries from survivor Node ${peerId}`);
                  await this.applier!.applyEntries(
                    {
                      entries: respObj.entries,
                      prevSeq: localLastSeq,
                      prevEpoch: 0,
                      epoch: currentEpoch,
                      leaderId: peerId,
                      leaderLastSeq: localLastSeq + respObj.entries.length,
                    },
                    currentEpoch,
                  );
                }
              }
              resolve();
            },
          );
        });
      } catch (err) {
        logger.warn(`Failed to pull missing log entries from survivor Node ${peerId}`, { err });
      }
    }
  }
}
