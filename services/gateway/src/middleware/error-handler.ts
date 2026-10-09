import type { Request, Response, NextFunction } from 'express';
import { AppError, createLogger } from '@bank/shared';
import type { Metadata } from '@grpc/grpc-js';

const logger = createLogger({ service: 'gateway-error' });

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = req.requestId ?? 'unknown';

  let appErr: AppError;

  if (err instanceof AppError) {
    appErr = err;
  } else if (err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'number') {
    appErr = AppError.fromGrpcError(err as { code?: number; message?: string; metadata?: Metadata });
  } else {
    logger.error('Unhandled server error', { error: String(err), requestId });
    appErr = new AppError('INTERNAL', 'An unexpected internal error occurred.', { cause: err });
  }

  res.status(appErr.httpStatus).json(appErr.toResponseJson(requestId));
}
