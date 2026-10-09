import { describe, it, expect } from 'vitest';
import { AppError } from './app-error.js';
import { ErrorCodes } from './codes.js';

describe('AppError & ErrorCodes mappings', () => {
  it('creates AppError with correct metadata defaults', () => {
    const err = new AppError(ErrorCodes.INSUFFICIENT_FUNDS);
    expect(err.code).toBe('INSUFFICIENT_FUNDS');
    expect(err.httpStatus).toBe(422);
    expect(err.retryable).toBe(false);
    expect(err.message).toBe('Balance is lower than the requested amount.');
  });

  it('formats to JSON envelope correctly', () => {
    const err = new AppError(ErrorCodes.INSUFFICIENT_FUNDS, 'Balance is lower than requested.', {
      details: { balancePaise: 300000 },
    });
    const json = err.toResponseJson('req-123', 42);
    expect(json).toEqual({
      error: {
        code: 'INSUFFICIENT_FUNDS',
        message: 'Balance is lower than requested.',
        details: { balancePaise: 300000 },
        retryable: false,
      },
      meta: {
        requestId: 'req-123',
        lamport: 42,
      },
    });
  });

  it('converts to and from gRPC trailers', () => {
    const err = new AppError(ErrorCodes.CONFLICT_LOCK_TIMEOUT, 'Lock timeout', {
      details: { accountId: 'acc-1' },
      retryable: true,
    });
    const trailers = err.toGrpcTrailers();
    expect(trailers.get('x-error-code')).toEqual(['CONFLICT_LOCK_TIMEOUT']);
    expect(trailers.get('x-retryable')).toEqual(['true']);

    const restored = AppError.fromGrpcError({
      message: 'Lock timeout',
      metadata: trailers,
    });
    expect(restored.code).toBe('CONFLICT_LOCK_TIMEOUT');
    expect(restored.retryable).toBe(true);
    expect(restored.details).toEqual({ accountId: 'acc-1' });
  });
});
