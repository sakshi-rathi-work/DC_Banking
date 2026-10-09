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

  try {
    await pool.query(
      `INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)`,
      [userId, name, email.toLowerCase().trim(), passwordHash],
    );
  } catch (err) {
    // Unique constraint violation on email
    if (err && typeof err === 'object' && (err as { code?: string }).code === '23505') {
      throw new AppError('EMAIL_TAKEN', 'Email is already registered.');
    }
    throw err;
  }

  const token = jwt.sign(
    { sub: userId, email: email.toLowerCase().trim() },
    jwtSecret,
    { expiresIn: JWT_EXPIRY },
  );

  logger.info('User registered', { userId, email: email.toLowerCase().trim() });

  return {
    user: { id: userId, name, email: email.toLowerCase().trim() },
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
