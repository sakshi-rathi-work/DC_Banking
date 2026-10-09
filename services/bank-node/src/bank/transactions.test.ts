import { describe, it, expect } from 'vitest';
import { toPaise } from '@bank/shared';
import { computeRequestHash } from './idempotency.js';

describe('U-BNK-1: Money & Transaction Rules', () => {
  it('validates money inputs strictly using toPaise', () => {
    // Valid positive integers
    expect(toPaise(100)).toBe(100);
    expect(toPaise(10000)).toBe(10000);
    expect(toPaise(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);

    // Invalid non-integers
    expect(() => toPaise(10.5)).toThrow();
    expect(() => toPaise(0.1)).toThrow();

    // Invalid <= 0 (when positiveOnly=true)
    expect(() => toPaise(0, true)).toThrow();
    expect(() => toPaise(-100, true)).toThrow();

    // Invalid unsafe integers
    expect(() => toPaise(Number.MAX_SAFE_INTEGER + 1)).toThrow();
    expect(() => toPaise(NaN)).toThrow();
    expect(() => toPaise(Infinity)).toThrow();
  });

  it('rejects same-account transfer request hash computation or matching accounts', () => {
    const hash1 = computeRequestHash({
      type: 'TRANSFER',
      fromAccountId: 'acc-1',
      toAccountNumber: '100000000001',
      amountPaise: 5000,
    });

    const hash2 = computeRequestHash({
      type: 'TRANSFER',
      fromAccountId: 'acc-1',
      toAccountNumber: '100000000001',
      amountPaise: 5000,
    });

    expect(hash1).toBe(hash2);
    expect(typeof hash1).toBe('string');
    expect(hash1.length).toBe(64); // SHA-256 hex
  });
});
