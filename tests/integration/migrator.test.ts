import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import path from 'node:path';
import { runMigrations } from '../../services/bank-node/src/db/migrator.js';

const { Pool } = pg;

describe('Migration & Database Constraints (I-DB-1)', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    const dbUrl = process.env['DATABASE_URL'] || 'postgres://bank:bank_pw_dev@localhost:5441/bank';
    pool = new Pool({
      connectionString: dbUrl,
      connectionTimeoutMillis: 5000,
    });
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it('applies migrations idempotently', async () => {
    const migrationsDir = path.resolve(process.cwd(), 'database', 'migrations');
    const results = await runMigrations(pool, migrationsDir);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.name).toBe('init');

    // Second run should report already applied
    const secondResults = await runMigrations(pool, migrationsDir);
    expect(secondResults[0]?.applied).toBe(false);
  });

  it('I-DB-1: enforces CHECK (balance_paise >= 0) constraint against negative balance', async () => {
    const client = await pool.connect();
    try {
      const userId = '00000000-0000-0000-0000-000000000001';
      const accountId = '00000000-0000-0000-0000-000000000002';

      // Insert dummy user and account
      await client.query(`
        INSERT INTO users (id, name, email, password_hash)
        VALUES ('${userId}', 'Constraint Test User', 'test-constraint@example.com', 'dummy_hash')
        ON CONFLICT (id) DO NOTHING;
      `);

      await client.query(`
        INSERT INTO accounts (id, user_id, account_number, balance_paise)
        VALUES ('${accountId}', '${userId}', '999999999999', 1000)
        ON CONFLICT (id) DO UPDATE SET balance_paise = 1000;
      `);

      // Attempt updating balance to negative
      let errorThrown = false;
      try {
        await client.query(`
          UPDATE accounts SET balance_paise = -100 WHERE id = '${accountId}';
        `);
      } catch (err: unknown) {
        errorThrown = true;
        const pgErr = err as { code?: string };
        // PostgreSQL error code 23514 is check_violation
        expect(pgErr.code).toBe('23514');
      }

      expect(errorThrown).toBe(true);
    } finally {
      client.release();
    }
  });
});
