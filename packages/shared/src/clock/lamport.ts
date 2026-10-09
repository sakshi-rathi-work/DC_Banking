export interface LamportClockOptions {
  initialValue?: number;
}

export class LamportClock {
  private counter: number;

  constructor(options: LamportClockOptions = {}) {
    this.counter = Math.max(0, Math.floor(options.initialValue ?? 0));
  }

  /**
   * Advance the logical clock for a local event.
   * L = L + 1
   */
  public tick(): number {
    this.counter += 1;
    return this.counter;
  }

  /**
   * Advance the logical clock before sending a message.
   * L = L + 1
   */
  public send(): number {
    return this.tick();
  }

  /**
   * Witness an incoming message with a remote Lamport value.
   * L = max(L, remoteL) + 1
   */
  public receive(remoteLamport: number | string | bigint | undefined | null): number {
    const parsed = toLamportNumber(remoteLamport);
    this.counter = Math.max(this.counter, parsed) + 1;
    return this.counter;
  }

  /**
   * Get current clock value without mutating.
   */
  public getValue(): number {
    return this.counter;
  }

  /**
   * Update internal clock to checkpoint value if checkpoint is higher.
   */
  public setCheckpoint(checkpoint: number | string | bigint | undefined | null): number {
    const parsed = toLamportNumber(checkpoint);
    if (parsed > this.counter) {
      this.counter = parsed;
    }
    return this.counter;
  }
}

export function toLamportNumber(val: unknown): number {
  if (val === undefined || val === null) {
    return 0;
  }
  if (typeof val === 'number') {
    return Number.isFinite(val) ? Math.max(0, Math.floor(val)) : 0;
  }
  if (typeof val === 'bigint') {
    return val > 0n ? Number(val) : 0;
  }
  if (typeof val === 'string') {
    const parsed = parseInt(val, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }
  return 0;
}
