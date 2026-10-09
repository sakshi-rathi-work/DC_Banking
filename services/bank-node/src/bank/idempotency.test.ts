import { describe, it, expect } from 'vitest';
import { computeRequestHash } from './idempotency.js';

describe('U-IDM-1: Idempotency Hashing', () => {
  it('produces stable SHA-256 hash regardless of object key order', () => {
    const payload1 = {
      type: 'DEPOSIT',
      accountId: 'acc-123',
      amountPaise: 1000,
      note: 'test deposit',
    };

    const payload2 = {
      note: 'test deposit',
      amountPaise: 1000,
      accountId: 'acc-123',
      type: 'DEPOSIT',
    };

    const hash1 = computeRequestHash(payload1);
    const hash2 = computeRequestHash(payload2);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces different hashes for different payloads', () => {
    const hash1 = computeRequestHash({
      type: 'DEPOSIT',
      accountId: 'acc-123',
      amountPaise: 1000,
    });

    const hash2 = computeRequestHash({
      type: 'DEPOSIT',
      accountId: 'acc-123',
      amountPaise: 2000,
    });

    const hash3 = computeRequestHash({
      type: 'WITHDRAWAL',
      accountId: 'acc-123',
      amountPaise: 1000,
    });

    expect(hash1).not.toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash2).not.toBe(hash3);
  });
});
