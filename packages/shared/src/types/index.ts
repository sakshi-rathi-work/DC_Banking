/**
 * Branded type for currency in paise (1 INR = 100 paise).
 * Money is always integer paise, never floats.
 */
export type Paise = number & { readonly __brand: 'paise' };

/**
 * Validates and casts an integer number to Paise.
 * Rejects non-integers, numbers <= 0 (if positiveOnly is true), and numbers exceeding Number.MAX_SAFE_INTEGER.
 */
export function toPaise(value: number, positiveOnly = false): Paise {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid paise amount: ${value} is not a finite number`);
  }
  if (!Number.isInteger(value)) {
    throw new Error(`Invalid paise amount: ${value} must be an integer, never a float`);
  }
  if (value > Number.MAX_SAFE_INTEGER || value < -Number.MAX_SAFE_INTEGER) {
    throw new Error(`Invalid paise amount: ${value} exceeds safe integer bounds`);
  }
  if (positiveOnly && value <= 0) {
    throw new Error(`Invalid paise amount: ${value} must be positive`);
  }
  return value as Paise;
}

/**
 * Branded type for Lamport logical clock timestamps.
 */
export type Lamport = number & { readonly __brand: 'lamport' };

export function toLamport(value: number): Lamport {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid Lamport timestamp: ${value}`);
  }
  return value as Lamport;
}

/**
 * Node roles in cluster coordination.
 */
export type Role = 'LEADER' | 'BACKUP' | 'CANDIDATE' | 'NONE';

/**
 * Node lifecycle and fault status.
 */
export type NodeStatus =
  | 'STARTING'
  | 'RECOVERING'
  | 'UP'
  | 'DB_DOWN'
  | 'CRASH_SIM'
  | 'PARTITION_SIM';

/**
 * Election algorithms.
 */
export type ElectionAlgorithm = 'bully' | 'ring';

/**
 * Replication consistency modes.
 */
export type ConsistencyMode = 'strong' | 'eventual';

/**
 * Lab-injected fault modes.
 */
export type FaultMode = 'NONE' | 'CRASH' | 'PARTITION';
