import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { LamportClock } from '@bank/shared';
import { LogApplier } from './applier.js';

const DB_URL = process.env.DATABASE_URL || 'postgres://bank:bank_pw_dev@localhost:5441/bank';

describe('LogApplier Logic (U-REP-1)', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('should reject AppendEntries with STALE_EPOCH if request epoch is lower than local epoch', async () => {
    const clock = new LamportClock();
    const applier = new LogApplier(pool, 2, clock);

    const res = await applier.applyEntries(
      {
        epoch: 1,
        leaderId: 1,
        prevSeq: 0,
        prevEpoch: 0,
        entries: [],
        leaderLastSeq: 0,
      },
      5, // current local epoch is 5
    );

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('STALE_EPOCH');
    expect(res.epoch).toBe(5);
  });

  it('should detect GAP if prevSeq is higher than localLastSeq', async () => {
    const clock = new LamportClock();
    const applier = new LogApplier(pool, 2, clock);

    const res = await applier.applyEntries(
      {
        epoch: 1,
        leaderId: 1,
        prevSeq: 99999, // far ahead of local seq
        prevEpoch: 1,
        entries: [],
        leaderLastSeq: 99999,
      },
      1,
    );

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('GAP');
  });
});
