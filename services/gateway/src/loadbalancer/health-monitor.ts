import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '@bank/shared';
import type { NodeLoadState } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = path.resolve(__dirname, '../../../../proto');

const logger = createLogger({ service: 'gateway-lb-health' });

type ServiceConstructor = new (
  target: string,
  credentials: grpc.ChannelCredentials,
) => ObservabilityClientInstance;

interface ObservabilityClientInstance {
  getStatus: (
    req: unknown,
    metadata: grpc.Metadata,
    options: { deadline: number },
    callback: (err: grpc.ServiceError | null, res: unknown) => void,
  ) => void;
  close: () => void;
}

export class HealthMonitor {
  private clients = new Map<number, ObservabilityClientInstance>();
  private timer: NodeJS.Timeout | null = null;
  private intervalMs: number;
  private getNodeStates: () => Map<number, NodeLoadState>;

  constructor(
    getNodeStates: () => Map<number, NodeLoadState>,
    intervalMs = 2000,
  ) {
    this.getNodeStates = getNodeStates;
    this.intervalMs = intervalMs;
  }

  private getClient(nodeId: number, address: string): ObservabilityClientInstance {
    let client = this.clients.get(nodeId);
    if (!client) {
      const packageDef = protoLoader.loadSync(path.join(PROTO_DIR, 'observability.proto'), {
        keepCase: false,
        longs: Number,
        enums: String,
        defaults: true,
        oneofs: true,
        includeDirs: [PROTO_DIR],
      });

      const proto = grpc.loadPackageDefinition(packageDef) as unknown as {
        bank: { v1: { ObservabilityService: ServiceConstructor } };
      };
      client = new proto.bank.v1.ObservabilityService(address, grpc.credentials.createInsecure());
      this.clients.set(nodeId, client);
    }
    return client;
  }

  public start(): void {
    if (this.timer) return;
    // Initial immediate probe
    this.checkAll();
    this.timer = setInterval(() => {
      this.checkAll();
    }, this.intervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const client of this.clients.values()) {
      try {
        client.close();
      } catch {
        // ignore close errors
      }
    }
    this.clients.clear();
  }

  public async checkNode(node: NodeLoadState): Promise<void> {
    const client = this.getClient(node.nodeId, node.address);
    const deadline = Date.now() + 1000; // 1s deadline per docs/architecture.md §10.3

    return new Promise<void>((resolve) => {
      client.getStatus({}, new grpc.Metadata(), { deadline }, (err, res) => {
        const now = new Date().toISOString();
        node.lastHealthCheckAt = now;

        if (err || !res) {
          node.consecutiveFailures++;
          if (node.consecutiveFailures >= 2) {
            node.healthy = false;
            node.status = 'DOWN';
          }
          logger.warn(`Health check failed for Node ${node.nodeId} (${node.consecutiveFailures}/2 failures)`, {
            code: err?.code,
            details: err?.details,
          });
          resolve();
          return;
        }

        const statusRes = res as { status?: string };
        const reportedStatus = (statusRes.status || 'UP').toUpperCase();

        if (reportedStatus === 'UP' || reportedStatus === 'HEALTHY') {
          // Healthy after 1 success with status = UP
          node.consecutiveFailures = 0;
          node.healthy = true;
          node.status = 'UP';
        } else if (reportedStatus === 'DB_DOWN') {
          // Excluded from routing per D-DB-1
          node.consecutiveFailures++;
          node.healthy = false;
          node.status = 'DB_DOWN';
        } else {
          node.consecutiveFailures++;
          if (node.consecutiveFailures >= 2) {
            node.healthy = false;
          }
          node.status = reportedStatus as NodeLoadState['status'];
        }

        resolve();
      });
    });
  }

  public async checkAll(): Promise<void> {
    const nodes = Array.from(this.getNodeStates().values());
    await Promise.all(nodes.map((n) => this.checkNode(n)));
  }

  public recordFailure(nodeId: number): void {
    const node = this.getNodeStates().get(nodeId);
    if (!node) return;

    node.failures++;
    node.consecutiveFailures++;
    if (node.consecutiveFailures >= 2) {
      node.healthy = false;
      node.status = 'DOWN';
    }
  }
}
