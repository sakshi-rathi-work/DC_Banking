# CLAUDE.md — Distributed Banking System (DBS)

> Master instructions for the AI coding agent (Claude Code / Antigravity IDE).
> Read this file first. Then read the linked document for whatever area you are touching.
> If this file conflicts with the code you find in the repo, **stop and report the conflict** — do not silently choose one.

---

## 1. What we are building

A **small but genuinely distributed banking platform** for a Distributed Computing lab project.

- Users register, log in, open accounts, deposit, withdraw, transfer, and view history.
- Behind the scenes, **3 peer bank nodes** (separate processes/containers, each with its **own PostgreSQL**) cooperate using real gRPC calls, real heartbeats, real elections, real clock synchronization, and an **application-level replication log**.
- A React dashboard shows the banking UI **and** a "Distributed Lab" section where an evaluator can trigger and observe each experiment on the live system.

**Guiding principle: simple banking, real distributed mechanics.**
The banking domain stays deliberately small (3 transaction types, INR only). All the depth goes into making the distributed behavior *real, observable and correct*.

**Anti-goal:** two systems glued together (a bank + a fake demo). Every experiment must run on the same nodes, same database, and same RPC layer as the banking flow.

---

## 2. Document map (read the relevant one before coding)

| Document | Read it when you are… |
|---|---|
| [docs/architecture.md](docs/architecture.md) | building anything backend: nodes, RPC, clocks, elections, replication, load balancer, DB schema, Docker, failure handling |
| [docs/api-reference.md](docs/api-reference.md) | building/consuming REST endpoints, `.proto` files, error codes, response shapes |
| [docs/style-guide.md](docs/style-guide.md) | writing any code, SQL, logs, tests, commits, or frontend UI |
| [docs/testing-and-demo.md](docs/testing-and-demo.md) | writing tests, failure scripts, or preparing the lab viva demo |

This file owns: scope, rules, stack, repo layout, phases, decision log, acceptance criteria.

---

## 3. Confirmed requirements (answered by the project owner — do not re-litigate)

1. **RPC = gRPC on Node.js/TypeScript.** Java RMI is *not* required. Do not add Java.
2. **Database = one PostgreSQL instance per bank node**, with **replication implemented in application code** (log shipping over gRPC). Do **not** use Postgres streaming/logical replication.
3. **Single user role.** No admin/customer split. Every logged-in user can use banking features *and* all monitoring/lab pages.
   - Interpretation (flag if wrong): "sees everything" applies to **system/lab visibility**. Bank data is still **owned** — a user can only operate on their own accounts (ownership checks stay; they are a basic correctness/security rule, not a role system).
   - Lab/fault-injection endpoints are enabled by `LAB_MODE=true` (default in demo compose file), not by a role.

---

## 4. Scope

**In scope**
- Banking: register, login, accounts, deposit, withdraw, transfer, history, CSV statement.
- 7 experiments: gRPC, multithreading/concurrency, physical clock (Berkeley), logical clock (Lamport), Bully election, Ring election, replication/consistency (strong + eventual), plus primary-backup failover, load balancing (least connections), fault tolerance.
- Docker Compose with 8 containers, health checks, persistent volumes.
- Tests: unit, integration, concurrency, fault-injection.

**Explicitly out of scope** (do not add unless the owner asks)
Java RMI · Redis · message brokers (RabbitMQ/Kafka) · Kubernetes · Raft/Paxos (we use Bully/Ring + epochs, not consensus) · more than 3 nodes in tests · multi-currency · interest/loans/cards · email/OTP · role-based access · websockets (use polling) · ORMs.

Every infrastructure component must have a stated purpose in the decision log. If you cannot justify it there, do not add it.

---

## 5. Technology stack

| Layer | Choice | Purpose |
|---|---|---|
| Language | TypeScript (strict), Node.js 20 LTS | One language across gateway, nodes, frontend |
| REST gateway | Express + `zod` + `helmet` + `cors` + `express-rate-limit` + `jsonwebtoken` + `pino` | Client entry point, validation, auth, logging |
| RPC | `@grpc/grpc-js`, `@grpc/proto-loader`, `proto-loader-gen-types` | Inter-process communication (Experiment 1) |
| DB | PostgreSQL 16 via `pg` (no ORM) | ACID, row locks, explicit SQL control |
| Concurrency | `piscina` (worker_threads pool) | CPU-bound work off the event loop |
| Password hashing | `bcryptjs` run inside the worker pool | Real CPU-bound work → real use of worker threads |
| Frontend | React 18, Vite, Tailwind CSS, React Router, TanStack Query, Recharts | Dashboard + polling of live data |
| Tests | Vitest, Supertest | Unit/integration; distributed tests drive `docker compose` |
| Container | Docker, Docker Compose v2, nginx (frontend static serving) | Run/kill/restart nodes independently |
| Docs | OpenAPI 3 (REST, served by gateway at `/api/docs`), `.proto` (RPC) | Contracts |

Adding a dependency requires a one-line justification in the decision log (§12).

---

## 6. System at a glance

```
                 ┌────────────┐
   Browser ────► │  frontend  │  (nginx, static React build, :3000)
                 └─────┬──────┘
                       │ REST/JSON
                 ┌─────▼──────┐   JWT verify · validation · rate limit
                 │  gateway   │   LEAST-CONNECTIONS load balancer · health checks
                 │   :8080    │   lab orchestration · Lamport participant (id 0)
                 └──┬───┬───┬─┘
          gRPC      │   │   │
        ┌───────────┘   │   └───────────┐
 ┌──────▼─────┐  ┌──────▼─────┐  ┌──────▼─────┐
 │ bank-node-1│◄►│ bank-node-2│◄►│ bank-node-3│   peer-to-peer gRPC:
 │ prio 1     │  │ prio 2     │  │ prio 3     │   heartbeats, elections, Berkeley sync,
 └──────┬─────┘  └──────┬─────┘  └──────┬─────┘   AppendEntries (replication), forwarding
        │               │               │
   ┌────▼───┐      ┌────▼───┐      ┌────▼───┐
   │  db-1  │      │  db-2  │      │  db-3  │      one PostgreSQL per node
   └────────┘      └────────┘      └────────┘
```

- Every bank node is a **peer** running identical code. The **elected leader is the primary** (accepts writes); others are **backups**.
- Any node can receive any request (the gateway's load balancer picks it). Writes arriving at a backup are **forwarded over gRPC to the leader**; reads are served locally (subject to the consistency rules in architecture.md §9).
- There is **no separate coordination service**. Heartbeats, elections, clocks and replication are modules *inside* each bank node (they must be peer-to-peer to be meaningful).
- Auth (register/login) is a module inside the bank node (users must be replicated like everything else).

Full detail: [docs/architecture.md](docs/architecture.md).

---

## 7. Repository structure

```
distributed-bank/
├── CLAUDE.md
├── README.md                    # quick start (written in Phase 15)
├── docker-compose.yml
├── .env.example
├── docs/
│   ├── architecture.md  api-reference.md  style-guide.md  testing-and-demo.md
├── proto/
│   ├── bank.proto  cluster.proto  observability.proto  lab.proto
├── packages/
│   └── shared/                  # proto loading, gRPC interceptors (Lamport, request-id, trace),
│                                # logger, error types, config helpers, shared types
├── services/
│   ├── gateway/
│   │   └── src/ routes/ middleware/ loadbalancer/ lab/ openapi/
│   └── bank-node/
│       └── src/
│           ├── bank/            # auth, accounts, transactions (pure rules + SQL repos)
│           ├── cluster/         # membership, heartbeat, failure detector, node status
│           ├── clock/           # lamport.ts, physical-clock.ts, berkeley.ts
│           ├── election/        # bully.ts, ring.ts, election-manager.ts
│           ├── replication/     # log, replicator (leader), applier (backup), catchup, snapshot
│           ├── concurrency/     # worker pool + workers/
│           ├── observability/   # event-log, rpc-trace, integrity
│           ├── lab/             # LAB_MODE-only handlers
│           ├── grpc/            # server wiring, service implementations
│           └── db/              # pool, tx helper, migration runner
├── database/migrations/         # plain .sql, applied by each node at startup
├── frontend/
├── scripts/                     # seed-demo, reset, kill/start node, failover-under-load
├── tests/                       # cross-service integration + distributed tests
└── docker/                      # Dockerfiles, nginx.conf
```

**Module rule:** every distributed algorithm is split into a **pure core** (decisions, no I/O, unit-testable with an injected transport/clock) and a **thin adapter** (gRPC/DB/timers). See style-guide §3.

---

## 8. Experiment → implementation map

| # | Experiment | Where it lives in the real banking flow | Code | Lab UI page |
|---|---|---|---|---|
| 1 | RPC (gRPC) | Every gateway→node call and node→node call (forwarding, replication, heartbeats) | `proto/*`, `packages/shared`, `bank-node/grpc` | RPC Communication |
| 2 | Multithreading / concurrency | Concurrent withdrawals/transfers on the leader; bcrypt + statement export in worker pool | `bank-node/bank`, `bank-node/concurrency` | Concurrency |
| 3 | Physical clock (Berkeley) | Transaction `physical_ts` uses the synchronized clock; leader is time master | `bank-node/clock` | Physical Clock |
| 4 | Logical clock (Lamport) | Every RPC, replication entry, election message and event carries/updates a Lamport timestamp | `clock/lamport.ts` + shared interceptors | Logical Clock |
| 5 | Bully election | Automatic leader (=primary) selection and failover (default algorithm) | `bank-node/election/bully.ts` | Bully Election |
| 6 | Ring election | Same role, switchable at runtime | `bank-node/election/ring.ts` | Ring Election |
| 7 | Replication & consistency | Every committed banking write is a log entry shipped to backups; strong vs eventual | `bank-node/replication` | Replication |
| — | Primary-backup fault tolerance | Failure detection → election → leader catch-up → serve → old primary rejoin/resync | `cluster`, `election`, `replication` | Fault Tolerance |
| — | Load balancing | Gateway routes every request by least active connections with health checks | `gateway/loadbalancer` | Load Balancing |

---

## 9. Rules for the implementation agent

### 9.1 Honesty (the project's whole value)
1. **Never hardcode or fake distributed results** — no static node lists, leaders, offsets, lag values, or distribution percentages in production code paths.
2. **Never fake node status.** Status comes from heartbeats / health checks / RPC results.
3. **Never fake election outcomes.** Leader changes only via the Bully or Ring protocol messages in architecture.md §8.
4. **No frontend-only simulations.** Every lab visualization renders data fetched from the backend.
5. Test fixtures/mocks live only under `tests/` or `frontend/src/__fixtures__/` and are never imported by production code.
6. The only sanctioned simulation is the **software hardware-clock skew/drift** (containers share the host clock; see architecture §6.2). It must be labeled as simulated in code and UI.

### 9.2 Financial correctness
7. Money is **integer paise (`BIGINT`)**. No floats, ever.
8. Every balance change happens inside **one DB transaction** with row locks (architecture §5). Never read-then-write outside a transaction.
9. Never store financial state only in React or in memory.
10. All money-moving endpoints require an **idempotency key**.
11. `CHECK (balance_paise >= 0)` stays in the schema as the last line of defense.

### 9.3 Distributed discipline
12. Never silently swallow errors from RPC/DB/timers. Log with context and propagate or handle explicitly.
13. Every RPC has a **deadline** (architecture §4.5). No unbounded calls.
14. Every distributed event is traceable: request ID + Lamport timestamp + node ID in structured logs.
15. Writes are accepted **only by a ready leader**; replication messages carry an **epoch** and stale epochs are rejected (split-brain fencing).
16. Do not rely on Postgres to provide distributed consistency — the replication protocol is ours.

### 9.4 Engineering hygiene
17. Every service has one clear owner of data/behavior (see architecture §3). No cross-service DB access.
18. Every new feature ships with tests (unit at minimum; distributed behavior needs an integration/distributed test).
19. Every API input is validated (`zod` at gateway; defensive checks in node).
20. Every service runs in Docker; nothing may require a local-only setup to function.
21. No secrets in Git. Use `.env` (git-ignored) + `.env.example`.
22. Do not over-engineer. No extra microservices, no abstractions "for later". Prefer correctness over visual polish.
23. Do not rewrite working components unnecessarily; preserve existing behavior and tests.
24. Keep documentation synchronized with implementation (see §10 step 5).

---

## 10. Working agreement (follow for every phase)

1. **Inspect first.** Read the current repo state and the relevant docs before writing code. Before a major architectural change, summarize the current state and the planned change.
2. **Build only the current phase.** Do not start the next phase until the current phase's *exit criteria* are met and tests pass.
3. **Test as you go.** Add unit tests with the code; add integration/distributed tests when the phase introduces cross-node behavior.
4. **Run it.** Each phase ends with `docker compose up --build` (or the phase-appropriate subset) working.
5. **Sync docs.** If implementation deviates from a doc, update the doc in the same change and add a line to the **Change log** (§14).
6. **Ask when blocked.** If a requirement is ambiguous or contradictory, stop and ask rather than assume.
7. **Keep logs useful.** Event names and fields follow style-guide §5.

---

## 11. Implementation phases

Each phase lists deliverables and **verifiable exit criteria**. Order differs slightly from the original outline (gRPC and the standalone banking core come first; elections precede replication because leader = primary).

| # | Phase | Deliverables | Exit criteria |
|---|---|---|---|
| 1 | **Foundation** | npm workspaces monorepo, strict TS, ESLint/Prettier, `packages/shared` skeleton, migration runner, `docker-compose.yml` with `db-1..3`, `bank-node-1..3` (idle + `/healthz`), `gateway` (idle), `.env.example` | `docker compose up --build` starts all containers healthy; each node migrates its own DB; structured JSON logs visible |
| 2 | **RPC + banking core (standalone node)** | `proto/bank.proto`; `BankService` impl: register/login (bcrypt in worker pool), accounts, deposit, withdraw, transfer, history; idempotency; row-lock transactions; node runs standalone with no peers | Unit + integration tests pass against one node via gRPC client; race test (7000 vs 6000 on 10000) passes; duplicate idempotency key applies once |
| 3 | **Gateway REST** | Express routes per api-reference, JWT, zod validation, error mapping, rate limit, OpenAPI at `/api/docs`, simple single-node routing | Full banking flow works via `curl`/Supertest through gateway → node 1 |
| 4 | **Cluster membership + Lamport** | Peer config, `ClusterService.Heartbeat/Ping`, failure detector, `ObservabilityService.GetStatus`, Lamport clock + gRPC interceptors, `event_log`, `rpc_trace` | Stopping a node is detected by peers within `FAILURE_TIMEOUT_MS`; every RPC carries/updates Lamport; events visible via `GetEvents` ordered by (lamport, node) |
| 5 | **Elections (Bully + Ring)** | `bully.ts`, `ring.ts`, election manager, epoch persistence, `election_history`, runtime algorithm switch, leader preemption on recovery, write forwarding to leader. **Remove any bootstrap-leader env var.** | Cold start of 3 nodes elects node 3 via real messages; stop node 3 → node 2 elected; restart node 3 → it catches up then becomes leader again; both algorithms pass the same scenarios |
| 6 | **Replication & consistency** | `replication_log` with gapless seq, `AppendEntries`, replicator/applier, strong + eventual modes, lag metrics, catch-up (`GetLogEntries`), snapshot resync (`GetSnapshot`), read-forwarding rule, `GetIntegrity` | After any write sequence, all nodes' integrity checksums match (after convergence); strong mode blocks until ack; eventual shows measurable lag with injected delay |
| 7 | **Failover & recovery** | Leader-prep (log reconciliation), epoch fencing, step-down on higher epoch, DB-down handling, gateway write retries with idempotency, old-primary rejoin + divergence → snapshot | `scripts/failover-under-load` finishes with: no lost acknowledged writes (strong), no duplicates, checksums equal on all nodes |
| 8 | **Load balancing** | Least-connections balancer, health checks, EWMA latency tie-break, metrics endpoint, retry rules | Load test shows distribution responding to active connections; stopped node receives 0 requests; recovered node gets traffic again |
| 9 | **Physical clock (Berkeley)** | Simulated hardware clock, `GetTime/AdjustClock`, Berkeley round on leader every `CLOCK_SYNC_INTERVAL_MS` + manual trigger, `clock_sync_history`, monotonic timestamp wrapper | Initial offsets differ by seconds; after a sync round offsets between nodes < 50 ms; values come from running nodes |
| 10 | **Concurrency lab** | `LabService.CpuTask`, event-loop lag metric, worker-pool stats, gateway concurrency scenarios (`withdraw-race`, `transfer-crossfire`, `duplicate-key`) | 20 concurrent withdrawals test passes; main-thread vs worker CPU task shows different event-loop lag |
| 11 | **Lab services & observability completeness** | `LabService` (fault modes, config, trigger election/sync, simulate work), all `/api/system/*` and `/api/lab/*` endpoints | Every endpoint in api-reference returns real data; fault modes behave as documented |
| 12 | **Frontend — banking** | Auth screens, dashboard, accounts, deposit/withdraw/transfer, history, statement download | Complete banking flow in browser; idempotency key generated per submit |
| 13 | **Frontend — distributed lab & monitoring** | Cluster overview + 9 lab pages, polling hooks, event timeline, per-page "what this demonstrates" panel | Each page shows live backend data; no hardcoded arrays; evaluator can run every demo in testing-and-demo.md |
| 14 | **Test hardening** | Fill gaps against the test matrix in testing-and-demo.md; flake removal (no fixed sleeps) | `npm test` (unit) and `npm run test:distributed` (compose-driven) green |
| 15 | **Final packaging** | README, `scripts/seed-demo`, `scripts/reset`, demo rehearsal, docs sync | Fresh clone → `docker compose up --build` → seed → full demo script runs without manual fixes |

---

## 12. Decision log

| ID | Decision | Reason | Alternatives considered | Trade-off |
|---|---|---|---|---|
| D1 | Node.js + TypeScript everywhere | One language; strong typing for message contracts; owner's chosen stack | Java (native threads/RMI) | Node has no shared-memory threads → use `worker_threads` + DB locks; documented in architecture §5 |
| D2 | gRPC for all internal RPC | Real RPC with stubs, `.proto` contracts, deadlines, streaming; satisfies Experiment 1 honestly | Java RMI (not required), REST (not RPC), tRPC | Slightly more setup than REST; browser can't call gRPC directly → REST gateway |
| D3 | PostgreSQL | ACID, `SELECT … FOR UPDATE`, constraints, mature | MySQL, MongoDB | Heavier than SQLite, but financial integrity matters |
| D4 | One Postgres per node + app-level replication | Makes the replication protocol visible and ours; simple to reason about; matches owner's choice | Postgres streaming replication; shared single DB | We must implement catch-up/snapshot ourselves; not production-grade |
| D5 | No Redis | Locks live in Postgres rows; node state lives in-process/DB; pub/sub unnecessary (polling UI) | Redis locks/cache | Fewer containers; no cross-node cache |
| D6 | No message broker | Replication is direct gRPC log shipping; broker would hide the protocol we must demonstrate | RabbitMQ/Kafka | Backpressure/retry written by hand (small scope) |
| D7 | Peer bank nodes with embedded coordination (no coordination-service) | Elections, heartbeats and clocks must be peer-to-peer to be real; separate service would be a single point of failure | Dedicated coordination service/ZooKeeper | Each node is more complex, but topology is 8 containers instead of 12+ |
| D8 | Auth inside bank node | Users must be replicated with the same log; avoids a 4th service | Separate auth-service + its own DB | Login routed to leader; gateway only verifies JWT |
| D9 | Leader = primary | One concept to explain: election chooses who accepts writes | Separate election and primary roles | Highest-ID node may be least up-to-date → leader-prep catch-up step (arch §8.5) |
| D10 | Berkeley (not Cristian) | Needs ≥3 nodes and a master; fits peer cluster with elected leader as time master; shows averaging | Cristian (single time server) | More messages; converges to cluster average, not true time (shown in UI) |
| D11 | Simulated hardware clock skew/drift | Containers share one host clock, so natural drift is ~0; without it Berkeley is unobservable | Real VMs with different clocks | Clearly labeled; algorithm and RPCs are still real |
| D12 | Implement both Bully and Ring | Required by syllabus; runtime switchable | Only one | Two code paths; shared election manager keeps it small |
| D13 | Least-connections load balancing in gateway | Reacts to real load; visible when a node is slow | Round robin | Needs in-flight counters and health state |
| D14 | Integer paise for money | Avoid float errors | `NUMERIC(14,2)` | Frontend formatting needed |
| D15 | `READ COMMITTED` + `FOR UPDATE` (ordered) + `CHECK` + version column | Simple, deadlock-safe, correct for this workload | `SERIALIZABLE` (retry storms), optimistic-only | Pessimistic locks serialize hot accounts (acceptable) |
| D16 | Transactional replication log (gapless `seq` via counter row), row-image payloads | Deterministic apply on backups; no re-execution divergence | Statement replication; Postgres WAL | Counter row serializes commit tail on primary (small) |
| D17 | Epoch (term) fencing | Cheap, effective split-brain protection | Leases/quorum-only | Not full consensus; limitations documented |
| D18 | Node-local `event_log` instead of `transaction_events` + `nodes` tables | Node registry is volatile state (heartbeats), not data worth replicating | Replicated registry table | Lab pages aggregate from all nodes |
| D19 | Polling (1–2 s) instead of websockets/SSE | Simpler, adequate for lab | SSE/WebSocket | Slight UI latency |
| D20 | Plain `pg` + SQL files, no ORM | Explicit locks/isolation must be visible and controllable | Prisma/TypeORM | Hand-written SQL |
| D21 | Load balancer lives in the gateway | Gateway is already the single client entry point | Dedicated LB container (nginx/HAProxy) | Gateway is a SPOF for this project (acknowledged) |
| D22 | Single role | Owner's choice; less code | RBAC | Lab endpoints guarded by `LAB_MODE` flag only |

Add new decisions as `D23…` using the same columns.

---

## 13. Acceptance criteria

The project is complete only when **all** boxes can be ticked.

**Banking**
- [ ] Register/login; JWT-protected API
- [ ] Create accounts; deposit; withdraw; transfer (with idempotency key)
- [ ] Transaction history + CSV statement
- [ ] Data persists across `docker compose down` / `up` (volumes)

**Distributed architecture**
- [ ] 3 bank nodes run simultaneously, each with its own DB
- [ ] gRPC used gateway→node and node→node; RPC trace visible
- [ ] Least-connections load balancing with health checks and live metrics
- [ ] Heartbeat-based failure detection
- [ ] Bully **and** Ring election work via real messages; switchable
- [ ] Berkeley sync adjusts running nodes; before/after offsets visible
- [ ] Lamport timestamps on RPCs, replication entries, election messages, events
- [ ] Strong and eventual replication; lag, seq and checksums visible
- [ ] Leader failover; old leader rejoins and resyncs (catch-up or snapshot)
- [ ] 20 concurrent withdrawals never overdraw; duplicate keys apply once

**Docker**
- [ ] `docker compose up --build` starts everything; health checks green
- [ ] `docker compose stop bank-node-3` → observable detection + re-election, system keeps working

**Demonstrations** (scripts in testing-and-demo.md all pass)
- [ ] Failure demo · Election demo · Replication demo · Load-balancing demo · Clock demo · Concurrency demo

**Quality**
- [ ] No hardcoded distributed data in production code (grep-checked in review)
- [ ] `npm test` and `npm run test:distributed` pass
- [ ] Docs match implementation; change log up to date

---

## 14. Change log (agent appends here)

| Date | Phase | Change | Docs updated |
|---|---|---|---|
| 2026-10-09 | Pre-Phase 1 | Clarified Berkeley round 3-value semantics (verification pass), strong replication quorum & pending replication rules, precise idempotency scoping, Ring non-blocking ack forwarding, and cross-platform npm/tsx script tooling | CLAUDE.md, docs/architecture.md, docs/api-reference.md, docs/testing-and-demo.md |
| 2026-10-09 | Phase 1 | Completed Foundation: npm workspaces monorepo, strict TS, ESLint, packages/shared skeleton, standalone pg migration runner, 8-container docker-compose topology healthy, and cross-platform npm scripts | CLAUDE.md, implementation_plan.md |
| 2026-10-09 | Phase 2 | Completed RPC + Banking Core: proto files & generation script, Piscina worker thread pool (bcrypt, CSV), standalone gRPC BankService (12 RPCs), row-level locks in ID order, idempotency key scoping & persistence, REJECTED transaction recording, and full unit/integration/concurrency tests | CLAUDE.md, implementation_plan.md |
| 2026-10-09 | Phase 3 | Completed Gateway REST: Express gateway app with Helmet, CORS, X-Request-Id correlation ID, JWT auth middleware, Zod validation, rate limiters, gRPC client forwarding with auto-retry, standardized JSON envelopes, OpenAPI 3.0 & Swagger UI at /api/docs, and end-to-end REST integration tests | CLAUDE.md, implementation_plan.md |
| 2026-10-09 | Phase 4 | Completed Cluster Membership & Lamport Clocks: pure LamportClock class & tests (U-LAM-1), gRPC client/server interceptors (x-lamport, x-request-id, x-origin) & tests (U-LAM-2), peer connection manager parsing PEERS, heartbeat sender loop (1s interval), failure detector (3s timeout -> DOWN, emitting NODE_FAILURE_DETECTED and NODE_RECOVERED), Postgres event_log sink, 500-capacity circular rpc_trace buffer, ClusterService & ObservabilityService gRPC handlers, and Gateway REST proxy monitoring endpoints (/api/system/nodes, /api/system/events, /api/system/rpc-trace) | CLAUDE.md, implementation_plan.md |
| 2026-10-09 | Phase 5 | Completed Elections (Bully + Ring): pure Bully core & tests (U-BUL-1), pure Ring core with non-blocking hop forwarding & tests (U-RNG-1), ElectionManager adapter with DB epoch persistence & tests (U-ELC-1), LeaderPrep lifecycle, recovery preemption (PREEMPT_ON_RECOVERY), BankService write forwarding to current leader with x-forwarded-by header, LabService gRPC handlers & gateway lab routes, and removed bootstrap leader hardcoding | CLAUDE.md, implementation_plan.md |
| 2026-10-09 | Phase 6 | Completed Replication & Consistency: LogStore gapless seq counter lock (FOR UPDATE), LogApplier with row-image upserts & tests (U-REP-1), Replicator with Strong (NO_QUORUM 503 pre-check, 2s ACK deadline, 202 COMMITTED_PENDING_REPLICATION) and Eventual modes & tests (U-REP-3), CatchupService (GetLogEntries), SnapshotService streaming DB snapshots & tests (U-REP-2), IntegrityChecker MD5 checksums, Gateway system/lab replication & integrity routes | CLAUDE.md, implementation_plan.md |
| 2026-10-09 | Phase 7 | Completed Failover & Recovery: LeaderPrep log reconciliation pulling missing survivor logs, strict epoch fencing (step down on higher epoch), FaultManager (NONE, CRASH, PARTITION) & gateway lab route POST /api/lab/nodes/:id/fault, DbHealthMonitor tracking DB_DOWN, Gateway executeWithRetry (5 attempts, 12s budget), failover under load test script (failover-under-load.ts), and unit/integration tests (phase7.test.ts) | CLAUDE.md, implementation_plan.md |
| 2026-10-09 | Phase 8 | Completed Load Balancing: pure least-connections picker with EWMA latency tie-breaking and capacity cap (U-LB-1), health monitor polling GetStatus every 2s (excluding DB_DOWN), LoadBalancer engine in gateway with active in-flight tracking, BankGrpcClient routing integration with executeWithRetry, SimulateWork RPC & artificial latency in LabService, GET /api/system/load metrics, PUT /api/lab/nodes/:id/latency, POST /api/lab/load/run, and distributed test D-LB-1..3 | CLAUDE.md, implementation_plan.md |




---

## 15. Known limitations (be honest in the viva)

Details and guarantees: architecture §9.7. In short: not a consensus protocol; eventual mode can lose writes on leader crash and diverge under partition (resolved by snapshot, discarding divergent writes); strong mode requires a majority (≥2 of 3 nodes, i.e. leader + ≥1 acking backup) to commit (pre-checks zero UP backups → 503 NO_QUORUM; zero acks within timeout → 202 COMMITTED_PENDING_REPLICATION); gateway is a single point of failure; clock "drift" is simulated; Berkeley step-adjusts rather than slewing.
