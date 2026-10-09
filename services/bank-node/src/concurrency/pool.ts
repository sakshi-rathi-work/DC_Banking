/**
 * Piscina worker thread pool for CPU-bound tasks.
 * Offloads bcrypt hashing and CSV generation to worker threads
 * to avoid blocking the event loop.
 */
import { Piscina } from 'piscina';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '@bank/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = createLogger({ service: 'worker-pool' });

let bcryptPool: Piscina | null = null;
let csvPool: Piscina | null = null;

export function getBcryptPool(): Piscina {
  if (!bcryptPool) {
    bcryptPool = new Piscina({
      filename: path.join(__dirname, 'workers', 'bcrypt-worker.ts'),
      // One worker per core is fine for CPU-bound bcrypt
      maxThreads: 4,
      minThreads: 1,
      idleTimeout: 30000,
    });
    logger.info('Bcrypt worker pool created', { maxThreads: 4 });
  }
  return bcryptPool;
}

export function getCsvPool(): Piscina {
  if (!csvPool) {
    csvPool = new Piscina({
      filename: path.join(__dirname, 'workers', 'csv-worker.ts'),
      maxThreads: 2,
      minThreads: 1,
      idleTimeout: 30000,
    });
    logger.info('CSV worker pool created', { maxThreads: 2 });
  }
  return csvPool;
}

export async function destroyPools(): Promise<void> {
  const tasks: Promise<void>[] = [];
  if (bcryptPool) {
    tasks.push(bcryptPool.destroy().then(() => { bcryptPool = null; }));
  }
  if (csvPool) {
    tasks.push(csvPool.destroy().then(() => { csvPool = null; }));
  }
  await Promise.all(tasks);
  logger.info('Worker pools destroyed');
}

// ===== High-level helpers =====

export interface BcryptHashResult {
  hash: string;
}

export interface BcryptVerifyResult {
  match: boolean;
}

export async function hashPassword(password: string): Promise<string> {
  const pool = getBcryptPool();
  const result = await pool.run({ op: 'hash', password }) as BcryptHashResult;
  return result.hash;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const pool = getBcryptPool();
  const result = await pool.run({ op: 'verify', password, hash }) as BcryptVerifyResult;
  return result.match;
}

export interface CsvInput {
  columns: string[];
  rows: Record<string, string | number | null | undefined>[];
}

export async function generateCsv(input: CsvInput): Promise<Buffer> {
  const pool = getCsvPool();
  const result = await pool.run(input) as { csv: string };
  return Buffer.from(result.csv, 'utf-8');
}
