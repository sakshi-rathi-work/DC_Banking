/**
 * BankService gRPC handler implementations.
 * Maps gRPC calls to banking domain functions.
 *
 * Each handler:
 * 1. Extracts context from the Ctx message
 * 2. Delegates to the appropriate bank module function
 * 3. Maps AppError to gRPC status codes with trailers
 */
import type * as grpc from '@grpc/grpc-js';
import type pg from 'pg';
import { AppError, createLogger } from '@bank/shared';
import * as auth from '../bank/auth.js';
import * as accounts from '../bank/accounts.js';
import * as transactions from '../bank/transactions.js';
import * as statement from '../bank/statement.js';
import { computeRequestHash } from '../bank/idempotency.js';
import { forwardWriteToLeader } from './forwarding.js';
import type { PeerManager } from '../cluster/peer-manager.js';

const logger = createLogger({ service: 'grpc-bank' });

interface ServiceDeps {
  pool: pg.Pool;
  jwtSecret: string;
  nodeId: number;
  getEpoch: () => number;
  getLamport: () => number;
  isLeader?: () => boolean;
  getLeaderId?: () => number;
  peerManager?: PeerManager;
}


/**
 * Handle errors by mapping AppError to gRPC status + trailers.
 */
function handleError(call: grpc.ServerUnaryCall<unknown, unknown>, callback: grpc.sendUnaryData<unknown>, err: unknown): void {
  if (err instanceof AppError) {
    const trailers = err.toGrpcTrailers();
    callback({ code: err.grpcStatus, message: err.message, metadata: trailers });
  } else {
    logger.error('Unexpected error in BankService', err);
    const appErr = new AppError('INTERNAL', 'An internal error occurred.', { cause: err });
    const trailers = appErr.toGrpcTrailers();
    callback({ code: appErr.grpcStatus, message: appErr.message, metadata: trailers });
  }
}

/**
 * Create all BankService handler implementations.
 */
export function createBankServiceHandlers(deps: ServiceDeps) {
  const { pool, jwtSecret, nodeId } = deps;

  function getNodeCtx() {
    return { nodeId, epoch: deps.getEpoch(), lamport: deps.getLamport() };
  }

  async function tryForwardWrite<TRes>(
    methodName: string,
    call: grpc.ServerUnaryCall<unknown, unknown>,
    callback: grpc.sendUnaryData<unknown>,
  ): Promise<boolean> {
    if (deps.isLeader && !deps.isLeader() && deps.getLeaderId && deps.peerManager) {
      const leaderId = deps.getLeaderId();
      if (leaderId !== nodeId) {
        const forwardedRes = await forwardWriteToLeader<TRes>(
          methodName,
          call.request,
          call.metadata,
          nodeId,
          leaderId,
          deps.peerManager,
        );
        callback(null, forwardedRes);
        return true;
      }
    }
    return false;
  }

  return {

    // ===== Auth =====
    async Register(
      call: grpc.ServerUnaryCall<{ name?: string; email?: string; password?: string }, unknown>,
      callback: grpc.sendUnaryData<unknown>,
    ) {
      try {
        const req = call.request;
        if (!req.name || !req.email || !req.password) {
          throw new AppError('VALIDATION_ERROR', 'Name, email, and password are required.');
        }
        if (req.password.length < 8) {
          throw new AppError('VALIDATION_ERROR', 'Password must be at least 8 characters.');
        }

        const result = await auth.register(pool, jwtSecret, req.name, req.email, req.password);
        callback(null, { user: result.user, token: result.token });
      } catch (err) {
        handleError(call, callback, err);
      }
    },

    async Login(
      call: grpc.ServerUnaryCall<{ email?: string; password?: string }, unknown>,
      callback: grpc.sendUnaryData<unknown>,
    ) {
      try {
        const req = call.request;
        if (!req.email || !req.password) {
          throw new AppError('VALIDATION_ERROR', 'Email and password are required.');
        }

        const result = await auth.login(pool, jwtSecret, req.email, req.password);
        callback(null, { user: result.user, token: result.token });
      } catch (err) {
        handleError(call, callback, err);
      }
    },

    async GetMe(
      call: grpc.ServerUnaryCall<{ ctx?: { userId?: string } }, unknown>,
      callback: grpc.sendUnaryData<unknown>,
    ) {
      try {
        const userId = call.request.ctx?.userId;
        if (!userId) {
          throw new AppError('UNAUTHENTICATED', 'User context required.');
        }

        const user = await auth.getUser(pool, userId);
        callback(null, user);
      } catch (err) {
        handleError(call, callback, err);
      }
    },

    // ===== Accounts =====
    async CreateAccount(
      call: grpc.ServerUnaryCall<{ ctx?: { userId?: string; idempotencyKey?: string }; nickname?: string }, unknown>,
      callback: grpc.sendUnaryData<unknown>,
    ) {
      try {
        if (await tryForwardWrite('CreateAccount', call, callback)) return;
        const ctx = call.request.ctx;
        if (!ctx?.userId) {
          throw new AppError('UNAUTHENTICATED', 'User context required.');
        }

        // For account creation, we use the withTx from the accounts module
        const { withTx } = await import('../db/tx.js');
        const account = await withTx(pool, async (client) => {
          return accounts.createAccount(client, ctx.userId!, call.request.nickname);
        });

        callback(null, {
          id: account.id,
          accountNumber: account.accountNumber,
          nickname: account.nickname ?? '',
          balancePaise: account.balancePaise,
          currency: account.currency,
          status: account.status,
          version: account.version,
          createdAt: account.createdAt,
        });
      } catch (err) {
        handleError(call, callback, err);
      }
    },

    async ListAccounts(
      call: grpc.ServerUnaryCall<{ ctx?: { userId?: string } }, unknown>,
      callback: grpc.sendUnaryData<unknown>,
    ) {
      try {
        const userId = call.request.ctx?.userId;
        if (!userId) {
          throw new AppError('UNAUTHENTICATED', 'User context required.');
        }

        const accts = await accounts.listAccounts(pool, userId);
        callback(null, {
          accounts: accts.map((a) => ({
            id: a.id,
            accountNumber: a.accountNumber,
            nickname: a.nickname ?? '',
            balancePaise: a.balancePaise,
            currency: a.currency,
            status: a.status,
            version: a.version,
            createdAt: a.createdAt,
          })),
        });
      } catch (err) {
        handleError(call, callback, err);
      }
    },

    async GetAccount(
      call: grpc.ServerUnaryCall<{ ctx?: { userId?: string }; accountId?: string }, unknown>,
      callback: grpc.sendUnaryData<unknown>,
    ) {
      try {
        const userId = call.request.ctx?.userId;
        const accountId = call.request.accountId;
        if (!userId) {
          throw new AppError('UNAUTHENTICATED', 'User context required.');
        }
        if (!accountId) {
          throw new AppError('VALIDATION_ERROR', 'Account ID is required.');
        }

        const account = await accounts.getAccount(pool, accountId, userId);
        callback(null, {
          id: account.id,
          accountNumber: account.accountNumber,
          nickname: account.nickname ?? '',
          balancePaise: account.balancePaise,
          currency: account.currency,
          status: account.status,
          version: account.version,
          createdAt: account.createdAt,
        });
      } catch (err) {
        handleError(call, callback, err);
      }
    },

    async LookupAccount(
      call: grpc.ServerUnaryCall<{ ctx?: { userId?: string }; accountNumber?: string }, unknown>,
      callback: grpc.sendUnaryData<unknown>,
    ) {
      try {
        if (!call.request.ctx?.userId) {
          throw new AppError('UNAUTHENTICATED', 'User context required.');
        }
        const accountNumber = call.request.accountNumber;
        if (!accountNumber) {
          throw new AppError('VALIDATION_ERROR', 'Account number is required.');
        }

        const result = await accounts.lookupAccount(pool, accountNumber);
        callback(null, {
          accountNumber: result.accountNumber,
          holderName: result.holderName,
        });
      } catch (err) {
        handleError(call, callback, err);
      }
    },

    // ===== Transactions =====
    async Deposit(
      call: grpc.ServerUnaryCall<{ ctx?: { userId?: string; idempotencyKey?: string; requestId?: string }; accountId?: string; amountPaise?: number; note?: string }, unknown>,
      callback: grpc.sendUnaryData<unknown>,
    ) {
      try {
        if (await tryForwardWrite('Deposit', call, callback)) return;
        const ctx = call.request.ctx;
        if (!ctx?.userId) throw new AppError('UNAUTHENTICATED', 'User context required.');
        if (!ctx.idempotencyKey) throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required.');
        if (!call.request.accountId) throw new AppError('VALIDATION_ERROR', 'Account ID is required.');
        if (!call.request.amountPaise || call.request.amountPaise <= 0) {
          throw new AppError('VALIDATION_ERROR', 'Amount must be a positive integer in paise.');
        }

        const requestHash = computeRequestHash({
          type: 'DEPOSIT',
          accountId: call.request.accountId,
          amountPaise: call.request.amountPaise,
          note: call.request.note ?? '',
        });

        const result = await transactions.deposit(
          pool,
          getNodeCtx(),
          ctx.userId,
          call.request.accountId,
          call.request.amountPaise,
          call.request.note ?? null,
          ctx.idempotencyKey,
          requestHash,
        );

        callback(null, toTransactionResultProto(result));
      } catch (err) {
        handleError(call, callback, err);
      }
    },

    async Withdraw(
      call: grpc.ServerUnaryCall<{ ctx?: { userId?: string; idempotencyKey?: string; requestId?: string }; accountId?: string; amountPaise?: number; note?: string }, unknown>,
      callback: grpc.sendUnaryData<unknown>,
    ) {
      try {
        if (await tryForwardWrite('Withdraw', call, callback)) return;
        const ctx = call.request.ctx;
        if (!ctx?.userId) throw new AppError('UNAUTHENTICATED', 'User context required.');
        if (!ctx.idempotencyKey) throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required.');
        if (!call.request.accountId) throw new AppError('VALIDATION_ERROR', 'Account ID is required.');
        if (!call.request.amountPaise || call.request.amountPaise <= 0) {
          throw new AppError('VALIDATION_ERROR', 'Amount must be a positive integer in paise.');
        }

        const requestHash = computeRequestHash({
          type: 'WITHDRAWAL',
          accountId: call.request.accountId,
          amountPaise: call.request.amountPaise,
          note: call.request.note ?? '',
        });

        const result = await transactions.withdraw(
          pool,
          getNodeCtx(),
          ctx.userId,
          call.request.accountId,
          call.request.amountPaise,
          call.request.note ?? null,
          ctx.idempotencyKey,
          requestHash,
        );

        callback(null, toTransactionResultProto(result));
      } catch (err) {
        handleError(call, callback, err);
      }
    },

    async Transfer(
      call: grpc.ServerUnaryCall<{ ctx?: { userId?: string; idempotencyKey?: string; requestId?: string }; fromAccountId?: string; toAccountNumber?: string; amountPaise?: number; note?: string }, unknown>,
      callback: grpc.sendUnaryData<unknown>,
    ) {
      try {
        if (await tryForwardWrite('Transfer', call, callback)) return;
        const ctx = call.request.ctx;
        if (!ctx?.userId) throw new AppError('UNAUTHENTICATED', 'User context required.');
        if (!ctx.idempotencyKey) throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required.');
        if (!call.request.fromAccountId) throw new AppError('VALIDATION_ERROR', 'Source account ID is required.');
        if (!call.request.toAccountNumber) throw new AppError('VALIDATION_ERROR', 'Destination account number is required.');
        if (!call.request.amountPaise || call.request.amountPaise <= 0) {
          throw new AppError('VALIDATION_ERROR', 'Amount must be a positive integer in paise.');
        }

        const requestHash = computeRequestHash({
          type: 'TRANSFER',
          fromAccountId: call.request.fromAccountId,
          toAccountNumber: call.request.toAccountNumber,
          amountPaise: call.request.amountPaise,
          note: call.request.note ?? '',
        });

        const result = await transactions.transfer(
          pool,
          getNodeCtx(),
          ctx.userId,
          call.request.fromAccountId,
          call.request.toAccountNumber,
          call.request.amountPaise,
          call.request.note ?? null,
          ctx.idempotencyKey,
          requestHash,
        );

        callback(null, toTransactionResultProto(result));
      } catch (err) {
        handleError(call, callback, err);
      }
    },

    async ListTransactions(
      call: grpc.ServerUnaryCall<{ ctx?: { userId?: string }; accountId?: string; type?: string; status?: string; limit?: number; cursor?: string }, unknown>,
      callback: grpc.sendUnaryData<unknown>,
    ) {
      try {
        const userId = call.request.ctx?.userId;
        if (!userId) throw new AppError('UNAUTHENTICATED', 'User context required.');

        const result = await transactions.listTransactions(pool, userId, {
          accountId: call.request.accountId || undefined,
          type: call.request.type || undefined,
          status: call.request.status || undefined,
          limit: call.request.limit || undefined,
          cursor: call.request.cursor || undefined,
        });

        callback(null, {
          transactions: result.transactions.map(toTransactionProto),
          nextCursor: result.nextCursor ?? '',
        });
      } catch (err) {
        handleError(call, callback, err);
      }
    },

    async GetTransaction(
      call: grpc.ServerUnaryCall<{ ctx?: { userId?: string }; transactionId?: string }, unknown>,
      callback: grpc.sendUnaryData<unknown>,
    ) {
      try {
        const userId = call.request.ctx?.userId;
        if (!userId) throw new AppError('UNAUTHENTICATED', 'User context required.');
        if (!call.request.transactionId) throw new AppError('VALIDATION_ERROR', 'Transaction ID is required.');

        const txn = await transactions.getTransaction(pool, userId, call.request.transactionId);
        callback(null, toTransactionProto(txn));
      } catch (err) {
        handleError(call, callback, err);
      }
    },

    // ===== Statement =====
    async GetStatement(
      call: grpc.ServerUnaryCall<{ ctx?: { userId?: string }; accountId?: string; fromDate?: string; toDate?: string }, unknown>,
      callback: grpc.sendUnaryData<unknown>,
    ) {
      try {
        const userId = call.request.ctx?.userId;
        if (!userId) throw new AppError('UNAUTHENTICATED', 'User context required.');
        if (!call.request.accountId) throw new AppError('VALIDATION_ERROR', 'Account ID is required.');

        const csvData = await statement.getStatement(pool, {
          accountId: call.request.accountId,
          userId,
          fromDate: call.request.fromDate || undefined,
          toDate: call.request.toDate || undefined,
        });

        callback(null, { csvData });
      } catch (err) {
        handleError(call, callback, err);
      }
    },
  };
}

// ===== Proto mappers =====

function toTransactionProto(txn: transactions.TransactionRow) {
  return {
    id: txn.id,
    reference: txn.reference,
    type: txn.type,
    status: txn.status,
    rejectReason: txn.reject_reason ?? '',
    sourceAccountId: txn.source_account_id ?? '',
    destinationAccountId: txn.destination_account_id ?? '',
    amountPaise: txn.amount_paise,
    sourceBalanceAfter: txn.source_balance_after ?? 0,
    destinationBalanceAfter: txn.destination_balance_after ?? 0,
    note: txn.note ?? '',
    entryNode: txn.entry_node,
    processedByNode: txn.processed_by_node,
    epoch: txn.epoch,
    logSeq: txn.log_seq,
    lamport: txn.lamport,
    physicalTs: txn.physical_ts instanceof Date ? txn.physical_ts.toISOString() : String(txn.physical_ts),
  };
}

function toTransactionResultProto(result: transactions.TransactionResult) {
  return {
    transaction: toTransactionProto(result.transaction),
    replication: {
      mode: result.replication.mode,
      ackedBy: result.replication.ackedBy,
      pendingNodes: result.replication.pendingNodes,
      durationMs: result.replication.durationMs,
    },
  };
}
