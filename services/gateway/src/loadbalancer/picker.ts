import type { NodeLoadState } from './types.js';

/**
 * Pure Least-Connections picker function.
 * Matches docs/architecture.md §10.1 and §10.2:
 *
 * 1. Considers only healthy nodes with status === 'UP' (DB_DOWN excluded per D-DB-1).
 * 2. Capped by soft capacity: skips nodes at capacity unless ALL eligible nodes are at capacity.
 * 3. Chooses the node with the fewest active (in-flight) requests.
 * 4. Ties broken by lowest EWMA latency.
 * 5. Further ties broken by lowest node ID.
 *
 * @param nodes List of node load states.
 * @returns The selected NodeLoadState, or null if no healthy nodes are available.
 */
export function pickLeastConnectionsNode(nodes: readonly NodeLoadState[]): NodeLoadState | null {
  // 1. Filter healthy nodes
  const healthyNodes = nodes.filter((node) => node.healthy && node.status === 'UP');
  if (healthyNodes.length === 0) {
    return null;
  }

  // 2. Capacity filtering: skip at-capacity nodes unless all are at capacity
  const belowCapacityNodes = healthyNodes.filter((node) => node.activeRequests < node.capacity);
  const candidates = belowCapacityNodes.length > 0 ? belowCapacityNodes : healthyNodes;

  // 3. Sort candidates:
  // - activeRequests ascending
  // - ewmaLatencyMs ascending
  // - nodeId ascending
  const sorted = [...candidates].sort((a, b) => {
    if (a.activeRequests !== b.activeRequests) {
      return a.activeRequests - b.activeRequests;
    }
    if (a.ewmaLatencyMs !== b.ewmaLatencyMs) {
      return a.ewmaLatencyMs - b.ewmaLatencyMs;
    }
    return a.nodeId - b.nodeId;
  });

  return sorted[0] ?? null;
}

/**
 * Calculates updated EWMA latency given previous EWMA and newly measured latency.
 * α = 0.2 per docs/architecture.md §10.2.
 */
export function calculateNextEwma(previousEwmaMs: number, sampleLatencyMs: number, alpha = 0.2): number {
  if (previousEwmaMs <= 0) {
    return sampleLatencyMs;
  }
  return Number((alpha * sampleLatencyMs + (1 - alpha) * previousEwmaMs).toFixed(2));
}
