import { describe, it, expect } from 'vitest';
import { BullyElectionCore } from './bully.js';

describe('Bully Election Pure Core (U-BUL-1)', () => {
  const cluster = [
    { nodeId: 1, priority: 1 },
    { nodeId: 2, priority: 2 },
    { nodeId: 3, priority: 3 },
  ];

  it('highest alive node (Node 3) wins election without needing OK replies', () => {
    const node3 = new BullyElectionCore({ selfNodeId: 3, selfPriority: 3, clusterNodes: cluster });
    const init = node3.startElection();

    expect(init.higherNodes).toHaveLength(0);
    expect(init.isHighest).toBe(true);

    const evalRes = node3.evaluateOkTimeout();
    expect(evalRes.wonElection).toBe(true);
    expect(evalRes.winner).toBe(3);
    expect(node3.isLeader()).toBe(true);
  });

  it('lower node (Node 1) sends Election to higher nodes and steps down when OK received', () => {
    const node1 = new BullyElectionCore({ selfNodeId: 1, selfPriority: 1, clusterNodes: cluster });
    const init = node1.startElection();

    expect(init.higherNodes).toHaveLength(2); // Node 2 & 3
    expect(init.isHighest).toBe(false);

    // Node 2 replies OK
    node1.handleElectionReply({ ok: true, nodeId: 2, epoch: 1 });

    const evalRes = node1.evaluateOkTimeout();
    expect(evalRes.wonElection).toBe(false);
    expect(node1.isLeader()).toBe(false);
  });

  it('lower node (Node 1) receives Coordinator from Node 3 and updates leader', () => {
    const node1 = new BullyElectionCore({ selfNodeId: 1, selfPriority: 1, clusterNodes: cluster });
    const res = node1.handleCoordinatorMsg({ electionId: 'el-1', leaderId: 3, epoch: 1 });

    expect(res.accepted).toBe(true);
    expect(res.newLeader).toBe(3);
    expect(node1.getLeaderId()).toBe(3);
    expect(node1.isLeader()).toBe(false);
  });

  it('current leader (Node 2) steps down when higher node (Node 3) sends Coordinator', () => {
    const node2 = new BullyElectionCore({ selfNodeId: 2, selfPriority: 2, clusterNodes: cluster });
    node2.startElection();
    node2.evaluateOkTimeout(); // Node 2 becomes leader
    expect(node2.isLeader()).toBe(true);

    // Node 3 recovers and sends CoordinatorMsg
    const res = node2.handleCoordinatorMsg({ electionId: 'el-2', leaderId: 3, epoch: 2 });
    expect(res.accepted).toBe(true);
    expect(res.wasLeaderPreempted).toBe(true);
    expect(node2.isLeader()).toBe(false);
    expect(node2.getLeaderId()).toBe(3);
  });
});
