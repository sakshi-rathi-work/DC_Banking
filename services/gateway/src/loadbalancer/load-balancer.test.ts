import { describe, it, expect } from 'vitest';
import { LoadBalancer } from './load-balancer.js';

describe('LoadBalancer Engine', () => {
  it('initializes nodes from GATEWAY_NODES configuration', () => {
    const lb = new LoadBalancer({
      gatewayNodes: '1=127.0.0.1:50051,2=127.0.0.1:50052,3=127.0.0.1:50053',
    });

    const states = lb.getNodeStates();
    expect(states.size).toBe(3);
    expect(states.get(1)?.address).toBe('127.0.0.1:50051');
    expect(states.get(2)?.address).toBe('127.0.0.1:50052');
    expect(states.get(3)?.address).toBe('127.0.0.1:50053');
  });

  it('increments in-flight activeRequests during execution and decrements in finally', async () => {
    const lb = new LoadBalancer({
      gatewayNodes: '1=127.0.0.1:50051',
    });

    let observedActiveInFlight = 0;
    const { result, targetNode } = await lb.execute(async (node) => {
      observedActiveInFlight = node.activeRequests;
      return 'success';
    });

    expect(result).toBe('success');
    expect(targetNode.nodeId).toBe(1);
    expect(observedActiveInFlight).toBe(1);
    expect(targetNode.activeRequests).toBe(0);
    expect(targetNode.totalRequests).toBe(1);
  });

  it('decrements activeRequests even if operation throws an error', async () => {
    const lb = new LoadBalancer({
      gatewayNodes: '1=127.0.0.1:50051',
    });

    await expect(
      lb.execute(async () => {
        throw new Error('Test operation failure');
      }),
    ).rejects.toThrow();

    const node1 = lb.getNode(1);
    expect(node1?.activeRequests).toBe(0);
    expect(node1?.totalRequests).toBe(1);
  });

  it('updates EWMA latency after completed execution', async () => {
    const lb = new LoadBalancer({
      gatewayNodes: '1=127.0.0.1:50051',
    });

    await lb.execute(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return true;
    });

    const node1 = lb.getNode(1);
    expect(node1?.ewmaLatencyMs).toBeGreaterThan(0);
  });

  it('generates system load metrics with valid shares summing to 100%', async () => {
    const lb = new LoadBalancer({
      gatewayNodes: '1=127.0.0.1:50051,2=127.0.0.1:50052',
    });

    // Run 3 requests on node 1, 1 on node 2 manually setting
    const n1 = lb.getNode(1)!;
    const n2 = lb.getNode(2)!;
    n1.totalRequests = 3;
    n2.totalRequests = 1;

    const metrics = lb.getMetrics();
    expect(metrics.algorithm).toBe('least-connections');
    expect(metrics.nodes.length).toBe(2);

    const share1 = metrics.nodes.find((n) => n.nodeId === 1)?.sharePct;
    const share2 = metrics.nodes.find((n) => n.nodeId === 2)?.sharePct;

    expect(share1).toBe(75.0);
    expect(share2).toBe(25.0);
    expect((share1 || 0) + (share2 || 0)).toBe(100.0);
  });

  it('tracks retries count correctly', () => {
    const lb = new LoadBalancer({
      gatewayNodes: '1=127.0.0.1:50051',
    });

    lb.recordRetry();
    lb.recordRetry();
    expect(lb.getMetrics().retries).toBe(2);
  });
});
