import pino from 'pino';

export const EventTypes = {
  RPC_REQUEST: 'RPC_REQUEST',
  RPC_RESPONSE: 'RPC_RESPONSE',
  TRANSACTION_CREATED: 'TRANSACTION_CREATED',
  TRANSACTION_COMMITTED: 'TRANSACTION_COMMITTED',
  TRANSACTION_REJECTED: 'TRANSACTION_REJECTED',
  REPLICATION_SENT: 'REPLICATION_SENT',
  REPLICATION_ACK: 'REPLICATION_ACK',
  REPLICATION_APPLIED: 'REPLICATION_APPLIED',
  REPLICATION_TIMEOUT: 'REPLICATION_TIMEOUT',
  NODE_FAILURE_DETECTED: 'NODE_FAILURE_DETECTED',
  NODE_RECOVERED: 'NODE_RECOVERED',
  ELECTION_STARTED: 'ELECTION_STARTED',
  ELECTION_OK_RECEIVED: 'ELECTION_OK_RECEIVED',
  COORDINATOR_ANNOUNCED: 'COORDINATOR_ANNOUNCED',
  LEADER_ELECTED: 'LEADER_ELECTED',
  LEADER_STEPPED_DOWN: 'LEADER_STEPPED_DOWN',
  FAILOVER_COMPLETED: 'FAILOVER_COMPLETED',
  CATCH_UP_COMPLETED: 'CATCH_UP_COMPLETED',
  SNAPSHOT_RESYNC: 'SNAPSHOT_RESYNC',
  DIVERGENT_WRITES_DISCARDED: 'DIVERGENT_WRITES_DISCARDED',
  CLOCK_SYNC_STARTED: 'CLOCK_SYNC_STARTED',
  CLOCK_SYNC_COMPLETED: 'CLOCK_SYNC_COMPLETED',
  DB_DOWN: 'DB_DOWN',
  LB_ROUTED: 'LB_ROUTED',
  LB_RETRY: 'LB_RETRY',
  LB_NODE_UNHEALTHY: 'LB_NODE_UNHEALTHY',
  LAB_FAULT_SET: 'LAB_FAULT_SET',
  NODE_HEARTBEAT: 'NODE_HEARTBEAT',
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

export interface LogContext {
  node?: number | string;
  service?: string;
  event?: EventType | string;
  requestId?: string;
  lamport?: number;
  txnId?: string;
  peer?: number | string;
  epoch?: number;
  seq?: number;
  [key: string]: unknown;
}

export function createLogger(options?: { service?: string; node?: number | string; level?: string }) {
  const service = options?.service ?? 'unknown';
  const node = options?.node ?? 0;
  const level = options?.level ?? process.env['LOG_LEVEL'] ?? 'info';

  const basePino = pino({
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    base: {
      node,
      service,
    },
  });

  return {
    debug(msg: string, ctx?: LogContext) {
      basePino.debug(ctx ?? {}, msg);
    },
    info(msg: string, ctx?: LogContext) {
      basePino.info(ctx ?? {}, msg);
    },
    warn(msg: string, ctx?: LogContext) {
      basePino.warn(ctx ?? {}, msg);
    },
    error(msg: string, err?: unknown, ctx?: LogContext) {
      const errorObj = err instanceof Error ? { err: { message: err.message, stack: err.stack, name: err.name } } : { err };
      basePino.error({ ...errorObj, ...(ctx ?? {}) }, msg);
    },
    child(bindings: LogContext) {
      return basePino.child(bindings);
    },
    raw: basePino,
  };
}

export type Logger = ReturnType<typeof createLogger>;
