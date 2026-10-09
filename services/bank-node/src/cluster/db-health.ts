import type pg from 'pg';
import { createLogger } from '@bank/shared';

const logger = createLogger({ service: 'db-health' });

export class DbHealthMonitor {
  private pool: pg.Pool;
  private intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private consecutiveFailures = 0;
  private isDbDown = false;
  private onDbStatusChange?: (isDown: boolean) => void;

  constructor(pool: pg.Pool, intervalMs = 1000, onDbStatusChange?: (isDown: boolean) => void) {
    this.pool = pool;
    this.intervalMs = intervalMs;
    this.onDbStatusChange = onDbStatusChange;
  }

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(async () => {
      try {
        await this.pool.query('SELECT 1');
        if (this.consecutiveFailures > 0) {
          logger.info('Database connection recovered');
        }
        this.consecutiveFailures = 0;
        if (this.isDbDown) {
          this.isDbDown = false;
          if (this.onDbStatusChange) this.onDbStatusChange(false);
        }
      } catch (err) {
        this.consecutiveFailures++;
        logger.warn(`Database health check failed (${this.consecutiveFailures}/2)`, { err });
        if (this.consecutiveFailures >= 2 && !this.isDbDown) {
          this.isDbDown = true;
          logger.error('Database marked DB_DOWN after 2 consecutive health check failures');
          if (this.onDbStatusChange) this.onDbStatusChange(true);
        }
      }
    }, this.intervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public isDown(): boolean {
    return this.isDbDown;
  }
}
