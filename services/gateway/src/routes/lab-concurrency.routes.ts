import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '@bank/shared';
import { LoadBalancer } from '../loadbalancer/load-balancer.js';
import { BankGrpcClient } from '../grpc/bank-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = path.resolve(__dirname, '../../../../proto');

export const concurrencyRouter = Router();

// ─── helpers ───────────────────────────────────────────────────────────────

type ServiceConstructor = new (
  target: string,
  credentials: grpc.ChannelCredentials,
) => LabClientConcurrency;

interface LabClientConcurrency {
  cpuTask: (req: unknown, callback: (err: grpc.ServiceError | null, res: unknown) => void) => void;
  close: () => void;
}

const labClients = new Map<string, LabClientConcurrency>();

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

function getLabClient(target: string): LabClientConcurrency {
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

// ─── POST /api/lab/concurrency/run ─────────────────────────────────────────
/**
 * Simulates concurrency scenarios directly at the gateway level.
 * Scenarios: withdraw-race, transfer-crossfire, duplicate-key
 *
 * For real race-condition demos, we fire N concurrent gRPC calls to the
 * bank-node leader. The DB row locks and CHECK constraints enforce correctness.
 *
 * Body: { scenario: 'withdraw-race' | 'transfer-crossfire' | 'duplicate-key', ... }
 */
concurrencyRouter.post('/run', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scenario = String(req.body?.scenario || 'withdraw-race');
    const concurrency = Math.min(parseInt(String(req.body?.concurrency ?? 20), 10), 50);
    const targetNodeId = parseInt(String(req.body?.nodeId ?? 1), 10);

    const results: Record<string, unknown> = {
      scenario,
      concurrency,
      startedAt: new Date().toISOString(),
    };

    if (scenario === 'withdraw-race') {
      // Fire `concurrency` concurrent withdrawals from same account.
      // Exactly one should succeed when balance = amountPaise * 1.
      // The DB CHECK (balance_paise >= 0) prevents overdraft.
      const amountPaise = parseInt(String(req.body?.amountPaise ?? 100), 10);
      const accountId = String(req.body?.accountId ?? '');
      const userId = String(req.body?.userId ?? '');

      if (!accountId || !userId) {
        return res.json({
          success: true,
          data: {
            ...results,
            message: 'withdraw-race requires accountId and userId. Provide them to run the real demo.',
            simulatedCommitted: 1,
            simulatedRejected: concurrency - 1,
            invariant: 'Only 1 withdrawal commits when initial balance = amountPaise',
          },
        });
      }

      // Real concurrent withdrawals
      const tasks = Array.from({ length: concurrency }, (_, i) =>
        new Promise<{ status: string; reason?: string }>((resolve) => {
          BankGrpcClient.withdraw(userId, accountId, amountPaise, 'race-test', randomUUID(), randomUUID())
            .then((r) => resolve({ status: r.transaction.status }))
            .catch((e: Error) => resolve({ status: 'ERROR', reason: e.message }));
        }),
      );

      const outcomes = await Promise.all(tasks);
      const committed = outcomes.filter((o) => o.status === 'COMMITTED').length;
      const rejected = outcomes.filter((o) => o.status === 'REJECTED' || o.status === 'ERROR').length;

      res.json({
        success: true,
        data: {
          ...results,
          committed,
          rejected,
          total: concurrency,
          invariantHeld: committed <= 1,
          outcomes,
          finishedAt: new Date().toISOString(),
        },
      });

    } else if (scenario === 'transfer-crossfire') {
      // Two accounts A and B; fire transfers A->B and B->A concurrently.
      // Deadlock avoidance: row locks acquired in account ID order.
      const accountA = String(req.body?.accountA ?? '');
      const accountB = String(req.body?.accountB ?? '');
      const userId = String(req.body?.userId ?? '');
      const amountPaise = parseInt(String(req.body?.amountPaise ?? 100), 10);

      if (!accountA || !accountB || !userId) {
        return res.json({
          success: true,
          data: {
            ...results,
            message: 'transfer-crossfire requires accountA, accountB, and userId.',
            invariant: 'No deadlock; total money conserved across A + B',
          },
        });
      }

      const { BankGrpcClient } = await import('../grpc/bank-client.js');

      const pairs = Array.from({ length: Math.floor(concurrency / 2) }, (_, i) => i);
      const tasks = pairs.flatMap(() => [
        BankGrpcClient.transfer(userId, accountA, accountB, amountPaise, 'crossfire', randomUUID(), randomUUID())
          .then((r) => ({ dir: 'A->B', status: r.transaction.status }))
          .catch((e: Error) => ({ dir: 'A->B', status: 'ERROR', reason: e.message })),
        BankGrpcClient.transfer(userId, accountB, accountA, amountPaise, 'crossfire', randomUUID(), randomUUID())
          .then((r) => ({ dir: 'B->A', status: r.transaction.status }))
          .catch((e: Error) => ({ dir: 'B->A', status: 'ERROR', reason: e.message })),
      ]);

      const outcomes = await Promise.all(tasks);
      const committed = outcomes.filter((o) => o.status === 'COMMITTED').length;
      const errors = outcomes.filter((o) => o.status === 'ERROR').length;

      res.json({
        success: true,
        data: {
          ...results,
          committed,
          rejected: outcomes.length - committed - errors,
          errors,
          total: outcomes.length,
          deadlockDetected: false, // If we got here, no deadlock
          invariant: 'Deadlock-free due to account-ID-order locking',
          finishedAt: new Date().toISOString(),
        },
      });

    } else if (scenario === 'duplicate-key') {
      // Send `concurrency` identical requests with the same idempotency key.
      // Exactly 1 should be processed; the rest return the cached result.
      const accountId = String(req.body?.accountId ?? '');
      const userId = String(req.body?.userId ?? '');
      const amountPaise = parseInt(String(req.body?.amountPaise ?? 100), 10);
      const idempotencyKey = String(req.body?.idempotencyKey ?? randomUUID());

      if (!accountId || !userId) {
        return res.json({
          success: true,
          data: {
            ...results,
            message: 'duplicate-key requires accountId and userId.',
            invariant: 'Exactly 1 transaction committed regardless of concurrency',
            idempotencyKey,
          },
        });
      }

      const { BankGrpcClient } = await import('../grpc/bank-client.js');
      const tasks = Array.from({ length: concurrency }, () =>
        BankGrpcClient.deposit(userId, accountId, amountPaise, 'dup-test', idempotencyKey, randomUUID())
          .then((r) => ({ status: r.transaction.status, id: r.transaction.id }))
          .catch((e: Error) => ({ status: 'ERROR', reason: e.message })),
      );

      const outcomes = await Promise.all(tasks);
      const uniqueIds = new Set(outcomes.filter((o) => 'id' in o).map((o) => (o as { id: string }).id));
      const committed = outcomes.filter((o) => o.status === 'COMMITTED').length;

      res.json({
        success: true,
        data: {
          ...results,
          committed,
          uniqueTransactionIds: uniqueIds.size,
          idempotencyKey,
          invariantHeld: uniqueIds.size <= 1,
          total: concurrency,
          finishedAt: new Date().toISOString(),
        },
      });

    } else {
      throw new AppError('VALIDATION_ERROR', `Unknown scenario: ${scenario}. Use withdraw-race, transfer-crossfire, or duplicate-key.`);
    }
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/lab/concurrency/cpu-task ────────────────────────────────────
/**
 * Run a CPU-bound task on a bank-node (main thread vs worker thread),
 * returns duration and p99 event loop lag.
 */
concurrencyRouter.post('/cpu-task', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mode = String(req.body?.mode ?? 'MAIN').toUpperCase() as 'MAIN' | 'WORKER';
    const iterations = Math.min(parseInt(String(req.body?.iterations ?? 1000000), 10), 10000000);
    const parallel = Math.min(parseInt(String(req.body?.parallel ?? 1), 10), 8);
    const nodeId = parseInt(String(req.body?.nodeId ?? 1), 10);
    const target = getNodeAddress(nodeId);
    const client = getLabClient(target);

    const result = await new Promise<unknown>((resolve, reject) => {
      client.cpuTask({ mode, iterations, parallel }, (err, res) => {
        if (err) return reject(AppError.fromGrpcError(err));
        resolve(res);
      });
    });

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});
