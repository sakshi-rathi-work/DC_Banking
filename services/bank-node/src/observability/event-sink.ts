import type pg from 'pg';
import { createLogger, type LamportClock } from '@bank/shared';

const logger = createLogger({ service: 'event-sink' });

export interface LogEventOptions {
  service: string;
  eventType: string;
  severity: 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  requestId?: string;
  transactionId?: string;
  peerNodeId?: number;
  details?: Record<string, unknown>;
  lamport?: number;
}

export interface EventEntryRecord {
  lamport: number;
  nodeId: number;
  physicalTs: string;
  service: string;
  eventType: string;
  severity: string;
  requestId?: string;
  transactionId?: string;
  peerNodeId?: number;
  detailsJson?: string;
}

export class EventSink {
  private pool: pg.Pool;
  private nodeId: number;
  private clock: LamportClock;

  constructor(pool: pg.Pool, nodeId: number, clock: LamportClock) {
    this.pool = pool;
    this.nodeId = nodeId;
    this.clock = clock;
  }

  public async logEvent(opts: LogEventOptions): Promise<number> {
    const lamport = opts.lamport ?? this.clock.tick();
    const physicalTs = new Date().toISOString();
    const detailsJson = opts.details ? JSON.stringify(opts.details) : null;

    try {
      await this.pool.query(
        `INSERT INTO event_log (
          lamport, physical_ts, node_id, service, event_type, severity,
          request_id, transaction_id, peer_node_id, details
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          lamport,
          physicalTs,
          this.nodeId,
          opts.service,
          opts.eventType,
          opts.severity,
          opts.requestId || null,
          opts.transactionId || null,
          opts.peerNodeId || null,
          detailsJson,
        ],
      );
    } catch (err) {
      logger.error('Failed to log event to Postgres event_log', { err, eventType: opts.eventType });
    }

    return lamport;
  }

  public async getEvents(filter: {
    since?: number;
    limit?: number;
    type?: string;
    node?: number;
    requestId?: string;
  }): Promise<EventEntryRecord[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.since !== undefined && filter.since > 0) {
      params.push(filter.since);
      conditions.push(`lamport > $${params.length}`);
    }

    if (filter.type) {
      params.push(filter.type);
      conditions.push(`event_type = $${params.length}`);
    }

    if (filter.node) {
      params.push(filter.node);
      conditions.push(`node_id = $${params.length}`);
    }

    if (filter.requestId) {
      params.push(filter.requestId);
      conditions.push(`request_id = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(filter.limit || 100, 500);

    params.push(limit);
    const limitClause = `LIMIT $${params.length}`;

    const query = `
      SELECT
        lamport,
        node_id AS "nodeId",
        physical_ts AS "physicalTs",
        service,
        event_type AS "eventType",
        severity,
        request_id AS "requestId",
        transaction_id AS "transactionId",
        peer_node_id AS "peerNodeId",
        details
      FROM event_log
      ${whereClause}
      ORDER BY lamport ASC, node_id ASC
      ${limitClause}
    `;

    const result = await this.pool.query(query, params);
    return result.rows.map((r) => ({
      lamport: Number(r.lamport),
      nodeId: Number(r.nodeId),
      physicalTs: new Date(r.physicalTs).toISOString(),
      service: r.service,
      eventType: r.eventType,
      severity: r.severity,
      requestId: r.requestId || undefined,
      transactionId: r.transactionId || undefined,
      peerNodeId: r.peerNodeId ? Number(r.peerNodeId) : undefined,
      detailsJson: r.details ? JSON.stringify(r.details) : '',
    }));
  }
}
