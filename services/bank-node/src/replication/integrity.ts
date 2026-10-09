import type pg from 'pg';

export interface NodeIntegrityResult {
  nodeId: number;
  lastSeq: number;
  accountCount: number;
  txnCount: number;
  totalBalancePaise: number;
  accountsChecksum: string;
}

export class IntegrityChecker {
  private pool: pg.Pool;
  private selfNodeId: number;

  constructor(pool: pg.Pool, selfNodeId: number) {
    this.pool = pool;
    this.selfNodeId = selfNodeId;
  }

  public async getLocalIntegrity(): Promise<NodeIntegrityResult> {
    const seqRes = await this.pool.query<{ last_seq: string }>('SELECT last_seq FROM node_state WHERE node_id = $1', [this.selfNodeId]);
    const lastSeq = Number(seqRes.rows[0]?.last_seq || 0);

    const acctRes = await this.pool.query<{ cnt: string; total_balance: string; chk: string }>(
      `SELECT
        COUNT(*)::text AS cnt,
        COALESCE(SUM(balance_paise), 0)::text AS total_balance,
        COALESCE(md5(string_agg(id::text || ':' || balance_paise::text || ':' || version::text, ',' ORDER BY id)), '') AS chk
       FROM accounts`,
    );

    const txnRes = await this.pool.query<{ cnt: string }>('SELECT COUNT(*)::text AS cnt FROM transactions');

    return {
      nodeId: this.selfNodeId,
      lastSeq,
      accountCount: Number(acctRes.rows[0]?.cnt || 0),
      txnCount: Number(txnRes.rows[0]?.cnt || 0),
      totalBalancePaise: Number(acctRes.rows[0]?.total_balance || 0),
      accountsChecksum: acctRes.rows[0]?.chk || '',
    };
  }
}
