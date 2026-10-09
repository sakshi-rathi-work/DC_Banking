/**
 * Berkeley Clock Synchronization Algorithm.
 * Matches docs/architecture.md §6.2.
 *
 * The leader (time daemon) periodically:
 * 1. Reads its own simulated hardware clock
 * 2. Requests GetTime from every peer
 * 3. Computes RTT-adjusted offsets
 * 4. Computes the average time (Bavg) — excluding outliers
 * 5. Sends AdjustClock(delta) to each peer
 */
import { randomUUID } from 'node:crypto';
import { createLogger } from '@bank/shared';
import type { SimulatedHwClock } from './simulated-hw-clock.js';
import type { PeerManager } from '../cluster/peer-manager.js';

const logger = createLogger({ service: 'berkeley-sync' });

export interface ClockSyncNodeResult {
  nodeId: number;
  rttMs: number;
  offsetBeforeMs: number;
  included: boolean;
  adjustMs: number;
  residualAfterMs: number;
}

export interface ClockSyncRoundResult {
  roundId: string;
  master: number;
  averageMs: number;
  nodes: ClockSyncNodeResult[];
  startedAt?: string;
}

export interface BerkeleyClockSyncOptions {
  nodeId: number;
  hwClock: SimulatedHwClock;
  peerManager: PeerManager;
  outlierThresholdMs?: number;
}

export class BerkeleyClockSync {
  private nodeId: number;
  private hwClock: SimulatedHwClock;
  private peerManager: PeerManager;
  private outlierThresholdMs: number;

  private adjustmentMs = 0;
  private lastSyncAt: string | null = null;
  private history: ClockSyncRoundResult[] = [];
  private maxHistory = 50;
  private syncInterval: ReturnType<typeof setInterval> | null = null;

  constructor(opts: BerkeleyClockSyncOptions) {
    this.nodeId = opts.nodeId;
    this.hwClock = opts.hwClock;
    this.peerManager = opts.peerManager;
    this.outlierThresholdMs = opts.outlierThresholdMs ?? 500;
  }

  /**
   * Returns the synchronized time = hwClock + adjustment
   */
  public getSyncedTimeMs(): number {
    return this.hwClock.nowMs() + this.adjustmentMs;
  }

  public getSyncedTimeUs(): bigint {
    return BigInt(Math.round(this.getSyncedTimeMs() * 1000));
  }

  public getHardwareTimeUs(): bigint {
    return this.hwClock.nowUs();
  }

  public getAdjustmentMs(): number {
    return this.adjustmentMs;
  }

  public setAdjustmentMs(delta: number): { before: number; after: number } {
    const before = this.adjustmentMs;
    this.adjustmentMs += delta;
    return { before, after: this.adjustmentMs };
  }

  public getOffsetFromMasterMs(): number {
    return this.adjustmentMs;
  }

  public getGroundTruthErrorMs(): number {
    // Difference between synced time and real wall clock
    const syncedMs = this.getSyncedTimeMs();
    const realMs = Date.now();
    return syncedMs - realMs;
  }

  public getLastSyncAt(): string | null {
    return this.lastSyncAt;
  }

  public getHistory(): ClockSyncRoundResult[] {
    return this.history;
  }

  /**
   * Start periodic synchronization (only the leader should call this).
   */
  public startPeriodicSync(intervalMs = 10000): void {
    this.stopPeriodicSync();
    this.syncInterval = setInterval(() => {
      this.runSyncRound().catch((err) => {
        logger.warn('Berkeley sync round failed', { error: String(err) });
      });
    }, intervalMs);
    logger.info(`Berkeley periodic sync started (every ${intervalMs}ms)`);
  }

  public stopPeriodicSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  /**
   * Execute one full Berkeley sync round as the master/leader.
   */
  public async runSyncRound(): Promise<ClockSyncRoundResult> {
    const roundId = randomUUID().slice(0, 8);
    const masterTimeMs = this.hwClock.nowMs();

    logger.info(`Berkeley sync round ${roundId} starting, master time: ${masterTimeMs.toFixed(0)}`);

    // Collect times from all peers
    const nodeResults: ClockSyncNodeResult[] = [];

    // Master's own entry
    nodeResults.push({
      nodeId: this.nodeId,
      rttMs: 0,
      offsetBeforeMs: 0,
      included: true,
      adjustMs: 0,
      residualAfterMs: 0,
    });

    // Query each peer
    const peerIds = this.peerManager.getAllPeerNodeIds();
    for (const peerId of peerIds) {
      try {
        const t0 = performance.now();
        const peerTimeMs = await this.requestPeerTime(peerId, roundId);
        const rttMs = performance.now() - t0;

        // Adjust for RTT: estimated peer time at midpoint
        const adjustedPeerTime = peerTimeMs + rttMs / 2;
        const offsetMs = adjustedPeerTime - masterTimeMs;

        nodeResults.push({
          nodeId: peerId,
          rttMs: Number(rttMs.toFixed(2)),
          offsetBeforeMs: Number(offsetMs.toFixed(2)),
          included: true,
          adjustMs: 0,
          residualAfterMs: 0,
        });
      } catch (err) {
        logger.warn(`Failed to get time from node ${peerId}`, { error: String(err) });
        nodeResults.push({
          nodeId: peerId,
          rttMs: 0,
          offsetBeforeMs: 0,
          included: false,
          adjustMs: 0,
          residualAfterMs: 0,
        });
      }
    }

    // Filter outliers
    const includedNodes = nodeResults.filter((n) => n.included);
    if (includedNodes.length > 2) {
      const offsets = includedNodes.map((n) => n.offsetBeforeMs);
      const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;

      for (const node of includedNodes) {
        if (Math.abs(node.offsetBeforeMs - mean) > this.outlierThresholdMs) {
          node.included = false;
        }
      }
    }

    // Compute average time among included nodes
    const finalIncluded = nodeResults.filter((n) => n.included);
    const avgOffset = finalIncluded.length > 0
      ? finalIncluded.reduce((sum, n) => sum + n.offsetBeforeMs, 0) / finalIncluded.length
      : 0;

    const averageTimeMs = masterTimeMs + avgOffset;

    // Compute adjustments for each node
    for (const node of nodeResults) {
      if (!node.included) continue;
      // Each node needs to adjust by: avgOffset - nodeOffset
      node.adjustMs = Number((avgOffset - node.offsetBeforeMs).toFixed(2));
    }

    // Apply master's own adjustment
    const masterResult = nodeResults.find((n) => n.nodeId === this.nodeId);
    if (masterResult) {
      this.setAdjustmentMs(masterResult.adjustMs);
      masterResult.residualAfterMs = 0;
    }

    // Send adjustments to peers
    for (const node of nodeResults) {
      if (node.nodeId === this.nodeId || !node.included) continue;
      try {
        await this.sendAdjustment(node.nodeId, roundId, node.adjustMs);
        node.residualAfterMs = 0; // ideally zero after adjustment
      } catch (err) {
        logger.warn(`Failed to send adjustment to node ${node.nodeId}`, { error: String(err) });
      }
    }

    this.lastSyncAt = new Date().toISOString();

    const result: ClockSyncRoundResult = {
      roundId,
      master: this.nodeId,
      averageMs: Number(averageTimeMs.toFixed(2)),
      nodes: nodeResults,
      startedAt: this.lastSyncAt,
    };

    this.history.push(result);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    logger.info(`Berkeley sync round ${roundId} complete, avgOffset=${avgOffset.toFixed(2)}ms`);
    return result;
  }

  /**
   * Request time from a peer node via gRPC GetTime.
   */
  private async requestPeerTime(peerId: number, roundId: string): Promise<number> {
    const client = this.peerManager.getPeerClient(peerId);
    if (!client) throw new Error(`No client for peer ${peerId}`);

    return new Promise<number>((resolve, reject) => {
      (client as unknown as {
        getTime: (req: { roundId: string }, cb: (err: Error | null, res: { syncedTimeUs?: number }) => void) => void;
      }).getTime({ roundId }, (err, res) => {
        if (err) return reject(err);
        // Convert microseconds back to milliseconds
        const timeMs = (res.syncedTimeUs ?? 0) / 1000;
        resolve(timeMs);
      });
    });
  }

  /**
   * Send clock adjustment to a peer node via gRPC AdjustClock.
   */
  private async sendAdjustment(peerId: number, roundId: string, adjustMs: number): Promise<void> {
    const client = this.peerManager.getPeerClient(peerId);
    if (!client) throw new Error(`No client for peer ${peerId}`);

    return new Promise<void>((resolve, reject) => {
      (client as unknown as {
        adjustClock: (req: { roundId: string; adjustMs: number }, cb: (err: Error | null, res: unknown) => void) => void;
      }).adjustClock({ roundId, adjustMs }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
}
