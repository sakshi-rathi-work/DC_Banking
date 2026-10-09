import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { AppError } from '@bank/shared';
import { LeaderPrep } from '../../services/bank-node/src/election/leader-prep.js';
import { FailureDetector } from '../../services/bank-node/src/cluster/failure-detector.js';
import { FaultManager } from '../../services/bank-node/src/cluster/fault-manager.js';
import { DbHealthMonitor } from '../../services/bank-node/src/cluster/db-health.js';
import { executeWithRetry } from '../../services/gateway/src/loadbalancer/retry.js';

const DB_URL = process.env.DATABASE_URL || 'postgres://bank:bank_pw_dev@localhost:5441/bank';

describe('Phase 7: Failover & Recovery Unit/Integration Tests', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('U-FOV-1: FaultManager correctly tracks NONE, CRASH, and PARTITION modes', () => {
    const fm = new FaultManager();
    expect(fm.getMode()).toBe('NONE');
    expect(fm.isCrashed()).toBe(false);
    expect(fm.isPartitioned()).toBe(false);

    fm.setMode('PARTITION');
    expect(fm.getMode()).toBe('PARTITION');
    expect(fm.isPartitioned()).toBe(true);
    expect(fm.isCrashed()).toBe(false);

    fm.setMode('CRASH');
    expect(fm.getMode()).toBe('CRASH');
    expect(fm.isCrashed()).toBe(true);
    expect(fm.isPartitioned()).toBe(true);
  });

  it('U-FOV-2: LeaderPrep requires majority quorum to prepare leader', async () => {
    const fd = new FailureDetector(1, 3000); // 0 active peers recorded
    const leaderPrep = new LeaderPrep(1, fd);

    // Active count = 1 (self). Total cluster size = 3 -> majority = 2 -> quorum false
    const ok = await leaderPrep.prepareLeader(3);
    expect(ok).toBe(false);
    expect(leaderPrep.isLeaderReady()).toBe(false);

    // Record heartbeat for peer 2 -> active count = 2 -> quorum true
    await fd.recordHeartbeat({ nodeId: 2, status: 'HEALTHY', role: 'FOLLOWER', epoch: 1, leaderId: 1, lastSeq: 0, lamport: 1 });
    const ok2 = await leaderPrep.prepareLeader(3);
    expect(ok2).toBe(true);
    expect(leaderPrep.isLeaderReady()).toBe(true);
  });

  it('U-FOV-3: executeWithRetry retries retryable errors up to maxAttempts', async () => {
    let attemptsCount = 0;
    try {
      await executeWithRetry(
        async (attempt) => {
          attemptsCount = attempt;
          throw new AppError('NODE_UNAVAILABLE', 'Node down');
        },
        { maxAttempts: 3, initialDelayMs: 10, isIdempotent: true },
      );
      expect.fail('Should have thrown error after retries');
    } catch (_err: unknown) {
      expect(attemptsCount).toBe(3);
    }
  });

  it('U-FOV-4: DbHealthMonitor detects healthy database connection', async () => {
    let statusChanged = false;
    const monitor = new DbHealthMonitor(pool, 100, (isDown) => {
      statusChanged = isDown;
    });

    monitor.start();
    await new Promise((resolve) => setTimeout(resolve, 300));
    monitor.stop();

    expect(monitor.isDown()).toBe(false);
    expect(statusChanged).toBe(false);
  });
});
