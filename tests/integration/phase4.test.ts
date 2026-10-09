import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { LamportClock } from '@bank/shared';
import { FailureDetector } from '../../services/bank-node/src/cluster/failure-detector.js';
import { EventSink } from '../../services/bank-node/src/observability/event-sink.js';
import { RpcTraceBuffer } from '../../services/bank-node/src/observability/rpc-trace-buffer.js';
import { parsePeersString } from '../../services/bank-node/src/cluster/peer-manager.js';

const DB_URL = process.env.DATABASE_URL || 'postgres://bank:bank_pw_dev@localhost:5441/bank';

describe('Phase 4: Cluster Membership & Observability Integration Tests', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('should parse PEERS environment string correctly', () => {
    const peersStr = '1=bank-node-1:50051,2=bank-node-2:50051,3=bank-node-3:50051';
    const parsed = parsePeersString(peersStr);

    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toEqual({ nodeId: 1, address: 'bank-node-1:50051' });
    expect(parsed[1]).toEqual({ nodeId: 2, address: 'bank-node-2:50051' });
    expect(parsed[2]).toEqual({ nodeId: 3, address: 'bank-node-3:50051' });
  });

  it('should detect node failure after timeout (3000ms)', async () => {
    const clock = new LamportClock({ initialValue: 1 });
    const eventSink = new EventSink(pool, 1, clock);
    const fd = new FailureDetector(1, 100, eventSink); // 100ms short timeout for fast test execution

    // Node 2 sends heartbeat
    await fd.recordHeartbeat({
      nodeId: 2,
      status: 'HEALTHY',
      role: 'FOLLOWER',
      epoch: 1,
      leaderId: 1,
      lastSeq: 0,
      lamport: 5,
    });

    const stateBefore = fd.getPeerState(2);
    expect(stateBefore).toBeDefined();
    expect(stateBefore?.status).toBe('HEALTHY');

    // Wait 150ms without heartbeat
    await new Promise((resolve) => setTimeout(resolve, 150));
    await fd.checkFailures();

    const stateAfter = fd.getPeerState(2);
    expect(stateAfter?.status).toBe('DOWN');

    // Check event log
    const events = await eventSink.getEvents({ type: 'NODE_FAILURE_DETECTED', node: 1 });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.peerNodeId).toBe(2);
  });

  it('should record recovery when heartbeat arrives for a DOWN node', async () => {
    const clock = new LamportClock({ initialValue: 10 });
    const eventSink = new EventSink(pool, 1, clock);
    const fd = new FailureDetector(1, 100, eventSink);

    await fd.recordHeartbeat({ nodeId: 3, status: 'HEALTHY', role: 'FOLLOWER', epoch: 1, leaderId: 1, lastSeq: 0, lamport: 1 });
    await new Promise((r) => setTimeout(r, 150));
    await fd.checkFailures();
    expect(fd.getPeerState(3)?.status).toBe('DOWN');

    // Node 3 recovers and sends heartbeat
    await fd.recordHeartbeat({ nodeId: 3, status: 'HEALTHY', role: 'FOLLOWER', epoch: 1, leaderId: 1, lastSeq: 0, lamport: 12 });
    expect(fd.getPeerState(3)?.status).toBe('HEALTHY');

    const recoveryEvents = await eventSink.getEvents({ type: 'NODE_RECOVERED', node: 1 });
    expect(recoveryEvents.length).toBeGreaterThan(0);
    expect(recoveryEvents[0]?.peerNodeId).toBe(3);
  });


  it('should store and retrieve event logs in causal Lamport order', async () => {
    const clock = new LamportClock({ initialValue: 100 });
    const eventSink = new EventSink(pool, 1, clock);

    const l1 = await eventSink.logEvent({ service: 'test', eventType: 'TEST_EVENT_A', severity: 'INFO' });
    const l2 = await eventSink.logEvent({ service: 'test', eventType: 'TEST_EVENT_B', severity: 'WARN' });

    expect(l2).toBeGreaterThan(l1);

    const events = await eventSink.getEvents({ limit: 10 });
    expect(events.length).toBeGreaterThanOrEqual(2);

    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.lamport).toBeGreaterThanOrEqual(events[i - 1]!.lamport);
    }
  });

  it('should manage circular RPC trace buffer (capacity 500)', () => {
    const buffer = new RpcTraceBuffer(5); // small buffer size for testing

    for (let i = 1; i <= 10; i++) {
      buffer.addTrace({
        method: `Method_${i}`,
        fromNode: 1,
        toNode: 2,
        lamportSend: i,
        lamportRecv: i + 1,
        latencyMs: 1.5,
        requestId: `req-${i}`,
        physicalTs: new Date().toISOString(),
      });
    }

    const traces = buffer.getTraces(10);
    expect(traces).toHaveLength(5); // max capacity was 5
    expect(traces[0]?.method).toBe('Method_10'); // most recent trace
    expect(traces[4]?.method).toBe('Method_6');
  });

  it('D-LAM-1: Causal ordering property', () => {
    const clockA = new LamportClock({ initialValue: 0 });
    const clockB = new LamportClock({ initialValue: 0 });

    // Event 1 on Node A
    const sendL = clockA.send(); // L_A = 1
    expect(sendL).toBe(1);

    // Message sent to Node B
    const recvL = clockB.receive(sendL); // L_B = max(0, 1) + 1 = 2
    expect(recvL).toBe(2);
    expect(recvL).toBeGreaterThan(sendL);

    // Response sent back to Node A
    const replyL = clockB.send(); // L_B = 3
    const finalL = clockA.receive(replyL); // L_A = max(1, 3) + 1 = 4
    expect(finalL).toBe(4);
    expect(finalL).toBeGreaterThan(replyL);
  });
});
