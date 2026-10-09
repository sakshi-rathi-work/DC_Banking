import { Router, type Request, type Response, type NextFunction } from 'express';
import { ObservabilityGrpcClient } from '../grpc/observability-client.js';

export const systemRouter = Router();

// GET /api/system/nodes
systemRouter.get('/nodes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = await ObservabilityGrpcClient.getStatus();
    res.json({ success: true, data: status });
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
    const state = await ObservabilityGrpcClient.getReplicationState();
    res.json({ success: true, data: state });
  } catch (err) {
    next(err);
  }
});

// GET /api/system/integrity
systemRouter.get('/integrity', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const integrity = await ObservabilityGrpcClient.getIntegrity();
    res.json({ success: true, data: integrity });
  } catch (err) {
    next(err);
  }
});
