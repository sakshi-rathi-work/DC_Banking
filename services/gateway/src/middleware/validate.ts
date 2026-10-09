/* eslint-disable @typescript-eslint/no-namespace */
import type { Request, Response, NextFunction } from 'express';
import { z, type AnyZodObject } from 'zod';
import { AppError } from '@bank/shared';

export interface ValidationSchemas {
  body?: AnyZodObject;
  query?: AnyZodObject;
  params?: AnyZodObject;
  requireIdempotencyKey?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      idempotencyKey?: string;
    }
  }
}

export function validateRequest(schemas: ValidationSchemas) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (schemas.requireIdempotencyKey) {
        const rawKey = req.headers['idempotency-key'];
        const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
        if (!key || key.trim().length < 16 || key.trim().length > 64) {
          throw new AppError(
            'IDEMPOTENCY_KEY_REQUIRED',
            'Idempotency-Key header is required (16-64 characters).',
          );
        }
        req.idempotencyKey = key.trim();
      }

      if (schemas.body) {
        req.body = await schemas.body.parseAsync(req.body);
      }
      if (schemas.query) {
        req.query = await schemas.query.parseAsync(req.query);
      }
      if (schemas.params) {
        req.params = await schemas.params.parseAsync(req.params);
      }

      next();
    } catch (err) {
      if (err instanceof AppError) {
        return next(err);
      }
      if (err instanceof z.ZodError) {
        const issues = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
        return next(
          new AppError('VALIDATION_ERROR', `Validation error: ${issues}`, {
            details: err.format(),
          }),
        );
      }
      next(err);
    }
  };
}
