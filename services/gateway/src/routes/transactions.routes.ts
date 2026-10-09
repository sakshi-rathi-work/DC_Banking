import { Router, type RequestHandler } from 'express';
import { validateRequest } from '../middleware/validate.js';
import { createSuccessEnvelope } from '../middleware/envelope.js';
import {
  depositSchema,
  withdrawSchema,
  transferSchema,
  listTransactionsQuerySchema,
  getTransactionParamsSchema,
} from './transactions.schema.js';
import { BankGrpcClient } from '../grpc/bank-client.js';

interface ListTransactionsQuery {
  accountId?: string;
  type?: string;
  status?: string;
  limit?: number;
  cursor?: string;
}

export function createTransactionsRouter(requireAuth: RequestHandler): Router {
  const router = Router();
  router.use(requireAuth);

  router.post(
    '/deposit',
    validateRequest({ body: depositSchema, requireIdempotencyKey: true }),
    async (req, res, next) => {
      try {
        const { accountId, amountPaise, note } = req.body;
        const result = await BankGrpcClient.deposit(
          req.userId!,
          accountId,
          amountPaise,
          note,
          req.idempotencyKey!,
          req.requestId,
        );
        res.status(201).json(createSuccessEnvelope(result.transaction, req, {
          processedBy: result.transaction.processedByNode,
          lamport: result.transaction.lamport,
        }));
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/withdraw',
    validateRequest({ body: withdrawSchema, requireIdempotencyKey: true }),
    async (req, res, next) => {
      try {
        const { accountId, amountPaise, note } = req.body;
        const result = await BankGrpcClient.withdraw(
          req.userId!,
          accountId,
          amountPaise,
          note,
          req.idempotencyKey!,
          req.requestId,
        );
        res.status(201).json(createSuccessEnvelope(result.transaction, req, {
          processedBy: result.transaction.processedByNode,
          lamport: result.transaction.lamport,
        }));
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/transfer',
    validateRequest({ body: transferSchema, requireIdempotencyKey: true }),
    async (req, res, next) => {
      try {
        const { fromAccountId, toAccountNumber, amountPaise, note } = req.body;
        const result = await BankGrpcClient.transfer(
          req.userId!,
          fromAccountId,
          toAccountNumber,
          amountPaise,
          note,
          req.idempotencyKey!,
          req.requestId,
        );
        res.status(201).json(createSuccessEnvelope(result.transaction, req, {
          processedBy: result.transaction.processedByNode,
          lamport: result.transaction.lamport,
        }));
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/',
    validateRequest({ query: listTransactionsQuerySchema }),
    async (req, res, next) => {
      try {
        const query = (req.query as unknown) as ListTransactionsQuery;
        const result = await BankGrpcClient.listTransactions(
          req.userId!,
          {
            accountId: query.accountId,
            type: query.type,
            status: query.status,
            limit: query.limit,
            cursor: query.cursor,
          },
          req.requestId,
        );

        const envelope = createSuccessEnvelope(result.transactions ?? [], req);
        (envelope as Record<string, unknown>).nextCursor = result.nextCursor || null;
        res.status(200).json(envelope);
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/:id',
    validateRequest({ params: getTransactionParamsSchema }),
    async (req, res, next) => {
      try {
        const transactionId = req.params.id!;
        const result = await BankGrpcClient.getTransaction(
          req.userId!,
          transactionId,
          req.requestId,
        );
        res.status(200).json(createSuccessEnvelope(result, req));
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
