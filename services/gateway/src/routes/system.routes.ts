import { Router, type Request, type Response, type NextFunction } from 'express';
import { ObservabilityGrpcClient } from '../grpc/observability-client.js';

export const systemRouter = Router();

function getNodeAddresses(): Record<number, string> {
  const rawNodes = process.env.GATEWAY_NODES || '1=bank-node-1:50051,2=bank-node-2:50051,3=bank-node-3:50051';
  const nodeAddresses: Record<number, string> = {};
  for (const item of rawNodes.split(',')) {
    const [id, addr] = item.trim().split('=');
    if (id && addr) nodeAddresses[parseInt(id, 10)] = addr;
  }
  return nodeAddresses;
}

// GET /api/system/overview
systemRouter.get('/overview', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const nodeAddresses = getNodeAddresses();
    const nodeResults = await Promise.allSettled(
      Object.entries(nodeAddresses).map(async ([id, addr]) => {
        const status = await ObservabilityGrpcClient.getStatus(addr);
        return { nodeId: parseInt(id, 10), ...(status as object), reachable: true };
      }),
    );

    const nodes = nodeResults.map((r, i) => {
      const nid = i + 1;
      if (r.status === 'fulfilled') return r.value;
      return { nodeId: nid, status: 'UNREACHABLE', reachable: false, role: 'UNKNOWN' };
    });

    const leaderNode = (nodes as any[]).find((n) => n.role === 'LEADER' && n.reachable);
    const { LoadBalancer } = await import('../loadbalancer/load-balancer.js');
    const load = LoadBalancer.getInstance().getMetrics();

    let replication: unknown = null;
    try {
      replication = await ObservabilityGrpcClient.getReplicationState();
    } catch {
      // ignore
    }

    res.json({
      success: true,
      data: {
        clusterSize: Object.keys(nodeAddresses).length,
        nodes,
        leader: leaderNode ? { nodeId: leaderNode.nodeId, epoch: leaderNode.epoch } : null,
        load,
        replication,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/system/nodes
systemRouter.get('/nodes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const nodeId = req.query.node ? parseInt(req.query.node as string, 10) : undefined;
    const nodeAddresses = getNodeAddresses();

    if (nodeId && nodeAddresses[nodeId]) {
      const status = await ObservabilityGrpcClient.getStatus(nodeAddresses[nodeId]);
      res.json({ success: true, data: status });
    } else {
      const results = await Promise.allSettled(
        Object.entries(nodeAddresses).map(async ([id, addr]) => {
          const status = await ObservabilityGrpcClient.getStatus(addr);
          return { nodeId: parseInt(id, 10), ...(status as object), reachable: true };
        }),
      );

      const nodes = results.map((r, i) => {
        const nid = i + 1;
        if (r.status === 'fulfilled') return r.value;
        return { nodeId: nid, status: 'UNREACHABLE', reachable: false, role: 'UNKNOWN' };
      });

      res.json({ success: true, data: nodes });
    }
  } catch (err) {
    next(err);
  }
});

// GET /api/system/leader
systemRouter.get('/leader', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const nodeAddresses = getNodeAddresses();
    for (const [id, addr] of Object.entries(nodeAddresses)) {
      try {
        const status = (await ObservabilityGrpcClient.getStatus(addr)) as any;
        if (status?.role === 'LEADER') {
          return res.json({
            success: true,
            data: {
              nodeId: parseInt(id, 10),
              leaderId: status.leaderId || parseInt(id, 10),
              epoch: status.epoch || 0,
              ready: status.leaderReady ?? true,
            },
          });
        }
      } catch {
        // try next node
      }
    }
    res.json({ success: true, data: { leaderId: 0, epoch: 0, ready: false } });
  } catch (err) {
    next(err);
  }
});

// GET /api/system/elections
systemRouter.get('/elections', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const result = await ObservabilityGrpcClient.getElections(limit);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/system/events
systemRouter.get('/events', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const since = req.query.since ? parseInt(req.query.since as string, 10) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const type = req.query.type as string | undefined;
    const node = req.query.node ? parseInt(req.query.node as string, 10) : undefined;
    const requestId = req.query.requestId as string | undefined;

    const result = await ObservabilityGrpcClient.getEvents({ since, limit, type, node, requestId });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/system/rpc-trace
systemRouter.get('/rpc-trace', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const requestId = req.query.requestId as string | undefined;

    const result = await ObservabilityGrpcClient.getRpcTrace({ limit, requestId });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/system/replication
systemRouter.get('/replication', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const nodeAddresses = getNodeAddresses();
    let leaderAddr: string | undefined;
    for (const addr of Object.values(nodeAddresses)) {
      try {
        const st = (await ObservabilityGrpcClient.getStatus(addr)) as any;
        if (st?.role === 'LEADER') {
          leaderAddr = addr;
          break;
        }
      } catch {
        // ignore
      }
    }
    const state = await ObservabilityGrpcClient.getReplicationState(leaderAddr);
    res.json({ success: true, data: state });
  } catch (err) {
    next(err);
  }
});

// GET /api/system/integrity
systemRouter.get('/integrity', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const nodeAddresses = getNodeAddresses();
    const results = await Promise.allSettled(
      Object.entries(nodeAddresses).map(async ([id, addr]) => {
        const res = (await ObservabilityGrpcClient.getIntegrity(addr)) as any;
        if (res?.nodes && res.nodes.length > 0) {
          return { ...res.nodes[0], nodeId: parseInt(id, 10) };
        }
        return {
          nodeId: parseInt(id, 10),
          lastSeq: 0,
          accountCount: 0,
          txnCount: 0,
          totalBalancePaise: 0,
          accountsChecksum: '',
        };
      }),
    );
    const nodes = results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => (r as PromiseFulfilledResult<any>).value);

    const firstChecksum = nodes[0]?.accountsChecksum;
    const inSync = nodes.length > 0 && nodes.every((n) => n.accountsChecksum === firstChecksum);

    res.json({ success: true, data: { nodes, inSync } });
  } catch (err) {
    next(err);
  }
});

// GET /api/system/load
systemRouter.get('/load', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { LoadBalancer } = await import('../loadbalancer/load-balancer.js');
    const metrics = LoadBalancer.getInstance().getMetrics();
    res.json({ success: true, data: metrics });
  } catch (err) {
    next(err);
  }
});

// GET /api/system/clocks
systemRouter.get('/clocks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const nodeId = req.query.node ? parseInt(req.query.node as string, 10) : undefined;
    const rawNodes = process.env.GATEWAY_NODES || '1=bank-node-1:50051,2=bank-node-2:50051,3=bank-node-3:50051';
    const nodeAddresses: Record<number, string> = {};
    for (const item of rawNodes.split(',')) {
      const [id, addr] = item.trim().split('=');
      if (id && addr) nodeAddresses[parseInt(id, 10)] = addr;
    }

    if (nodeId) {
      const target = nodeAddresses[nodeId];
      const state = await ObservabilityGrpcClient.getClockState(target);
      res.json({ success: true, data: [state] });
    } else {
      const results = await Promise.allSettled(
        Object.entries(nodeAddresses).map(async ([id, addr]) => {
          const state = await ObservabilityGrpcClient.getClockState(addr);
          return { nodeId: parseInt(id, 10), ...(state as object) };
        }),
      );
      const clocks = results
        .filter((r) => r.status === 'fulfilled')
        .map((r) => (r as PromiseFulfilledResult<unknown>).value);
      res.json({ success: true, data: clocks });
    }
  } catch (err) {
    next(err);
  }
});

// GET /api/system/clocks/history
systemRouter.get('/clocks/history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const history = await ObservabilityGrpcClient.getClockHistory(limit);
    res.json({ success: true, data: history });
  } catch (err) {
    next(err);
  }
});
