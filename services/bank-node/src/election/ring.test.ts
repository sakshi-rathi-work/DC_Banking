import { describe, it, expect } from 'vitest';
import { RingElectionCore, selectRingWinner } from './ring.js';

describe('Ring Election Pure Core (U-RNG-1)', () => {
  const cluster = [
    { nodeId: 1, priority: 1 },
    { nodeId: 2, priority: 2 },
    { nodeId: 3, priority: 3 },
  ];

  it('correctly selects winner with highest priority', () => {
    const winner = selectRingWinner([
      { id: 1, priority: 1 },
      { id: 2, priority: 2 },
      { id: 3, priority: 3 },
    ]);
    expect(winner.id).toBe(3);
  });

  it('accumulates candidates along ring and elects highest priority node', () => {
    const node1 = new RingElectionCore({ selfNodeId: 1, selfPriority: 1, clusterNodes: cluster });
    const node2 = new RingElectionCore({ selfNodeId: 2, selfPriority: 2, clusterNodes: cluster });
    const node3 = new RingElectionCore({ selfNodeId: 3, selfPriority: 3, clusterNodes: cluster });

    // Step 1: Node 1 initiates ring election
    const init = node1.startElection();
    expect(init.nextSuccessor?.nodeId).toBe(2);

    // Step 2: Node 2 receives token, adds self, forwards to Node 3
    const step2 = node2.handleToken(init.token);
    expect(step2.complete).toBe(false);
    expect(step2.updatedToken?.candidates).toHaveLength(2);
    expect(step2.nextSuccessor?.nodeId).toBe(3);

    // Step 3: Node 3 receives token, adds self, forwards to Node 1
    const step3 = node3.handleToken(step2.updatedToken!);
    expect(step3.complete).toBe(false);
    expect(step3.updatedToken?.candidates).toHaveLength(3);
    expect(step3.nextSuccessor?.nodeId).toBe(1);

    // Step 4: Token returns to Node 1 (initiator)
    const step4 = node1.handleToken(step3.updatedToken!);
    expect(step4.complete).toBe(true);
    expect(step4.winner).toBe(3);
    expect(step4.coordinatorMsg?.winner).toBe(3);
    expect(node1.getLeaderId()).toBe(3);
  });

  it('skips failed nodes on timeout and continues ring traversal', () => {
    const node1 = new RingElectionCore({ selfNodeId: 1, selfPriority: 1, clusterNodes: cluster });
    const init = node1.startElection();

    // Node 2 is down/unreachable -> hop timeout to Node 2
    const skipRes = node1.handleHopTimeout(init.token, 2);
    expect(skipRes.updatedToken.skipped).toContain(2);
    expect(skipRes.nextSuccessor?.nodeId).toBe(3); // skips 2, forwards directly to 3
  });
});
