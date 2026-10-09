import { Router, type Request, type Response, type NextFunction } from 'express';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '@bank/shared';

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
  close: () => void;
}

let labClientInstance: LabClientInstance | null = null;

function getLabClient(target = '127.0.0.1:50051'): LabClientInstance {
  if (!labClientInstance) {
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
    labClientInstance = new LabService(target, grpc.credentials.createInsecure());
  }
  return labClientInstance;
}

export const labRouter = Router();

// POST /api/lab/election/bully
labRouter.post('/election/bully', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const client = getLabClient();
    client.triggerElection({ algorithm: 'bully' }, (err, response) => {
      if (err) return next(AppError.fromGrpcError(err));
      res.json({ success: true, data: response });
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/lab/election/ring
labRouter.post('/election/ring', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const client = getLabClient();
    client.triggerElection({ algorithm: 'ring' }, (err, response) => {
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

    const client = getLabClient();
    client.setConfig({ consistencyMode: String(mode).toLowerCase() }, (err) => {
      if (err) return next(AppError.fromGrpcError(err));
      res.json({ success: true, message: `Consistency mode set to ${mode}` });
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/lab/nodes/:id/replication-delay
labRouter.put('/nodes/:id/replication-delay', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const delayMs = parseInt(req.body?.delayMs || '0', 10);
    const client = getLabClient();
    client.setConfig({ replicationDelayMs: delayMs }, (err) => {
      if (err) return next(AppError.fromGrpcError(err));
      res.json({ success: true, message: `Replication delay set to ${delayMs}ms` });
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/lab/nodes/:id/fault
labRouter.post('/nodes/:id/fault', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mode } = req.body || {};
    const validModes = ['NONE', 'CRASH', 'PARTITION'];
    const selectedMode = String(mode || 'NONE').toUpperCase();

    if (!validModes.includes(selectedMode)) {
      throw new AppError('VALIDATION_ERROR', 'mode must be NONE, CRASH, or PARTITION');
    }

    const client = getLabClient();
    client.setFaultMode({ mode: selectedMode }, (err) => {
      if (err) return next(AppError.fromGrpcError(err));
      res.json({ success: true, message: `Node fault mode set to ${selectedMode}` });
    });
  } catch (err) {
    next(err);
  }
});
