import type pg from 'pg';
import { createLogger } from '@bank/shared';

const logger = createLogger({ service: 'snapshot-service' });

export interface SnapshotChunkData {
  table: string;
  rowsJson: string[];
  last: boolean;
  snapshotSeq: number;
}

export class SnapshotService {
  private pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  public async createSnapshotChunks(): Promise<SnapshotChunkData[]> {
    const lastSeqRes = await this.pool.query<{ max_seq: string }>('SELECT COALESCE(MAX(seq), 0) AS max_seq FROM replication_log');
    const snapshotSeq = Number(lastSeqRes.rows[0]?.max_seq || 0);

    const chunks: SnapshotChunkData[] = [];
    const tables = ['users', 'accounts', 'transactions', 'replication_log'];

    for (let i = 0; i < tables.length; i++) {
      const table = tables[i]!;
      const rowsRes = await this.pool.query(`SELECT * FROM ${table}`);
      const rowsJson = rowsRes.rows.map((r) => JSON.stringify(r));
      const isLast = i === tables.length - 1;

      chunks.push({
        table,
        rowsJson,
        last: isLast,
        snapshotSeq,
      });
    }

    return chunks;
  }

  public async applySnapshot(chunks: SnapshotChunkData[], selfNodeId: number): Promise<number> {
    logger.warn(`Applying full database snapshot stream (${chunks.length} chunks)...`);

    const client = await this.pool.connect();
    let maxSnapshotSeq = 0;

    try {
      await client.query('BEGIN');

      // Truncate replicated tables CASCADE
      await client.query('TRUNCATE users, accounts, transactions, replication_log CASCADE');

      for (const chunk of chunks) {
        maxSnapshotSeq = Math.max(maxSnapshotSeq, chunk.snapshotSeq);
        const rows = chunk.rowsJson.map((r) => JSON.parse(r));

        if (chunk.table === 'users') {
          for (const u of rows) {
            await client.query(
              `INSERT INTO users (id, name, email, password_hash, created_at)
               VALUES ($1, $2, $3, $4, $5)`,
              [u.id, u.name, u.email, u.password_hash, u.created_at],
            );
          }
        } else if (chunk.table === 'accounts') {
          for (const a of rows) {
            await client.query(
              `INSERT INTO accounts (id, user_id, account_number, nickname, balance_paise, currency, status, version, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
              [a.id, a.user_id, a.account_number, a.nickname, a.balance_paise, a.currency, a.status, a.version, a.created_at, a.updated_at],
            );
          }
        } else if (chunk.table === 'transactions') {
          for (const t of rows) {
            await client.query(
              `INSERT INTO transactions (
                id, reference, type, source_account_id, destination_account_id, amount_paise,
                status, reject_reason, note, source_balance_after, destination_balance_after,
                entry_node, processed_by_node, epoch, log_seq, lamport, physical_ts, created_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
              [
                t.id, t.reference, t.type, t.source_account_id, t.destination_account_id, t.amount_paise,
                t.status, t.reject_reason, t.note, t.source_balance_after, t.destination_balance_after,
                t.entry_node, t.processed_by_node, t.epoch, t.log_seq, t.lamport, t.physical_ts, t.created_at,
              ],
            );
          }
        } else if (chunk.table === 'replication_log') {
          for (const l of rows) {
            await client.query(
              `INSERT INTO replication_log (seq, epoch, op_type, payload, lamport, origin_node, physical_ts, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [l.seq, l.epoch, l.op_type, typeof l.payload === 'string' ? l.payload : JSON.stringify(l.payload), l.lamport, l.origin_node, l.physical_ts, l.created_at],
            );
          }
        }
      }

      await client.query(
        'UPDATE node_state SET last_seq = $1, updated_at = now() WHERE node_id = $2',
        [maxSnapshotSeq, selfNodeId],
      );

      await client.query('COMMIT');
      logger.info(`Database snapshot successfully applied! (snapshotSeq: ${maxSnapshotSeq})`);
      return maxSnapshotSeq;
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('Failed to apply snapshot stream', { err });
      throw err;
    } finally {
      client.release();
    }
  }
}
