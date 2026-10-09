/**
 * Software-Simulated Hardware Clock.
 * Matches docs/architecture.md §6.2.
 *
 * All containers share the host kernel clock, so real drift is ≈ 0.
 * Each node wraps the OS clock in a software hardware-clock:
 * hw(t) = realNow(t) + INITIAL_CLOCK_SKEW_MS + CLOCK_DRIFT_PPM * 1e-6 * (realNow(t) - processStart)
 *
 * NOTE: This is the ONLY sanctioned simulation in the system.
 */

export interface SimulatedHwClockConfig {
  initialClockSkewMs?: number;
  clockDriftPpm?: number;
}

export class SimulatedHwClock {
  private initialClockSkewMs: number;
  private clockDriftPpm: number;
  private processStartMs: number;

  constructor(config: SimulatedHwClockConfig = {}) {
    this.initialClockSkewMs = config.initialClockSkewMs ?? 0;
    this.clockDriftPpm = config.clockDriftPpm ?? 0;
    this.processStartMs = Date.now();
  }

  /**
   * Returns current simulated hardware clock time in milliseconds.
   */
  public nowMs(): number {
    const realNow = Date.now();
    const elapsedMs = realNow - this.processStartMs;
    const driftMs = (this.clockDriftPpm * 1e-6) * elapsedMs;
    return realNow + this.initialClockSkewMs + driftMs;
  }

  /**
   * Returns simulated hardware clock in microseconds (for gRPC GetTime).
   */
  public nowUs(): bigint {
    return BigInt(Math.round(this.nowMs() * 1000));
  }

  public getSkewMs(): number {
    return this.initialClockSkewMs;
  }

  public getDriftPpm(): number {
    return this.clockDriftPpm;
  }
}
