import type pg from 'pg';
import { createLogger, type LamportClock } from '@bank/shared';
import type { AppendEntriesReq, AppendEntriesRes } from './types.js';

const logger = createLogger({ service: 'log-applier' });

export class LogApplier {
  private pool: pg.Pool;
  private selfNodeId: number;
  private clock: LamportClock;

  constructor(pool: pg.Pool, selfNodeId: number, clock: LamportClock) {
    this.pool = pool;
    this.selfNodeId = selfNodeId;
    this.clock = clock;
  }

  public async applyEntries(req: AppendEntriesReq, currentLocalEpoch: number): Promise<AppendEntriesRes> {
    // 1. Epoch check
    if (req.epoch < currentLocalEpoch) {
      logger.warn(`Rejected AppendEntries from stale epoch ${req.epoch} (local: ${currentLocalEpoch})`);
      const localSeqRes = await this.pool.query<{ last_seq: string }>('SELECT last_seq FROM node_state WHERE node_id = $1', [this.selfNodeId]);
      const lastSeq = Number(localSeqRes.rows[0]?.last_seq || 0);
      return { ok: false, reason: 'STALE_EPOCH', lastSeq, epoch: currentLocalEpoch };
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Lock local node_state
      const stateRes = await client.query<{ last_seq: string }>('SELECT last_seq FROM node_state WHERE node_id = $1 FOR UPDATE', [this.selfNodeId]);
      let localLastSeq = stateRes.rows[0] ? Number(stateRes.rows[0].last_seq || 0) : 0;

      // 2. Continuity check
      if (req.prevSeq > 0) {
        if (req.prevSeq > localLastSeq) {
          await client.query('ROLLBACK');
          logger.warn(`Replication GAP detected: prevSeq=${req.prevSeq} > localLastSeq=${localLastSeq}`);
          return { ok: false, reason: 'GAP', lastSeq: localLastSeq, epoch: currentLocalEpoch };
        }

        const prevRes = await client.query<{ epoch: string }>('SELECT epoch FROM replication_log WHERE seq = $1', [req.prevSeq]);
        if (prevRes.rows.length === 0 || Number(prevRes.rows[0]?.epoch) !== req.prevEpoch) {
          await client.query('ROLLBACK');
          logger.warn(`Replication CONFLICT at prevSeq=${req.prevSeq}`);
          return { ok: false, reason: 'CONFLICT', lastSeq: localLastSeq, epoch: currentLocalEpoch };
        }
      }

      // 3. Apply entries sequentially
      for (const entry of req.entries) {
        // Witness entry Lamport timestamp
        if (entry.lamport) {
          this.clock.receive(entry.lamport);
        }

        if (entry.seq <= localLastSeq) {
          // Already applied or duplicate entry, skip payload execution
          continue;
        }

        // Apply row image based on opType
        const payload = JSON.parse(entry.payloadJson);
        await this.applyRowPayload(client, entry.opType, payload);

        // Record in replication_log
        await client.query(
          `INSERT INTO replication_log (
            seq, epoch, op_type, payload, lamport, origin_node, physical_ts
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (seq) DO NOTHING`,
          [entry.seq, entry.epoch, entry.opType, entry.payloadJson, entry.lamport, entry.originNode, entry.physicalTs],
        );

        localLastSeq = entry.seq;
      }

      // Update node_state
      await client.query(
        'UPDATE node_state SET last_seq = $1, epoch = $2, updated_at = now() WHERE node_id = $3',
        [localLastSeq, req.epoch, this.selfNodeId],
      );

      await client.query('COMMIT');
      return { ok: true, reason: 'OK', lastSeq: localLastSeq, epoch: req.epoch };
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('Failed to apply replication entries', { err });
      throw err;
    } finally {
      client.release();
    }
  }

  private async applyRowPayload(client: pg.PoolClient, opType: string, payload: Record<string, Record<string, unknown>>): Promise<void> {
    if (opType === 'CREATE_USER' && payload.user) {
      const u = payload.user;
      await client.query(
        `INSERT INTO users (id, name, email, password_hash, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name, email = EXCLUDED.email, password_hash = EXCLUDED.password_hash`,
        [u.id, u.name, u.email, u.passwordHash || u.password_hash || '', u.createdAt || new Date().toISOString()],
      );
    } else if (opType === 'CREATE_ACCOUNT' && payload.account) {
      const a = payload.account;
      await client.query(
        `INSERT INTO accounts (id, user_id, account_number, nickname, balance_paise, currency, status, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE
         SET nickname = EXCLUDED.nickname, balance_paise = EXCLUDED.balance_paise, version = EXCLUDED.version, updated_at = EXCLUDED.updated_at
         WHERE EXCLUDED.version >= accounts.version`,
        [
          a.id,
          a.userId || a.user_id,
          a.accountNumber || a.account_number,
          a.nickname || null,
          a.balancePaise ?? a.balance_paise ?? 0,
          a.currency || 'INR',
          a.status || 'ACTIVE',
          a.version ?? 0,
          a.createdAt || new Date().toISOString(),
          a.updatedAt || new Date().toISOString(),
        ],
      );
    } else if (opType === 'TRANSACTION') {
      if (payload.transaction) {
        const t = payload.transaction;
        await client.query(
          `INSERT INTO transactions (
            id, reference, type, source_account_id, destination_account_id, amount_paise,
            status, reject_reason, note, source_balance_after, destination_balance_after,
            entry_node, processed_by_node, epoch, log_seq, lamport, physical_ts, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
          ON CONFLICT (id) DO NOTHING`,
          [
            t.id,
            t.reference,
            t.type,
            t.sourceAccountId || t.source_account_id || null,
            t.destinationAccountId || t.destination_account_id || null,
            t.amountPaise ?? t.amount_paise,
            t.status,
            t.rejectReason || t.reject_reason || null,
            t.note || null,
            t.sourceBalanceAfter ?? t.source_balance_after ?? null,
            t.destinationBalanceAfter ?? t.destination_balance_after ?? null,
            t.entryNode ?? t.entry_node ?? 1,
            t.processedByNode ?? t.processed_by_node ?? 1,
            t.epoch,
            t.logSeq ?? t.log_seq ?? 0,
            t.lamport,
            t.physicalTs || t.physical_ts || new Date().toISOString(),
            t.createdAt || new Date().toISOString(),
          ],
        );
      }

      if (payload.sourceAccount) {
        const sa = payload.sourceAccount;
        await client.query(
          `UPDATE accounts SET balance_paise = $1, version = $2, updated_at = now()
           WHERE id = $3 AND $2 >= version`,
          [sa.balancePaise ?? sa.balance_paise, sa.version, sa.id],
        );
      }

      if (payload.destAccount) {
        const da = payload.destAccount;
        await client.query(
          `UPDATE accounts SET balance_paise = $1, version = $2, updated_at = now()
           WHERE id = $3 AND $2 >= version`,
          [da.balancePaise ?? da.balance_paise, da.version, da.id],
        );
      }
    }
  }
}
