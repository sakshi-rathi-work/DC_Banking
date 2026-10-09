/**
 * Idempotency module — ensures exactly-once processing for mutating operations.
 *
 * Scoping rules (from api-reference.md §1 and CLAUDE.md):
 * - Gateway errors (400, 401, 429) do NOT consume or persist the key.
 * - Pre-transaction checks (SAME_ACCOUNT, validation errors) do NOT persist.
 * - NOT_FOUND, FORBIDDEN inside the tx rollback without persisting the key.
 * - Business failures (INSUFFICIENT_FUNDS, ACCOUNT_NOT_ACTIVE) record a REJECTED
 *   transaction and store the 422 response against the key.
 * - Infrastructure errors (503 lock timeout, DB down) rollback without storing.
 * - Successful operations (201) store the key and response.
 * - Same key + same body → replay original response.
 * - Same key + different body → IDEMPOTENCY_KEY_REUSED (422).
 */
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { AppError, createLogger } from '@bank/shared';

const logger = createLogger({ service: 'idempotency' });

export interface IdempotencyRecord {
  userId: string;
  key: string;
  requestHash: string;
  response: unknown;
  httpStatus: number;
}

/**
 * Compute a stable hash of the request body for idempotency comparison.
 * Uses SHA-256 of the deterministically sorted JSON.
 */
export function computeRequestHash(body: unknown): string {
  const json = JSON.stringify(body, Object.keys(body as object).sort());
  return createHash('sha256').update(json).digest('hex');
}

/**
 * Pre-check (BEFORE transaction BEGIN): Look for an existing idempotency key.
 *
 * Returns:
 * - null: key not found, proceed with normal processing.
 * - IdempotencyRecord: key found, caller should replay or reject.
 *
 * This read is outside the transaction for performance — we only lock inside tx.
 */
export async function preCheck(
  pool: pg.Pool,
  userId: string,
  key: string,
  requestHash: string,
): Promise<{ replay: true; record: IdempotencyRecord } | { replay: false } | null> {
  const result = await pool.query<{
    user_id: string;
    key: string;
    request_hash: string;
    response: unknown;
    http_status: number;
  }>(
    `SELECT user_id, key, request_hash, response, http_status
     FROM idempotency_keys
     WHERE user_id = $1 AND key = $2`,
    [userId, key],
  );

  const row = result.rows[0];
  if (!row) {
    return null; // Key not found, proceed
  }

  // Key found — check if same request or different
  if (row.request_hash !== requestHash) {
    throw new AppError(
      'IDEMPOTENCY_KEY_REUSED',
      'Idempotency key reused with a different request payload.',
    );
  }

  // Same key + same body → replay
  return {
    replay: true,
    record: {
      userId: row.user_id,
      key: row.key,
      requestHash: row.request_hash,
      response: row.response,
      httpStatus: row.http_status,
    },
  };
}

/**
 * Lock the idempotency key row inside a transaction (SELECT FOR UPDATE or INSERT).
 * This prevents concurrent requests with the same key from both succeeding.
 *
 * Returns:
 * - null: no existing record, safe to proceed.
 * - IdempotencyRecord: record exists, replay or reject.
 */
export async function lockInsideTx(
  client: pg.PoolClient,
  userId: string,
  key: string,
  requestHash: string,
): Promise<IdempotencyRecord | null> {
  // Try to lock existing row
  const result = await client.query<{
    user_id: string;
    key: string;
    request_hash: string;
    response: unknown;
    http_status: number;
  }>(
    `SELECT user_id, key, request_hash, response, http_status
     FROM idempotency_keys
     WHERE user_id = $1 AND key = $2
     FOR UPDATE`,
    [userId, key],
  );

  const row = result.rows[0];
  if (!row) {
    return null; // No existing record
  }

  // Existing record found inside transaction
  if (row.request_hash !== requestHash) {
    throw new AppError(
      'IDEMPOTENCY_KEY_REUSED',
      'Idempotency key reused with a different request payload.',
    );
  }

  return {
    userId: row.user_id,
    key: row.key,
    requestHash: row.request_hash,
    response: row.response,
    httpStatus: row.http_status,
  };
}

/**
 * Store the idempotency key and response inside a transaction.
 * Called for:
 * - 201 COMMITTED results (success)
 * - 422 REJECTED results (INSUFFICIENT_FUNDS, ACCOUNT_NOT_ACTIVE)
 */
export async function store(
  client: pg.PoolClient,
  userId: string,
  key: string,
  requestHash: string,
  response: unknown,
  httpStatus: number,
): Promise<void> {
  await client.query(
    `INSERT INTO idempotency_keys (user_id, key, request_hash, response, http_status)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, key) DO UPDATE
       SET response = $4, http_status = $5`,
    [userId, key, requestHash, JSON.stringify(response), httpStatus],
  );

  logger.debug('Idempotency key stored', { userId, key, httpStatus });
}
