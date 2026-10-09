import { describe, it, expect } from 'vitest';
import { LamportClock } from '@bank/shared';
import { ElectionManager } from './election-manager.js';
import { FailureDetector } from '../cluster/failure-detector.js';
import { PeerManager } from '../cluster/peer-manager.js';

describe('ElectionManager Epoch Rules & Adapter (U-ELC-1)', () => {
  it('should increment epoch monotonically during elections', async () => {
    const clock = new LamportClock();
    const fd = new FailureDetector(1, 3000);
    const pm = new PeerManager(1, '1=127.0.0.1:50051,2=127.0.0.1:50052');

    const em = new ElectionManager({
      selfNodeId: 1,
      selfPriority: 1,
      algorithm: 'bully',
      clock,
      failureDetector: fd,
      peerManager: pm,
    });

    expect(em.getEpoch()).toBe(0);

    em.setEpoch(5);
    expect(em.getEpoch()).toBe(5);

    // Stale epoch (e.g., 3) should not lower current epoch
    em.setEpoch(3);
    expect(em.getEpoch()).toBe(5);
  });

  it('should support switching between Bully and Ring election algorithms', () => {
    const clock = new LamportClock();
    const fd = new FailureDetector(1, 3000);
    const pm = new PeerManager(1, '1=127.0.0.1:50051,2=127.0.0.1:50052');

    const em = new ElectionManager({
      selfNodeId: 1,
      selfPriority: 1,
      algorithm: 'bully',
      clock,
      failureDetector: fd,
      peerManager: pm,
    });

    expect(em.getAlgorithm()).toBe('bully');

    em.setAlgorithm('ring');
    expect(em.getAlgorithm()).toBe('ring');
  });
});
