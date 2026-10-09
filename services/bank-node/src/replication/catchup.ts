import type pg from 'pg';
import { LogStore } from './log-store.js';
import type { LogEntryPayload } from './types.js';

export class CatchupService {
  private pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  public async getLogEntries(
    fromSeq: number,
    maxEntries = 100,
  ): Promise<{ entries: LogEntryPayload[]; lastSeq: number }> {
    return LogStore.getLogEntries(this.pool, fromSeq, maxEntries);
  }
}
