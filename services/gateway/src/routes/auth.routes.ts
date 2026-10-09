import { Router, type RequestHandler } from 'express';
import { validateRequest } from '../middleware/validate.js';
import { authRateLimiter } from '../middleware/rate-limit.js';
import { createSuccessEnvelope } from '../middleware/envelope.js';
import { registerSchema, loginSchema } from './auth.schema.js';
import { BankGrpcClient } from '../grpc/bank-client.js';

export function createAuthRouter(requireAuth: RequestHandler): Router {
  const router = Router();

  router.post(
    '/register',
    authRateLimiter,
    validateRequest({ body: registerSchema }),
    async (req, res, next) => {
      try {
        const { name, email, password } = req.body;
        const result = await BankGrpcClient.register(name, email, password);
        res.status(201).json(createSuccessEnvelope(result, req));
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/login',
    authRateLimiter,
    validateRequest({ body: loginSchema }),
    async (req, res, next) => {
      try {
        const { email, password } = req.body;
        const result = await BankGrpcClient.login(email, password);
        res.status(200).json(createSuccessEnvelope(result, req));
      } catch (err) {
        next(err);
      }
    },
  );

  router.get('/me', requireAuth, async (req, res, next) => {
    try {
      const user = await BankGrpcClient.getMe(req.userId!, req.requestId);
      res.status(200).json(createSuccessEnvelope(user, req));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
