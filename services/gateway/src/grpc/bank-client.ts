import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, createLogger } from '@bank/shared';
import { executeWithRetry } from '../loadbalancer/retry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = path.resolve(__dirname, '../../../../proto');

const logger = createLogger({ service: 'gateway-grpc-client' });

type ServiceConstructor = new (
  target: string,
  credentials: grpc.ChannelCredentials,
) => BankServiceClientInstance;

interface BankServiceClientInstance {
  [method: string]: (
    request: unknown,
    callback: (err: grpc.ServiceError | null, response: unknown) => void,
  ) => void;
  close: () => void;
}

let clientInstance: BankServiceClientInstance | null = null;

function getDefaultTarget(): string {
  if (process.env.NODE1_TARGET) {
    return process.env.NODE1_TARGET;
  }
  if (process.env.GATEWAY_NODES) {
    const firstNode = process.env.GATEWAY_NODES.split(',')[0];
    if (firstNode && firstNode.includes('=')) {
      return firstNode.split('=')[1]!;
    }
  }
  return '127.0.0.1:50051';
}

function getClient(target = getDefaultTarget()): BankServiceClientInstance {
  if (!clientInstance) {
    const packageDef = protoLoader.loadSync(path.join(PROTO_DIR, 'bank.proto'), {
      keepCase: false,
      longs: Number,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [PROTO_DIR],
    });

    const proto = grpc.loadPackageDefinition(packageDef) as unknown as {
      bank: { v1: { BankService: ServiceConstructor } };
    };
    const BankService = proto.bank.v1.BankService;
    clientInstance = new BankService(target, grpc.credentials.createInsecure());
    logger.info(`gRPC client connected to ${target}`);
  }
  return clientInstance;
}

export function setGrpcTarget(target: string): void {
  if (clientInstance) {
    clientInstance.close();
    clientInstance = null;
  }
  getClient(target);
}

function callWithRetry<TRes = Record<string, unknown>>(
  methodName: string,
  request: unknown,
  isIdempotent = false,
  targetNode?: string,
): Promise<TRes> {
  return executeWithRetry<TRes>(
    () => {
      const client = getClient(targetNode);
      return new Promise<TRes>((resolve, reject) => {
        const fn = client[methodName];
        if (!fn) {
          return reject(new AppError('INTERNAL', `gRPC method ${methodName} not found.`));
        }

        fn.call(client, request, (err: grpc.ServiceError | null, response: unknown) => {
          if (!err) {
            return resolve(response as TRes);
          }
          reject(AppError.fromGrpcError(err));
        });
      });
    },
    { isIdempotent, maxAttempts: 5, maxBudgetMs: 12000 },
  );
}

export interface AuthResponse {
  user: { id: string; name: string; email: string };
  token: string;
}

export interface AccountResponse {
  id: string;
  accountNumber: string;
  nickname: string;
  balancePaise: number;
  currency: string;
  status: string;
  version: number;
  createdAt: string;
}

export interface ListAccountsResponse {
  accounts: AccountResponse[];
}

export interface LookupAccountResponse {
  accountNumber: string;
  holderName: string;
}

export interface TransactionResponse {
  id: string;
  reference: string;
  type: string;
  status: string;
  rejectReason?: string;
  sourceAccountId?: string;
  destinationAccountId?: string;
  amountPaise: number;
  sourceBalanceAfter?: number;
  destinationBalanceAfter?: number;
  note?: string;
  entryNode: number;
  processedByNode: number;
  epoch: number;
  logSeq: number;
  lamport: number;
  physicalTs: string;
}

export interface TransactionResultResponse {
  transaction: TransactionResponse;
}

export interface ListTransactionsResponse {
  transactions: TransactionResponse[];
  nextCursor?: string;
}

export interface StatementResponse {
  csvData: Uint8Array;
}

export class BankGrpcClient {
  static async register(name: string, email: string, password: string) {
    return callWithRetry<AuthResponse>('Register', { name, email, password });
  }

  static async login(email: string, password: string) {
    return callWithRetry<AuthResponse>('Login', { email, password });
  }

  static async getMe(userId: string, requestId: string) {
    return callWithRetry<{ id: string; name: string; email: string }>('GetMe', {
      ctx: { userId, requestId },
    });
  }

  static async createAccount(
    userId: string,
    nickname: string | undefined,
    idempotencyKey: string,
    requestId: string,
  ) {
    return callWithRetry<AccountResponse>(
      'CreateAccount',
      {
        ctx: { userId, idempotencyKey, requestId },
        nickname: nickname ?? '',
      },
      true,
    );
  }

  static async listAccounts(userId: string, requestId: string) {
    return callWithRetry<ListAccountsResponse>('ListAccounts', {
      ctx: { userId, requestId },
    });
  }

  static async getAccount(userId: string, accountId: string, requestId: string) {
    return callWithRetry<AccountResponse>('GetAccount', {
      ctx: { userId, requestId },
      accountId,
    });
  }

  static async lookupAccount(userId: string, accountNumber: string, requestId: string) {
    return callWithRetry<LookupAccountResponse>('LookupAccount', {
      ctx: { userId, requestId },
      accountNumber,
    });
  }

  static async deposit(
    userId: string,
    accountId: string,
    amountPaise: number,
    note: string | undefined,
    idempotencyKey: string,
    requestId: string,
  ) {
    return callWithRetry<TransactionResultResponse>(
      'Deposit',
      {
        ctx: { userId, idempotencyKey, requestId },
        accountId,
        amountPaise,
        note: note ?? '',
      },
      true,
    );
  }

  static async withdraw(
    userId: string,
    accountId: string,
    amountPaise: number,
    note: string | undefined,
    idempotencyKey: string,
    requestId: string,
  ) {
    return callWithRetry<TransactionResultResponse>(
      'Withdraw',
      {
        ctx: { userId, idempotencyKey, requestId },
        accountId,
        amountPaise,
        note: note ?? '',
      },
      true,
    );
  }

  static async transfer(
    userId: string,
    fromAccountId: string,
    toAccountNumber: string,
    amountPaise: number,
    note: string | undefined,
    idempotencyKey: string,
    requestId: string,
  ) {
    return callWithRetry<TransactionResultResponse>(
      'Transfer',
      {
        ctx: { userId, idempotencyKey, requestId },
        fromAccountId,
        toAccountNumber,
        amountPaise,
        note: note ?? '',
      },
      true,
    );
  }

  static async listTransactions(
    userId: string,
    options: { accountId?: string; type?: string; status?: string; limit?: number; cursor?: string },
    requestId: string,
  ) {
    return callWithRetry<ListTransactionsResponse>('ListTransactions', {
      ctx: { userId, requestId },
      accountId: options.accountId ?? '',
      type: options.type ?? '',
      status: options.status ?? '',
      limit: options.limit ?? 20,
      cursor: options.cursor ?? '',
    });
  }

  static async getTransaction(userId: string, transactionId: string, requestId: string) {
    return callWithRetry<TransactionResponse>('GetTransaction', {
      ctx: { userId, requestId },
      transactionId,
    });
  }

  static async getStatement(
    userId: string,
    accountId: string,
    fromDate?: string,
    toDate?: string,
    requestId?: string,
  ) {
    return callWithRetry<StatementResponse>('GetStatement', {
      ctx: { userId, requestId },
      accountId,
      fromDate: fromDate ?? '',
      toDate: toDate ?? '',
    });
  }
}
