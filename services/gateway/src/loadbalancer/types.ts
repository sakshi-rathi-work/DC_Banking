/**
 * Types for the Least-Connections Load Balancer in the REST Gateway.
 * Matches docs/architecture.md §10 and docs/api-reference.md §5.
 */

export interface NodeLoadState {
  nodeId: number;
  address: string;
  healthy: boolean;
  status: 'UP' | 'DOWN' | 'DB_DOWN' | 'RECOVERING' | 'UNKNOWN';
  activeRequests: number;
  totalRequests: number;
  failures: number;
  ewmaLatencyMs: number;
  lastHealthCheckAt: string | null;
  capacity: number; // static soft max, default 50
  consecutiveFailures: number;
}

export interface NodeMetricView {
  nodeId: number;
  healthy: boolean;
  activeRequests: number;
  totalRequests: number;
  sharePct: number;
  ewmaLatencyMs: number;
  failures: number;
  lastCheckAt: string | null;
}

export interface SystemLoadResponse {
  algorithm: 'least-connections';
  nodes: NodeMetricView[];
  retries: number;
  requestsPerMin: number;
}

export interface SyntheticLoadRunResult {
  totalSent: number;
  successful: number;
  failed: number;
  perNodeCounts: Record<number, number>;
  peakActiveRequests: number;
  latencyPercentiles: {
    p50: number;
    p90: number;
    p99: number;
    min: number;
    max: number;
  };
}
