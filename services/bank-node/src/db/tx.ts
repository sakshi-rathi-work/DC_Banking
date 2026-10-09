/**
 * Transaction runner enforcing lock_timeout and READ COMMITTED isolation.
 * All banking writes must go through `withTx` to ensure consistent
 * row-lock acquisition with 3-second timeout and proper rollback.
 */
import type pg from 'pg';
import { createLogger, AppError } from '@bank/shared';

const logger = createLogger({ service: 'db-tx' });

const LOCK_TIMEOUT_MS = 3000;

/**
 * Execute `fn` within a database transaction.
 * - Sets `lock_timeout = '3s'` to prevent indefinite row-lock waits.
 * - Uses `READ COMMITTED` isolation (Postgres default).
 * - Catches lock timeout errors and maps them to `CONFLICT_LOCK_TIMEOUT`.
 * - Rolls back on any error; commits on success.
 */
export async function withTx<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);

    const result = await fn(client);

    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch((rollbackErr) => {
      logger.error('Rollback failed', rollbackErr);
    });

    // Map lock timeout errors to AppError
    if (isLockTimeoutError(err)) {
      throw new AppError(
        'CONFLICT_LOCK_TIMEOUT',
        'Database lock acquisition timed out. Please retry.',
        { cause: err },
      );
    }

    throw err;
  } finally {
    client.release();
  }
}

function isLockTimeoutError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    // Postgres error code 55P03 = lock_not_available
    const pgErr = err as { code?: string };
    return pgErr.code === '55P03';
  }
  return false;
}
