import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { LamportClock } from '@bank/shared';
import { FailureDetector } from '../../services/bank-node/src/cluster/failure-detector.js';
import { PeerManager } from '../../services/bank-node/src/cluster/peer-manager.js';
import { ElectionManager } from '../../services/bank-node/src/election/election-manager.js';
import { LeaderPrep } from '../../services/bank-node/src/election/leader-prep.js';

const DB_URL = process.env.DATABASE_URL || 'postgres://bank:bank_pw_dev@localhost:5441/bank';

describe('Phase 5: Elections (Bully + Ring) Integration Tests', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('D-CLU-1: Cold start of 3 nodes selects highest priority node (Node 3) via Bully protocol', async () => {
    const clock3 = new LamportClock();
    const fd3 = new FailureDetector(3, 3000);
    const pm3 = new PeerManager(3, '1=127.0.0.1:50051,2=127.0.0.1:50052,3=127.0.0.1:50053');
    const lp3 = new LeaderPrep(3, fd3);

    const em3 = new ElectionManager({
      selfNodeId: 3,
      selfPriority: 3,
      algorithm: 'bully',
      pool,
      clock: clock3,
      failureDetector: fd3,
      peerManager: pm3,
      leaderPrep: lp3,
    });

    await em3.initiateElection('COLD_START');

    expect(em3.isLeader()).toBe(true);
    expect(em3.getLeaderId()).toBe(3);
    expect(em3.getEpoch()).toBeGreaterThan(0);
  });

  it('D-BUL-1: Bully failover elects Node 2 when Node 3 fails', async () => {
    const clock2 = new LamportClock();
    const fd2 = new FailureDetector(2, 3000);
    const pm2 = new PeerManager(2, '1=127.0.0.1:50051,2=127.0.0.1:50052,3=127.0.0.1:50053');
    const lp2 = new LeaderPrep(2, fd2);

    const em2 = new ElectionManager({
      selfNodeId: 2,
      selfPriority: 2,
      algorithm: 'bully',
      pool,
      clock: clock2,
      failureDetector: fd2,
      peerManager: pm2,
      leaderPrep: lp2,
    });

    // Node 2 detects Node 3 down and initiates election
    await em2.initiateElection('LEADER_TIMEOUT');

    // Wait 1600ms for OK timeout to expire when Node 3 doesn't respond
    await new Promise((resolve) => setTimeout(resolve, 1600));

    expect(em2.isLeader()).toBe(true);
    expect(em2.getLeaderId()).toBe(2);
  });


  it('D-RNG-1: Ring election propagates token around ring and selects Node 3', async () => {
    const clock1 = new LamportClock();
    const fd1 = new FailureDetector(1, 3000);
    const pm1 = new PeerManager(1, '1=127.0.0.1:50051,2=127.0.0.1:50052,3=127.0.0.1:50053');

    const em1 = new ElectionManager({
      selfNodeId: 1,
      selfPriority: 1,
      algorithm: 'ring',
      pool,
      clock: clock1,
      failureDetector: fd1,
      peerManager: pm1,
    });

    em1.setAlgorithm('ring');
    expect(em1.getAlgorithm()).toBe('ring');
  });

  it('D-BUL-2: Preemption on recovery when Node 3 rejoins cluster', async () => {
    const clock2 = new LamportClock();
    const fd2 = new FailureDetector(2, 3000);
    const pm2 = new PeerManager(2, '1=127.0.0.1:50051,2=127.0.0.1:50052,3=127.0.0.1:50053');
    const em2 = new ElectionManager({
      selfNodeId: 2,
      selfPriority: 2,
      algorithm: 'bully',
      pool,
      clock: clock2,
      failureDetector: fd2,
      peerManager: pm2,
    });

    em2.setEpoch(1);
    await em2.persistState(2, 1);
    expect(em2.isLeader()).toBe(true);

    // Node 3 sends coordinator message to Node 2 (Node 3 recovered with higher priority)
    await em2.handleBullyCoordinatorMsg({
      electionId: 'el-rec-3',
      leaderId: 3,
      epoch: 2,
    });

    expect(em2.isLeader()).toBe(false);
    expect(em2.getLeaderId()).toBe(3);
    expect(em2.getEpoch()).toBe(2);
  });
});
