import { Router, type RequestHandler } from 'express';
import { validateRequest } from '../middleware/validate.js';
import { createSuccessEnvelope } from '../middleware/envelope.js';
import {
  createAccountSchema,
  lookupAccountSchema,
  getAccountParamsSchema,
  getStatementQuerySchema,
} from './accounts.schema.js';
import { BankGrpcClient } from '../grpc/bank-client.js';

export function createAccountsRouter(requireAuth: RequestHandler): Router {
  const router = Router();
  router.use(requireAuth);

  router.post(
    '/',
    validateRequest({ body: createAccountSchema, requireIdempotencyKey: true }),
    async (req, res, next) => {
      try {
        const { nickname, initialDepositPaise } = req.body;
        const result = await BankGrpcClient.createAccount(
          req.userId!,
          nickname,
          req.idempotencyKey!,
          req.requestId,
        );

        // Auto-deposit initial amount if provided and > 0
        if (initialDepositPaise && initialDepositPaise > 0 && result.id) {
          try {
            await BankGrpcClient.deposit(
              req.userId!,
              result.id,
              initialDepositPaise,
              'Initial deposit',
              `${req.idempotencyKey!}-init-deposit`,
              req.requestId,
            );
            // Refetch updated balance
            const updated = await BankGrpcClient.getAccount(req.userId!, result.id, req.requestId);
            return res.status(201).json(createSuccessEnvelope(updated, req));
          } catch {
            // Initial deposit failed — still return the created account
          }
        }

        res.status(201).json(createSuccessEnvelope(result, req));
      } catch (err) {
        next(err);
      }
    },
  );

  router.get('/', async (req, res, next) => {
    try {
      const result = await BankGrpcClient.listAccounts(req.userId!, req.requestId);
      res.status(200).json(createSuccessEnvelope({ accounts: result.accounts ?? [] }, req));
    } catch (err) {
      next(err);
    }
  });

  router.get('/lookup', validateRequest({ query: lookupAccountSchema }), async (req, res, next) => {
    try {
      const accountNumber = req.query.accountNumber as string;
      const result = await BankGrpcClient.lookupAccount(req.userId!, accountNumber, req.requestId);
      res.status(200).json(createSuccessEnvelope(result, req));
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', validateRequest({ params: getAccountParamsSchema }), async (req, res, next) => {
    try {
      const accountId = req.params.id!;
      const result = await BankGrpcClient.getAccount(req.userId!, accountId, req.requestId);
      res.status(200).json(createSuccessEnvelope(result, req));
    } catch (err) {
      next(err);
    }
  });

  router.get(
    '/:id/statement.csv',
    validateRequest({ params: getAccountParamsSchema, query: getStatementQuerySchema }),
    async (req, res, next) => {
      try {
        const accountId = req.params.id!;
        const fromDate = req.query.fromDate as string | undefined;
        const toDate = req.query.toDate as string | undefined;

        const result = await BankGrpcClient.getStatement(
          req.userId!,
          accountId,
          fromDate,
          toDate,
          req.requestId,
        );

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="statement-${accountId}.csv"`);
        const buffer = Buffer.from(result.csvData);
        res.status(200).send(buffer);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
