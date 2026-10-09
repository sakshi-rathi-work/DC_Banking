/* eslint-disable @typescript-eslint/no-namespace */
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '@bank/shared';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
    }
  }
}

export function createAuthMiddleware(jwtSecret: string) {
  return function requireAuth(req: Request, _res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(new AppError('UNAUTHENTICATED', 'Authentication token is required.'));
    }

    const token = authHeader.substring(7).trim();
    try {
      const decoded = jwt.verify(token, jwtSecret) as { sub?: string; email?: string };
      if (!decoded.sub) {
        return next(new AppError('UNAUTHENTICATED', 'Invalid authentication token.'));
      }

      req.userId = decoded.sub;
      req.userEmail = decoded.email;
      next();
    } catch {
      return next(new AppError('UNAUTHENTICATED', 'Invalid or expired authentication token.'));
    }
  };
}
