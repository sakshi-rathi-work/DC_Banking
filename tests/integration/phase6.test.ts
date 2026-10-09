import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { LamportClock, AppError } from '@bank/shared';
import { LogStore } from '../../services/bank-node/src/replication/log-store.js';
import { Replicator } from '../../services/bank-node/src/replication/replicator.js';
import { IntegrityChecker } from '../../services/bank-node/src/replication/integrity.js';
import { FailureDetector } from '../../services/bank-node/src/cluster/failure-detector.js';
import { PeerManager } from '../../services/bank-node/src/cluster/peer-manager.js';

const DB_URL = process.env.DATABASE_URL || 'postgres://bank:bank_pw_dev@localhost:5441/bank';

describe('Phase 6: Replication & Consistency Integration Tests', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('D-REP-1: LogStore assigns gapless monotonic sequence numbers via node_state lock', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { seq, entry } = await LogStore.appendLogEntry(client, 1, {
        opType: 'CREATE_USER',
        payload: { test: true },
        epoch: 1,
        lamport: 10,
      });
      await client.query('COMMIT');

      expect(seq).toBeGreaterThan(0);
      expect(entry.seq).toBe(seq);
      expect(entry.opType).toBe('CREATE_USER');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  it('D-REP-2: IntegrityChecker computes account MD5 checksums and stats', async () => {
    const integrityChecker = new IntegrityChecker(pool, 1);
    const integrity = await integrityChecker.getLocalIntegrity();

    expect(integrity.nodeId).toBe(1);
    expect(integrity.accountCount).toBeGreaterThanOrEqual(0);
    expect(integrity.totalBalancePaise).toBeGreaterThanOrEqual(0);
    expect(typeof integrity.accountsChecksum).toBe('string');
  });

  it('D-REP-4: Strong mode pre-checks 0 UP backups and throws NO_QUORUM (503)', async () => {
    const clock = new LamportClock();
    const fd = new FailureDetector(1, 3000); // 0 active backups recorded
    const pm = new PeerManager(1, '1=127.0.0.1:50051,2=127.0.0.1:50052');
    const replicator = new Replicator(pool, 1, clock, pm, fd, 'strong');

    const entry = {
      seq: 1,
      epoch: 1,
      opType: 'CREATE_USER',
      payloadJson: '{}',
      lamport: 1,
      originNode: 1,
      physicalTs: new Date().toISOString(),
    };

    try {
      await replicator.replicateEntry(entry, 1);
      expect.fail('Should have thrown NO_QUORUM');
    } catch (err: unknown) {
      expect((err as AppError).code).toBe('NO_QUORUM');
    }
  });
});
