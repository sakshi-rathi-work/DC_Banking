/**
 * Auth module — user registration and login.
 * Bcrypt hashing is offloaded to the Piscina worker pool.
 * JWTs contain {sub: userId, email} with 24h expiry.
 */
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type pg from 'pg';
import { AppError, createLogger } from '@bank/shared';
import { hashPassword, verifyPassword } from '../concurrency/pool.js';

const logger = createLogger({ service: 'auth' });

const JWT_EXPIRY = '24h';

export interface AuthResult {
  user: { id: string; name: string; email: string };
  token: string;
}

/**
 * Register a new user.
 * - Hashes password in worker thread (bcrypt cost 10).
 * - Inserts user row.
 * - Appends CREATE_USER to replication_log so user is replicated to all nodes.
 * - Returns user info + JWT.
 */
export async function register(
  pool: pg.Pool,
  jwtSecret: string,
  name: string,
  email: string,
  password: string,
): Promise<AuthResult> {
  // Hash password in worker pool (off main thread)
  const passwordHash = await hashPassword(password);

  const userId = randomUUID();
  const normalizedEmail = email.toLowerCase().trim();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    try {
      await client.query(
        `INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)`,
        [userId, name, normalizedEmail, passwordHash],
      );
    } catch (err) {
      // Unique constraint violation on email
      if (err && typeof err === 'object' && (err as { code?: string }).code === '23505') {
        await client.query('ROLLBACK');
        throw new AppError('EMAIL_TAKEN', 'Email is already registered.');
      }
      throw err;
    }

    // Append CREATE_USER to replication log so user row propagates to all follower nodes.
    // If node_state doesn't exist yet (e.g. solo dev boot), skip gracefully.
    try {
      const seqResult = await client.query<{ last_seq: number; node_id: number; epoch: number }>(
        `UPDATE node_state SET last_seq = last_seq + 1, updated_at = now()
         RETURNING last_seq, node_id, epoch`,
      );
      if (seqResult.rows.length > 0) {
        const { last_seq: newSeq, node_id: nodeId, epoch } = seqResult.rows[0]!;
        await client.query(
          `INSERT INTO replication_log (seq, epoch, op_type, payload, lamport, origin_node, physical_ts)
           VALUES ($1, $2, 'CREATE_USER', $3::jsonb, 0, $4, now())`,
          [
            newSeq,
            epoch,
            JSON.stringify({
              user: {
                id: userId,
                name,
                email: normalizedEmail,
                passwordHash,
                createdAt: new Date().toISOString(),
              },
            }),
            nodeId,
          ],
        );
      }
    } catch (replErr) {
      // Non-fatal: replication log write failed (initial boot before node_state)
      logger.warn('Could not write CREATE_USER to replication_log', { replErr });
    }

    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }

  const token = jwt.sign(
    { sub: userId, email: normalizedEmail },
    jwtSecret,
    { expiresIn: JWT_EXPIRY },
  );

  logger.info('User registered', { userId, email: normalizedEmail });

  return {
    user: { id: userId, name, email: normalizedEmail },
    token,
  };
}

/**
 * Login an existing user.
 * - Looks up by email, verifies password in worker thread.
 * - Returns user info + JWT.
 */
export async function login(
  pool: pg.Pool,
  jwtSecret: string,
  email: string,
  password: string,
): Promise<AuthResult> {
  const result = await pool.query(
    `SELECT id, name, email, password_hash FROM users WHERE lower(email) = $1`,
    [email.toLowerCase().trim()],
  );

  const row = result.rows[0] as
    | { id: string; name: string; email: string; password_hash: string }
    | undefined;

  if (!row) {
    throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  // Verify password in worker pool (off main thread)
  const isValid = await verifyPassword(password, row.password_hash);
  if (!isValid) {
    throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  const token = jwt.sign(
    { sub: row.id, email: row.email },
    jwtSecret,
    { expiresIn: JWT_EXPIRY },
  );

  logger.info('User logged in', { userId: row.id, email: row.email });

  return {
    user: { id: row.id, name: row.name, email: row.email },
    token,
  };
}

/**
 * Get user info by ID (for /auth/me).
 */
export async function getUser(
  pool: pg.Pool,
  userId: string,
): Promise<{ id: string; name: string; email: string }> {
  const result = await pool.query(
    `SELECT id, name, email FROM users WHERE id = $1`,
    [userId],
  );

  const row = result.rows[0] as { id: string; name: string; email: string } | undefined;
  if (!row) {
    throw new AppError('NOT_FOUND', 'User not found.');
  }

  return row;
}

/**
 * Verify a JWT token and extract claims.
 */
export function verifyToken(
  token: string,
  jwtSecret: string,
): { sub: string; email: string } {
  try {
    const payload = jwt.verify(token, jwtSecret) as { sub: string; email: string };
    return payload;
  } catch {
    throw new AppError('UNAUTHENTICATED', 'Invalid or expired token.');
  }
}
