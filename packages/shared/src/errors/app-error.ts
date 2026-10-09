import { Metadata, status as GrpcStatus } from '@grpc/grpc-js';
import { ErrorCode, ERROR_METADATA } from './codes.js';

export interface AppErrorOptions {
  details?: unknown;
  cause?: unknown;
  retryable?: boolean;
  httpStatus?: number;
  grpcStatus?: GrpcStatus;
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  public readonly grpcStatus: GrpcStatus;
  public readonly retryable: boolean;
  public readonly details?: unknown;

  constructor(code: ErrorCode, message?: string, options?: AppErrorOptions) {
    const meta = ERROR_METADATA[code] ?? ERROR_METADATA.INTERNAL;
    super(message ?? meta.defaultMessage);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = options?.httpStatus ?? meta.httpStatus;
    this.grpcStatus = options?.grpcStatus ?? meta.grpcStatus;
    this.retryable = options?.retryable ?? meta.retryable;
    this.details = options?.details;

    if (options?.cause) {
      this.cause = options.cause;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toResponseJson(requestId?: string, lamport?: number) {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
        retryable: this.retryable,
      },
      meta: {
        requestId,
        lamport,
      },
    };
  }

  public toGrpcTrailers(): Metadata {
    const trailers = new Metadata();
    trailers.set('x-error-code', this.code);
    trailers.set('x-retryable', this.retryable ? 'true' : 'false');
    if (this.details) {
      try {
        trailers.set('x-error-details', JSON.stringify(this.details));
      } catch {
        // ignore serialization failure for trailers
      }
    }
    return trailers;
  }

  public static fromGrpcError(err: { code?: number; message?: string; metadata?: Metadata }): AppError {
    const errorCodeTrailer = err.metadata?.get('x-error-code')?.[0]?.toString();
    let code = errorCodeTrailer as ErrorCode | undefined;

    if (!code) {
      if (err.code === GrpcStatus.UNAVAILABLE) {
        code = 'NODE_UNAVAILABLE';
      } else if (err.code === GrpcStatus.DEADLINE_EXCEEDED) {
        code = 'DEADLINE_EXCEEDED';
      } else if (err.code === GrpcStatus.UNAUTHENTICATED) {
        code = 'UNAUTHENTICATED';
      } else if (err.code === GrpcStatus.NOT_FOUND) {
        code = 'NOT_FOUND';
      } else {
        code = 'INTERNAL';
      }
    }

    const retryableTrailer = err.metadata?.get('x-retryable')?.[0]?.toString();
    const detailsTrailer = err.metadata?.get('x-error-details')?.[0]?.toString();

    let details: unknown;
    if (detailsTrailer) {
      try {
        details = JSON.parse(detailsTrailer);
      } catch {
        details = detailsTrailer;
      }
    }

    return new AppError(code, err.message, {
      details,
      retryable: retryableTrailer ? retryableTrailer === 'true' : undefined,
    });
  }
}
