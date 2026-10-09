import { describe, it, expect } from 'vitest';
import { pickLeastConnectionsNode, calculateNextEwma } from './picker.js';
import type { NodeLoadState } from './types.js';

function createMockNode(overrides: Partial<NodeLoadState> = {}): NodeLoadState {
  return {
    nodeId: 1,
    address: '127.0.0.1:50051',
    healthy: true,
    status: 'UP',
    activeRequests: 0,
    totalRequests: 0,
    failures: 0,
    ewmaLatencyMs: 10,
    lastHealthCheckAt: null,
    capacity: 50,
    consecutiveFailures: 0,
    ...overrides,
  };
}

describe('Least Connections Picker (U-LB-1)', () => {
  it('picks the node with minimum active requests', () => {
    const nodes = [
      createMockNode({ nodeId: 1, activeRequests: 5 }),
      createMockNode({ nodeId: 2, activeRequests: 2 }),
      createMockNode({ nodeId: 3, activeRequests: 4 }),
    ];

    const picked = pickLeastConnectionsNode(nodes);
    expect(picked).not.toBeNull();
    expect(picked?.nodeId).toBe(2);
  });

  it('breaks ties using lowest EWMA latency', () => {
    const nodes = [
      createMockNode({ nodeId: 1, activeRequests: 2, ewmaLatencyMs: 35 }),
      createMockNode({ nodeId: 2, activeRequests: 2, ewmaLatencyMs: 12 }),
      createMockNode({ nodeId: 3, activeRequests: 2, ewmaLatencyMs: 25 }),
    ];

    const picked = pickLeastConnectionsNode(nodes);
    expect(picked).not.toBeNull();
    expect(picked?.nodeId).toBe(2);
  });

  it('breaks further ties using lowest node ID', () => {
    const nodes = [
      createMockNode({ nodeId: 3, activeRequests: 2, ewmaLatencyMs: 20 }),
      createMockNode({ nodeId: 1, activeRequests: 2, ewmaLatencyMs: 20 }),
      createMockNode({ nodeId: 2, activeRequests: 2, ewmaLatencyMs: 20 }),
    ];

    const picked = pickLeastConnectionsNode(nodes);
    expect(picked).not.toBeNull();
    expect(picked?.nodeId).toBe(1);
  });

  it('excludes unhealthy nodes and non-UP nodes', () => {
    const nodes = [
      createMockNode({ nodeId: 1, healthy: false, status: 'DOWN', activeRequests: 0 }),
      createMockNode({ nodeId: 2, healthy: true, status: 'DB_DOWN', activeRequests: 0 }),
      createMockNode({ nodeId: 3, healthy: true, status: 'UP', activeRequests: 3 }),
    ];

    const picked = pickLeastConnectionsNode(nodes);
    expect(picked).not.toBeNull();
    expect(picked?.nodeId).toBe(3);
  });

  it('returns null when no nodes are healthy', () => {
    const nodes = [
      createMockNode({ nodeId: 1, healthy: false, status: 'DOWN' }),
      createMockNode({ nodeId: 2, healthy: false, status: 'UNKNOWN' }),
    ];

    expect(pickLeastConnectionsNode(nodes)).toBeNull();
  });

  it('skips at-capacity nodes if other below-capacity healthy nodes exist', () => {
    const nodes = [
      createMockNode({ nodeId: 1, activeRequests: 50, capacity: 50 }), // at capacity
      createMockNode({ nodeId: 2, activeRequests: 10, capacity: 50 }), // below capacity
    ];

    const picked = pickLeastConnectionsNode(nodes);
    expect(picked).not.toBeNull();
    expect(picked?.nodeId).toBe(2);
  });

  it('allows at-capacity nodes if ALL healthy nodes are at capacity (overflow allowed)', () => {
    const nodes = [
      createMockNode({ nodeId: 1, activeRequests: 55, capacity: 50, ewmaLatencyMs: 30 }),
      createMockNode({ nodeId: 2, activeRequests: 50, capacity: 50, ewmaLatencyMs: 20 }),
    ];

    const picked = pickLeastConnectionsNode(nodes);
    expect(picked).not.toBeNull();
    expect(picked?.nodeId).toBe(2);
  });

  it('computes EWMA latency correctly with alpha = 0.2', () => {
    // If previous was 0 (first request), new sample becomes ewma
    expect(calculateNextEwma(0, 50, 0.2)).toBe(50);

    // α * sample + (1 - α) * previous
    // 0.2 * 100 + 0.8 * 50 = 20 + 40 = 60
    expect(calculateNextEwma(50, 100, 0.2)).toBe(60);
  });
});
