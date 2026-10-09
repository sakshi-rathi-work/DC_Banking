import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';

const BASE_URL = process.env.GATEWAY_URL || 'http://localhost:8080/api';

interface ApiSuccess<T> {
  data: T;
  meta: { requestId: string };
}

interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta: { requestId: string };
}


describe('Phase 3 Gateway REST Integration Tests (I-GW-1)', () => {
  let authToken = '';
  let userId = '';
  let accountId = '';
  let accountNumber = '';

  const userEmail = `gw_user_${randomUUID()}@example.com`;
  const userPassword = 'Password123!';

  // Auth & Validation
  describe('Auth & Validation', () => {
    it('rejects registration with invalid email with 400 VALIDATION_ERROR', async () => {
      const res = await fetch(`${BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Invalid Email User',
          email: 'not-an-email',
          password: 'Password123!',
        }),
      });

      expect(res.status).toBe(400);
      const json = ((await res.json()) as unknown) as ApiError;
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it('registers a new user successfully via POST /api/auth/register', async () => {
      const res = await fetch(`${BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Gateway Alice',
          email: userEmail,
          password: userPassword,
        }),
      });

      expect(res.status).toBe(201);
      const json = ((await res.json()) as unknown) as ApiSuccess<{
        user: { id: string; name: string; email: string };
        token: string;
      }>;
      expect(json.data.user.id).toBeDefined();
      expect(json.data.user.email).toBe(userEmail);
      expect(json.data.token).toBeDefined();

      authToken = json.data.token;
      userId = json.data.user.id;
    });

    it('logs in via POST /api/auth/login', async () => {
      const res = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail,
          password: userPassword,
        }),
      });

      expect(res.status).toBe(200);
      const json = ((await res.json()) as unknown) as ApiSuccess<{
        user: { id: string; email: string };
        token: string;
      }>;
      expect(json.data.user.id).toBe(userId);
      expect(json.data.token).toBeDefined();
    });

    it('gets current user via GET /api/auth/me', async () => {
      const res = await fetch(`${BASE_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(res.status).toBe(200);
      const json = ((await res.json()) as unknown) as ApiSuccess<{ id: string }>;
      expect(json.data.id).toBe(userId);
    });

    it('rejects unauthenticated request with 401 UNAAUTHENTICATED', async () => {
      const res = await fetch(`${BASE_URL}/auth/me`);
      expect(res.status).toBe(401);
      const json = ((await res.json()) as unknown) as ApiError;
      expect(json.error.code).toBe('UNAUTHENTICATED');
    });
  });

  // Account Management
  describe('Account Management', () => {
    it('rejects POST /api/accounts missing Idempotency-Key header with 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
      const res = await fetch(`${BASE_URL}/accounts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ nickname: 'No Key' }),
      });

      expect(res.status).toBe(400);
      const json = ((await res.json()) as unknown) as ApiError;
      expect(json.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });

    it('creates an account via POST /api/accounts with Idempotency-Key', async () => {
      const idmKey = `idm_acct_${randomUUID()}`;
      const res = await fetch(`${BASE_URL}/accounts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idmKey,
        },
        body: JSON.stringify({ nickname: 'Checking' }),
      });

      expect(res.status).toBe(201);
      const json = ((await res.json()) as unknown) as ApiSuccess<{
        id: string;
        accountNumber: string;
        balancePaise: number;
      }>;
      expect(json.data.id).toBeDefined();
      expect(json.data.accountNumber).toMatch(/^\d{12}$/);
      expect(json.data.balancePaise).toBe(0);

      accountId = json.data.id;
      accountNumber = json.data.accountNumber;
    });

    it('lists user accounts via GET /api/accounts', async () => {
      const res = await fetch(`${BASE_URL}/accounts`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(res.status).toBe(200);
      const json = ((await res.json()) as unknown) as ApiSuccess<Array<{ id: string }>>;
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data.length).toBeGreaterThan(0);
    });

    it('looks up account holder via GET /api/accounts/lookup', async () => {
      const res = await fetch(`${BASE_URL}/accounts/lookup?accountNumber=${accountNumber}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(res.status).toBe(200);
      const json = ((await res.json()) as unknown) as ApiSuccess<{
        accountNumber: string;
        holderName: string;
      }>;
      expect(json.data.accountNumber).toBe(accountNumber);
      expect(json.data.holderName).toBeDefined();
    });

    it('gets account details via GET /api/accounts/:id', async () => {
      const res = await fetch(`${BASE_URL}/accounts/${accountId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(res.status).toBe(200);
      const json = ((await res.json()) as unknown) as ApiSuccess<{ id: string }>;
      expect(json.data.id).toBe(accountId);
    });
  });

  // Transactions
  describe('Transactions', () => {
    let secondAcctNumber = '';

    beforeAll(async () => {
      const idmKey = `idm_acct2_${randomUUID()}`;
      const res = await fetch(`${BASE_URL}/accounts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idmKey,
        },
        body: JSON.stringify({ nickname: 'Savings' }),
      });
      const json = ((await res.json()) as unknown) as ApiSuccess<{ accountNumber: string }>;
      secondAcctNumber = json.data.accountNumber;
    });

    it('deposits funds via POST /api/transactions/deposit', async () => {
      const idmKey = `idm_dep_${randomUUID()}`;
      const res = await fetch(`${BASE_URL}/transactions/deposit`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idmKey,
        },
        body: JSON.stringify({
          accountId,
          amountPaise: 20000,
          note: 'Paycheck',
        }),
      });

      expect(res.status).toBe(201);
      const json = ((await res.json()) as unknown) as ApiSuccess<{
        status: string;
        amountPaise: number;
      }>;
      expect(json.data.status).toBe('COMMITTED');
      expect(json.data.amountPaise).toBe(20000);
    });

    it('withdraws funds via POST /api/transactions/withdraw', async () => {
      const idmKey = `idm_wd_${randomUUID()}`;
      const res = await fetch(`${BASE_URL}/transactions/withdraw`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idmKey,
        },
        body: JSON.stringify({
          accountId,
          amountPaise: 5000,
          note: 'Groceries',
        }),
      });

      expect(res.status).toBe(201);
      const json = ((await res.json()) as unknown) as ApiSuccess<{
        status: string;
        amountPaise: number;
      }>;
      expect(json.data.status).toBe('COMMITTED');
      expect(json.data.amountPaise).toBe(5000);
    });

    it('transfers funds via POST /api/transactions/transfer', async () => {
      const idmKey = `idm_trf_${randomUUID()}`;
      const res = await fetch(`${BASE_URL}/transactions/transfer`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idmKey,
        },
        body: JSON.stringify({
          fromAccountId: accountId,
          toAccountNumber: secondAcctNumber,
          amountPaise: 3000,
          note: 'Internal transfer',
        }),
      });

      expect(res.status).toBe(201);
      const json = ((await res.json()) as unknown) as ApiSuccess<{ status: string }>;
      expect(json.data.status).toBe('COMMITTED');
    });

    it('returns 422 INSUFFICIENT_FUNDS when withdrawal exceeds balance', async () => {
      const idmKey = `idm_wd_fail_${randomUUID()}`;
      const res = await fetch(`${BASE_URL}/transactions/withdraw`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idmKey,
        },
        body: JSON.stringify({
          accountId,
          amountPaise: 99999999,
          note: 'Overdraft',
        }),
      });

      expect(res.status).toBe(422);
      const json = ((await res.json()) as unknown) as ApiError;
      expect(json.error.code).toBe('INSUFFICIENT_FUNDS');
    });

    it('lists transaction history via GET /api/transactions', async () => {
      const res = await fetch(`${BASE_URL}/transactions?accountId=${accountId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(res.status).toBe(200);
      const json = ((await res.json()) as unknown) as ApiSuccess<Array<{ id: string }>>;
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data.length).toBeGreaterThan(0);
    });

    it('downloads statement CSV via GET /api/accounts/:id/statement.csv', async () => {
      const res = await fetch(`${BASE_URL}/accounts/${accountId}/statement.csv`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/csv');
      const text = await res.text();
      expect(text).toContain('date,reference,type,description');
    });
  });

  // OpenAPI documentation endpoint
  describe('Documentation Endpoint', () => {
    it('serves OpenAPI spec at GET /api/docs/openapi.json', async () => {
      const res = await fetch('http://localhost:8080/api/docs/openapi.json');
      expect(res.status).toBe(200);
      const json = ((await res.json()) as unknown) as { openapi: string; info: { title: string } };
      expect(json.openapi).toBe('3.0.3');
      expect(json.info.title).toContain('Distributed Banking System');
    });
  });
});
