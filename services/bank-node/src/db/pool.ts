import pg from 'pg';
import { createLogger } from '@bank/shared';

const { Pool, types } = pg;

// Parse Postgres BIGINT (type ID 20) to JavaScript number
// style-guide §4: numbers are within safe integer range
types.setTypeParser(20, (val: string) => parseInt(val, 10));

const logger = createLogger({ service: 'db' });

let poolInstance: pg.Pool | null = null;

export function getDbPool(connectionString?: string): pg.Pool {
  if (poolInstance) {
    return poolInstance;
  }

  const databaseUrl = connectionString ?? process.env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required to create DB pool');
  }

  const maxConnections = process.env['PG_POOL_MAX']
    ? parseInt(process.env['PG_POOL_MAX'], 10)
    : 10;

  poolInstance = new Pool({
    connectionString: databaseUrl,
    max: maxConnections,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  poolInstance.on('error', (err) => {
    logger.error('Unexpected error on idle database client', err);
  });

  return poolInstance;
}

export async function closeDbPool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
}
