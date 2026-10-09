import { AppError, createLogger } from '@bank/shared';

const logger = createLogger({ service: 'gateway-retry-engine' });

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxBudgetMs?: number;
  isIdempotent?: boolean;
}

/**
 * Execute an async operation with exponential backoff retries for retryable gRPC error codes.
 * Retryable error codes: UNAVAILABLE (503), DEADLINE_EXCEEDED (504), NOT_LEADER (409), LEADER_NOT_READY (503), NO_QUORUM (503).
 */
export async function executeWithRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const isIdempotent = opts.isIdempotent ?? true;
  const maxAttempts = isIdempotent ? (opts.maxAttempts ?? 5) : 1;
  const initialDelayMs = opts.initialDelayMs ?? 200;
  const maxBudgetMs = opts.maxBudgetMs ?? 12000;

  const startTime = Date.now();
  let attempt = 0;
  let lastErr: unknown;

  do {
    attempt++;
    try {
      return await fn(attempt);
    } catch (err: unknown) {
      lastErr = err;
      const elapsed = Date.now() - startTime;
      const appErr = err instanceof AppError ? err : AppError.fromGrpcError(err as { code?: number; details?: string });

      const isRetryable =
        appErr.retryable ||
        ['UNAVAILABLE', 'DEADLINE_EXCEEDED', 'NOT_LEADER', 'LEADER_NOT_READY', 'NO_QUORUM'].includes(appErr.code);

      if (!isRetryable || !isIdempotent || attempt >= maxAttempts || elapsed >= maxBudgetMs) {
        throw appErr;
      }

      const backoffDelay = Math.min(initialDelayMs * Math.pow(2, attempt - 1), 2000);
      logger.warn(`Gateway retrying operation (attempt ${attempt}/${maxAttempts}, delay ${backoffDelay}ms)`, {
        code: appErr.code,
        message: appErr.message,
      });

      await new Promise((resolve) => setTimeout(resolve, backoffDelay));
    }
  } while (attempt < maxAttempts);

  throw lastErr;
}
