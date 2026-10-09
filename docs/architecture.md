# Architecture — Distributed Banking System

Part of [CLAUDE.md](../CLAUDE.md). Contracts live in [api-reference.md](api-reference.md); conventions in [style-guide.md](style-guide.md); tests/demos in [testing-and-demo.md](testing-and-demo.md).

**Contents**
1. Topology & Docker
2. Bank node internals
3. Service ownership
4. Communication (REST, gRPC, metadata, deadlines)
5. Concurrency & transaction processing
6. Clocks (Lamport + Berkeley)
7. Membership & failure detection
8. Elections (Bully + Ring) and leader lifecycle
9. Replication & consistency
10. Load balancing
11. Database schema
12. Failure scenarios
13. Observability
14. Security
15. Lab mode

---

## 1. Topology & Docker

### 1.1 Containers (8)

| Container | Image/Build | Ports (host:container) | Purpose | Depends on |
|---|---|---|---|---|
| `frontend` | nginx serving Vite build | 3000:80 | UI | `gateway` (started) |
| `gateway` | `docker/gateway.Dockerfile` | 8080:8080 | REST API, JWT, load balancer, lab orchestration | `bank-node-*` (started, not healthy — gateway tolerates absent nodes) |
| `bank-node-1` | `docker/bank-node.Dockerfile` | 50051:50051 (gRPC, for grpcurl debugging) | Peer node, priority 1 | `db-1` healthy |
| `bank-node-2` | same image | 50052:50051 | Peer node, priority 2 | `db-2` healthy |
| `bank-node-3` | same image | 50053:50051 | Peer node, priority 3 | `db-3` healthy |
| `db-1` `db-2` `db-3` | `postgres:16-alpine` | 5441/5442/5443:5432 | One DB per node (never shared) | — |

Internal-only: node HTTP health endpoint `:9000/healthz` (used by Docker health check; the only non-gRPC listener on a node).

- **Network:** single user-defined bridge `bank-net`. Service discovery = Docker DNS (`bank-node-2:50051`).
- **Volumes:** `db1-data`, `db2-data`, `db3-data` (named, persistent). `docker compose down -v` wipes state.
- **Restart policy:** `unless-stopped` for nodes/gateway (genuine crashes self-heal; manual `stop` stays stopped).
- **Health checks:** Postgres `pg_isready`; nodes `GET /healthz` (200 only when DB reachable and gRPC server listening); gateway `GET /api/health`.
- **Startup order:** DBs → nodes → gateway → frontend. Nodes must **not** require peers to be up (they start in `RECOVERING`, discover peers via heartbeats).
- **Same image, different env:** all three nodes use one image; `NODE_ID` differentiates.

### 1.2 Environment variables

| Var | Service | Example | Meaning |
|---|---|---|---|
| `NODE_ID` | node | `2` | Unique numeric ID (1..N) |
| `NODE_PRIORITY` | node | `2` | Election priority (default = `NODE_ID`; higher wins) |
| `PEERS` | node | `1=bank-node-1:50051,2=bank-node-2:50051,3=bank-node-3:50051` | Static membership list (includes self) |
| `DATABASE_URL` | node | `postgres://bank:***@db-2:5432/bank` | Own DB only |
| `JWT_SECRET` | gateway, node | (from `.env`) | HS256 signing key (node signs on login; gateway verifies) |
| `LAB_MODE` | gateway, node | `true` | Enables LabService + `/api/lab/*` |
| `ELECTION_ALGORITHM` | node | `bully` | Initial algorithm (`bully`\|`ring`); runtime-changeable |
| `CONSISTENCY_MODE` | node | `strong` | Initial mode (`strong`\|`eventual`); runtime-changeable |
| `PREEMPT_ON_RECOVERY` | node | `true` | Recovered higher-priority node starts election after catch-up |
| `INITIAL_CLOCK_SKEW_MS` | node | `3000` / `-2000` / `500` | Simulated hardware offset (§6.2) |
| `CLOCK_DRIFT_PPM` | node | `2000` / `-1500` / `500` | Simulated drift rate (exaggerated for demo) |
| `GATEWAY_NODES` | gateway | same as `PEERS` | Node endpoints to balance across |

Timing constants (all overridable via env, defaults below):

| Constant | Default | Used for |
|---|---|---|
| `HEARTBEAT_INTERVAL_MS` | 1000 | Heartbeat send period |
| `FAILURE_TIMEOUT_MS` | 3000 | No heartbeat for this long ⇒ peer DOWN |
| `ELECTION_OK_TIMEOUT_MS` | 1500 | Bully: wait for OK replies |
| `COORDINATOR_WAIT_TIMEOUT_MS` | 3000 | Bully: wait for Coordinator after OK |
| `RING_HOP_TIMEOUT_MS` | 1000 | Ring: per-hop ack deadline before skipping a node |
| `RPC_DEADLINE_MS` | 2000 | Default unary peer RPC deadline |
| `STRONG_ACK_TIMEOUT_MS` | 2000 | Strong mode: wait for backup acks |
| `CLOCK_SYNC_INTERVAL_MS` | 30000 | Berkeley round period |
| `BERKELEY_OUTLIER_MS` | 10000 | Exclude clocks further than this from the average |
| `LB_HEALTH_INTERVAL_MS` | 2000 | Gateway health poll |
| `PG_POOL_MAX` | 10 | Connections per node |
| `PG_LOCK_TIMEOUT_MS` | 3000 | `SET LOCAL lock_timeout` |

### 1.3 Killing things (the demo primitives)

| Action | Command | Real effect |
|---|---|---|
| Crash a node | `docker compose stop bank-node-3` | Process dies; peers detect via missing heartbeats |
| Restore | `docker compose start bank-node-3` | Rejoins as RECOVERING → catch-up → possibly preempts as leader |
| DB failure | `docker compose stop db-2` | Node reports `DB_DOWN`, becomes ineligible for election/reads/writes |
| UI soft-crash | Lab → `CRASH` | Node refuses all RPC and sends nothing (like a dead process, no container kill) |
| UI partition | Lab → `PARTITION` | Peer-to-peer RPC dropped both ways; gateway→node still works |

---

## 2. Bank node internals

One Node.js process. Modules (see CLAUDE.md §7 for paths):

```
gRPC server ── interceptors (request-id, Lamport, trace, fault-mode gate)
   ├─ BankService ─────────► bank/ (auth, accounts, transactions) ─► db/ (pg pool, tx helper)
   ├─ ClusterService ──────► cluster/ election/ clock/ replication/
   ├─ ObservabilityService ► observability/
   └─ LabService (LAB_MODE) ► lab/
Background loops: heartbeat sender · failure detector · replicator (leader) · applier/catch-up (backup)
                  · Berkeley round (leader) · db health check · event-loop lag monitor
Worker pool (piscina): bcrypt hash/verify, CSV statement build, lab CPU tasks
```

### 2.1 Node state

| Field | Values | Notes |
|---|---|---|
| `status` | `STARTING`, `RECOVERING`, `UP`, `DB_DOWN`, `CRASH_SIM`, `PARTITION_SIM` | Process-level health. Only `UP` nodes are election-eligible and read/write-eligible |
| `role` | `LEADER`, `BACKUP`, `CANDIDATE`, `NONE` | `NONE` = no known leader |
| `leaderReady` | bool | Leader finished preparation (§8.5) and may accept writes |
| `epoch` | int | Persisted in `node_state`; monotonically increasing term of leadership |
| `leaderId` | int \| null | Who this node believes is leader |
| `lastSeq` | int | Last log seq applied/committed locally |
| `config` | `{electionAlgorithm, consistencyMode, version}` | Gossiped in heartbeats; higher `version` wins |

### 2.2 Startup sequence

1. Load config; connect to DB (retry with backoff up to 60 s; `/healthz` stays 503 until success).
2. Run migrations (`schema_migrations` table; idempotent).
3. Load `node_state` (epoch, last_seq, lamport checkpoint, clock adjustment, config); insert defaults on first boot.
4. Start gRPC server and `/healthz`. `status = RECOVERING`, `role = NONE`.
5. Start heartbeat sender + failure detector. **Listen for up to 3 s.**
6. If a heartbeat shows a live leader with `epoch ≥ mine` → sync with it (catch-up or snapshot, §9.5) → `status = UP`, `role = BACKUP`.
7. Otherwise start an election using the configured algorithm (`trigger = STARTUP`). Winner enters leader preparation (§8.5).
8. After becoming `BACKUP` with `PREEMPT_ON_RECOVERY=true` and higher priority than the leader: start an election (`trigger = RECOVERY_PREEMPT`). Per Bully, the higher-priority node wins and takes over after preparation.

Cold start of an empty cluster therefore elects node 3; if node 3 boots late, node 2 may lead briefly and node 3 takes over once synced.

---

## 3. Service ownership

| Component | Owns | Never does |
|---|---|---|
| `gateway` | HTTP API, JWT verification, input validation, load balancer state, lab orchestration, REST error mapping | Touch any database; hold financial state |
| `bank-node` | Its own Postgres; banking logic; replication log; Lamport/Berkeley clock; elections; heartbeats | Read another node's DB (peers talk only via gRPC) |
| `frontend` | Presentation, polling hooks | Hold authoritative state; fabricate lab data |

---

## 4. Communication

### 4.1 Layers

| Path | Protocol | Why |
|---|---|---|
| Browser → gateway | HTTPS/HTTP + JSON (REST) | Browsers can't speak native gRPC |
| Gateway → node | gRPC | RPC experiment; typed contracts; deadlines |
| Node ↔ node | gRPC | Heartbeats, elections, Berkeley, replication, forwarding |

**REST is not claimed as RPC.** The RPC experiment is the gRPC layer. The RPC Communication lab page shows real gRPC calls.

### 4.2 Proto files (`proto/`)

| File | Service | Callers | Summary |
|---|---|---|---|
| `bank.proto` | `BankService` | gateway→node, node→leader (forwarding) | Business operations |
| `cluster.proto` | `ClusterService` | node↔node (and `Ping` from gateway) | Heartbeat, elections, Berkeley, replication, snapshot |
| `observability.proto` | `ObservabilityService` | gateway→node | Read-only state: status, events, rpc trace, elections, clock, replication, integrity |
| `lab.proto` | `LabService` | gateway→node (LAB_MODE only) | Fault modes, config, triggers, synthetic work |

Full message definitions: [api-reference.md §6](api-reference.md).

### 4.3 gRPC metadata (every call)

| Key | Set by | Meaning |
|---|---|---|
| `x-request-id` | gateway (generated or from `X-Request-Id`) | Correlation ID across all hops |
| `x-lamport` | every caller (client interceptor) | Sender's Lamport value *after* send-tick |
| `x-origin` | every caller | Caller identity: `gateway` or `node-<id>` |
| `x-forwarded-by` | entry node when forwarding a write | Prevents forwarding loops (leader never re-forwards) |

Server trailers carry `x-lamport` back; the client interceptor applies the receive rule on response too.

### 4.4 Serialization & stubs

Protocol Buffers v3 binary. Stubs are loaded dynamically with `@grpc/proto-loader`; TS types generated with `proto-loader-gen-types` into `packages/shared/src/generated` (generated code is git-ignored, produced by `npm run proto:gen`). Server implementations live in `bank-node/src/grpc/`. Gateway has one client per node with channel options: keepalive 10 s, max reconnect backoff 2 s.

### 4.5 Deadlines & error handling

| Call | Deadline |
|---|---|
| Gateway → node, read | 3 s |
| Gateway → node, write | 8 s (node→leader forward inherits remaining time minus 500 ms) |
| Heartbeat / Ping / Election / Coordinator / GetTime / AdjustClock | 1–2 s (`RPC_DEADLINE_MS`) |
| AppendEntries | 2 s |
| GetSnapshot (stream) | 30 s |

gRPC status → application behavior:

| gRPC status | Meaning | Handling |
|---|---|---|
| `UNAVAILABLE` | Node down/partitioned | Mark peer suspect; gateway retries another node (idempotent calls) |
| `DEADLINE_EXCEEDED` | Slow/timeout | Same as above; counted in LB latency stats |
| `FAILED_PRECONDITION` + detail `NOT_LEADER` / `LEADER_NOT_READY` / `NO_QUORUM` | Cluster state issue | Gateway retry with backoff (§10.4) |
| `INVALID_ARGUMENT`, `NOT_FOUND`, `PERMISSION_DENIED`, `ALREADY_EXISTS` | Client error | No retry; map to 4xx |
| `ABORTED` | Lock timeout/deadlock | Retry once on node; otherwise 409/503 |

Application error details are carried in `google.rpc`-style `ErrorInfo` equivalent: gRPC trailer `x-error-code` (string from the api-reference error table).

### 4.6 Java RMI note

Not required (owner confirmed). If ever required, an optional standalone `rmi-demo/` Java module could expose `balance()`/`ping()` and call the gateway, sharing no code with the main system. **Do not build it unless asked.**

---

## 5. Concurrency & transaction processing

### 5.1 How concurrency actually works here

Node.js has one JavaScript thread per process, but concurrency is real at three levels:

1. **Event loop + async I/O** — a node handles many in-flight gRPC calls concurrently; each awaits Postgres.
2. **Postgres connection pool (`PG_POOL_MAX=10`)** — truly parallel transactions inside Postgres, which arbitrates conflicts with row locks.
3. **Worker threads (`piscina`)** — real OS threads for CPU-bound work: bcrypt hashing on register/login, CSV statement generation, and lab CPU tasks. Keeps the event loop responsive (measured by `perf_hooks.monitorEventLoopDelay`).

Also concurrent across the cluster: multiple nodes receive requests simultaneously; background loops (heartbeat, replicator, election monitor) run alongside request handling.

Pool config: `minThreads = 1`, `maxThreads = min(4, cpus)`, queue limit 100 (reject with `RESOURCE_EXHAUSTED` beyond).

### 5.2 Correctness mechanisms (and why)

| Mechanism | Purpose |
|---|---|
| **Single writer (leader only)** | All balance mutations run on one node → no cross-node write conflicts |
| **DB transaction + `SELECT … FOR UPDATE`** on affected accounts | Pessimistic row lock serializes concurrent debits on the same account |
| **Lock ordering** — lock accounts `ORDER BY id` | Prevents deadlock in crossing transfers (A→B vs B→A) |
| **`READ COMMITTED` isolation** | After waiting on a row lock Postgres re-reads the latest committed row, so the second withdrawal sees the reduced balance. `SERIALIZABLE` rejected (retry storms; locks already sufficient) |
| **`CHECK (balance_paise >= 0)`** | Database refuses an overdraft even if app logic is wrong |
| **`version` column on accounts** | Incremented on every change; used by backups to ignore stale row images and shown in UI |
| **Idempotency keys** | Duplicate submit/retry applies exactly once (§5.4) |
| **`lock_timeout` 3 s** | Bounded waits; failure surfaces as `ABORTED` → retry/503 |
| **Log sequence counter row** | Gapless, ordered replication `seq` (§9.2) |

### 5.3 Worked example — the 7,000 vs 6,000 race

Account balance ₹10,000 (1,000,000 paise). Two withdrawals arrive at the same instant (possibly at different entry nodes; both forwarded to the leader).

1. Tx-A and Tx-B each `BEGIN` and insert their idempotency rows (different keys).
2. Both run `SELECT … FROM accounts WHERE id = $1 FOR UPDATE`. Postgres grants the lock to Tx-A; Tx-B **blocks**.
3. Tx-A validates 10,000 ≥ 7,000, sets balance 3,000, inserts transaction `COMMITTED`, appends log entry, commits.
4. Tx-B unblocks; the locked row is re-read at the new committed version: balance 3,000.
5. Tx-B validates 3,000 < 6,000 → inserts transaction `REJECTED(INSUFFICIENT_FUNDS)`, balance unchanged, commits.

Result: exactly one success, final balance ₹3,000, never negative. 20 concurrent ₹1,000 withdrawals from ₹10,000 → exactly 10 `COMMITTED`, 10 `REJECTED`, final ₹0.

### 5.4 Transaction algorithm (leader, per request)

Pre-transaction: Gateway checks (validation 400, auth 401, rate limit 429) and node pre-checks (`amount > 0`, `SAME_ACCOUNT`, malformed input) happen before `BEGIN` — no idempotency key is stored.

```
BEGIN;                                     -- READ COMMITTED
SET LOCAL lock_timeout = '3s';
-- 1. Idempotency check / registration
INSERT INTO idempotency_keys(user_id, key, request_hash) VALUES (...) ON CONFLICT DO NOTHING;
IF no row inserted:
    ROLLBACK; read stored response (same hash) or fail IDEMPOTENCY_KEY_REUSED (different hash); RETURN it.
    -- (a concurrent duplicate blocks on the unique index until the first commits, then returns its result)
-- 2. Lock accounts in id order
SELECT id, balance_paise, status, user_id, version FROM accounts WHERE id IN (...) ORDER BY id FOR UPDATE;
-- 3. Validate existence and authorization:
IF account not found OR caller not owner (source):
    ROLLBACK; RETURN NOT_FOUND / FORBIDDEN;   -- key not persisted, no transaction row
-- 4. Validate business rules:
IF account status != ACTIVE (source/dest) OR funds < amount:
    -- Record REJECTED transaction; balances untouched; key persisted with 422 error response
    INSERT INTO transactions(status='REJECTED', reject_reason=...);
    UPDATE idempotency_keys SET response = <422 error body>, http_status = 422;
    COMMIT; RETURN 422 (INSUFFICIENT_FUNDS / ACCOUNT_NOT_ACTIVE);
-- 5. Apply COMMITTED transaction
UPDATE accounts SET balance_paise = balance_paise ± $amt, version = version + 1, updated_at = now() WHERE id = ...;
INSERT INTO transactions(status='COMMITTED', ...);  -- id, reference, type, lamport, physical_ts, node ids, epoch
-- 6. Stamp + log (accounts first, counter row LAST — fixed lock order everywhere)
lamport := clock.tick();  physical_ts := physicalClock.now();
UPDATE node_state SET last_seq = last_seq + 1 RETURNING last_seq;     -- row lock serializes commit tail
INSERT INTO replication_log(seq, epoch, op_type='TXN_APPLIED', payload=<row images + idempotency result>, lamport, ...);
UPDATE idempotency_keys SET response = <201 success body>, http_status = 201;
COMMIT;
-- 7. After commit
replicator.notify(seq);
IF consistencyMode == 'strong':
    await acks (§9.3); -- >=1 ack -> 201; 0 acks within timeout -> 202 COMMITTED_PENDING_REPLICATION
ELSE:
    return 201 result immediately;
```

Lock order is always: idempotency row → accounts (by id) → `node_state` counter. Never any other order. Infrastructure errors (lock timeout, DB failure, NO_LEADER, LEADER_NOT_READY) cause rollback with no key persisted, allowing safe retry. The frontend generates a new UUID idempotency key per new user submission so a rejected attempt can be retried with corrected inputs.

### 5.5 Transaction flows

**Deposit** (own account) → lock account → balance += amt → log.
**Withdraw** (own account) → lock account → check funds → balance −= amt → log.
**Transfer** (own source → any destination account number) → resolve destination id → lock both by id → check source funds, destination `ACTIVE` → debit + credit in the same DB transaction → log. Debit and credit are atomic: both or neither.

End-to-end path (transfer):
`Browser → gateway (JWT, zod, Idempotency-Key) → LB picks node N → N.BankService.Transfer → (if N ≠ leader) gRPC forward to leader → leader executes §5.4 → AppendEntries to backups → (strong) wait acks → response bubbles back with meta {entryNode, processedBy, lamport, seq}`.

### 5.6 Failure handling inside a transaction

| Situation | Behavior |
|---|---|
| Insufficient funds / Account not active | `REJECTED` transaction recorded; 422 stored in `idempotency_keys`; replay returns identical 422 |
| Invalid inputs / Forbidden / Not found | Pre-check or rollback; no key stored; client receives 400/403/404 |
| Lock timeout / deadlock | rollback; one automatic retry on node; then `ABORTED` → 503 `RETRY_LATER` (key not stored) |
| DB connection lost mid-tx | rollback (Postgres); node marks `DB_DOWN`; client sees 503; retry with same key is safe |
| Leader crash before commit | nothing persisted; gateway retries on new leader with same key → applied once |
| Leader crash after commit, before ack to client | gateway retries with same key; if entry replicated, new leader returns stored result; if not (eventual mode), write lost and applied again |
| Zero backups UP at write time (strong) | Pre-check rejects BEFORE executing with `NO_QUORUM` (503); nothing committed, no key stored |
| Backups UP but zero ack within timeout (strong) | Committed locally; returns `202 COMMITTED_PENDING_REPLICATION`; retry with same key returns result once replicated |
| Backup unreachable / times out with ≥1 other backup acking (strong) | Non-responsive backup marked `LAGGING`; commit succeeds (201); backup catches up on recovery |

---

## 6. Clocks

### 6.1 Lamport logical clock (`clock/lamport.ts`)

Each process (gateway = id 0, nodes 1..N) keeps integer `L`.

| Event | Rule |
|---|---|
| Local event (txn processed, state change, log append) | `L = L + 1` |
| Send (RPC request, replication entry, election msg, heartbeat) | `L = L + 1`; attach `L` as `x-lamport` |
| Receive (request or response) | `L = max(L, received) + 1` |

Implementation: **gRPC client + server interceptors in `packages/shared`** apply the rules automatically, so no call path can forget. Lamport value is persisted to `node_state` every 100 events and on shutdown; on restart `L = persisted + 1` (monotonic across restarts; still correct because the first received message fixes it).

Everything records `lamport`: `event_log`, `transactions`, `replication_log`, `election_history` messages, `rpc_trace`.

Ordering: sort merged events by `(lamport ASC, nodeId ASC)`. Lamport gives a total order consistent with causality (if a → b then L(a) < L(b)); the converse does not hold — the lab page shows a note and highlights **concurrent** events (no causal path) when asked.

Example the UI must be able to show:
```
gateway   L=10  send Transfer → node-1
node-1    L=11  recv (max(0,10)+1)           ; forwards to leader: L=12 send
node-3    L=13  recv; commit txn L=14; send AppendEntries L=15
node-2    L=16  recv AppendEntries (max(9,15)+1); apply L=17; ack L=18
```

### 6.2 Physical clock — simulated hardware clock

All containers share the host kernel clock, so real drift is ≈ 0 and synchronization would be invisible. Each node therefore wraps the OS clock in a **software hardware-clock** (the only sanctioned simulation):

```
hw(t)      = realNow(t) + INITIAL_CLOCK_SKEW_MS + CLOCK_DRIFT_PPM × 1e-6 × (realNow(t) − processStart)
synced(t)  = hw(t) + adjustmentMs            // adjustmentMs persisted in node_state
```

Everything else is real: the Berkeley protocol, its RPCs, RTTs, computation, and adjustments. Because containers share the real time, the lab page can also show **ground-truth error** `synced − realNow` (labelled "simulation reference"). Berkeley converges nodes to the *cluster average*, not to true time — the UI shows this.

Demo values: node1 skew +3000 ms / +2000 ppm; node2 −2000 ms / −1500 ppm; node3 +500 ms / +500 ppm.

`physicalClock.now()` is **monotonic**: `max(synced(t), lastIssued + 1ms)`, so a backward adjustment never produces decreasing transaction timestamps.

### 6.3 Berkeley algorithm (`clock/berkeley.ts`)

**Master = current leader.** Runs every `CLOCK_SYNC_INTERVAL_MS`, on manual trigger, ~5 s after a leader becomes ready, and when a node rejoins.

For each participating node *i* (including the master itself as `d=0`):

1. Master records `t_send` (its synced clock), calls `ClusterService.GetTime`.
2. Node replies with its synced time `T_i`.
3. Master records `t_recv`; `RTT_i = t_recv − t_send`.
4. Estimated node clock at `t_recv`: `T_i + RTT_i / 2`. Offset relative to master: `offsetBeforeMs` ($d_i$) = `T_i + RTT_i/2 − t_recv`.

Then:

5. Valid set `V = { i : |d_i| ≤ BERKELEY_OUTLIER_MS }` (master always valid). Clocks outside the bound are **excluded from the average** (fault tolerance against a bad clock) but still corrected.
6. `avg = (Σ_{i∈V} d_i) / |V|` (informational `averageMs`, offset relative to master's pre-round clock).
7. Adjustment for each node: `adjustMs` ($a_i = avg − d_i$). Master applies `a_master = avg`.
8. Master sends `AdjustClock(round_id, a_i)`; node does `adjustmentMs += a_i`, persists, replies with cumulative adjustments `{adjustment_before_ms, adjustment_after_ms}`.
9. **Verification pass:** After all `AdjustClock` calls complete, the master executes a second `GetTime` sweep across all nodes. It measures `residualAfterMs` for each node using the same RTT/2 offset formula. This is a **measured, not computed** value confirming post-sync pairwise offset is < 50 ms (UI "After" column = `residualAfterMs`; "Before" column = `offsetBeforeMs`).
10. Master stores the round in `clock_sync_history` (per-node `{nodeId, rttMs, offsetBeforeMs, included, adjustMs, residualAfterMs, skipped}`).

Properties and handling:

- **Drift:** between rounds clocks diverge again (visible in UI as growing offsets).
- **Node unreachable:** skipped for this round; marked `skipped`. Missing nodes don't block the round.
- **Master fails mid-round:** round abandoned (adjustments only sent after all `GetTime` replies are in; a lost `AdjustClock` just means that node corrects next round). New leader's first round runs ~5 s after it is ready.
- **Node joins/rejoins:** leader runs an immediate round when a peer transitions DOWN→UP.
- **Step vs slew:** adjustments are applied as a step (documented simplification); monotonic wrapper protects timestamps.
- **Concurrent rounds:** a `round_id` + "round in progress" flag on the master prevents overlap.

Physical timestamps are written to `transactions.physical_ts` and `event_log.physical_ts`; Lamport remains the source of causal order.

---

## 7. Membership & failure detection (`cluster/`)

Static membership from `PEERS`. Every node sends `Heartbeat` to every peer every `HEARTBEAT_INTERVAL_MS`:

```
HeartbeatMsg {
  node_id, status, role, epoch, leader_id, last_seq, lamport,
  config { election_algorithm, consistency_mode, version },
  active_requests, event_loop_lag_ms, sent_at(synced time)
}
```

Failure detector per peer: `lastHeartbeatAt`. Peer is **DOWN** if `now − lastHeartbeatAt > FAILURE_TIMEOUT_MS`; **UP** again on the next successful heartbeat (event `NODE_RECOVERED`). Nodes whose heartbeat reports `status ≠ UP` (e.g., `DB_DOWN`) are treated as **unavailable** for election/read/write purposes even though they are reachable.

Heartbeat events are held in the in-memory trace only (not `event_log`) to avoid flooding; state *changes* (UP/DOWN) are logged.

Leader failure detection: a `BACKUP` that marks its `leaderId` DOWN, or sees a leader with `status≠UP`, starts an election after a priority-scaled jitter `(maxPriority − myPriority) × 100 ms` (higher nodes go first → fewer redundant messages; correctness doesn't depend on it).

---

## 8. Elections (`election/`)

Leader == primary. Algorithm selected by `config.electionAlgorithm` (gossiped; changeable from the UI). Both produce the same outcome type `{electionId, winner, epoch, participants, messages[]}`.

**Eligibility:** only nodes with `status = UP` participate/respond. `DB_DOWN`, `CRASH_SIM`, `RECOVERING` (not yet synced) nodes do not reply OK / forward the token.

**Epoch:** every successful election yields `epoch = max(epoch values seen) + 1` (own epoch, epochs from heartbeats and OK replies). Epoch is persisted before the winner announces.

### 8.1 Bully algorithm (default)

Messages: `Election(from, epoch, election_id)` → reply `OK`; `Coordinator(leader, epoch, election_id)`.

1. **Initiate** (leader timeout, startup, manual, or recovery preempt): node *I* sets `role=CANDIDATE`, sends `Election` to all nodes with **higher priority**.
2. Any higher node that is `UP` replies `OK` immediately and **starts its own election** (if not already running).
3. If *I* receives **no OK** within `ELECTION_OK_TIMEOUT_MS` → *I* wins: computes new epoch, persists, sends `Coordinator` to **all other nodes**, enters leader preparation (§8.5).
4. If *I* receives ≥1 `OK` → *I* stops and waits `COORDINATOR_WAIT_TIMEOUT_MS` for a `Coordinator`; if none arrives, restart from step 1.
5. **Receiving `Coordinator`:** accept if `epoch > myEpoch` (or same epoch & same leader). Set `leaderId`, `epoch`, `role=BACKUP`, cancel in-flight election. A current leader receiving a higher-epoch Coordinator **steps down** immediately.
6. **Recovered node:** after sync, if its priority is higher than the current leader and `PREEMPT_ON_RECOVERY`, it initiates an election and (being highest) wins, taking over.

Demo trace (3 nodes, node 3 killed): node 2 detects timeout → sends `Election` to node 3 (no reply, timeout) → no OK → node 2 wins → `Coordinator(2, epoch+1)` to nodes 1 and 3(down) → node 1 becomes BACKUP of 2.

### 8.2 Ring algorithm

Logical ring ordered by node ID ascending, wrapping (1→2→3→1). Ring order is computed from the static membership; **dead nodes are skipped** at runtime (reconstruction by skipping).

Messages: `RingElection(election_id, initiator, candidates[{id,priority}])`, `RingCoordinator(election_id, winner, epoch, participants[])`. Each hop returns an immediate ack (empty reply) on receipt.
- **Non-blocking hop forwarding:** The handler returns the empty ack immediately, then forwards to its successor in the background. It **never holds the inbound RPC open** while forwarding.
- `RING_HOP_TIMEOUT_MS` applies to the ack of the outbound forward call; a failed ack means skip to the next node and record it in `skipped`.

1. **Initiate:** *I* sends `RingElection{candidates=[I]}` to its successor.
2. **Each node on receipt:** returns empty ack immediately, appends `{id, priority}` (if eligible), and forwards to its successor asynchronously. If the successor's ack is not received within `RING_HOP_TIMEOUT_MS`, it tries the *next* node in the ring (records `skipped=[id]`).
3. When the message returns to the initiator (its own id already in `candidates`) → **winner = highest priority** in `candidates`. Epoch = max+1.
4. **Coordinator round:** initiator sends `RingCoordinator` around the ring once; every node sets leader/epoch; when it returns to the initiator the election completes.
5. **Initiator dies mid-election:** token lost; failure detectors start a fresh election on timeout.
6. **Concurrent elections:** a node already holding an active election with a *higher-priority initiator* drops tokens from lower-priority initiators; same winner results regardless.

### 8.3 Algorithm switching

`PUT /api/lab/config/election-algorithm` → node bumps `config.version` → gossiped via heartbeat → all nodes adopt. Both algorithms are always loaded; the setting selects which one *initiates* elections. Both respond to the other's messages if received.

### 8.4 Election history

Each node records elections it observed in local `election_history` (`election_id`, `algorithm`, `trigger`, `initiator`, `winner`, `epoch`, `participants`, `messages[]` with `{from,to,type,lamport,at}`, timestamps, `outcome`). The gateway merges rows across nodes by `election_id` for the UI.

### 8.5 Leader lifecycle & preparation

After winning/learning it is leader, a node runs **preparation** (`leaderReady=false` → writes rejected `LEADER_NOT_READY`, retryable):

1. Query reachable peers via `GetStatus`: `(lastEntryEpoch, lastSeq)`.
2. **Log reconciliation:** if some peer's log is more up-to-date than mine (higher `lastEntryEpoch`, or equal epoch & higher `lastSeq`), pull from it via `GetLogEntries` (or snapshot if the logs diverge) before proceeding. Highest-priority ≠ most up-to-date, so this step is essential.
3. **Quorum gate:** in `strong` mode require at least one reachable peer (majority of 3 = self + 1) before `leaderReady`; otherwise stay not-ready (writes get `NO_QUORUM`). In `eventual` mode become ready immediately after attempting step 2.
4. Probe each backup with an empty `AppendEntries` to learn its `matchSeq`; start the replicator.
5. `leaderReady = true`; log `FAILOVER_COMPLETED` (with detection→ready duration). Trigger a Berkeley round in ~5 s.

**Step-down:** on any message with a higher epoch → `role=BACKUP`, stop replicator, run divergence check (§9.5).

---

## 9. Replication & consistency (`replication/`)

Protocol is custom log shipping (Raft-like *shape*, but leadership comes from Bully/Ring and there is no voting — **not consensus**).

### 9.1 Replicated vs local data

| Replicated through the log | Node-local (never replicated) |
|---|---|
| `users`, `accounts`, `transactions`, `idempotency_keys`, `replication_log` | `node_state`, `event_log`, `election_history`, `clock_sync_history`, `schema_migrations` |

### 9.2 Log entries

`replication_log(seq, epoch, op_type, payload, lamport, origin_node, physical_ts)`; `seq` is gapless and contiguous, assigned **inside the business DB transaction** (counter row), so a committed change always has exactly one log entry and vice versa.

| `op_type` | Payload (row images, not statements) |
|---|---|
| `USER_CREATED` | `user` row |
| `ACCOUNT_CREATED` | `account` row |
| `TXN_APPLIED` | `transaction` row, post-change `accounts` rows (with `version`), `idempotency_keys` row |

Row-image payloads make apply deterministic: backups upsert rows (`INSERT … ON CONFLICT (id) DO UPDATE … WHERE excluded.version > accounts.version` for accounts) rather than re-executing logic.

### 9.3 Write path & consistency modes

Leader after commit calls `replicator.notify(seq)`. One sender loop per backup ships all entries `> matchSeq` via `AppendEntries(epoch, leader_id, prev_seq, prev_epoch, entries[], leader_commit_seq)`; backup applies each entry in its own DB transaction (check `seq == lastSeq + 1`), records `REPLICATION_APPLIED`, acks `{ok, last_seq}`.

| | **Strong (synchronous)** | **Eventual (asynchronous)** |
|---|---|---|
| Pre-check | If leader believes 0 backups are UP, rejects write BEFORE executing with `NO_QUORUM` (HTTP 503). Nothing is committed. | Write accepted as long as leader is ready (AP). |
| Client ack | After local commit: waits for **every backup currently believed UP** (≤ `STRONG_ACK_TIMEOUT_MS`). If ≥1 backup acks (majority of 3: leader + ≥1 backup) → HTTP 201 success. Any backup that times out is marked `LAGGING`. If backups were UP but 0 acks arrive within timeout → returns `202 COMMITTED_PENDING_REPLICATION`; client retry with same key returns result once replicated. | Immediately after local commit (HTTP 201). Backups catch up in the background. |
| Backup that times out | Marked `LAGGING` (excluded from fresh reads until caught up); commit still OK if ≥1 backup acked | n/a |
| Zero backups reachable | Pre-check rejects with `NO_QUORUM` (HTTP 503); if backups drop mid-commit and 0 ack → status `COMMITTED_PENDING_REPLICATION` (HTTP 202) | Write accepted (AP) |
| Read from backup | Fresh (forwarded to leader if `lastSeq < leaderSeq` or backup is `LAGGING`) | May be stale; response includes `stale`, `lagEntries` |
| Leader crash | Acknowledged writes survive (present on ≥1 surviving node; leader-prep §8.5 pulls them) | Acknowledged writes **may be lost** if not yet shipped |
| Partitioned leader | Cannot get acks → rejects writes (`NO_QUORUM`, CP) | Keeps accepting writes → diverges (AP) |

Mode is cluster-wide config (gossiped); changing it affects subsequent writes. Replication lag metrics: `lagEntries = leader.lastSeq − backup.lastSeq`, `lagMs = now − timestamp of oldest unapplied entry`.

Lab-only **injected replication delay** (`LabService.SetConfig.replication_delay_ms`, per node) delays the sender loop so lag is visible in eventual mode and strong-mode latency visibly increases.

### 9.4 Read consistency

- Any node may serve reads (load-balanced).
- `strong` mode: a `BACKUP` serves a read only if `lastSeq ≥ leaderSeq` (leader's latest `last_seq` from heartbeats) and it isn't `LAGGING`; else it forwards the read to the leader.
- `eventual` mode: serve locally, attach `{appliedSeq, leaderSeq, stale}`.
- Login/Register (auth) are always handled by the leader.
- Known gap: a backup that just fell behind may serve one stale read within one heartbeat interval in strong mode (documented limitation).

### 9.5 Catch-up, snapshot, divergence

**Catch-up (gap):** backup replies `ok=false, last_seq=k`; leader resends from `k+1` (or backup pulls via `GetLogEntries(from_seq)`).

**Divergence check** (on rejoin, step-down, or `prev_epoch` mismatch): compare `(seq, epoch)` of my last entry with the leader's entry at that seq.
- Same → plain catch-up.
- Different or I have `lastSeq` > leader's → my tail is divergent (e.g., an old leader's eventual-mode writes). **Snapshot resync:** call `GetSnapshot` (server-streaming) on the leader; in **one DB transaction** truncate replicated tables and load the stream; set `lastSeq`. Divergent entries are copied into `event_log` as `DIVERGENT_WRITES_DISCARDED` (for audit and demo).

Snapshot size is small (lab data), so full snapshot is acceptable.

### 9.6 Primary-backup failover (end to end)

1. Leader L stops. Peers' failure detectors flag it after ≤ `FAILURE_TIMEOUT_MS`.
2. A backup starts an election (§8). New leader N wins; epoch++.
3. N runs preparation (§8.5): pulls missing entries from the most up-to-date survivor; probes backups.
4. `leaderReady` → N accepts writes; gateway retries (with idempotency key) succeed. Expected unavailability window ≈ 4–7 s (3 s detection + ≤1.5 s election + prep).
5. L restarts → `RECOVERING` → hears N's heartbeat (epoch higher) → divergence check → catch-up or snapshot → `BACKUP`.
6. If `PREEMPT_ON_RECOVERY` and L has higher priority: L starts an election, wins, runs preparation (already in sync) and resumes as leader (epoch++; N steps down on higher epoch).

### 9.7 Guarantees and limitations (state these honestly in the viva)

| Guarantee | Holds when |
|---|---|
| No overdraft, atomic debit+credit, exactly-once per idempotency key | Always (single leader + DB locks + keys) |
| Acknowledged writes survive any single node failure | `strong` mode |
| Only one leader accepts *committed* writes | `strong` mode (needs majority acks), thanks to epoch fencing |
| Linearizable reads | Not guaranteed (see §9.4 gap) |

Limitations: not consensus (no voting, no formal proof; Bully can elect a stale node, mitigated by leader-prep); `eventual` mode can lose or diverge writes; split-brain is *prevented for commits in strong mode* and *tolerated then repaired* in eventual mode; static membership (3 nodes); gateway and its LB are a single point of failure; clock adjustments are step-based.

---

## 10. Load balancing (`gateway/src/loadbalancer`)

### 10.1 Algorithm — Least Connections

For each incoming request, among **healthy** nodes choose the one with the fewest **active (in-flight) requests**; ties broken by lowest EWMA latency, then lowest node id. Counter incremented on dispatch, decremented in `finally` (success, error, or timeout).

### 10.2 State per node

`{nodeId, address, healthy, status, activeRequests, totalRequests, failures, ewmaLatencyMs (α=0.2), lastHealthCheckAt, capacity (static soft max, default 50)}`.
A node at capacity is skipped unless all are.

### 10.3 Health checks

Every `LB_HEALTH_INTERVAL_MS` call `ObservabilityService.GetStatus` on each node (deadline 1 s). Unhealthy after **2 consecutive failures** or `status ≠ UP`; healthy again after **1 success** with `status = UP`. Passive signal: a failed dispatch (`UNAVAILABLE`/`DEADLINE_EXCEEDED`) counts as a failure immediately.

### 10.4 Retry rules

- Reads and idempotent writes (always keyed): on `UNAVAILABLE`/`DEADLINE_EXCEEDED`/`NOT_LEADER`/`LEADER_NOT_READY`/`NO_QUORUM`, retry on a (possibly different) node: up to 5 attempts, backoff 500 ms × 2ⁿ, total budget 12 s.
- Non-retryable errors (validation, ownership, insufficient funds) return immediately.

### 10.5 Metrics (exposed via `/api/system/load`)

Per node: active, total, share % of total, avg/EWMA latency, failures, healthy flag, last check. Plus global: requests/min, retry count. All are counters kept at runtime — nothing precomputed.

### 10.6 Lab support

`SimulateWork(duration_ms)` RPC and `artificial_latency_ms` per node let the evaluator generate overlapping requests through the **same dispatch code** and show least-connections steering traffic away from a slow node.

---

## 11. Database schema

Migrations are plain SQL in `database/migrations/` (`0001_init.sql`, …), applied to **each node's own DB** at startup. Money = `BIGINT` paise.

```sql
-- ===== Replicated tables =====
CREATE TABLE users (
  id            UUID PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

CREATE TABLE accounts (
  id             UUID PRIMARY KEY,
  user_id        UUID NOT NULL REFERENCES users(id),
  account_number CHAR(12) NOT NULL UNIQUE,
  nickname       TEXT,
  balance_paise  BIGINT NOT NULL DEFAULT 0 CHECK (balance_paise >= 0),
  currency       CHAR(3) NOT NULL DEFAULT 'INR',
  status         TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','FROZEN','CLOSED')),
  version        BIGINT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL
);
CREATE INDEX accounts_user_idx ON accounts(user_id);

CREATE TABLE transactions (
  id                        UUID PRIMARY KEY,                 -- transaction_id
  reference                 TEXT NOT NULL UNIQUE,             -- human-readable, e.g. TXN-20261007-9F3KQ2
  type                      TEXT NOT NULL CHECK (type IN ('DEPOSIT','WITHDRAWAL','TRANSFER')),
  source_account_id         UUID REFERENCES accounts(id),
  destination_account_id    UUID REFERENCES accounts(id),
  amount_paise              BIGINT NOT NULL CHECK (amount_paise > 0),
  status                    TEXT NOT NULL CHECK (status IN ('COMMITTED','REJECTED')),
  reject_reason             TEXT,
  note                      TEXT,
  source_balance_after      BIGINT,
  destination_balance_after BIGINT,
  entry_node                SMALLINT NOT NULL,                -- node that received the request
  processed_by_node         SMALLINT NOT NULL,                -- leader that executed it
  epoch                     BIGINT NOT NULL,
  log_seq                   BIGINT NOT NULL,
  lamport                   BIGINT NOT NULL,
  physical_ts               TIMESTAMPTZ NOT NULL,             -- Berkeley-synchronized clock
  created_at                TIMESTAMPTZ NOT NULL
);
CREATE INDEX tx_source_idx ON transactions(source_account_id, created_at DESC);
CREATE INDEX tx_dest_idx   ON transactions(destination_account_id, created_at DESC);

CREATE TABLE idempotency_keys (
  user_id      UUID NOT NULL,
  key          TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response     JSONB,
  http_status  INT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE replication_log (
  seq         BIGINT PRIMARY KEY,
  epoch       BIGINT NOT NULL,
  op_type     TEXT NOT NULL,
  payload     JSONB NOT NULL,
  lamport     BIGINT NOT NULL,
  origin_node SMALLINT NOT NULL,
  physical_ts TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Node-local tables =====
CREATE TABLE node_state (
  node_id            SMALLINT PRIMARY KEY,
  epoch              BIGINT NOT NULL DEFAULT 0,
  last_seq           BIGINT NOT NULL DEFAULT 0,
  leader_id          SMALLINT,
  lamport_checkpoint BIGINT NOT NULL DEFAULT 0,
  clock_adjust_ms    DOUBLE PRECISION NOT NULL DEFAULT 0,
  config             JSONB NOT NULL,       -- {electionAlgorithm, consistencyMode, version}
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE event_log (
  id             BIGSERIAL PRIMARY KEY,
  lamport        BIGINT NOT NULL,
  physical_ts    TIMESTAMPTZ NOT NULL,
  node_id        SMALLINT NOT NULL,
  service        TEXT NOT NULL,
  event_type     TEXT NOT NULL,
  severity       TEXT NOT NULL,
  request_id     TEXT,
  transaction_id UUID,
  peer_node_id   SMALLINT,
  details        JSONB
);                                          -- retention: keep newest 10,000 rows

CREATE TABLE election_history (
  election_id UUID PRIMARY KEY,
  algorithm   TEXT NOT NULL,                -- 'bully' | 'ring'
  trigger     TEXT NOT NULL,                -- STARTUP | LEADER_TIMEOUT | MANUAL | RECOVERY_PREEMPT
  initiator   SMALLINT NOT NULL,
  winner      SMALLINT,
  epoch       BIGINT,
  participants SMALLINT[],
  messages    JSONB NOT NULL DEFAULT '[]',  -- [{from,to,type,lamport,at}]
  outcome     TEXT NOT NULL,                -- COMPLETED | ABORTED | SUPERSEDED
  started_at  TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ
);

CREATE TABLE clock_sync_history (
  round_id    UUID PRIMARY KEY,
  master_node SMALLINT NOT NULL,
  average_ms  DOUBLE PRECISION,
  per_node    JSONB NOT NULL,               -- [{nodeId,rttMs,offsetBeforeMs,included,adjustMs,residualAfterMs,skipped}]
  started_at  TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ
);
```

Deviations from the original schema suggestion (intentional): no replicated `nodes` table (node registry is volatile, computed from heartbeats); no separate `transaction_events` (covered by `event_log` + `transactions` lifecycle fields); per-link replication delivery state (`source_node/target_node/status`) lives in the leader's memory + `REPLICATION_*` events rather than the replicated log (which would be circular).

**Integrity check** (`GetIntegrity`): `{lastSeq, totalBalancePaise, accountCount, txnCount, accountsChecksum = md5(string_agg(id||':'||balance_paise||':'||version, ',' ORDER BY id))}`. After convergence all nodes must match.

---

## 12. Failure scenarios

| # | Scenario | Detection | Recovery | Data consistency | User-visible | Key logs | Expected result |
|---|---|---|---|---|---|---|---|
| F1 | **Leader crashes mid-transaction** | Gateway gets `UNAVAILABLE`; peers miss heartbeats ≤3 s | Gateway retries w/ same key; election; leader-prep | Uncommitted tx vanishes; committed+replicated tx survives; key prevents dup | Brief 503/slow response (≈4–7 s), then success | `NODE_FAILURE_DETECTED`, `ELECTION_STARTED`, `LEADER_ELECTED`, `FAILOVER_COMPLETED` | Each request applied exactly once or fails explicitly; integrity checksums equal |
| F2 | **Backup unavailable** | Leader failure detector; `AppendEntries` timeout | Strong: mark LAGGING, commit if ≥1 ack; on return, catch-up | Backup behind until catch-up; excluded from fresh reads | Slightly higher latency; no errors if one backup remains | `REPLICATION_TIMEOUT`, `NODE_RECOVERED`, `CATCH_UP_COMPLETED` | Writes continue; backup converges after restart |
| F3 | **Leader crash (idle)** | Heartbeat timeout | Election → new leader | None lost (strong) | Leader badge changes; brief write pause | `LEADER_ELECTED` | New leader; old leader rejoins as backup/pre-empts |
| F4 | **RPC timeout / slow node** | `DEADLINE_EXCEEDED` | LB retries on another node; EWMA latency rises; node deprioritized | Unaffected (idempotent) | Slower response | `RPC_RESPONSE` status `DEADLINE_EXCEEDED`, `LB_RETRY` | Request completes elsewhere |
| F5 | **DB connection failure on a node** | DB health check fails twice (≈2 s) → `DB_DOWN`; heartbeat advertises it | Node ineligible; if leader, peers start election; on DB return node re-syncs | Node's DB may lag; catch-up on return | Brief 503 if leader; otherwise none | `DB_DOWN`, `LEADER_STEPPED_DOWN`, `NODE_RECOVERED` | Cluster continues on remaining nodes |
| F6 | **Backend node crash (backup)** | Heartbeats; LB health check | LB stops routing; none needed | None | None (maybe one retry) | `NODE_FAILURE_DETECTED`, `LB_NODE_UNHEALTHY` | Zero requests routed to dead node |
| F7 | **Node rejoins** | First heartbeat after restart | `RECOVERING` → catch-up/snapshot → BACKUP (→ preempt if higher priority) | Converges; divergent tail discarded + audited | Leader badge may move back | `NODE_RECOVERED`, `CATCH_UP_COMPLETED` / `SNAPSHOT_RESYNC`, `LEADER_ELECTED` | Checksums equal on all nodes |
| F8 | **Network partition (UI `PARTITION`)** | Peers stop hearing partitioned node | Majority side elects (if leader isolated); heal → higher-epoch fencing → step down → resync | Strong: isolated leader rejects writes (`NO_QUORUM`). Eventual: isolated leader accepts, then **discards** on heal | Strong: errors on isolated node. Eventual: success then rollback of those writes | `NO_QUORUM`, `LEADER_STEPPED_DOWN`, `DIVERGENT_WRITES_DISCARDED` | CP vs AP trade-off demonstrated |

---

## 13. Observability

**Structured JSON logs** (pino) to stdout; every distributed event includes:
`ts, node, service, level, event, requestId, txnId?, lamport, peer?, msg, …details`.

Event vocabulary (use exactly these names): `RPC_REQUEST`, `RPC_RESPONSE`, `TRANSACTION_CREATED`, `TRANSACTION_COMMITTED`, `TRANSACTION_REJECTED`, `REPLICATION_SENT`, `REPLICATION_ACK`, `REPLICATION_APPLIED`, `REPLICATION_TIMEOUT`, `NODE_FAILURE_DETECTED`, `NODE_RECOVERED`, `ELECTION_STARTED`, `ELECTION_OK_RECEIVED`, `COORDINATOR_ANNOUNCED`, `LEADER_ELECTED`, `LEADER_STEPPED_DOWN`, `FAILOVER_COMPLETED`, `CATCH_UP_COMPLETED`, `SNAPSHOT_RESYNC`, `DIVERGENT_WRITES_DISCARDED`, `CLOCK_SYNC_STARTED`, `CLOCK_SYNC_COMPLETED`, `DB_DOWN`, `LB_ROUTED`, `LB_RETRY`, `LB_NODE_UNHEALTHY`, `LAB_FAULT_SET`. (`NODE_HEARTBEAT` is trace-only.)

Persisted: significant events → `event_log`. Volatile: in-memory ring buffer of the last 500 RPC calls (`rpc_trace`: `{requestId, method, from, to, lamportSend, lamportRecv, startedAt, latencyMs, status}`), heartbeats, LB counters.

Correlation: `x-request-id` is generated at the gateway and appears in logs, events, RPC trace and the API response `meta.requestId`.

---

## 14. Security

- Passwords hashed with bcrypt (cost 10) in the worker pool. Never logged.
- JWT HS256, 1 h expiry, claims `{sub, email}`; gateway verifies; nodes trust gateway-supplied `user_id` on the internal network (assumption: `bank-net` is trusted; mTLS out of scope).
- Authorization: every account operation checks `accounts.user_id = caller`. Transfers: source must be owned; destination only needs to exist (response reveals masked holder name only via lookup endpoint).
- Validation: `zod` schemas at the gateway; parameterized SQL only (`pg` placeholders) — **no string-built SQL**.
- Rate limiting: auth endpoints 10/min/IP, others 300/min/IP.
- CORS restricted to the frontend origin; `helmet` defaults.
- Secrets only in `.env` (git-ignored); `.env.example` has placeholders.
- Idempotency keys scoped per user (no cross-user replay).
- **Lab endpoints** are gated by `LAB_MODE` (default `true` in the demo compose file; set `false` for a "production-like" run). Any authenticated user may use them (single-role decision D22).

---

## 15. Lab mode

`LAB_MODE=true` enables `LabService` and `/api/lab/*`. Lab controls never bypass real mechanisms; they only **inject faults or trigger the real code path**:

| Control | Effect | Real path exercised |
|---|---|---|
| `CRASH` fault mode | Node rejects all RPC and stops sending | Heartbeat timeout → election → failover |
| `PARTITION` fault mode | Peer RPC (ClusterService) dropped both directions | Elections, fencing, strong-mode `NO_QUORUM`, divergence repair |
| Set election algorithm / consistency mode | Config gossip | Bully/Ring selection; sync/async replication |
| Trigger election (bully/ring, chosen initiator) | Calls the real election starter | Full protocol messages |
| Trigger Berkeley round | Calls the real round | Full `GetTime/AdjustClock` exchange |
| Replication delay / artificial latency | Sleeps in sender loop / request handler | Lag visibility, LB steering |
| `SimulateWork`, `CpuTask` | Synthetic load through real dispatch/worker pool | LB, event-loop lag |

Each lab action emits a `LAB_FAULT_SET`/relevant event so the timeline shows what the evaluator did.
