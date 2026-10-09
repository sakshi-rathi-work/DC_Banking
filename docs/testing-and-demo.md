# Testing & Demo Guide

Part of [CLAUDE.md](../CLAUDE.md). Behavior: [architecture.md](architecture.md). Endpoints: [api-reference.md](api-reference.md). Conventions: [style-guide.md](style-guide.md).

**Contents**
1. Test strategy
2. Commands
3. Test matrix (required tests)
4. Concurrency test spec
5. Fault-tolerance test spec
6. Scripts
7. Viva demo runbook
8. Likely viva questions
9. Troubleshooting

---

## 1. Test strategy

| Level | Tooling | Runs against | Purpose |
|---|---|---|---|
| **Unit** | Vitest, fake clock, fake `PeerClient` | Pure cores only | Algorithms and rules: Lamport, Berkeley math, Bully/Ring state machines, least-connections picker, replication ordering, idempotency hashing, money validation |
| **Integration** | Vitest + Supertest, real Postgres (compose test profile) | One node + DB, gateway → node | Banking logic with real locking; REST → gRPC → DB path; error mapping |
| **Distributed** | Vitest driving `docker compose` (project `bank-test`) | Full 8-container stack | Kill/restart nodes, elections, replication, load balancing, clocks, failover under load |
| **Concurrency** | Part of integration/distributed | Real leader | Race conditions, deadlock avoidance, idempotency under parallelism |

Rules: no fixed sleeps (use `waitFor`); each test creates its own users/accounts; distributed tests restore the cluster to a healthy state in `afterEach` (start all nodes, set faults `NONE`, wait for a ready leader); tests that stop containers run **serially** (`describe.sequential`).

Every Definition of Done for a phase includes its rows in the matrix below.

---

## 2. Commands

```bash
npm run proto:gen             # generate TS types from proto/
npm test                      # unit tests (fast, no Docker)
npm run test:integration      # starts db + 1 node + gateway (compose profile "test"), runs tests/integration
npm run test:distributed      # starts full stack, runs tests/distributed (slow: ~5–10 min)
npm run test:concurrency      # concurrency subset of integration + distributed
npm run lint && npm run typecheck
docker compose up --build     # full system
```

---

## 3. Test matrix

IDs are referenced from phase exit criteria and the demo runbook.

### 3.1 Unit

| ID | Area | Cases |
|---|---|---|
| U-LAM-1 | Lamport | local tick +1; send ticks and returns value; receive `max(L, r)+1` for r<L, r=L, r>L; monotonic after restart restore |
| U-LAM-2 | Interceptors | client attaches `x-lamport`; server applies receive rule; response trailer applies receive rule |
| U-BRK-1 | Berkeley math | symmetric offsets → zero average; asymmetric → known adjustments `a_i = avg − d_i`; verification sweep measures pairwise residual < 50 ms; outlier excluded from average but still adjusted; single node; master only; RTT/2 compensation |
| U-BRK-2 | Monotonic clock | backward adjustment never yields decreasing timestamps |
| U-BUL-1 | Bully core | highest alive wins; lower node receiving Election replies OK and starts own; no OK within timeout → win; OK but no Coordinator → restart; higher-epoch Coordinator makes leader step down; ineligible nodes don't reply |
| U-RNG-1 | Ring core | token accumulates candidates; winner = max priority; dead successor skipped; initiator detection; coordinator round completes; token loss → timeout |
| U-ELC-1 | Epoch | `epoch = max seen + 1`; persisted before announce; stale-epoch messages rejected |
| U-LB-1 | Least connections | picks min active; tie → lower EWMA → lower id; unhealthy excluded; at-capacity skipped unless all; counter decremented on error/timeout |
| U-REP-1 | Applier | applies seq n+1 only; duplicate seq ignored; gap → reports last_seq; stale epoch rejected; row-image upsert respects `version` |
| U-REP-2 | Divergence check | same (seq, epoch) → catch-up; different epoch or longer log → snapshot |
| U-REP-3 | Strong-ack logic | ack set computation; majority requirement; timeout marks LAGGING |
| U-BNK-1 | Money rules | rejects non-integer, ≤0, > max safe; same-account transfer; funds check |
| U-IDM-1 | Idempotency | stable request hash; reuse with different body detected |

### 3.2 Integration (single node)

| ID | Scenario | Expected |
|---|---|---|
| I-AUTH-1 | Register → login → `/auth/me` | JWT works; duplicate email → `EMAIL_TAKEN`; wrong password → `INVALID_CREDENTIALS` |
| I-ACC-1 | Create account, list, get; other user's account | Ownership enforced (`FORBIDDEN`) |
| I-TXN-1 | Deposit, withdraw, transfer happy path | Balances, `version`, `reference`, history correct; debit+credit atomic |
| I-TXN-2 | Insufficient funds | 422; `REJECTED` row recorded; balance unchanged |
| I-TXN-3 | Transfer to unknown / frozen account | `NOT_FOUND` / `ACCOUNT_NOT_ACTIVE` |
| I-IDM-1 | Same key twice | Second returns identical response with `Idempotent-Replay`; one transaction row |
| I-IDM-2 | Same key, different amount | `IDEMPOTENCY_KEY_REUSED` |
| I-IDM-3 | Validation / 4xx error key scoping | 400 `VALIDATION_ERROR`, 403, 404 do not consume or persist key; corrected payload succeeds with same key |
| I-IDM-4 | Business failure 422 replays | 422 `INSUFFICIENT_FUNDS` persists key; retry with same key returns identical 422 response |
| I-DB-1 | Constraint check | direct `UPDATE` to negative balance rejected by `CHECK` |
| I-GW-1 | Validation + auth + rate limit | 400/401/429 as documented |
| I-GRPC-1 | Deadlines | slow handler → `DEADLINE_EXCEEDED` maps to 504 |
| I-WRK-1 | Worker pool | register/login don't block event loop (lag < threshold while hashing 10 users concurrently); CSV statement correct |

### 3.3 Distributed (full stack)

| ID | Scenario | Expected |
|---|---|---|
| D-CLU-1 | Cold start | Exactly one leader (node 3), same epoch on all nodes, all `UP`, replication in sync |
| D-RPC-1 | RPC trace | A transfer produces gateway→entry→leader→backups spans with same `requestId` and increasing Lamport |
| D-LAM-1 | Causal ordering | For a transfer, merged events satisfy: send L < receive L for every hop |
| D-BUL-1 | Bully failover | Stop node 3 → node 2 elected within 8 s; `Election`/`Coordinator` messages recorded; epoch +1 |
| D-BUL-2 | Bully preempt | Restart node 3 → catches up → becomes leader again; node 2 steps down |
| D-RNG-1 | Ring election | Switch to ring; trigger from node 1 → token visits 1→2→3; winner 3; coordinator round completes |
| D-RNG-2 | Ring skip | Node 2 stopped → token skips node 2; ring still elects 3 |
| D-RNG-3 | Ring failover | Stop node 3 with ring selected → node 2 wins via ring |
| D-ALG-1 | Algorithm switch | Config propagates to all nodes within 3 s |
| D-REP-1 | Strong replication | After write returns, **all live backups** (UP and not LAGGING at write time) already contain the entry |
| D-REP-2 | Eventual replication | With 2 s injected delay, write returns before backups apply; lag visible; converges later; checksums equal |
| D-REP-3 | Backup down (strong) | Writes still succeed with one backup; restarted node catches up; checksums equal |
| D-REP-4 | Both backups down (strong) | Pre-check detects zero UP backups → immediate 503 `NO_QUORUM` before commit, nothing written; after restart converges |
| D-REP-5 | Read consistency | Eventual: backup read shows `stale=true` during lag; strong: read never stale |
| D-REP-6 | Backups delayed mid-write (strong) | Both backups delayed > `STRONG_ACK_TIMEOUT_MS` → leader commits locally, returns 202 `COMMITTED_PENDING_REPLICATION`; backups catch up later; retry returns same txn |
| D-FOV-1 | Leader failover with data | 20 writes (strong) → kill leader → every acknowledged write exists on new leader |
| D-FOV-2 | Failover under load | `failover-under-load` script: acknowledged ∪ retried-success writes = applied exactly once; no overdraft; checksums equal |
| D-FOV-3 | Eventual loss window | Eventual mode + delay: write acked, leader killed before shipping → write absent on new leader; old leader's tail discarded (`DIVERGENT_WRITES_DISCARDED`) after rejoin |
| D-SPL-1 | Partition, strong | Partition leader → its writes `NO_QUORUM`; majority elects new leader; heal → old leader steps down, resyncs |
| D-SPL-2 | Partition, eventual | Isolated leader accepts writes; after heal they are discarded via snapshot; checksums equal |
| D-DB-1 | DB failure | Stop `db-2` (non-leader) → node 2 `DB_DOWN`, LB stops routing, cluster OK. Stop leader's DB → new election |
| D-LB-1 | Distribution | 100 concurrent `SimulateWork` → every healthy node served; shares sum to 100% |
| D-LB-2 | Slow node | Node 2 latency 1000 ms → its share drops markedly vs. others |
| D-LB-3 | Dead node | Stopped node gets 0 requests; after restart receives requests again |
| D-CLK-1 | Berkeley | Before: offsets differ by ≥ 2 s (from env); after sync: verification sweep measures pairwise residual < 50 ms; round stored with 3 values per node |
| D-CLK-2 | Clock failure | Stop one node during round → round completes with that node `skipped` |
| D-CLK-3 | Drift | After 60 s without sync, pairwise difference grows (> before-sync residual) — proves drift model is live |
| D-CLK-4 | Timestamps | `transactions.physical_ts` uses synced clock; monotonic across adjustment |
| D-CON-1 | Race 7,000/6,000 | See §4 |
| D-CON-2 | 20 withdrawals | See §4 |
| D-CON-3 | Crossfire | See §4 |
| D-CON-4 | Duplicate key | See §4 |
| D-CON-5 | Worker vs main | CPU task on `MAIN` shows higher event-loop lag p99 than on `WORKER` |
| D-SEC-1 | Security | no JWT → 401; other user's account → 403; SQL-injection strings stored literally; lab disabled when `LAB_MODE=false` |

---

## 4. Concurrency test spec

**D-CON-1 (the classic race).** Account balance ₹10,000. Fire simultaneously: withdraw ₹7,000 and withdraw ₹6,000 (different idempotency keys, ideally entering via different nodes).
Assert: exactly **one** `COMMITTED`, one `REJECTED(INSUFFICIENT_FUNDS)`; final balance is ₹3,000 or ₹4,000 (depending on winner); never negative; `transactions` rows = 2.

**D-CON-2 (20 simultaneous).** Balance ₹10,000; 20 simultaneous withdrawals of ₹1,000.
Assert: committed = 10, rejected = 10, final balance ₹0, `sum(committed) = ₹10,000`, balance `version` incremented by 10, checksums equal on all nodes after convergence.

**D-CON-3 (crossfire).** Accounts A and B with ₹10,000 each; 10 transfers A→B ₹100 and 10 transfers B→A ₹100 simultaneously.
Assert: no deadlock error surfaces to client (or only retried `ABORTED`), total money A+B = ₹20,000, both balances = ₹10,000 (net zero), 20 `COMMITTED`.

**D-CON-4 (duplicate key).** Same idempotency key sent 10× concurrently (deposit ₹500).
Assert: exactly one transaction row; balance +₹500 once; all 10 responses carry the same transaction id.

All run in both `strong` and `eventual` modes.

---

## 5. Fault-tolerance test spec

Common harness (`tests/helpers/cluster.ts`): `startCluster()`, `stopNode(n)`, `startNode(n)`, `stopDb(n)`, `setFault(n, mode)`, `waitForLeader({not?: n, timeoutMs})`, `integrity()` → `inSync`.

**`scripts/failover-under-load.ts`** (also used by D-FOV-2):
1. Seed 5 accounts with ₹1,00,000 each; record total money.
2. Start 20 workers sending transfers continuously (each with an idempotency key, retrying the same key on failure up to 30 s).
3. After 5 s, `docker compose stop` the current leader. After 10 s more, start it again.
4. Stop workers; wait for convergence; collect results.
5. Report and assert: no key applied twice; total money unchanged; no negative balance; every request reported success exactly corresponds to one `COMMITTED` row; `integrity.inSync = true`; measured unavailability window (first failure → first success after) printed.

**Expected timings** (assert with generous margins): detection ≤ 3 s + 1 s; election ≤ 2 s; leader ready ≤ 3 s after election; total write unavailability ≤ 10 s.

---

## 6. Scripts

TypeScript scripts executed with `tsx` via npm scripts are the **primary, cross-platform interface** (working cleanly in Windows PowerShell and Linux). Thin `.sh` shell scripts wrap the npm commands for bash environments. Docker operations use `child_process` invoking Docker Compose v2.

| npm Command | Script File / Wrapper | Purpose |
|---|---|---|
| `npm run seed` | `scripts/seed-demo.ts` (`scripts/seed-demo.sh`) | Creates demo users `alice@demo.test` / `bob@demo.test` (password `Demo@1234`), 2 accounts each, deposits so Alice has ₹1,00,000 and Bob ₹50,000 |
| `npm run reset` | `scripts/reset.ts` (`scripts/reset.sh`) | `docker compose down -v` and cleans up volumes |
| `npm run node:stop -- <n>` | `scripts/node-ctl.ts stop <n>` (`scripts/kill-node.sh <n>`) | Stops container `bank-node-<n>` |
| `npm run node:start -- <n>` | `scripts/node-ctl.ts start <n>` (`scripts/start-node.sh <n>`) | Starts container `bank-node-<n>` |
| `npm run db:stop -- <n>` | `scripts/db-ctl.ts stop <n>` (`scripts/kill-db.sh <n>`) | Stops container `db-<n>` |
| `npm run db:start -- <n>` | `scripts/db-ctl.ts start <n>` (`scripts/start-db.sh <n>`) | Starts container `db-<n>` |
| `npm run failover:load` | `scripts/failover-under-load.ts` | Continuous load test with mid-flight leader crash/restart (§5) |
| `npm run verify:integrity` | `scripts/verify-integrity.ts` (`scripts/verify-integrity.sh`) | Calls `/system/integrity`, prints comparison table, exits 1 if inconsistent |
| `npm run grpc:demo` | `scripts/grpc-demo.ts` (`scripts/grpc-demo.sh`) | Interacts with `localhost:5005x` via gRPC (raw RPC showcase) |

---

## 7. Viva demo runbook

**Pre-flight (do before the evaluator arrives)**
1. `npm run reset && docker compose up --build -d` — wait until all containers are healthy.
2. `npm run seed`.
3. Open `http://localhost:3000`; log in as Alice (tab 1) and Bob (tab 2, private window).
4. Open a terminal with `docker compose logs -f bank-node-1 bank-node-2 bank-node-3` (optional, impressive).
5. Open **Cluster** page: expect leader = Node 3, all nodes `UP`.

Each demo: **Do → Observe → Say**.

### Demo 1 — The bank works end to end
- **Do:** As Alice, transfer ₹5,00,000 paise (₹5,000) to Bob's account number. As Bob, refresh and view history.
- **Observe:** Success toast shows `entry node` and `processed by` (leader). Both histories show the same reference. Cluster page: all nodes' `lastSeq` advance together.
- **Say:** "Any node can receive the request; writes are forwarded over gRPC to the leader; the leader commits in Postgres and replicates to the backups."

### Demo 2 — RPC (Experiment 1)
- **Do:** Lab → RPC. Click **Trace call** (Node 1 → Node 3). Optionally run `npm run grpc:demo` to show raw gRPC.
- **Observe:** Hop list with method, request ID, Lamport send/recv, latency. Show `proto/*.proto`.
- **Say:** "Browser uses REST because browsers can't speak gRPC; everything behind the gateway is real gRPC with generated stubs, deadlines and typed errors."

### Demo 3 — Logical clock (Experiment 4)
- **Do:** Make a transfer. Lab → Logical Clock → filter by that request ID.
- **Observe:** Timeline sorted by `(L, node)`; each receive shows `max(local, received)+1`; node chips with current L.
- **Say:** "Lamport guarantees if A caused B then L(A) < L(B). Nodes that never talked directly are ordered only by causality chains through messages."

### Demo 4 — Physical clock / Berkeley (Experiment 3)
- **Do:** Lab → Physical Clock. Note offsets (≈ +3 s, −2 s, +0.5 s; growing drift). Click **Synchronize now**.
- **Observe:** Round result per node: RTT, `offsetBeforeMs` (Before column), included/excluded, adjustment, and measured `residualAfterMs` (After column). Offsets collapse to < 50 ms. A line chart shows drift growing again between rounds.
- **Say:** "Leader is time master; computes the average offset using RTT/2 compensation; sends relative adjustments. A verification pass measures the post-sync residual offset. Skew is simulated because containers share the host clock; the algorithm and RPCs are real. Berkeley converges to the cluster average, not true time — the ground-truth column shows that."

### Demo 5 — Concurrency (Experiment 2)
- **Do:** Lab → Concurrency. Select Alice's account, scenario **withdraw-race** (set balance ₹10,000 first via deposit/withdraw), amount ₹1,000 × 20. Then **duplicate-key** and **transfer-crossfire**. Then CPU task: `MAIN` vs `WORKER`.
- **Observe:** 10 committed / 10 rejected, final ₹0, invariant ✔. Event-loop lag chart much higher for `MAIN`.
- **Say:** "Node is single-threaded for JS but the database does real parallel transactions; row locks (`FOR UPDATE`) serialize same-account debits; lock ordering prevents deadlocks; idempotency keys make retries safe; CPU-heavy work runs in worker threads."

### Demo 6 — Load balancing
- **Do:** Lab → Load Balancing. Run 100 requests, concurrency 20. Then set Node 2 latency to 1000 ms and run again. Then stop a node (`npm run node:stop -- 1`) and run again.
- **Observe:** Shares per node from live counters; slow node's share drops (least connections); stopped node receives 0 and turns red; after restart (`npm run node:start -- 1`) it returns.
- **Say:** "Least connections routes to the node with the fewest in-flight requests, with health checks removing dead nodes and EWMA latency as a tie-breaker."

### Demo 7 — Replication: strong vs eventual (Experiment 7)
- **Do:** Lab → Replication. Set **Strong**, perform a demo deposit; observe per-node `lastSeq` and ack timeline. Set delay 2000 ms on Node 2. Repeat — response time increases. Switch to **Eventual** and repeat — response returns immediately; Node 2 shows lag 1 entry then converges. Read the balance through Node 2 during lag (stale badge).
- **Observe:** Ack events with Lamport values, lag bars, checksums equal after convergence.
- **Say:** "Strong waits for backups (CP); eventual returns after local commit (AP) and backups catch up asynchronously. Replication is our own log-shipping protocol with sequence numbers and epochs, not Postgres replication."

### Demo 8 — Bully election (Experiment 5)
- **Do:** Lab → Bully. Run `npm run node:stop -- 3` (real container stop).
- **Observe (in order):** Node 3 marked DOWN (≤ 3 s) → Node 2 `ELECTION_STARTED` → Election to 3 times out → Node 2 `COORDINATOR_ANNOUNCED` → Node 1 follows → leader = Node 2, epoch +1 → writes work again. Sequence diagram of messages with Lamport values.
- **Do (continue):** `npm run node:start -- 3`.
- **Observe:** Node 3 `RECOVERING` → catches up → starts election, wins → Node 2 steps down; leader = Node 3, epoch +1.
- **Say:** "Higher ID wins; OK replies suppress lower candidates; a recovered higher-priority node takes over after it has synced its data."

### Demo 9 — Ring election (Experiment 6)
- **Do:** Lab → Ring. Switch algorithm to Ring. Trigger election from Node 1. Then stop Node 2 (`npm run node:stop -- 2`) and trigger again.
- **Observe:** Token path 1→2→3→1 with candidate list, winner = 3, coordinator round; with Node 2 stopped the token skips Node 2 (`skipped=[2]`).
- **Say:** "Token collects candidate IDs around the ring; the initiator picks the maximum and circulates the coordinator message; failed nodes are skipped."

### Demo 10 — Fault tolerance & failover under load
- **Do:** Run `npm run failover:load` (≈ 40 s). Watch Fault Tolerance page.
- **Observe:** Brief error/retry window, new leader, old leader rejoins; final report: zero duplicates, total money conserved, checksums equal.
- **Say:** "Idempotency keys + a ready-leader gate + epoch fencing make failover safe; we measure the unavailability window."

### Demo 11 — Partition: CP vs AP (bonus)
- **Do:** Strong mode: Lab → Fault Tolerance → set **PARTITION** on the leader; try a transfer that lands on it → `NO_QUORUM`; majority elects a new leader. Heal. Then switch to **Eventual**, partition the leader again, write to it, heal → write discarded (`DIVERGENT_WRITES_DISCARDED`).
- **Say:** "Strong favors consistency; eventual favors availability and can lose data on partition — the classic trade-off."

### Demo 12 — Database failure (bonus)
- **Do:** `npm run db:stop -- 2`.
- **Observe:** Node 2 `DB_DOWN`, LB stops routing there, cluster continues; `npm run db:start -- 2` → node re-syncs.

---

## 8. Likely viva questions (prepare short answers)

1. Why gRPC and not REST between services? *(typed contracts, streaming, deadlines; REST isn't RPC)*
2. How do you prevent two withdrawals overdrawing? *(row locks, re-read after lock wait, CHECK constraint)*
3. Why `READ COMMITTED` instead of `SERIALIZABLE`? *(explicit locks suffice; fewer aborts)*
4. How do you prevent deadlocks in transfers? *(lock accounts in id order)*
5. What happens if the leader dies right after commit but before replying? *(idempotency key; strong mode ensures replica has it)*
6. Why Berkeley over Cristian? *(no authoritative time server; averages; fits peer cluster)* And what's simulated? *(skew/drift only)*
7. Difference between Lamport and physical time? *(causal order vs wall-clock; Lamport ≠ real time)*
8. How does Bully pick a leader that might be stale? *(leader-prep reconciliation before accepting writes)*
9. What stops split-brain? *(epoch fencing; strong mode needs majority acks; eventual mode accepts divergence then repairs)*
10. Is this Raft? *(No: similar log shipping, but leadership from Bully/Ring, no voting; limitations documented)*
11. How does the load balancer know a node is slow/dead? *(health checks + passive failures + EWMA)*
12. What are the consistency guarantees of each mode? *(architecture §9.3/§9.7 table)*

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Node stuck `RECOVERING` | Peers unreachable or `PEERS` env wrong | Check compose env, `docker compose logs bank-node-N` |
| No leader / endless elections | Clock/timeouts too tight, or node `status ≠ UP` (DB down) | Check `FAILURE_TIMEOUT_MS`, DB health |
| `LEADER_NOT_READY` persists | Strong mode and no quorum | Start another node or switch to eventual |
| Checksums differ after test | Convergence not finished or divergence | Wait `waitFor(inSync)`; check `SNAPSHOT_RESYNC` events |
| gRPC `UNAVAILABLE` from gateway | Node in `CRASH` fault mode | Lab → set fault `NONE` |
| Ports in use | Local Postgres/other apps | Change host ports in compose |
