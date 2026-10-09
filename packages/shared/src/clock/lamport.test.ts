import { describe, it, expect } from 'vitest';
import { LamportClock, toLamportNumber } from './lamport.js';

describe('LamportClock (U-LAM-1)', () => {
  it('should initialize to 0 or specified initial value', () => {
    const clock1 = new LamportClock();
    expect(clock1.getValue()).toBe(0);

    const clock2 = new LamportClock({ initialValue: 42 });
    expect(clock2.getValue()).toBe(42);
  });

  it('should increment clock on tick() and send()', () => {
    const clock = new LamportClock();
    expect(clock.tick()).toBe(1);
    expect(clock.getValue()).toBe(1);

    expect(clock.send()).toBe(2);
    expect(clock.getValue()).toBe(2);
  });

  it('should update clock on receive() when remote is smaller', () => {
    const clock = new LamportClock({ initialValue: 10 });
    // Local: 10, Remote: 5 -> max(10, 5) + 1 = 11
    const nextVal = clock.receive(5);
    expect(nextVal).toBe(11);
    expect(clock.getValue()).toBe(11);
  });

  it('should update clock on receive() when remote is larger', () => {
    const clock = new LamportClock({ initialValue: 5 });
    // Local: 5, Remote: 20 -> max(5, 20) + 1 = 21
    const nextVal = clock.receive(20);
    expect(nextVal).toBe(21);
    expect(clock.getValue()).toBe(21);
  });

  it('should handle string, bigint, and undefined inputs in receive()', () => {
    const clock = new LamportClock({ initialValue: 0 });
    expect(clock.receive('100')).toBe(101);
    expect(clock.receive(200n)).toBe(201);
    expect(clock.receive(undefined)).toBe(202); // max(201, 0) + 1 = 202
  });

  it('should set checkpoint correctly', () => {
    const clock = new LamportClock({ initialValue: 10 });
    clock.setCheckpoint(50);
    expect(clock.getValue()).toBe(50);

    // Should not lower clock if checkpoint is smaller
    clock.setCheckpoint(20);
    expect(clock.getValue()).toBe(50);
  });

  it('should safely convert values using toLamportNumber helper', () => {
    expect(toLamportNumber(42)).toBe(42);
    expect(toLamportNumber('123')).toBe(123);
    expect(toLamportNumber(500n)).toBe(500);
    expect(toLamportNumber(null)).toBe(0);
    expect(toLamportNumber(undefined)).toBe(0);
    expect(toLamportNumber('invalid')).toBe(0);
    expect(toLamportNumber(-5)).toBe(0);
  });
});
