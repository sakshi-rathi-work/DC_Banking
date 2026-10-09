import { monitorEventLoopDelay } from 'node:perf_hooks';

class EventLoopLagMonitor {
  private histogram = monitorEventLoopDelay({ resolution: 10 });
  private running = false;

  start(): void {
    if (!this.running) {
      this.histogram.enable();
      this.running = true;
    }
  }

  stop(): void {
    if (this.running) {
      this.histogram.disable();
      this.running = false;
    }
  }

  /** Returns p99 event loop lag in ms */
  getP99Ms(): number {
    return this.histogram.percentile(99) / 1e6; // nanoseconds -> ms
  }

  /** Returns p50 event loop lag in ms */
  getP50Ms(): number {
    return this.histogram.percentile(50) / 1e6;
  }

  /** Returns mean lag in ms */
  getMeanMs(): number {
    return this.histogram.mean / 1e6;
  }

  /** Returns max lag in ms */
  getMaxMs(): number {
    return this.histogram.max / 1e6;
  }

  reset(): void {
    this.histogram.reset();
  }

  getStats(): { p50Ms: number; p99Ms: number; meanMs: number; maxMs: number } {
    return {
      p50Ms: this.getP50Ms(),
      p99Ms: this.getP99Ms(),
      meanMs: this.getMeanMs(),
      maxMs: this.getMaxMs(),
    };
  }
}

// Singleton
export const lagMonitor = new EventLoopLagMonitor();
