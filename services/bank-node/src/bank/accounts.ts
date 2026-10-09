/**
 * Accounts module — create, list, get, lookup.
 * Account numbers are 12-digit random strings.
 */
import { randomUUID, randomInt } from 'node:crypto';
import type pg from 'pg';
import { AppError, createLogger } from '@bank/shared';

const logger = createLogger({ service: 'accounts' });

export interface AccountRow {
  id: string;
  account_number: string;
  user_id: string;
  nickname: string | null;
  balance_paise: number;
  currency: string;
  status: string;
  version: number;
  created_at: Date;
}

export interface AccountDto {
  id: string;
  accountNumber: string;
  nickname: string | null;
  balancePaise: number;
  currency: string;
  status: string;
  version: number;
  createdAt: string;
}

function toDto(row: AccountRow): AccountDto {
  return {
    id: row.id,
    accountNumber: row.account_number,
    nickname: row.nickname,
    balancePaise: row.balance_paise,
    currency: row.currency,
    status: row.status,
    version: row.version,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Generate a 12-digit numeric account number.
 * Uses crypto.randomInt for secure generation.
 */
function generateAccountNumber(): string {
  // Generate 12 digits: first digit 1-9, remaining 0-9
  let num = String(randomInt(1, 10));
  for (let i = 1; i < 12; i++) {
    num += String(randomInt(0, 10));
  }
  return num;
}

/**
 * Create a new account for the authenticated user.
 * Writes a CREATE_ACCOUNT entry to the replication log so accounts
 * are propagated to follower nodes.
 */
export async function createAccount(
  client: pg.PoolClient,
  userId: string,
  nickname?: string,
): Promise<AccountDto> {
  const accountId = randomUUID();

  // Generate unique 12-digit account number with collision retry
  let accountNumber: string;
  let attempts = 0;
  const MAX_ATTEMPTS = 5;

  while (attempts < MAX_ATTEMPTS) {
    accountNumber = generateAccountNumber();
    try {
      const result = await client.query<AccountRow>(
        `INSERT INTO accounts (id, user_id, account_number, nickname, balance_paise, currency, status, version)
         VALUES ($1, $2, $3, $4, 0, 'INR', 'ACTIVE', 0)
         RETURNING *`,
        [accountId, userId, accountNumber, nickname ?? null],
      );
      const row = result.rows[0]!;
      logger.info('Account created', {
        accountId,
        accountNumber,
        userId,
      });

      // Append CREATE_ACCOUNT to replication log so follower nodes receive this account.
      try {
        const seqResult = await client.query<{ last_seq: number; node_id: number; epoch: number }>(
          `UPDATE node_state SET last_seq = last_seq + 1, updated_at = now()
           RETURNING last_seq, node_id, epoch`,
        );
        if (seqResult.rows.length > 0) {
          const { last_seq: newSeq, node_id: nodeId, epoch } = seqResult.rows[0]!;
          await client.query(
            `INSERT INTO replication_log (seq, epoch, op_type, payload, lamport, origin_node, physical_ts)
             VALUES ($1, $2, 'CREATE_ACCOUNT', $3::jsonb, 0, $4, now())`,
            [
              newSeq,
              epoch,
              JSON.stringify({
                account: {
                  id: row.id,
                  userId: row.user_id,
                  accountNumber: row.account_number,
                  nickname: row.nickname,
                  balancePaise: row.balance_paise,
                  currency: row.currency,
                  status: row.status,
                  version: row.version,
                  createdAt: row.created_at.toISOString(),
                  updatedAt: row.created_at.toISOString(),
                },
              }),
              nodeId,
            ],
          );
        }
      } catch (replErr) {
        // Non-fatal — log a warning but don't abort account creation
        logger.warn('Could not write CREATE_ACCOUNT to replication_log', { replErr });
      }

      return toDto(row);
    } catch (err) {
      // Unique constraint on account_number — retry
      if (
        err &&
        typeof err === 'object' &&
        (err as { code?: string }).code === '23505' &&
        (err as { constraint?: string }).constraint?.includes('account_number')
      ) {
        attempts++;
        if (attempts >= MAX_ATTEMPTS) {
          throw new AppError('INTERNAL', 'Could not generate unique account number.');
        }
        continue;
      }
      throw err;
    }
  }

  throw new AppError('INTERNAL', 'Could not generate unique account number.');
}

/**
 * List all accounts owned by the authenticated user.
 */
export async function listAccounts(
  pool: pg.Pool | pg.PoolClient,
  userId: string,
): Promise<AccountDto[]> {
  const result = await pool.query<AccountRow>(
    `SELECT * FROM accounts WHERE user_id = $1 ORDER BY created_at ASC`,
    [userId],
  );
  return result.rows.map(toDto);
}

/**
 * Get a single account by ID. Enforces ownership check.
 */
export async function getAccount(
  pool: pg.Pool | pg.PoolClient,
  accountId: string,
  userId: string,
): Promise<AccountDto> {
  const result = await pool.query<AccountRow>(
    `SELECT * FROM accounts WHERE id = $1`,
    [accountId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new AppError('NOT_FOUND', 'Account not found.');
  }

  if (row.user_id !== userId) {
    throw new AppError('FORBIDDEN', 'You do not have permission to access this account.');
  }

  return toDto(row);
}

/**
 * Lookup account by account number for transfer validation.
 * Returns masked holder name (first name + last initial).
 */
export async function lookupAccount(
  pool: pg.Pool | pg.PoolClient,
  accountNumber: string,
): Promise<{ accountNumber: string; holderName: string }> {
  const result = await pool.query<{ account_number: string; name: string }>(
    `SELECT a.account_number, u.name
     FROM accounts a
     JOIN users u ON u.id = a.user_id
     WHERE a.account_number = $1 AND a.status = 'ACTIVE'`,
    [accountNumber],
  );

  const row = result.rows[0];
  if (!row) {
    throw new AppError('NOT_FOUND', 'Account not found.');
  }

  // Mask name: "Alice Rao" → "Alice R."
  const parts = row.name.split(' ').filter(Boolean);
  let maskedName: string;
  if (parts.length >= 2) {
    maskedName = `${parts[0]} ${parts[parts.length - 1]![0]}.`;
  } else {
    maskedName = parts[0] ?? 'Unknown';
  }

  return {
    accountNumber: row.account_number,
    holderName: maskedName,
  };
}

/**
 * Get account by ID (internal, no ownership check).
 * Used by transaction processing to fetch account details.
 */
export async function getAccountInternal(
  client: pg.PoolClient,
  accountId: string,
): Promise<AccountRow | null> {
  const result = await client.query<AccountRow>(
    `SELECT * FROM accounts WHERE id = $1`,
    [accountId],
  );
  return result.rows[0] ?? null;
}

/**
 * Get account by account number (internal, no ownership check).
 */
export async function getAccountByNumberInternal(
  client: pg.PoolClient,
  accountNumber: string,
): Promise<AccountRow | null> {
  const result = await client.query<AccountRow>(
    `SELECT * FROM accounts WHERE account_number = $1`,
    [accountNumber],
  );
  return result.rows[0] ?? null;
}
