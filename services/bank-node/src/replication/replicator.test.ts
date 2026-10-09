import { describe, it, expect } from 'vitest';
import { LamportClock, AppError } from '@bank/shared';
import type pg from 'pg';
import { Replicator } from './replicator.js';
import { FailureDetector } from '../cluster/failure-detector.js';
import { PeerManager } from '../cluster/peer-manager.js';

describe('Replicator Strong & Eventual Logic (U-REP-3)', () => {
  it('should reject with NO_QUORUM in Strong mode if 0 backups are UP', async () => {
    const clock = new LamportClock();
    const fd = new FailureDetector(1, 3000); // no heartbeats recorded -> 0 healthy peers
    const pm = new PeerManager(1, '1=127.0.0.1:50051,2=127.0.0.1:50052');

    const replicator = new Replicator(null as unknown as pg.Pool, 1, clock, pm, fd, 'strong');

    const testEntry = {
      seq: 1,
      epoch: 1,
      opType: 'CREATE_USER',
      payloadJson: '{}',
      lamport: 1,
      originNode: 1,
      physicalTs: new Date().toISOString(),
    };

    try {
      await replicator.replicateEntry(testEntry, 1);
      expect.fail('Should have thrown AppError with NO_QUORUM');
    } catch (err: unknown) {
      expect((err as AppError).code).toBe('NO_QUORUM');
    }
  });


  it('should return immediately in Eventual mode without throwing NO_QUORUM', async () => {
    const clock = new LamportClock();
    const fd = new FailureDetector(1, 3000);
    const pm = new PeerManager(1, '1=127.0.0.1:50051,2=127.0.0.1:50052');

    const replicator = new Replicator(null as unknown as pg.Pool, 1, clock, pm, fd, 'eventual');

    const testEntry = {
      seq: 1,
      epoch: 1,
      opType: 'CREATE_USER',
      payloadJson: '{}',
      lamport: 1,
      originNode: 1,
      physicalTs: new Date().toISOString(),
    };

    const res = await replicator.replicateEntry(testEntry, 1);
    expect(res.pendingReplication).toBe(false);
  });
});
