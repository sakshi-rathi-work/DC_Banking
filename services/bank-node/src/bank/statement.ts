/**
 * Statement module — CSV export generated in worker thread.
 * Columns: date, reference, type, description, debitPaise, creditPaise, balanceAfterPaise, status
 */
import type pg from 'pg';
import { AppError, createLogger } from '@bank/shared';
import { generateCsv } from '../concurrency/pool.js';
import type { TransactionRow } from './transactions.js';

const logger = createLogger({ service: 'statement' });

const CSV_COLUMNS = [
  'date',
  'reference',
  'type',
  'description',
  'debitPaise',
  'creditPaise',
  'balanceAfterPaise',
  'status',
];

interface StatementOptions {
  accountId: string;
  userId: string;
  fromDate?: string; // ISO-8601
  toDate?: string; // ISO-8601
}

/**
 * Generate a CSV statement for an account.
 * Validates ownership, fetches transactions, and generates CSV in worker thread.
 */
export async function getStatement(
  pool: pg.Pool,
  options: StatementOptions,
): Promise<Buffer> {
  const { accountId, userId, fromDate, toDate } = options;

  // Verify ownership
  const accountResult = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM accounts WHERE id = $1`,
    [accountId],
  );

  const account = accountResult.rows[0];
  if (!account) {
    throw new AppError('NOT_FOUND', 'Account not found.');
  }
  if (account.user_id !== userId) {
    throw new AppError('FORBIDDEN', 'You do not have permission to access this account.');
  }

  // Build query for transactions
  const conditions: string[] = [`(t.source_account_id = $1 OR t.destination_account_id = $1)`];
  const params: unknown[] = [accountId];
  let paramIdx = 2;

  if (fromDate) {
    conditions.push(`t.created_at >= $${paramIdx}`);
    params.push(fromDate);
    paramIdx++;
  }
  if (toDate) {
    conditions.push(`t.created_at <= $${paramIdx}`);
    params.push(toDate);
    paramIdx++;
  }

  const result = await pool.query<TransactionRow>(
    `SELECT t.* FROM transactions t
     WHERE ${conditions.join(' AND ')}
     ORDER BY t.created_at ASC`,
    params,
  );

  // Transform rows for CSV
  const csvRows = result.rows.map((txn) => {
    const isDebit = txn.source_account_id === accountId;
    const balanceAfter = isDebit
      ? txn.source_balance_after
      : txn.destination_balance_after;

    return {
      date: txn.physical_ts instanceof Date ? txn.physical_ts.toISOString() : String(txn.physical_ts),
      reference: txn.reference,
      type: txn.type,
      description: txn.note ?? '',
      debitPaise: isDebit ? String(txn.amount_paise) : '',
      creditPaise: !isDebit ? String(txn.amount_paise) : '',
      balanceAfterPaise: balanceAfter != null ? String(balanceAfter) : '',
      status: txn.status,
    };
  });

  logger.info('Generating CSV statement', {
    accountId,
    rows: csvRows.length,
  });

  // Generate CSV in worker thread
  const csvBuffer = await generateCsv({
    columns: CSV_COLUMNS,
    rows: csvRows,
  });

  return csvBuffer;
}
