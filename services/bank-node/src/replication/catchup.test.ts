import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { SnapshotService } from './snapshot.js';

const DB_URL = process.env.DATABASE_URL || 'postgres://bank:bank_pw_dev@localhost:5441/bank';

describe('Divergence & Snapshot Resync (U-REP-2)', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('should create snapshot chunks with tables and last flag set', async () => {
    const snapshotService = new SnapshotService(pool);
    const chunks = await snapshotService.createSnapshotChunks();

    expect(chunks.length).toBe(4);
    expect(chunks[0]?.table).toBe('users');
    expect(chunks[3]?.table).toBe('replication_log');
    expect(chunks[3]?.last).toBe(true);
  });
});
