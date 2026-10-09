import { performance } from 'node:perf_hooks';

let nodeArtificialLatencyMs = 0;

/**
 * Simulates CPU/I-O work for a given duration.
 * @param durationMs Milliseconds to simulate work.
 * @returns Actual elapsed milliseconds measured via performance.now().
 */
export async function simulateWork(durationMs: number): Promise<number> {
  const start = performance.now();
  const targetMs = Math.max(0, durationMs) + nodeArtificialLatencyMs;

  if (targetMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, targetMs));
  }

  return Number((performance.now() - start).toFixed(2));
}

/**
 * Configure artificial latency injected into handlers on this node.
 * Used by PUT /api/lab/nodes/:id/latency to make a node slow in load balancing experiments.
 */
export function setArtificialLatency(ms: number): void {
  nodeArtificialLatencyMs = Math.max(0, ms);
}

export function getArtificialLatency(): number {
  return nodeArtificialLatencyMs;
}

/**
 * Injects configured artificial latency if greater than zero.
 */
export async function applyArtificialLatency(): Promise<void> {
  if (nodeArtificialLatencyMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, nodeArtificialLatencyMs));
  }
}
