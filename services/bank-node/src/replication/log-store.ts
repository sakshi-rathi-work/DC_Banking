import type pg from 'pg';
import type { LogEntryPayload } from './types.js';

export class LogStore {
  /**
   * Append a new log entry transactionally on the leader inside an active DB transaction client.
   * Uses FOR UPDATE lock on node_state to guarantee gapless monotonic seq numbers.
   */
  public static async appendLogEntry(
    client: pg.PoolClient,
    nodeId: number,
    opts: {
      opType: string;
      payload: unknown;
      epoch: number;
      lamport: number;
      originNode?: number;
    },
  ): Promise<{ seq: number; entry: LogEntryPayload }> {
    // 1. Lock node_state row for update to get next gapless seq
    const stateRes = await client.query<{ last_seq: string }>(
      'SELECT last_seq FROM node_state WHERE node_id = $1 FOR UPDATE',
      [nodeId],
    );

    const currentSeq = stateRes.rows[0] ? Number(stateRes.rows[0].last_seq || 0) : 0;
    const nextSeq = currentSeq + 1;
    const physicalTs = new Date().toISOString();
    const payloadJson = JSON.stringify(opts.payload);
    const originNode = opts.originNode ?? nodeId;

    // 2. Update node_state
    await client.query(
      'UPDATE node_state SET last_seq = $1, updated_at = now() WHERE node_id = $2',
      [nextSeq, nodeId],
    );

    // 3. Insert into replication_log
    await client.query(
      `INSERT INTO replication_log (
        seq, epoch, op_type, payload, lamport, origin_node, physical_ts
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [nextSeq, opts.epoch, opts.opType, payloadJson, opts.lamport, originNode, physicalTs],
    );

    const entry: LogEntryPayload = {
      seq: nextSeq,
      epoch: opts.epoch,
      opType: opts.opType,
      payloadJson,
      lamport: opts.lamport,
      originNode,
      physicalTs,
    };

    return { seq: nextSeq, entry };
  }

  /**
   * Fetch log entries starting from `fromSeq`.
   */
  public static async getLogEntries(
    pool: pg.Pool,
    fromSeq: number,
    maxEntries = 100,
  ): Promise<{ entries: LogEntryPayload[]; lastSeq: number }> {
    const res = await pool.query(
      `SELECT seq, epoch, op_type AS "opType", payload, lamport, origin_node AS "originNode", physical_ts AS "physicalTs"
       FROM replication_log
       WHERE seq >= $1
       ORDER BY seq ASC
       LIMIT $2`,
      [fromSeq, Math.min(maxEntries, 500)],
    );

    const entries: LogEntryPayload[] = res.rows.map((r) => ({
      seq: Number(r.seq),
      epoch: Number(r.epoch),
      opType: r.opType,
      payloadJson: typeof r.payload === 'string' ? r.payload : JSON.stringify(r.payload),
      lamport: Number(r.lamport),
      originNode: Number(r.originNode),
      physicalTs: new Date(r.physicalTs).toISOString(),
    }));

    const lastSeqRes = await pool.query<{ max_seq: string }>('SELECT COALESCE(MAX(seq), 0) AS max_seq FROM replication_log');
    const lastSeq = Number(lastSeqRes.rows[0]?.max_seq || 0);

    return { entries, lastSeq };
  }

  /**
   * Get highest sequence number from node_state.
   */
  public static async getLastSeq(pool: pg.Pool, nodeId: number): Promise<number> {
    const res = await pool.query<{ last_seq: string }>('SELECT last_seq FROM node_state WHERE node_id = $1', [nodeId]);
    return res.rows[0] ? Number(res.rows[0].last_seq || 0) : 0;
  }
}
