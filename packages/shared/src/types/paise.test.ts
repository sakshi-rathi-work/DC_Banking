import { describe, it, expect } from 'vitest';
import { toPaise, toLamport } from './index.js';

describe('Paise validation (U-BNK-1 subset)', () => {
  it('accepts valid positive integers', () => {
    const paise = toPaise(10050);
    expect(paise).toBe(10050);
  });

  it('accepts zero when positiveOnly is false', () => {
    const paise = toPaise(0);
    expect(paise).toBe(0);
  });

  it('rejects zero or negative when positiveOnly is true', () => {
    expect(() => toPaise(0, true)).toThrow('must be positive');
    expect(() => toPaise(-500, true)).toThrow('must be positive');
  });

  it('rejects non-integers (floats)', () => {
    expect(() => toPaise(100.5)).toThrow('must be an integer, never a float');
    expect(() => toPaise(0.01)).toThrow('must be an integer, never a float');
  });

  it('rejects non-finite values and unsafe integers', () => {
    expect(() => toPaise(NaN)).toThrow('not a finite number');
    expect(() => toPaise(Infinity)).toThrow('not a finite number');
    expect(() => toPaise(Number.MAX_SAFE_INTEGER + 10)).toThrow('exceeds safe integer bounds');
  });
});

describe('Lamport timestamp validation (U-LAM-1 subset)', () => {
  it('accepts non-negative integers', () => {
    expect(toLamport(0)).toBe(0);
    expect(toLamport(42)).toBe(42);
  });

  it('rejects negative numbers and floats', () => {
    expect(() => toLamport(-1)).toThrow('Invalid Lamport timestamp');
    expect(() => toLamport(1.5)).toThrow('Invalid Lamport timestamp');
  });
});
