import { status as GrpcStatus } from '@grpc/grpc-js';

export const ErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  CONFLICT_LOCK_TIMEOUT: 'CONFLICT_LOCK_TIMEOUT',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  ACCOUNT_NOT_ACTIVE: 'ACCOUNT_NOT_ACTIVE',
  SAME_ACCOUNT: 'SAME_ACCOUNT',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  RATE_LIMITED: 'RATE_LIMITED',
  NOT_LEADER: 'NOT_LEADER',
  NO_LEADER: 'NO_LEADER',
  LEADER_NOT_READY: 'LEADER_NOT_READY',
  NO_QUORUM: 'NO_QUORUM',
  COMMITTED_PENDING_REPLICATION: 'COMMITTED_PENDING_REPLICATION',
  NODE_UNAVAILABLE: 'NODE_UNAVAILABLE',
  DEADLINE_EXCEEDED: 'DEADLINE_EXCEEDED',
  LAB_DISABLED: 'LAB_DISABLED',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export interface ErrorMetadata {
  readonly httpStatus: number;
  readonly grpcStatus: GrpcStatus;
  readonly retryable: boolean;
  readonly defaultMessage: string;
}

export const ERROR_METADATA: Record<ErrorCode, ErrorMetadata> = {
  VALIDATION_ERROR: {
    httpStatus: 400,
    grpcStatus: GrpcStatus.INVALID_ARGUMENT,
    retryable: false,
    defaultMessage: 'Request failed schema validation.',
  },
  UNAUTHENTICATED: {
    httpStatus: 401,
    grpcStatus: GrpcStatus.UNAUTHENTICATED,
    retryable: false,
    defaultMessage: 'Authentication credentials are required or invalid.',
  },
  INVALID_CREDENTIALS: {
    httpStatus: 401,
    grpcStatus: GrpcStatus.UNAUTHENTICATED,
    retryable: false,
    defaultMessage: 'Invalid email or password.',
  },
  FORBIDDEN: {
    httpStatus: 403,
    grpcStatus: GrpcStatus.PERMISSION_DENIED,
    retryable: false,
    defaultMessage: 'You do not have permission to access this resource.',
  },
  NOT_FOUND: {
    httpStatus: 404,
    grpcStatus: GrpcStatus.NOT_FOUND,
    retryable: false,
    defaultMessage: 'The requested resource was not found.',
  },
  EMAIL_TAKEN: {
    httpStatus: 409,
    grpcStatus: GrpcStatus.ALREADY_EXISTS,
    retryable: false,
    defaultMessage: 'Email is already registered.',
  },
  CONFLICT_LOCK_TIMEOUT: {
    httpStatus: 409,
    grpcStatus: GrpcStatus.ABORTED,
    retryable: true,
    defaultMessage: 'Database lock acquisition timed out. Please retry.',
  },
  INSUFFICIENT_FUNDS: {
    httpStatus: 422,
    grpcStatus: GrpcStatus.FAILED_PRECONDITION,
    retryable: false,
    defaultMessage: 'Balance is lower than the requested amount.',
  },
  ACCOUNT_NOT_ACTIVE: {
    httpStatus: 422,
    grpcStatus: GrpcStatus.FAILED_PRECONDITION,
    retryable: false,
    defaultMessage: 'Account is not active.',
  },
  SAME_ACCOUNT: {
    httpStatus: 422,
    grpcStatus: GrpcStatus.INVALID_ARGUMENT,
    retryable: false,
    defaultMessage: 'Source and destination accounts must be distinct.',
  },
  IDEMPOTENCY_KEY_REQUIRED: {
    httpStatus: 400,
    grpcStatus: GrpcStatus.INVALID_ARGUMENT,
    retryable: false,
    defaultMessage: 'Idempotency-Key header is required for this operation.',
  },
  IDEMPOTENCY_KEY_REUSED: {
    httpStatus: 422,
    grpcStatus: GrpcStatus.FAILED_PRECONDITION,
    retryable: false,
    defaultMessage: 'Idempotency key reused with a different request payload.',
  },
  RATE_LIMITED: {
    httpStatus: 429,
    grpcStatus: GrpcStatus.RESOURCE_EXHAUSTED,
    retryable: true,
    defaultMessage: 'Too many requests. Please try again later.',
  },
  NOT_LEADER: {
    httpStatus: 503,
    grpcStatus: GrpcStatus.FAILED_PRECONDITION,
    retryable: true,
    defaultMessage: 'Node is not the leader and cannot process writes.',
  },
  NO_LEADER: {
    httpStatus: 503,
    grpcStatus: GrpcStatus.UNAVAILABLE,
    retryable: true,
    defaultMessage: 'No leader currently elected in cluster. Election in progress.',
  },
  LEADER_NOT_READY: {
    httpStatus: 503,
    grpcStatus: GrpcStatus.FAILED_PRECONDITION,
    retryable: true,
    defaultMessage: 'Leader is preparing and not yet accepting writes.',
  },
  NO_QUORUM: {
    httpStatus: 503,
    grpcStatus: GrpcStatus.FAILED_PRECONDITION,
    retryable: true,
    defaultMessage: 'Strong consistency requires majority quorum, but no backups are currently UP.',
  },
  COMMITTED_PENDING_REPLICATION: {
    httpStatus: 202,
    grpcStatus: GrpcStatus.OK,
    retryable: true,
    defaultMessage: 'Transaction committed locally; awaiting replication confirmation from backups.',
  },
  NODE_UNAVAILABLE: {
    httpStatus: 503,
    grpcStatus: GrpcStatus.UNAVAILABLE,
    retryable: true,
    defaultMessage: 'Node or cluster service is currently unavailable.',
  },
  DEADLINE_EXCEEDED: {
    httpStatus: 504,
    grpcStatus: GrpcStatus.DEADLINE_EXCEEDED,
    retryable: true,
    defaultMessage: 'Request exceeded its execution deadline.',
  },
  LAB_DISABLED: {
    httpStatus: 404,
    grpcStatus: GrpcStatus.UNIMPLEMENTED,
    retryable: false,
    defaultMessage: 'Lab endpoints are disabled on this cluster instance.',
  },
  INTERNAL: {
    httpStatus: 500,
    grpcStatus: GrpcStatus.INTERNAL,
    retryable: false,
    defaultMessage: 'An internal server error occurred.',
  },
};
