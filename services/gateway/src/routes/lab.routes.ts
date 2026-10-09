import { Router, type Request, type Response, type NextFunction } from 'express';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { AppError } from '@bank/shared';
import { LoadBalancer } from '../loadbalancer/load-balancer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = path.resolve(__dirname, '../../../../proto');

type ServiceConstructor = new (
  target: string,
  credentials: grpc.ChannelCredentials,
) => LabClientInstance;

interface LabClientInstance {
  triggerElection: (req: unknown, callback: (err: grpc.ServiceError | null, res: unknown) => void) => void;
  setConfig: (req: unknown, callback: (err: grpc.ServiceError | null, res: unknown) => void) => void;
  setFaultMode: (req: unknown, callback: (err: grpc.ServiceError | null, res: unknown) => void) => void;
  simulateWork: (req: unknown, callback: (err: grpc.ServiceError | null, res: unknown) => void) => void;
  triggerClockSync: (req: unknown, callback: (err: grpc.ServiceError | null, res: unknown) => void) => void;
  peerPing: (req: unknown, callback: (err: grpc.ServiceError | null, res: unknown) => void) => void;
  close: () => void;
}

const labClients = new Map<string, LabClientInstance>();

function getNodeAddress(nodeId: number): string {
  const lbNode = LoadBalancer.getInstance().getNode(nodeId);
  if (lbNode) return lbNode.address;
  const rawNodes = process.env.GATEWAY_NODES || '1=bank-node-1:50051,2=bank-node-2:50051,3=bank-node-3:50051';
  for (const item of rawNodes.split(',')) {
    const [id, addr] = item.trim().split('=');
    if (parseInt(id || '', 10) === nodeId && addr) return addr;
  }
  return `127.0.0.1:${50050 + nodeId}`;
}

function getLabClient(target = '127.0.0.1:50051'): LabClientInstance {
  let client = labClients.get(target);
  if (!client) {
    const packageDef = protoLoader.loadSync(path.join(PROTO_DIR, 'lab.proto'), {
      keepCase: false,
      longs: Number,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [PROTO_DIR],
    });

    const proto = grpc.loadPackageDefinition(packageDef) as unknown as {
      bank: { v1: { LabService: ServiceConstructor } };
    };
    const LabService = proto.bank.v1.LabService;
    client = new LabService(target, grpc.credentials.createInsecure());
    labClients.set(target, client);
  }
  return client;
}

export const labRouter = Router();

// POST /api/lab/election/bully
labRouter.post('/election/bully', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const initiatorNodeId = req.body?.initiatorNodeId ? parseInt(req.body.initiatorNodeId, 10) : 1;
    const target = getNodeAddress(initiatorNodeId);
    const client = getLabClient(target);
    client.triggerElection({ algorithm: 'bully', initiatorNodeId }, (err, response) => {
      if (err) return next(AppError.fromGrpcError(err));
      res.json({ success: true, data: response });
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/lab/election/ring
labRouter.post('/election/ring', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const initiatorNodeId = req.body?.initiatorNodeId ? parseInt(req.body.initiatorNodeId, 10) : 1;
    const target = getNodeAddress(initiatorNodeId);
    const client = getLabClient(target);
    client.triggerElection({ algorithm: 'ring', initiatorNodeId }, (err, response) => {
      if (err) return next(AppError.fromGrpcError(err));
      res.json({ success: true, data: response });
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/lab/config/election-algorithm
labRouter.put('/config/election-algorithm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { algorithm } = req.body || {};
    if (!algorithm || !['bully', 'ring'].includes(String(algorithm).toLowerCase())) {
      throw new AppError('VALIDATION_ERROR', 'algorithm must be bully or ring');
    }

    const client = getLabClient();
    client.setConfig({ electionAlgorithm: String(algorithm).toLowerCase() }, (err) => {
      if (err) return next(AppError.fromGrpcError(err));
      res.json({ success: true, message: `Election algorithm set to ${algorithm}` });
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/lab/config/consistency-mode
labRouter.put('/config/consistency-mode', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mode } = req.body || {};
    if (!mode || !['strong', 'eventual'].includes(String(mode).toLowerCase())) {
      throw new AppError('VALIDATION_ERROR', 'mode must be strong or eventual');
    }

    const targets = [1, 2, 3].map((nid) => getNodeAddress(nid));
    await Promise.allSettled(
      targets.map((addr) => {
        return new Promise<void>((resolve) => {
          getLabClient(addr).setConfig({ consistencyMode: String(mode).toLowerCase() }, () => resolve());
        });
      }),
    );
    res.json({ success: true, message: `Consistency mode set to ${mode}` });
  } catch (err) {
    next(err);
  }
});

// PUT /api/lab/nodes/:id/replication-delay
labRouter.put('/nodes/:id/replication-delay', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const nodeId = parseInt(req.params.id || '1', 10);
    const delayMs = parseInt(req.body?.delayMs || '0', 10);
    const target = getNodeAddress(nodeId);

    const targetsToUpdate = Array.from(new Set([target, getNodeAddress(1)]));
    await Promise.allSettled(
      targetsToUpdate.map((addr) => {
        return new Promise<void>((resolve) => {
          getLabClient(addr).setConfig({ replicationDelayMs: delayMs }, () => resolve());
        });
      }),
    );
    res.json({ success: true, message: `Replication delay set to ${delayMs}ms on Node ${nodeId}` });
  } catch (err) {
    next(err);
  }
});

// PUT /api/lab/nodes/:id/latency
labRouter.put('/nodes/:id/latency', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const nodeId = parseInt(req.params.id || '1', 10);
    const latencyMs = parseInt(String(req.body?.latencyMs ?? 0), 10);
    if (isNaN(latencyMs) || latencyMs < 0 || latencyMs > 5000) {
      throw new AppError('VALIDATION_ERROR', 'latencyMs must be between 0 and 5000');
    }

    const target = getNodeAddress(nodeId);
    const client = getLabClient(target);

    client.setConfig({ artificialLatencyMs: latencyMs }, (err) => {
      if (err) return next(AppError.fromGrpcError(err));
      res.json({
        success: true,
        data: {
          applied: true,
          node: nodeId,
          latencyMs,
        },
      });
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/lab/nodes/:id/fault
labRouter.post('/nodes/:id/fault', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const nodeId = parseInt(req.params.id || '1', 10);
    const { mode } = req.body || {};
    const validModes = ['NONE', 'CRASH', 'PARTITION'];
    const selectedMode = String(mode || 'NONE').toUpperCase();

    if (!validModes.includes(selectedMode)) {
      throw new AppError('VALIDATION_ERROR', 'mode must be NONE, CRASH, or PARTITION');
    }

    const target = getNodeAddress(nodeId);
    const client = getLabClient(target);
    client.setFaultMode({ mode: selectedMode }, (err) => {
      if (err) return next(AppError.fromGrpcError(err));
      res.json({ success: true, data: { applied: true, node: nodeId, mode: selectedMode } });
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/lab/load/run
labRouter.post('/load/run', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const count = parseInt(String(req.body?.count ?? 100), 10);
    const concurrency = parseInt(String(req.body?.concurrency ?? 20), 10);
    const workMs = parseInt(String(req.body?.workMs ?? 150), 10);

    const lb = LoadBalancer.getInstance();
    const latencies: number[] = [];
    const perNodeCounts: Record<number, number> = {};
    let peakActiveRequests = 0;
    let successful = 0;
    let failed = 0;

    let inFlight = 0;
    let index = 0;

    const worker = async () => {
      while (index < count) {
        index++;
        inFlight++;
        if (inFlight > peakActiveRequests) {
          peakActiveRequests = inFlight;
        }

        const t0 = performance.now();
        try {
          const { result, targetNode } = await lb.execute(async (node) => {
            const client = getLabClient(node.address);
            return new Promise<{ nodeId: number; actualMs: number }>((resolve, reject) => {
              client.simulateWork({ workMs }, (err, reply) => {
                if (err) return reject(AppError.fromGrpcError(err));
                resolve(reply as { nodeId: number; actualMs: number });
              });
            });
          });

          const dur = performance.now() - t0;
          latencies.push(dur);
          successful++;
          const nid = result.nodeId || targetNode.nodeId;
          perNodeCounts[nid] = (perNodeCounts[nid] || 0) + 1;
        } catch {
          failed++;
        } finally {
          inFlight--;
        }
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, count) }, () => worker());
    await Promise.all(workers);

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
    const p90 = latencies[Math.floor(latencies.length * 0.9)] ?? 0;
    const p99 = latencies[Math.floor(latencies.length * 0.99)] ?? 0;
    const min = latencies[0] ?? 0;
    const max = latencies[latencies.length - 1] ?? 0;

    res.json({
      success: true,
      data: {
        totalSent: count,
        successful,
        failed,
        perNodeCounts,
        peakActiveRequests,
        latencyPercentiles: {
          p50: Number(p50.toFixed(2)),
          p90: Number(p90.toFixed(2)),
          p99: Number(p99.toFixed(2)),
          min: Number(min.toFixed(2)),
          max: Number(max.toFixed(2)),
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/lab/clock/synchronize
labRouter.post('/clock/synchronize', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const nodeId = req.body?.masterNodeId ? parseInt(req.body.masterNodeId, 10) : 1;
    const target = getNodeAddress(nodeId);
    const client = getLabClient(target);
    client.triggerClockSync({}, (err, response) => {
      if (err) return next(AppError.fromGrpcError(err));
      res.json({ success: true, data: response });
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/lab/rpc/trace-call
labRouter.post('/rpc/trace-call', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fromNodeId = parseInt(String(req.body?.fromNodeId ?? 1), 10);
    const toNodeId = parseInt(String(req.body?.toNodeId ?? 3), 10);
    const target = getNodeAddress(fromNodeId);
    const client = getLabClient(target);

    const t0 = performance.now();
    client.peerPing({ targetNodeId: toNodeId }, (err, response: any) => {
      if (err) return next(AppError.fromGrpcError(err));
      const totalMs = Number((performance.now() - t0).toFixed(2));

      const rawHops = response?.hops || [];
      const hops = [
        {
          from: 0,
          to: fromNodeId,
          method: 'PeerPing',
          lamportSend: 0,
          lamportRecv: 0,
          latencyMs: totalMs,
        },
        ...rawHops.map((h: any) => ({
          from: h.fromNode ?? h.from_node,
          to: h.toNode ?? h.to_node,
          method: h.method || 'Ping',
          lamportSend: Number(h.lamportSend ?? h.lamport_send ?? 0),
          lamportRecv: Number(h.lamportRecv ?? h.lamport_recv ?? 0),
          latencyMs: Number(h.latencyMs ?? h.latency_ms ?? 0),
        })),
      ];

      res.json({
        success: true,
        data: {
          requestId: (req as any).id || (req.headers['x-request-id'] as string) || undefined,
          fromNodeId,
          toNodeId,
          totalLatencyMs: totalMs,
          hops,
        },
      });
    });
  } catch (err) {
    next(err);
  }
});
