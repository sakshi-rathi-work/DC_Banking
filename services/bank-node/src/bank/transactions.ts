/**
 * Transaction processing module.
 *
 * Implements deposit, withdraw, transfer with:
 * - Row locks acquired in account ID order (deadlock avoidance)
 * - CHECK (balance_paise >= 0) enforced by database
 * - Replication log entry appended in same transaction
 * - last_seq counter bumped in node_state
 * - Idempotency key handling per scoping rules
 * - REJECTED transactions recorded for business failures
 *
 * Reference format: TXN-YYYYMMDD-XXXXX (5 random alphanumeric chars)
 */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { AppError, createLogger, toPaise } from '@bank/shared';
import { withTx } from '../db/tx.js';
import {
  getAccountByNumberInternal,
  type AccountRow,
} from './accounts.js';
import * as idempotency from './idempotency.js';

const logger = createLogger({ service: 'transactions' });

export type TxnType = 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER';
export type TxnStatus = 'COMMITTED' | 'REJECTED';

export interface TransactionRow {
  id: string;
  reference: string;
  type: TxnType;
  status: TxnStatus;
  reject_reason: string | null;
  source_account_id: string | null;
  destination_account_id: string | null;
  amount_paise: number;
  source_balance_after: number | null;
  destination_balance_after: number | null;
  note: string | null;
  entry_node: number;
  processed_by_node: number;
  epoch: number;
  log_seq: number;
  lamport: number;
  physical_ts: Date;
  created_at: Date;
}

export interface TransactionResult {
  transaction: TransactionRow;
  replication: {
    mode: string;
    ackedBy: number[];
    pendingNodes: number[];
    durationMs: number;
  };
}

interface NodeContext {
  nodeId: number;
  epoch: number;
  lamport: number;
}

/**
 * Generate a reference in the format TXN-YYYYMMDD-XXXXX.
 */
function generateReference(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1
  let suffix = '';
  for (let i = 0; i < 5; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `TXN-${date}-${suffix}`;
}

/**
 * Lock accounts in ID-sorted order to prevent deadlocks.
 * Returns locked account rows.
 */
async function lockAccountsInOrder(
  client: pg.PoolClient,
  ...accountIds: string[]
): Promise<Map<string, AccountRow>> {
  const sorted = [...new Set(accountIds)].sort();
  const result = new Map<string, AccountRow>();

  for (const id of sorted) {
    const res = await client.query<AccountRow>(
      `SELECT * FROM accounts WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const row = res.rows[0];
    if (!row) {
      throw new AppError('NOT_FOUND', `Account ${id} not found.`);
    }
    result.set(id, row);
  }

  return result;
}

/**
 * Append a replication log entry and bump last_seq in node_state.
 * Returns the new sequence number.
 */
async function appendReplicationLog(
  client: pg.PoolClient,
  nodeId: number,
  epoch: number,
  lamport: number,
  opType: string,
  payload: unknown,
): Promise<number> {
  // Atomically increment last_seq
  const seqResult = await client.query<{ last_seq: number }>(
    `UPDATE node_state
     SET last_seq = last_seq + 1, updated_at = now()
     WHERE node_id = $1
     RETURNING last_seq`,
    [nodeId],
  );
  const newSeq = seqResult.rows[0]!.last_seq;

  // Insert replication log entry
  await client.query(
    `INSERT INTO replication_log (seq, epoch, op_type, payload, lamport, origin_node, physical_ts)
     VALUES ($1, $2, $3, $4, $5, $6, now())`,
    [newSeq, epoch, opType, JSON.stringify(payload), lamport, nodeId],
  );

  return newSeq;
}

/**
 * Record a REJECTED transaction row (for business failures like INSUFFICIENT_FUNDS).
 */
async function recordRejectedTransaction(
  client: pg.PoolClient,
  ctx: NodeContext,
  txnType: TxnType,
  sourceId: string | null,
  destId: string | null,
  amountPaise: number,
  note: string | null,
  rejectReason: string,
  sourceBalanceAfter: number | null,
  destBalanceAfter: number | null,
): Promise<TransactionRow> {
  const txnId = randomUUID();
  const reference = generateReference();
  const lamport = ctx.lamport;

  const logSeq = await appendReplicationLog(client, ctx.nodeId, ctx.epoch, lamport, 'TXN_REJECTED', {
    txnId,
    type: txnType,
    sourceAccountId: sourceId,
    destinationAccountId: destId,
    amountPaise,
    rejectReason,
  });

  const result = await client.query<TransactionRow>(
    `INSERT INTO transactions
       (id, reference, type, source_account_id, destination_account_id, amount_paise,
        status, reject_reason, note,
        source_balance_after, destination_balance_after,
        entry_node, processed_by_node, epoch, log_seq, lamport, physical_ts)
     VALUES ($1, $2, $3, $4, $5, $6, 'REJECTED', $7, $8, $9, $10, $11, $11, $12, $13, $14, now())
     RETURNING *`,
    [
      txnId, reference, txnType, sourceId, destId, amountPaise,
      rejectReason, note,
      sourceBalanceAfter, destBalanceAfter,
      ctx.nodeId, ctx.epoch, logSeq, lamport,
    ],
  );

  return result.rows[0]!;
}

// ===== Public API =====

/**
 * Process a deposit transaction.
 */
export async function deposit(
  pool: pg.Pool,
  ctx: NodeContext,
  userId: string,
  accountId: string,
  amountPaise: number,
  note: string | null,
  idempotencyKey: string,
  requestHash: string,
): Promise<TransactionResult> {
  // Validate amount
  toPaise(amountPaise, true);

  // Pre-check idempotency (outside transaction)
  const preResult = await idempotency.preCheck(pool, userId, idempotencyKey, requestHash);
  if (preResult && 'replay' in preResult && preResult.replay) {
    return preResult.record.response as TransactionResult;
  }

  const result = await withTx(pool, async (client) => {
    // Check idempotency inside transaction
    const existing = await idempotency.lockInsideTx(client, userId, idempotencyKey, requestHash);
    if (existing) {
      return existing.response as TransactionResult;
    }

    // Lock account
    const accounts = await lockAccountsInOrder(client, accountId);
    const account = accounts.get(accountId)!;

    // Ownership check
    if (account.user_id !== userId) {
      throw new AppError('FORBIDDEN', 'You do not have permission to access this account.');
    }

    // Active check
    if (account.status !== 'ACTIVE') {
      // Record REJECTED transaction and persist idempotency key
      const rejectedTxn = await recordRejectedTransaction(
        client, ctx, 'DEPOSIT', null, accountId, amountPaise, note,
        'ACCOUNT_NOT_ACTIVE', null, account.balance_paise,
      );
      const rejectedResult: TransactionResult = {
        transaction: rejectedTxn,
        replication: { mode: 'strong', ackedBy: [], pendingNodes: [], durationMs: 0 },
      };
      await idempotency.store(client, userId, idempotencyKey, requestHash, rejectedResult, 422);
      return rejectedResult;
    }

    // Credit the account
    const newBalance = account.balance_paise + amountPaise;
    await client.query(
      `UPDATE accounts
       SET balance_paise = $1, version = version + 1, updated_at = now()
       WHERE id = $2`,
      [newBalance, accountId],
    );

    // Append replication log
    const txnId = randomUUID();
    const reference = generateReference();
    const lamport = ctx.lamport;

    const logSeq = await appendReplicationLog(client, ctx.nodeId, ctx.epoch, lamport, 'TXN_COMMITTED', {
      txnId,
      type: 'DEPOSIT',
      destinationAccountId: accountId,
      amountPaise,
      destinationBalanceAfter: newBalance,
    });

    // Insert transaction record
    const txnResult = await client.query<TransactionRow>(
      `INSERT INTO transactions
         (id, reference, type, source_account_id, destination_account_id, amount_paise,
          status, note,
          source_balance_after, destination_balance_after,
          entry_node, processed_by_node, epoch, log_seq, lamport, physical_ts)
       VALUES ($1, $2, 'DEPOSIT', NULL, $3, $4, 'COMMITTED', $5, NULL, $6, $7, $7, $8, $9, $10, now())
       RETURNING *`,
      [txnId, reference, accountId, amountPaise, note, newBalance, ctx.nodeId, ctx.epoch, logSeq, lamport],
    );

    const transaction = txnResult.rows[0]!;
    const result: TransactionResult = {
      transaction,
      replication: { mode: 'strong', ackedBy: [], pendingNodes: [], durationMs: 0 },
    };

    // Store idempotency key
    await idempotency.store(client, userId, idempotencyKey, requestHash, result, 201);

    logger.info('Deposit committed', {
      txnId: transaction.id,
      accountId,
      amountPaise,
      newBalance,
      seq: logSeq,
    });

    return result;
  });

  if (result.transaction.status === 'REJECTED') {
    const reason = result.transaction.reject_reason || 'ACCOUNT_NOT_ACTIVE';
    throw new AppError((reason as unknown) as 'ACCOUNT_NOT_ACTIVE', `Deposit rejected: ${reason}`, {
      details: { transactionId: result.transaction.id },
    });
  }

  return result;
}

/**
 * Process a withdrawal transaction.
 */
export async function withdraw(
  pool: pg.Pool,
  ctx: NodeContext,
  userId: string,
  accountId: string,
  amountPaise: number,
  note: string | null,
  idempotencyKey: string,
  requestHash: string,
): Promise<TransactionResult> {
  // Validate amount
  toPaise(amountPaise, true);

  // Pre-check idempotency
  const preResult = await idempotency.preCheck(pool, userId, idempotencyKey, requestHash);
  if (preResult && 'replay' in preResult && preResult.replay) {
    return preResult.record.response as TransactionResult;
  }

  const result = await withTx(pool, async (client) => {
    const existing = await idempotency.lockInsideTx(client, userId, idempotencyKey, requestHash);
    if (existing) {
      return existing.response as TransactionResult;
    }

    const accounts = await lockAccountsInOrder(client, accountId);
    const account = accounts.get(accountId)!;

    if (account.user_id !== userId) {
      throw new AppError('FORBIDDEN', 'You do not have permission to access this account.');
    }

    if (account.status !== 'ACTIVE') {
      const rejectedTxn = await recordRejectedTransaction(
        client, ctx, 'WITHDRAWAL', accountId, null, amountPaise, note,
        'ACCOUNT_NOT_ACTIVE', account.balance_paise, null,
      );
      const rejectedResult: TransactionResult = {
        transaction: rejectedTxn,
        replication: { mode: 'strong', ackedBy: [], pendingNodes: [], durationMs: 0 },
      };
      await idempotency.store(client, userId, idempotencyKey, requestHash, rejectedResult, 422);
      return rejectedResult;
    }

    // Check sufficient funds
    if (account.balance_paise < amountPaise) {
      const rejectedTxn = await recordRejectedTransaction(
        client, ctx, 'WITHDRAWAL', accountId, null, amountPaise, note,
        'INSUFFICIENT_FUNDS', account.balance_paise, null,
      );
      const rejectedResult: TransactionResult = {
        transaction: rejectedTxn,
        replication: { mode: 'strong', ackedBy: [], pendingNodes: [], durationMs: 0 },
      };
      await idempotency.store(client, userId, idempotencyKey, requestHash, rejectedResult, 422);
      return rejectedResult;
    }

    // Debit
    const newBalance = account.balance_paise - amountPaise;
    await client.query(
      `UPDATE accounts
       SET balance_paise = $1, version = version + 1, updated_at = now()
       WHERE id = $2`,
      [newBalance, accountId],
    );

    const txnId = randomUUID();
    const reference = generateReference();
    const lamport = ctx.lamport;

    const logSeq = await appendReplicationLog(client, ctx.nodeId, ctx.epoch, lamport, 'TXN_COMMITTED', {
      txnId,
      type: 'WITHDRAWAL',
      sourceAccountId: accountId,
      amountPaise,
      sourceBalanceAfter: newBalance,
    });

    const txnResult = await client.query<TransactionRow>(
      `INSERT INTO transactions
         (id, reference, type, source_account_id, destination_account_id, amount_paise,
          status, note,
          source_balance_after, destination_balance_after,
          entry_node, processed_by_node, epoch, log_seq, lamport, physical_ts)
       VALUES ($1, $2, 'WITHDRAWAL', $3, NULL, $4, 'COMMITTED', $5, $6, NULL, $7, $7, $8, $9, $10, now())
       RETURNING *`,
      [txnId, reference, accountId, amountPaise, note, newBalance, ctx.nodeId, ctx.epoch, logSeq, lamport],
    );

    const transaction = txnResult.rows[0]!;
    const result: TransactionResult = {
      transaction,
      replication: { mode: 'strong', ackedBy: [], pendingNodes: [], durationMs: 0 },
    };

    await idempotency.store(client, userId, idempotencyKey, requestHash, result, 201);

    logger.info('Withdrawal committed', {
      txnId: transaction.id,
      accountId,
      amountPaise,
      newBalance,
      seq: logSeq,
    });

    return result;
  });

  if (result.transaction.status === 'REJECTED') {
    const reason = result.transaction.reject_reason || 'TRANSACTION_REJECTED';
    throw new AppError((reason as unknown) as 'INSUFFICIENT_FUNDS', `Withdrawal rejected: ${reason}`, {
      details: { transactionId: result.transaction.id },
    });
  }

  return result;
}

/**
 * Process a transfer transaction.
 * Locks source and destination accounts in ID order (deadlock avoidance).
 */
export async function transfer(
  pool: pg.Pool,
  ctx: NodeContext,
  userId: string,
  fromAccountId: string,
  toAccountNumber: string,
  amountPaise: number,
  note: string | null,
  idempotencyKey: string,
  requestHash: string,
): Promise<TransactionResult> {
  // Validate amount
  toPaise(amountPaise, true);

  // Pre-check idempotency
  const preResult = await idempotency.preCheck(pool, userId, idempotencyKey, requestHash);
  if (preResult && 'replay' in preResult && preResult.replay) {
    return preResult.record.response as TransactionResult;
  }

  const result = await withTx(pool, async (client) => {
    const existing = await idempotency.lockInsideTx(client, userId, idempotencyKey, requestHash);
    if (existing) {
      return existing.response as TransactionResult;
    }

    // Look up destination by account number
    const destAccount = await getAccountByNumberInternal(client, toAccountNumber);
    if (!destAccount) {
      throw new AppError('NOT_FOUND', 'Destination account not found.');
    }

    // Same-account check (pre-check, key NOT stored)
    if (fromAccountId === destAccount.id) {
      throw new AppError('SAME_ACCOUNT', 'Source and destination accounts must be distinct.');
    }

    // Lock both accounts in ID order
    const accounts = await lockAccountsInOrder(client, fromAccountId, destAccount.id);
    const sourceAccount = accounts.get(fromAccountId)!;
    const destinationAccount = accounts.get(destAccount.id)!;

    // Ownership check on source
    if (sourceAccount.user_id !== userId) {
      throw new AppError('FORBIDDEN', 'You do not have permission to access this account.');
    }

    // Active check — source
    if (sourceAccount.status !== 'ACTIVE') {
      const rejectedTxn = await recordRejectedTransaction(
        client, ctx, 'TRANSFER', fromAccountId, destAccount.id, amountPaise, note,
        'ACCOUNT_NOT_ACTIVE', sourceAccount.balance_paise, destinationAccount.balance_paise,
      );
      const rejectedResult: TransactionResult = {
        transaction: rejectedTxn,
        replication: { mode: 'strong', ackedBy: [], pendingNodes: [], durationMs: 0 },
      };
      await idempotency.store(client, userId, idempotencyKey, requestHash, rejectedResult, 422);
      return rejectedResult;
    }

    // Active check — destination
    if (destinationAccount.status !== 'ACTIVE') {
      const rejectedTxn = await recordRejectedTransaction(
        client, ctx, 'TRANSFER', fromAccountId, destAccount.id, amountPaise, note,
        'ACCOUNT_NOT_ACTIVE', sourceAccount.balance_paise, destinationAccount.balance_paise,
      );
      const rejectedResult: TransactionResult = {
        transaction: rejectedTxn,
        replication: { mode: 'strong', ackedBy: [], pendingNodes: [], durationMs: 0 },
      };
      await idempotency.store(client, userId, idempotencyKey, requestHash, rejectedResult, 422);
      return rejectedResult;
    }

    // Sufficient funds check
    if (sourceAccount.balance_paise < amountPaise) {
      const rejectedTxn = await recordRejectedTransaction(
        client, ctx, 'TRANSFER', fromAccountId, destAccount.id, amountPaise, note,
        'INSUFFICIENT_FUNDS', sourceAccount.balance_paise, destinationAccount.balance_paise,
      );
      const rejectedResult: TransactionResult = {
        transaction: rejectedTxn,
        replication: { mode: 'strong', ackedBy: [], pendingNodes: [], durationMs: 0 },
      };
      await idempotency.store(client, userId, idempotencyKey, requestHash, rejectedResult, 422);
      return rejectedResult;
    }

    // Atomic debit + credit
    const newSourceBalance = sourceAccount.balance_paise - amountPaise;
    const newDestBalance = destinationAccount.balance_paise + amountPaise;

    await client.query(
      `UPDATE accounts SET balance_paise = $1, version = version + 1, updated_at = now() WHERE id = $2`,
      [newSourceBalance, fromAccountId],
    );
    await client.query(
      `UPDATE accounts SET balance_paise = $1, version = version + 1, updated_at = now() WHERE id = $2`,
      [newDestBalance, destAccount.id],
    );

    const txnId = randomUUID();
    const reference = generateReference();
    const lamport = ctx.lamport;

    const logSeq = await appendReplicationLog(client, ctx.nodeId, ctx.epoch, lamport, 'TXN_COMMITTED', {
      txnId,
      type: 'TRANSFER',
      sourceAccountId: fromAccountId,
      destinationAccountId: destAccount.id,
      amountPaise,
      sourceBalanceAfter: newSourceBalance,
      destinationBalanceAfter: newDestBalance,
    });

    const txnResult = await client.query<TransactionRow>(
      `INSERT INTO transactions
         (id, reference, type, source_account_id, destination_account_id, amount_paise,
          status, note,
          source_balance_after, destination_balance_after,
          entry_node, processed_by_node, epoch, log_seq, lamport, physical_ts)
       VALUES ($1, $2, 'TRANSFER', $3, $4, $5, 'COMMITTED', $6, $7, $8, $9, $9, $10, $11, $12, now())
       RETURNING *`,
      [
        txnId, reference, fromAccountId, destAccount.id, amountPaise, note,
        newSourceBalance, newDestBalance,
        ctx.nodeId, ctx.epoch, logSeq, lamport,
      ],
    );

    const transaction = txnResult.rows[0]!;
    const result: TransactionResult = {
      transaction,
      replication: { mode: 'strong', ackedBy: [], pendingNodes: [], durationMs: 0 },
    };

    await idempotency.store(client, userId, idempotencyKey, requestHash, result, 201);

    logger.info('Transfer committed', {
      txnId: transaction.id,
      from: fromAccountId,
      to: destAccount.id,
      amountPaise,
      sourceBalance: newSourceBalance,
      destBalance: newDestBalance,
      seq: logSeq,
    });

    return result;
  });

  if (result.transaction.status === 'REJECTED') {
    const reason = result.transaction.reject_reason || 'TRANSACTION_REJECTED';
    throw new AppError((reason as unknown) as 'INSUFFICIENT_FUNDS', `Transfer rejected: ${reason}`, {
      details: { transactionId: result.transaction.id },
    });
  }

  return result;
}

// ===== Query operations =====

/**
 * List transactions for an account (as source or destination), newest first.
 * Supports pagination with opaque cursor (ISO timestamp of last seen).
 */
export async function listTransactions(
  pool: pg.Pool,
  userId: string,
  options: {
    accountId?: string;
    type?: string;
    status?: string;
    limit?: number;
    cursor?: string;
  },
): Promise<{ transactions: TransactionRow[]; nextCursor: string | null }> {
  const limit = Math.min(options.limit ?? 20, 100);
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  // Filter by caller's accounts (join with accounts table for ownership)
  conditions.push(`(t.source_account_id IN (SELECT id FROM accounts WHERE user_id = $${paramIdx}) OR t.destination_account_id IN (SELECT id FROM accounts WHERE user_id = $${paramIdx}))`);
  params.push(userId);
  paramIdx++;

  if (options.accountId) {
    conditions.push(`(t.source_account_id = $${paramIdx} OR t.destination_account_id = $${paramIdx})`);
    params.push(options.accountId);
    paramIdx++;
  }

  if (options.type) {
    conditions.push(`t.type = $${paramIdx}`);
    params.push(options.type);
    paramIdx++;
  }

  if (options.status) {
    conditions.push(`t.status = $${paramIdx}`);
    params.push(options.status);
    paramIdx++;
  }

  if (options.cursor) {
    conditions.push(`t.created_at < $${paramIdx}`);
    params.push(options.cursor);
    paramIdx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Fetch limit+1 to detect if there are more pages
  params.push(limit + 1);
  const query = `
    SELECT t.* FROM transactions t
    ${whereClause}
    ORDER BY t.created_at DESC
    LIMIT $${paramIdx}
  `;

  const result = await pool.query<TransactionRow>(query, params);
  const rows = result.rows;

  let nextCursor: string | null = null;
  if (rows.length > limit) {
    rows.pop();
    const lastRow = rows[rows.length - 1];
    if (lastRow) {
      nextCursor = lastRow.created_at.toISOString();
    }
  }

  return { transactions: rows, nextCursor };
}

/**
 * Get a single transaction by ID (must involve one of the caller's accounts).
 */
export async function getTransaction(
  pool: pg.Pool,
  userId: string,
  transactionId: string,
): Promise<TransactionRow> {
  const result = await pool.query<TransactionRow>(
    `SELECT t.* FROM transactions t
     WHERE t.id = $1
       AND (t.source_account_id IN (SELECT id FROM accounts WHERE user_id = $2)
            OR t.destination_account_id IN (SELECT id FROM accounts WHERE user_id = $2))`,
    [transactionId, userId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new AppError('NOT_FOUND', 'Transaction not found.');
  }

  return row;
}
