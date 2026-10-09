import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { createLogger } from '@bank/shared';

const logger = createLogger({ service: 'migrator' });

export interface MigrationResult {
  version: number;
  name: string;
  applied: boolean;
}

export async function runMigrations(
  pool: pg.Pool,
  migrationsDir?: string,
): Promise<MigrationResult[]> {
  const resolvedDir =
    migrationsDir ??
    path.resolve(process.cwd(), 'database', 'migrations');

  // Verify migrations directory exists
  try {
    await fs.access(resolvedDir);
  } catch {
    // If running inside service container, try relative fallbacks
    const fallbackDir = path.resolve(process.cwd(), '..', '..', 'database', 'migrations');
    try {
      await fs.access(fallbackDir);
      return runMigrations(pool, fallbackDir);
    } catch {
      throw new Error(`Migrations directory not found at ${resolvedDir} or ${fallbackDir}`);
    }
  }

  const client = await pool.connect();
  const results: MigrationResult[] = [];

  try {
    // 1. Ensure schema_migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     INT PRIMARY KEY,
        name        TEXT NOT NULL,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // 2. Fetch applied migrations
    const { rows: appliedRows } = await client.query<{ version: number }>(
      'SELECT version FROM schema_migrations ORDER BY version ASC',
    );
    const appliedVersions = new Set(appliedRows.map((r) => r.version));

    // 3. Read migration files
    const entries = await fs.readdir(resolvedDir);
    const sqlFiles = entries
      .filter((file) => file.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));

    for (const file of sqlFiles) {
      const match = file.match(/^(\d+)_(.+)\.sql$/);
      if (!match) {
        logger.warn(`Skipping invalid migration filename format: ${file}`);
        continue;
      }

      const version = parseInt(match[1]!, 10);
      const name = match[2]!;

      if (appliedVersions.has(version)) {
        results.push({ version, name, applied: false });
        continue;
      }

      logger.info(`Applying migration ${file}...`);
      const filePath = path.join(resolvedDir, file);
      const sqlContent = await fs.readFile(filePath, 'utf-8');

      await client.query('BEGIN');
      try {
        await client.query(sqlContent);
        await client.query(
          'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
          [version, file],
        );
        await client.query('COMMIT');
        logger.info(`Migration ${file} applied successfully.`);
        results.push({ version, name, applied: true });
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error(`Failed to apply migration ${file}`, err);
        throw err;
      }
    }

    return results;
  } finally {
    client.release();
  }
}
