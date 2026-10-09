import { performance } from 'node:perf_hooks';
import { AppError, createLogger } from '@bank/shared';
import { pickLeastConnectionsNode, calculateNextEwma } from './picker.js';
import { HealthMonitor } from './health-monitor.js';
import type { NodeLoadState, SystemLoadResponse, NodeMetricView } from './types.js';

const logger = createLogger({ service: 'gateway-load-balancer' });

export interface LoadBalancerOptions {
  gatewayNodes?: string;
  healthIntervalMs?: number;
  capacity?: number;
}

export class LoadBalancer {
  private nodeStates = new Map<number, NodeLoadState>();
  private healthMonitor: HealthMonitor;
  private totalRetries = 0;
  private recentRequestTimestamps: number[] = [];
  private static instance: LoadBalancer | null = null;

  constructor(opts: LoadBalancerOptions = {}) {
    const rawNodes = opts.gatewayNodes || process.env.GATEWAY_NODES || '1=bank-node-1:50051,2=bank-node-2:50051,3=bank-node-3:50051';
    const capacity = opts.capacity ?? 50;

    // Parse GATEWAY_NODES format: "1=bank-node-1:50051,2=bank-node-2:50051,3=bank-node-3:50051"
    for (const item of rawNodes.split(',')) {
      const trimmed = item.trim();
      if (!trimmed) continue;
      const [idStr, address] = trimmed.split('=');
      if (idStr && address) {
        const nodeId = parseInt(idStr, 10);
        this.nodeStates.set(nodeId, {
          nodeId,
          address,
          healthy: true, // assume healthy until health check runs
          status: 'UP',
          activeRequests: 0,
          totalRequests: 0,
          failures: 0,
          ewmaLatencyMs: 0,
          lastHealthCheckAt: null,
          capacity,
          consecutiveFailures: 0,
        });
      }
    }

    this.healthMonitor = new HealthMonitor(
      () => this.nodeStates,
      opts.healthIntervalMs ?? 2000,
    );
  }

  public static getInstance(opts?: LoadBalancerOptions): LoadBalancer {
    if (!LoadBalancer.instance) {
      LoadBalancer.instance = new LoadBalancer(opts);
    }
    return LoadBalancer.instance;
  }

  public start(): void {
    logger.info(`Starting LoadBalancer with ${this.nodeStates.size} nodes`);
    this.healthMonitor.start();
  }

  public stop(): void {
    this.healthMonitor.stop();
  }

  public getNodeStates(): Map<number, NodeLoadState> {
    return this.nodeStates;
  }

  public getNode(nodeId: number): NodeLoadState | undefined {
    return this.nodeStates.get(nodeId);
  }

  public recordRetry(): void {
    this.totalRetries++;
  }

  /**
   * Dispatches a request using Least Connections with health checking,
   * active request counting, and EWMA latency tracking.
   */
  public async execute<T>(
    operation: (target: NodeLoadState) => Promise<T>,
  ): Promise<{ result: T; targetNode: NodeLoadState }> {
    const allNodes = Array.from(this.nodeStates.values());
    const selected = pickLeastConnectionsNode(allNodes);

    if (!selected) {
      throw new AppError('NODE_UNAVAILABLE', 'No healthy bank nodes available in cluster');
    }

    selected.activeRequests++;
    selected.totalRequests++;
    const startMs = performance.now();

    try {
      const result = await operation(selected);
      return { result, targetNode: selected };
    } catch (err: unknown) {
      const appErr = err instanceof AppError ? err : AppError.fromGrpcError(err as { code?: number; details?: string });
      if (['NODE_UNAVAILABLE', 'DEADLINE_EXCEEDED'].includes(appErr.code)) {
        this.healthMonitor.recordFailure(selected.nodeId);
      }
      throw appErr;
    } finally {
      selected.activeRequests = Math.max(0, selected.activeRequests - 1);
      const elapsedMs = performance.now() - startMs;
      selected.ewmaLatencyMs = calculateNextEwma(selected.ewmaLatencyMs, elapsedMs, 0.2);

      // Record for requests-per-minute metric
      const now = Date.now();
      this.recentRequestTimestamps.push(now);
      this.cleanOldTimestamps(now);
    }
  }

  private cleanOldTimestamps(now: number): void {
    const cutoff = now - 60000;
    while (this.recentRequestTimestamps.length > 0 && (this.recentRequestTimestamps[0] ?? 0) < cutoff) {
      this.recentRequestTimestamps.shift();
    }
  }

  /**
   * Generates live load metrics matching docs/api-reference.md §5 shape:
   * GET /api/system/load
   */
  public getMetrics(): SystemLoadResponse {
    const now = Date.now();
    this.cleanOldTimestamps(now);

    const nodes = Array.from(this.nodeStates.values());
    const totalRequestsAll = nodes.reduce((sum, n) => sum + n.totalRequests, 0);

    const nodeMetrics: NodeMetricView[] = nodes.map((node) => {
      const sharePct = totalRequestsAll > 0
        ? Number(((node.totalRequests / totalRequestsAll) * 100).toFixed(1))
        : 0;

      return {
        nodeId: node.nodeId,
        healthy: node.healthy,
        activeRequests: node.activeRequests,
        totalRequests: node.totalRequests,
        sharePct,
        ewmaLatencyMs: Number(node.ewmaLatencyMs.toFixed(1)),
        failures: node.failures,
        lastCheckAt: node.lastHealthCheckAt,
      };
    });

    return {
      algorithm: 'least-connections',
      nodes: nodeMetrics,
      retries: this.totalRetries,
      requestsPerMin: this.recentRequestTimestamps.length,
    };
  }
}
