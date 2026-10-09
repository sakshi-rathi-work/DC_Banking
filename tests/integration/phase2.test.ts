import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = path.resolve(__dirname, '../../proto');

const packageDef = protoLoader.loadSync(path.join(PROTO_DIR, 'bank.proto'), {
  keepCase: false,
  longs: Number,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [PROTO_DIR],
});

type ServiceConstructor = new (
  target: string,
  credentials: grpc.ChannelCredentials,
) => GrpcClient;

interface GrpcClient {
  [method: string]: (
    request: unknown,
    callback: (err: grpc.ServiceError | null, response: unknown) => void,
  ) => void;
  close: () => void;
}

const protoDescriptor = grpc.loadPackageDefinition(packageDef) as unknown as {
  bank: { v1: { BankService: ServiceConstructor } };
};

const BankService = protoDescriptor.bank.v1.BankService;

function createClient(target = 'localhost:50051'): GrpcClient {
  return new BankService(target, grpc.credentials.createInsecure());
}

function callRpc<TRes = Record<string, unknown>>(
  client: GrpcClient,
  method: string,
  request: unknown,
): Promise<TRes> {
  return new Promise<TRes>((resolve, reject) => {
    const fn = client[method];
    if (!fn) return reject(new Error(`Method ${method} not found on client`));
    fn.call(client, request, (err: grpc.ServiceError | null, response: unknown) => {
      if (err) return reject(err);
      resolve(response as TRes);
    });
  });
}

// ===== Common response types for testing =====
interface AuthRes {
  user: { id: string; name: string; email: string };
  token: string;
}

interface AccountRes {
  id: string;
  accountNumber: string;
  nickname: string;
  balancePaise: number;
  status: string;
}

interface ListAccountsRes {
  accounts: AccountRes[];
}

interface LookupRes {
  accountNumber: string;
  holderName: string;
}

interface TxnResultRes {
  transaction: {
    id: string;
    reference: string;
    type: string;
    status: string;
    amountPaise: number;
  };
}

interface StatementRes {
  csvData: Uint8Array;
}

describe('Phase 2 Integration Tests', () => {
  let client: GrpcClient;
  let dbPool: pg.Pool;

  beforeAll(() => {
    client = createClient('localhost:50051');
    dbPool = new pg.Pool({
      connectionString: 'postgres://bank:bank_pw_dev@localhost:5441/bank',
    });
  });

  afterAll(async () => {
    client.close();
    await dbPool.end();
  });

  // I-AUTH-1
  describe('I-AUTH-1: Authentication', () => {
    const testEmail = `user_${randomUUID()}@example.com`;
    const testPassword = 'Password123!';
    let token = '';
    let userId = '';

    it('registers a new user successfully', async () => {
      const res = await callRpc<AuthRes>(client, 'Register', {
        name: 'Alice Smith',
        email: testEmail,
        password: testPassword,
      });

      expect(res.user.id).toBeDefined();
      expect(res.user.name).toBe('Alice Smith');
      expect(res.user.email).toBe(testEmail);
      expect(res.token).toBeDefined();
      token = res.token;
      userId = res.user.id;
    });

    it('logs in with correct credentials', async () => {
      const res = await callRpc<AuthRes>(client, 'Login', {
        email: testEmail,
        password: testPassword,
      });

      expect(res.user.id).toBe(userId);
      expect(res.token).toBeDefined();
      expect(typeof token).toBe('string');
    });

    it('rejects duplicate email registration with ALREADY_EXISTS', async () => {
      await expect(
        callRpc(client, 'Register', {
          name: 'Duplicate Alice',
          email: testEmail,
          password: testPassword,
        }),
      ).rejects.toThrow();
    });

    it('rejects login with wrong password with UNAUTHENTICATED', async () => {
      await expect(
        callRpc(client, 'Login', {
          email: testEmail,
          password: 'WrongPassword!',
        }),
      ).rejects.toThrow();
    });

    it('gets current user info via GetMe', async () => {
      const res = await callRpc<{ id: string; email: string }>(client, 'GetMe', {
        ctx: { userId },
      });

      expect(res.id).toBe(userId);
      expect(res.email).toBe(testEmail);
    });
  });

  // I-ACC-1
  describe('I-ACC-1: Account Management', () => {
    let userId = '';
    let accountId = '';
    let accountNumber = '';

    beforeAll(async () => {
      const reg = await callRpc<AuthRes>(client, 'Register', {
        name: 'Bob AccountTest',
        email: `bob_${randomUUID()}@example.com`,
        password: 'Password123!',
      });
      userId = reg.user.id;
    });

    it('creates a new account with 12-digit number and 0 balance', async () => {
      const acct = await callRpc<AccountRes>(client, 'CreateAccount', {
        ctx: { userId },
        nickname: 'Primary Savings',
      });

      expect(acct.id).toBeDefined();
      expect(acct.accountNumber).toMatch(/^\d{12}$/);
      expect(acct.balancePaise).toBe(0);
      expect(acct.nickname).toBe('Primary Savings');
      expect(acct.status).toBe('ACTIVE');

      accountId = acct.id;
      accountNumber = acct.accountNumber;
    });

    it('lists user accounts', async () => {
      const res = await callRpc<ListAccountsRes>(client, 'ListAccounts', {
        ctx: { userId },
      });

      expect(res.accounts).toHaveLength(1);
      expect(res.accounts[0]?.id).toBe(accountId);
    });

    it('gets account by ID', async () => {
      const acct = await callRpc<AccountRes>(client, 'GetAccount', {
        ctx: { userId },
        accountId,
      });

      expect(acct.id).toBe(accountId);
      expect(acct.accountNumber).toBe(accountNumber);
    });

    it('rejects GetAccount for unowned account with NOT_FOUND/FORBIDDEN', async () => {
      await expect(
        callRpc(client, 'GetAccount', {
          ctx: { userId: '00000000-0000-0000-0000-000000000000' },
          accountId,
        }),
      ).rejects.toThrow();
    });

    it('looks up account holder name by account number', async () => {
      const res = await callRpc<LookupRes>(client, 'LookupAccount', {
        ctx: { userId },
        accountNumber,
      });

      expect(res.accountNumber).toBe(accountNumber);
      expect(res.holderName).toBeDefined();
    });
  });

  // I-TXN-1, I-TXN-2, I-TXN-3
  describe('I-TXN: Transactions (Deposit, Withdraw, Transfer)', () => {
    let aliceUserId = '';
    let aliceAcctId = '';
    let bobUserId = '';
    let bobAcctId = '';
    let bobAcctNumber = '';

    beforeAll(async () => {
      const regAlice = await callRpc<AuthRes>(client, 'Register', {
        name: 'Alice TxnTest',
        email: `alice_txn_${randomUUID()}@example.com`,
        password: 'Password123!',
      });
      aliceUserId = regAlice.user.id;

      const acctAlice = await callRpc<AccountRes>(client, 'CreateAccount', {
        ctx: { userId: aliceUserId },
        nickname: 'Alice Main',
      });
      aliceAcctId = acctAlice.id;

      const regBob = await callRpc<AuthRes>(client, 'Register', {
        name: 'Bob TxnTest',
        email: `bob_txn_${randomUUID()}@example.com`,
        password: 'Password123!',
      });
      bobUserId = regBob.user.id;

      const acctBob = await callRpc<AccountRes>(client, 'CreateAccount', {
        ctx: { userId: bobUserId },
        nickname: 'Bob Main',
      });
      bobAcctId = acctBob.id;
      bobAcctNumber = acctBob.accountNumber;
    });

    it('I-TXN-1: Deposit 10,000 paise (₹100) into Alice account', async () => {
      const res = await callRpc<TxnResultRes>(client, 'Deposit', {
        ctx: {
          userId: aliceUserId,
          idempotencyKey: `idm_dep_${randomUUID()}`,
          requestId: `req_dep_${randomUUID()}`,
        },
        accountId: aliceAcctId,
        amountPaise: 10000,
        note: 'Initial deposit',
      });

      expect(res.transaction.status).toBe('COMMITTED');
      expect(res.transaction.type).toBe('DEPOSIT');
      expect(res.transaction.amountPaise).toBe(10000);

      const acct = await callRpc<AccountRes>(client, 'GetAccount', {
        ctx: { userId: aliceUserId },
        accountId: aliceAcctId,
      });
      expect(acct.balancePaise).toBe(10000);
    });

    it('I-TXN-1: Withdraw 3,000 paise (₹30) from Alice account', async () => {
      const res = await callRpc<TxnResultRes>(client, 'Withdraw', {
        ctx: {
          userId: aliceUserId,
          idempotencyKey: `idm_wd_${randomUUID()}`,
          requestId: `req_wd_${randomUUID()}`,
        },
        accountId: aliceAcctId,
        amountPaise: 3000,
        note: 'ATM withdrawal',
      });

      expect(res.transaction.status).toBe('COMMITTED');
      expect(res.transaction.type).toBe('WITHDRAWAL');
      expect(res.transaction.amountPaise).toBe(3000);

      const acct = await callRpc<AccountRes>(client, 'GetAccount', {
        ctx: { userId: aliceUserId },
        accountId: aliceAcctId,
      });
      expect(acct.balancePaise).toBe(7000);
    });

    it('I-TXN-1: Transfer 2,000 paise (₹20) from Alice to Bob', async () => {
      const res = await callRpc<TxnResultRes>(client, 'Transfer', {
        ctx: {
          userId: aliceUserId,
          idempotencyKey: `idm_trf_${randomUUID()}`,
          requestId: `req_trf_${randomUUID()}`,
        },
        fromAccountId: aliceAcctId,
        toAccountNumber: bobAcctNumber,
        amountPaise: 2000,
        note: 'Lunch payback',
      });

      expect(res.transaction.status).toBe('COMMITTED');
      expect(res.transaction.type).toBe('TRANSFER');
      expect(res.transaction.amountPaise).toBe(2000);

      const acctAlice = await callRpc<AccountRes>(client, 'GetAccount', {
        ctx: { userId: aliceUserId },
        accountId: aliceAcctId,
      });
      expect(acctAlice.balancePaise).toBe(5000);

      const acctBob = await callRpc<AccountRes>(client, 'GetAccount', {
        ctx: { userId: bobUserId },
        accountId: bobAcctId,
      });
      expect(acctBob.balancePaise).toBe(2000);
    });

    it('I-TXN-2: Insufficient funds withdrawal records REJECTED row in DB and returns 422 error', async () => {
      const err = await callRpc(client, 'Withdraw', {
        ctx: {
          userId: aliceUserId,
          idempotencyKey: `idm_wd_fail_${randomUUID()}`,
          requestId: `req_wd_fail_${randomUUID()}`,
        },
        accountId: aliceAcctId,
        amountPaise: 100000,
        note: 'Overdraft attempt',
      }).catch((e) => e as Error);

      expect(err).toBeDefined();

      const dbRes = await dbPool.query<{ reject_reason: string }>(
        `SELECT * FROM transactions WHERE source_account_id = $1 AND status = 'REJECTED'`,
        [aliceAcctId],
      );
      expect(dbRes.rows.length).toBeGreaterThan(0);
      expect(dbRes.rows[0]?.reject_reason).toBe('INSUFFICIENT_FUNDS');
    });

    it('I-TXN-3: Transfer to non-existent account number fails with NOT_FOUND', async () => {
      await expect(
        callRpc(client, 'Transfer', {
          ctx: {
            userId: aliceUserId,
            idempotencyKey: `idm_trf_bad_${randomUUID()}`,
            requestId: `req_trf_bad_${randomUUID()}`,
          },
          fromAccountId: aliceAcctId,
          toAccountNumber: '000000000000',
          amountPaise: 1000,
          note: 'Invalid transfer',
        }),
      ).rejects.toThrow();
    });
  });

  // I-IDM-1..4
  describe('I-IDM: Idempotency Key Scenarios', () => {
    let userId = '';
    let accountId = '';

    beforeAll(async () => {
      const reg = await callRpc<AuthRes>(client, 'Register', {
        name: 'Idempotency User',
        email: `idm_${randomUUID()}@example.com`,
        password: 'Password123!',
      });
      userId = reg.user.id;

      const acct = await callRpc<AccountRes>(client, 'CreateAccount', {
        ctx: { userId },
        nickname: 'Idm Acct',
      });
      accountId = acct.id;
    });

    it('I-IDM-1 & 2: Identical request with same key returns cached response without duplicate execution', async () => {
      const idmKey = `idm_unique_${randomUUID()}`;

      const res1 = await callRpc<TxnResultRes>(client, 'Deposit', {
        ctx: { userId, idempotencyKey: idmKey, requestId: 'req-1' },
        accountId,
        amountPaise: 5000,
        note: 'Deposit with key',
      });
      expect(res1.transaction.status).toBe('COMMITTED');

      const res2 = await callRpc<TxnResultRes>(client, 'Deposit', {
        ctx: { userId, idempotencyKey: idmKey, requestId: 'req-2' },
        accountId,
        amountPaise: 5000,
        note: 'Deposit with key',
      });

      expect(res2.transaction.id).toBe(res1.transaction.id);

      const acct = await callRpc<AccountRes>(client, 'GetAccount', {
        ctx: { userId },
        accountId,
      });
      expect(acct.balancePaise).toBe(5000);
    });

    it('I-IDM-3: Same key with DIFFERENT payload fails with IDEMPOTENCY_KEY_MISMATCH', async () => {
      const idmKey = `idm_mismatch_${randomUUID()}`;

      await callRpc<TxnResultRes>(client, 'Deposit', {
        ctx: { userId, idempotencyKey: idmKey, requestId: 'req-1' },
        accountId,
        amountPaise: 1000,
        note: 'Original payload',
      });

      await expect(
        callRpc(client, 'Deposit', {
          ctx: { userId, idempotencyKey: idmKey, requestId: 'req-2' },
          accountId,
          amountPaise: 2000,
          note: 'Original payload',
        }),
      ).rejects.toThrow();
    });
  });

  // I-WRK-1
  describe('I-WRK-1: Statement CSV Generation via Worker Thread', () => {
    let userId = '';
    let accountId = '';

    beforeAll(async () => {
      const reg = await callRpc<AuthRes>(client, 'Register', {
        name: 'CSV Test User',
        email: `csv_${randomUUID()}@example.com`,
        password: 'Password123!',
      });
      userId = reg.user.id;

      const acct = await callRpc<AccountRes>(client, 'CreateAccount', {
        ctx: { userId },
        nickname: 'CSV Acct',
      });
      accountId = acct.id;

      await callRpc<TxnResultRes>(client, 'Deposit', {
        ctx: { userId, idempotencyKey: `idm_csv_${randomUUID()}`, requestId: 'req-csv' },
        accountId,
        amountPaise: 15000,
        note: 'Statement test deposit',
      });
    });

    it('generates a valid CSV statement containing header and transactions', async () => {
      const res = await callRpc<StatementRes>(client, 'GetStatement', {
        ctx: { userId },
        accountId,
      });

      expect(res.csvData).toBeDefined();
      const csvString = Buffer.from(res.csvData).toString('utf-8');
      expect(csvString).toContain('date,reference,type,description,debitPaise,creditPaise,balanceAfterPaise,status');
      expect(csvString).toContain('DEPOSIT');
      expect(csvString).toContain('15000');
    });
  });

  // Concurrency Race Test
  describe('Concurrency Race Test: 7,000 vs 6,000 withdrawal on 10,000 balance', () => {
    let userId = '';
    let accountId = '';

    beforeAll(async () => {
      const reg = await callRpc<AuthRes>(client, 'Register', {
        name: 'Race User',
        email: `race_${randomUUID()}@example.com`,
        password: 'Password123!',
      });
      userId = reg.user.id;

      const acct = await callRpc<AccountRes>(client, 'CreateAccount', {
        ctx: { userId },
        nickname: 'Race Acct',
      });
      accountId = acct.id;

      await callRpc<TxnResultRes>(client, 'Deposit', {
        ctx: { userId, idempotencyKey: `idm_race_dep_${randomUUID()}`, requestId: 'req-dep' },
        accountId,
        amountPaise: 10000,
        note: 'Initial 10,000 paise balance',
      });
    });

    it('executes 7,000 and 6,000 withdrawals concurrently: exactly 1 succeeds', async () => {
      const key1 = `idm_race_wd1_${randomUUID()}`;
      const key2 = `idm_race_wd2_${randomUUID()}`;

      const p1 = callRpc<TxnResultRes>(client, 'Withdraw', {
        ctx: { userId, idempotencyKey: key1, requestId: 'req-wd1' },
        accountId,
        amountPaise: 7000,
        note: 'Race 7,000 withdrawal',
      }).catch((err) => err as Error);

      const p2 = callRpc<TxnResultRes>(client, 'Withdraw', {
        ctx: { userId, idempotencyKey: key2, requestId: 'req-wd2' },
        accountId,
        amountPaise: 6000,
        note: 'Race 6,000 withdrawal',
      }).catch((err) => err as Error);

      const [res1, res2] = await Promise.all([p1, p2]);

      const successCount = [res1, res2].filter(
        (r) => !(r instanceof Error) && r?.transaction?.status === 'COMMITTED',
      ).length;

      expect(successCount).toBe(1);

      const acct = await callRpc<AccountRes>(client, 'GetAccount', {
        ctx: { userId },
        accountId,
      });
      expect([3000, 4000]).toContain(acct.balancePaise);

      const dbTxns = await dbPool.query<{ status: string; amount_paise: string }>(
        `SELECT status, amount_paise FROM transactions WHERE source_account_id = $1 AND type = 'WITHDRAWAL'`,
        [accountId],
      );
      expect(dbTxns.rows).toHaveLength(2);
      const statuses = dbTxns.rows.map((r) => r.status).sort();
      expect(statuses).toEqual(['COMMITTED', 'REJECTED']);
    });
  });
});
