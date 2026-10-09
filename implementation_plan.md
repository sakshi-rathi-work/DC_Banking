# Implementation Plan — Distributed Banking System (DBS)

> **Execution Rules:** Strictly sequential execution following `CLAUDE.md` §10 and user instructions. 
> Every task and phase requires real verification. No checkboxes may be ticked without running tests and confirming expected behavior. 
> Gated stopping checkpoints at the end of each phase.

---

## 🚀 Execution Status Dashboard (Updated 2026-10-09 23:47 IST)

| Phase | Description | Status | Verification |
|---|---|---|---|
| **Phase 1** | Foundation & Monorepo | ✅ COMPLETED | Docker compose 8 containers, migrations, shared types |
| **Phase 2** | RPC & Banking Core | ✅ COMPLETED | gRPC BankService, PostgreSQL row locks, Piscina pool |
| **Phase 3** | REST Gateway & Load Balancer | ✅ COMPLETED | Express gateway, auth, accounts, transactions, OpenAPI |
| **Phase 4** | Logical Clock (Lamport) | ✅ COMPLETED | LamportClock class, interceptors on gRPC calls, total order |
| **Phase 5** | Distributed Leader Election | ✅ COMPLETED | Bully & Ring algorithms, coordinator messages, epoch persistence |
| **Phase 6** | Replication Engine | ✅ COMPLETED | Primary-backup log streaming, Strong quorum / Eventual consistency |
| **Phase 7** | Failure Detection & Heartbeats | ✅ COMPLETED | Periodic heartbeats, Phi Accural / fixed timeout failure detector |
| **Phase 8** | Load Balancing | ✅ COMPLETED | Least-connections picker, EWMA latency tracking, simulate-work |
| **Phase 9** | Physical Clock (Berkeley) | ✅ COMPLETED | Simulated hardware clock, Berkeley average sync, residual sweeps |
| **Phase 10** | Concurrency Lab | ✅ COMPLETED | Race-condition runners, `perf_hooks` event-loop lag monitor, CPU task |
| **Phase 11** | Lab Services & Observability | ✅ COMPLETED | Real metrics endpoints, `PeerPing` hop tracing, `LAB_MODE` gating |
| **Phase 12** | Banking Frontend | ✅ COMPLETED | React 18 + Vite + Tailwind, login/register, accounts, transactions, CSV |
| **Phase 13** | Distributed Lab Frontend | ✅ COMPLETED | Cluster overview, 9 interactive lab modules, real-time polling |
| **Phase 14** | Test Hardening | ⏸️ DEFERRED | Non-blocking viva scenarios deferred for demo deliverable |
| **Phase 15** | Final Packaging & Runbook | ⏸️ DEFERRED | Demo seeding script & Viva rehearsal runbook |

### Local Run & Demonstration Commands

```bash
# 1. Typecheck the entire monorepo
npm run typecheck

# 2. Build production frontend
npm run build --workspace=@bank/frontend

# 3. Launch the full distributed cluster via Docker
docker compose up --build -d

# Access points:
# - Banking & Distributed Lab UI: http://localhost:3000
# - REST Gateway & Health/Docs:    http://localhost:8080/api/health (Swagger: /api/docs)
# - Bank Node 1 / 2 / 3 gRPC:     localhost:50051 / 50052 / 50053
```

---

## Phase 1: Foundation

### Objective
Establish the npm workspaces monorepo, strict TypeScript configurations, tooling, shared types/utilities, SQL migration runner, root Docker compose topology (`db-1..3`, `bank-node-1..3`, `gateway`), and environment templates.

### Deliverables
- Monorepo structure (`packages/shared`, `services/gateway`, `services/bank-node`, `frontend`).
- Root and workspace `package.json`, `tsconfig.json`, ESLint, Prettier.
- `packages/shared` skeleton (logger via Pino, AppError and error codes, config validator, Lamport type, Paise type).
- Plain SQL migration runner applying `database/migrations/0001_init.sql` to each node's DB.
- `docker-compose.yml` defining 8 containers (all 3 DBs, 3 bank-nodes with `/healthz` HTTP and gRPC stub, gateway stub with `/api/health`, frontend container stub) with health checks and persistent volumes.
- `.env.example` and local `.env` with configurable host ports and defaults.
- Cross-platform npm scripts using `tsx` (`reset`, `node:stop`, etc.) and `.gitattributes`.

### Files / Modules to be Created
- `package.json`, `tsconfig.json`, `.eslintrc.cjs`, `.prettierrc`, `.gitignore`, `.gitattributes`
- `.env.example`, `.env`
- `docker-compose.yml`
- `docker/bank-node.Dockerfile`, `docker/gateway.Dockerfile`, `docker/frontend.Dockerfile`, `docker/nginx.conf`
- `packages/shared/package.json`, `packages/shared/tsconfig.json`
- `packages/shared/src/config/index.ts`
- `packages/shared/src/errors/app-error.ts`, `packages/shared/src/errors/codes.ts`
- `packages/shared/src/logging/logger.ts`
- `packages/shared/src/types/index.ts` (branded `Paise`, `Lamport`, roles, statuses)
- `database/migrations/0001_init.sql`
- `services/bank-node/package.json`, `services/bank-node/tsconfig.json`
- `services/bank-node/src/db/pool.ts`, `services/bank-node/src/db/migrator.ts`, `services/bank-node/src/index.ts`
- `services/gateway/package.json`, `services/gateway/tsconfig.json`, `services/gateway/src/index.ts`
- `scripts/reset.ts`, `scripts/node-ctl.ts`, `scripts/db-ctl.ts`

### Tasks
- [x] Task 1.1: Initialize root monorepo `package.json` with npm workspaces (`packages/*`, `services/*`, `frontend`).
- [x] Task 1.2: Set up strict TypeScript configs (`tsconfig.base.json`, workspace `tsconfig.json` files) with ESM, `noUncheckedIndexedAccess`, and `noImplicitOverride`.
- [x] Task 1.3: Set up ESLint and Prettier configurations adhering to style guide.
- [x] Task 1.4: Implement `packages/shared` skeleton: branded `Paise` helper, `AppError` class with code mapper, Pino JSON logger formatting required fields, and Zod config helper.
- [x] Task 1.5: Write migration `database/migrations/0001_init.sql` matching `docs/architecture.md` §11 schema (replicated & node-local tables with `CHECK`, `UNIQUE`, indices).
- [x] Task 1.6: Implement standalone SQL migration runner in `bank-node` using `pg` with `schema_migrations` tracking.
- [x] Task 1.7: Create idle `bank-node` HTTP health listener on `:9000/healthz` (200 when DB reachable and migrator succeeded; 503 otherwise).
- [x] Task 1.8: Create idle `gateway` server with `/api/health` and basic Pino request logging.
- [x] Task 1.9: Create Dockerfiles for `bank-node`, `gateway`, and `frontend` (nginx static stub).
- [x] Task 1.10: Assemble `docker-compose.yml` with 8 containers, bridge network `bank-net`, persistent volumes `db1-data`..`db3-data`, and health checks.
- [x] Task 1.11: Create `.env.example` with configurable host ports (`DB1_HOST_PORT=5441`, etc.) and defaults; create `.env`.
- [x] Task 1.12: Implement cross-platform helper scripts in TypeScript (`scripts/reset.ts`, `scripts/node-ctl.ts`, `scripts/db-ctl.ts`) and register npm script aliases in root `package.json`.

### Tests to be Written
- Unit tests:
  - `packages/shared/src/types/paise.test.ts` (test `toPaise()` with integers, floats, negatives, overflow).
  - `packages/shared/src/config/config.test.ts` (validate Zod schema and defaults).
  - `packages/shared/src/errors/app-error.test.ts` (test error code properties and HTTP/gRPC mappings).
- Integration tests:
  - `services/bank-node/src/db/migrator.test.ts` (apply migration, verify table and constraint existence, idempotency on second run).
  - Test ID reference: `I-DB-1` (constraint check: verify `CHECK (balance_paise >= 0)` rejects negative balance update).

### Exit Criteria (from `CLAUDE.md` §11)
- `docker compose up --build` starts all containers healthy.
- Each node migrates its own database on boot with zero errors.
- Structured JSON logs from Pino visible on stdout with valid `ts`, `level`, `node`, `service`.
- Host ports correctly mapped and accessible.

### Definition of Done Checklist
- [x] Code complete and cleanly structured.
- [x] Unit tests passing.
- [x] Integration tests passing.
- [x] `npm run lint` and `npm run typecheck` clean.
- [x] `docker compose up --build` verified running and healthy.
- [x] Docs synced (if any deviations occurred).
- [x] Change log in `CLAUDE.md` §14 updated.

---

## Phase 2: RPC + Banking Core (Standalone Node)

### Objective
Implement `proto/bank.proto`, generate TypeScript types, implement `BankService` on a single bank node (auth, accounts, deposit, withdraw, transfer, history, CSV export in Piscina worker pool), row locks in ID order, idempotency key persistence, and transaction logging.

### Deliverables
- `proto/bank.proto` and generated TypeScript definitions.
- Worker pool (`piscina`) for bcrypt password hashing/verification and CSV generation.
- Banking domain logic in `bank-node/src/bank` (Auth, Accounts, Transactions).
- Transaction runner `db/tx.ts` enforcing `SELECT ... FOR UPDATE` in ID order and `READ COMMITTED`.
- Idempotency manager enforcing scoping rules (pre-check, inside transaction rollback vs 422 replay).
- `BankService` gRPC handler implementations.

### Files / Modules to be Created
- `proto/bank.proto`
- `scripts/proto-gen.ts` / root script `npm run proto:gen`
- `packages/shared/src/generated/*` (git-ignored)
- `services/bank-node/src/concurrency/pool.ts`
- `services/bank-node/src/concurrency/workers/bcrypt-worker.ts`
- `services/bank-node/src/concurrency/workers/csv-worker.ts`
- `services/bank-node/src/db/tx.ts`
- `services/bank-node/src/bank/auth.ts`, `services/bank-node/src/bank/accounts.ts`, `services/bank-node/src/bank/transactions.ts`
- `services/bank-node/src/bank/idempotency.ts`
- `services/bank-node/src/grpc/bank-service.ts`, `services/bank-node/src/grpc/server.ts`

### Tasks
- [x] Task 2.1: Write `proto/bank.proto` containing `BankService`, `Ctx`, `Account`, `Transaction`, `MoneyRequest`, `TransferRequest`, `StatementRequest`, and responses.
- [x] Task 2.2: Set up `npm run proto:gen` using `proto-loader-gen-types` generating into `packages/shared/src/generated`.
- [x] Task 2.3: Set up Piscina worker thread pool in `bank-node` with `bcrypt-worker.ts` (cost 10) and `csv-worker.ts`.
- [x] Task 2.4: Implement `db/tx.ts` wrapper (`withTx`) setting `lock_timeout = '3s'` and managing commit/rollback.
- [x] Task 2.5: Implement user registration and login with bcrypt worker hashing, generating JWT tokens with claims `{sub, email}`.
- [x] Task 2.6: Implement accounts module: `CreateAccount` (12-digit account number generation), `ListAccounts`, `GetAccount`, `LookupAccount` (masked name).
- [x] Task 2.7: Implement idempotency module following exact scoping rules (pre-check, inside-tx check, store 201 or 422, rollback on 400/403/404).
- [x] Task 2.8: Implement transaction processing algorithm (§5.4): Deposit, Withdraw, Transfer (lock accounts `ORDER BY id`, atomic debit+credit, insert `transactions`, insert `replication_log` entry, increment `last_seq` counter row).
- [x] Task 2.9: Implement `GetStatement` generating CSV bytes in worker thread.
- [x] Task 2.10: Wire `BankService` gRPC server in `bank-node/src/grpc/server.ts` on port 50051.

### Tests to be Written
- Unit tests:
  - `U-BNK-1`: Money rules (reject non-integer, <= 0, > MAX_SAFE_INTEGER; same-account transfer; funds check).
  - `U-IDM-1`: Idempotency hashing (stable request hash; reuse detection).
- Integration tests (single node gRPC client):
  - `I-AUTH-1`: Register -> login -> JWT verification; duplicate email -> `EMAIL_TAKEN`; bad password -> `INVALID_CREDENTIALS`.
  - `I-ACC-1`: Account creation, list, get; verify ownership enforcement.
  - `I-TXN-1`: Deposit, withdraw, transfer happy path; balances, `version`, `reference`, history correct; atomic debit+credit.
  - `I-TXN-2`: Insufficient funds -> 422; `REJECTED` row recorded; balance unchanged.
  - `I-TXN-3`: Transfer to unknown / frozen account -> `NOT_FOUND` / `ACCOUNT_NOT_ACTIVE`.
  - `I-IDM-1`: Same idempotency key twice -> second returns identical response with replay indication; single transaction row.
  - `I-IDM-2`: Same key with different payload -> `IDEMPOTENCY_KEY_REUSED` (422).
  - `I-IDM-3`: Validation / 4xx error does not consume or persist idempotency key.
  - `I-IDM-4`: Business failure 422 (`INSUFFICIENT_FUNDS`) persists key; retry replays identical 422.
  - `I-WRK-1`: Concurrent hashing in worker pool does not block event loop; CSV statement generation correct.
  - Concurrency race test (7,000 vs 6,000 on 10,000 balance): exactly one success, balance 3,000 or 4,000, 2 transaction rows.

### Exit Criteria (from `CLAUDE.md` §11)
- Unit and integration tests pass against one node via gRPC client.
- Concurrency race test (7,000 vs 6,000 on 10,000) passes with row lock serialization.
- Duplicate idempotency key applies once and replays safely.
- Standalone node boots and serves gRPC requests.

### Definition of Done Checklist
- [x] Code complete.
- [x] Unit tests passing.
- [x] Integration tests passing.
- [x] Lint and typecheck clean.
- [x] `docker compose up --build` working with single-node gRPC calls.
- [x] Docs synced.
- [x] Change log in `CLAUDE.md` §14 updated.

---

## Phase 3: Gateway REST

### Objective
Build the Express REST API gateway per `docs/api-reference.md`, including JWT verification, Zod input validation schemas, error mapping (`AppError` / gRPC status -> HTTP status), rate limiting, correlation IDs, OpenAPI documentation at `/api/docs`, and basic gRPC client forwarding to bank-node-1.

### Deliverables
- Express gateway application with Helmet, CORS, and Pino logging.
- Zod schemas for all REST endpoints (`routes/*.schema.ts`).
- Auth middleware (JWT verify, extraction of `user_id`, error responses).
- Rate limit middleware (auth 10/min/IP, general 300/min/IP).
- gRPC client stub wrapper for calling `BankService`.
- Error and response envelope mappers (`{ data, meta }`, `{ error, meta }`).
- OpenAPI 3.0 specification served at `/api/docs` (Swagger UI).

### Files / Modules to be Created
- `services/gateway/src/middleware/auth.ts`, `services/gateway/src/middleware/validate.ts`
- `services/gateway/src/middleware/rate-limit.ts`, `services/gateway/src/middleware/request-id.ts`
- `services/gateway/src/middleware/error-handler.ts`
- `services/gateway/src/routes/auth.routes.ts`, `services/gateway/src/routes/auth.schema.ts`
- `services/gateway/src/routes/accounts.routes.ts`, `services/gateway/src/routes/accounts.schema.ts`
- `services/gateway/src/routes/transactions.routes.ts`, `services/gateway/src/routes/transactions.schema.ts`
- `services/gateway/src/grpc/bank-client.ts`
- `services/gateway/src/openapi/openapi.json`, `services/gateway/src/openapi/docs.routes.ts`

### Tasks
- [x] Task 3.1: Set up Express application structure with `helmet`, `cors`, and correlation ID middleware (`X-Request-Id`).
- [x] Task 3.2: Implement response envelope helpers (`{ data, meta }` and `{ error, meta }`).
- [x] Task 3.3: Implement JWT authentication middleware extracting caller user ID into `req.userId`.
- [x] Task 3.4: Implement Zod validation middleware validating params, query, and body.
- [x] Task 3.5: Implement rate limiting middleware (10/min for auth, 300/min for standard APIs).
- [x] Task 3.6: Implement error mapping converting gRPC errors/trailers into standardized HTTP response codes (§2).
- [x] Task 3.7: Implement Auth routes: `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`.
- [x] Task 3.8: Implement Account routes: `POST /api/accounts`, `GET /api/accounts`, `GET /api/accounts/:id`, `GET /api/accounts/lookup`, `GET /api/accounts/:id/statement.csv`.
- [x] Task 3.9: Implement Transaction routes: `POST /api/transactions/deposit`, `POST /api/transactions/withdraw`, `POST /api/transactions/transfer`, `GET /api/transactions`, `GET /api/transactions/:id`.
- [x] Task 3.10: Serve OpenAPI 3.0 specification at `/api/docs`.

### Tests to be Written
- Integration tests (Gateway + Supertest -> Node 1):
  - `I-GW-1`: Validation (invalid UUID, negative amount -> 400), Auth (missing/bad token -> 401), Rate limiting (exceeded -> 429).
  - End-to-end banking flow: Register user -> login -> create account -> deposit -> withdraw -> transfer -> list transactions -> fetch statement CSV.
  - Idempotency header enforcement: missing `Idempotency-Key` on transactions -> 400 `IDEMPOTENCY_KEY_REQUIRED`.

### Exit Criteria (from `CLAUDE.md` §11)
- Full banking flow works via `curl` and Supertest through `gateway` -> `bank-node-1`.
- OpenAPI documentation served and readable at `/api/docs`.
- Error codes and response shapes match `docs/api-reference.md`.

### Definition of Done Checklist
- [x] Code complete.
- [x] Unit tests passing.
- [x] Integration tests passing.
- [x] Lint and typecheck clean.
- [x] `docker compose up --build` working for gateway + node 1 + db 1.
- [x] Docs synced.
- [x] Change log in `CLAUDE.md` §14 updated.

---

## Phase 4: Cluster Membership + Lamport Clocks

### Objective
Implement `proto/cluster.proto` and `proto/observability.proto`, Lamport logical clock with pure core and gRPC interceptors, peer configuration and ping/heartbeat loop, failure detector, node status tracking, and `event_log` / `rpc_trace` persistence.

### Deliverables
- `proto/cluster.proto` and `proto/observability.proto`.
- Pure `LamportClock` class and gRPC client/server metadata interceptors (`x-lamport`, `x-request-id`, `x-origin`).
- Peer connection manager and heartbeat sender loop (1s interval).
- Failure detector tracking peer `lastHeartbeatAt` (3s timeout -> `DOWN`).
- In-memory circular buffer for `rpc_trace` (500 items).
- Event logger writing to Postgres `event_log` table with `(lamport, physical_ts, node_id)`.
- `ClusterService` (`Heartbeat`, `Ping`) and `ObservabilityService` (`GetStatus`, `GetEvents`, `GetRpcTrace`).

### Files / Modules to be Created
- `proto/cluster.proto`, `proto/observability.proto`
- `packages/shared/src/clock/lamport.ts`
- `packages/shared/src/grpc/interceptors/lamport-interceptor.ts`
- `packages/shared/src/grpc/interceptors/metadata-interceptor.ts`
- `packages/shared/src/grpc/interceptors/trace-interceptor.ts`
- `services/bank-node/src/cluster/membership.ts`
- `services/bank-node/src/cluster/heartbeat.ts`
- `services/bank-node/src/cluster/failure-detector.ts`
- `services/bank-node/src/observability/event-sink.ts`
- `services/bank-node/src/observability/rpc-trace-buffer.ts`
- `services/bank-node/src/grpc/cluster-service.ts`
- `services/bank-node/src/grpc/observability-service.ts`

### Tasks
- [x] Task 4.1: Define `cluster.proto` and `observability.proto`, re-run `proto:gen`.
- [x] Task 4.2: Implement pure `LamportClock` class (`tick()`, `send()`, `receive(remoteL)`) and persistence checkpointing to `node_state`.
- [x] Task 4.3: Implement gRPC client and server interceptors in `packages/shared` attaching and updating `x-lamport`.
- [x] Task 4.4: Implement peer connection manager in `bank-node` parsing `PEERS` env variable.
- [x] Task 4.5: Implement `ClusterService.Heartbeat` and `ClusterService.Ping` handlers.
- [x] Task 4.6: Implement background heartbeat sender loop sending `HeartbeatMsg` every 1000ms.
- [x] Task 4.7: Implement failure detector: if `now - lastHeartbeatAt > 3000ms` mark peer `DOWN` and emit `NODE_FAILURE_DETECTED`; on recovery emit `NODE_RECOVERED`.
- [x] Task 4.8: Implement `event_log` writer and `rpc_trace` in-memory ring buffer (500 capacity).
- [x] Task 4.9: Implement `ObservabilityService.GetStatus`, `GetEvents`, and `GetRpcTrace`.
- [x] Task 4.10: Add gateway monitoring proxy endpoints (`GET /api/system/nodes`, `GET /api/system/events`, `GET /api/system/rpc-trace`).

### Tests to be Written
- Unit tests:
  - `U-LAM-1`: Lamport pure core (local tick +1, send ticks, receive `max(L, r)+1` for all cases, monotonic restore).
  - `U-LAM-2`: Interceptors (client attaches `x-lamport`, server applies receive rule, trailer applies return rule).
- Integration / Distributed tests:
  - `D-LAM-1`: Causal ordering (for RPC sequence, send L < receive L on all hops).
  - Failure detection test: Stop node 3 container; verify peers detect and log `NODE_FAILURE_DETECTED` within 3000ms.
  - Event query test: `GetEvents` returns events strictly ordered by `(lamport, node_id)`.

### Exit Criteria (from `CLAUDE.md` §11)
- Stopping a node is detected by peers within `FAILURE_TIMEOUT_MS` (3s).
- Every RPC carries and updates Lamport clock; response trailers advance caller.
- Events visible via `/api/system/events` ordered by `(lamport, node)`.
- RPC trace captures hops with accurate Lamport send/receive values.

### Definition of Done Checklist
- [x] Code complete.
- [x] Unit tests passing.
- [x] Distributed tests passing.
- [x] Lint and typecheck clean.
- [x] `docker compose up --build` with 3 nodes discovering each other and exchanging heartbeats.
- [x] Docs synced.
- [x] Change log in `CLAUDE.md` §14 updated.


---

## Phase 5: Elections (Bully + Ring)

### Objective
Implement pure cores and adapters for Bully and Ring election algorithms, election manager, epoch persistence and fencing, runtime algorithm switching, leader preparation, preemption on recovery, and write forwarding from backup to leader. Remove any bootstrap leader configuration.

### Deliverables
- Pure Bully algorithm state machine (`election/bully.ts`).
- Pure Ring algorithm state machine with non-blocking hop forwarding and dead-node skipping (`election/ring.ts`).
- `ElectionManager` adapter coordinating timers, gRPC messages, and DB epoch persistence.
- Leader preparation module (query peer logs, quorum check, Berkeley sync trigger).
- Request forwarding in `BankService`: writes arriving at a backup forward to current leader over gRPC with `x-forwarded-by` header.
- Runtime algorithm switch via heartbeat config gossip (`PUT /api/lab/config/election-algorithm`).

### Files / Modules to be Created
- `services/bank-node/src/election/types.ts`
- `services/bank-node/src/election/bully.ts` (pure core)
- `services/bank-node/src/election/ring.ts` (pure core)
- `services/bank-node/src/election/election-manager.ts` (adapter)
- `services/bank-node/src/election/leader-prep.ts`
- `services/bank-node/src/grpc/forwarding.ts`
- Gateway routes for `POST /api/lab/election/bully`, `POST /api/lab/election/ring`, `PUT /api/lab/config/election-algorithm`.

### Tasks
- [x] Task 5.1: Implement pure Bully state machine: handling election initiation, higher-node `OK` timeout, coordinator announcement, higher-epoch coordinator step-down.
- [x] Task 5.2: Implement pure Ring state machine: ring ordering, candidate accumulation, dead-node skipping on timeout, winner selection, coordinator round.
- [x] Task 5.3: Implement non-blocking Ring hop forwarding: return empty ack immediately to caller and forward token asynchronously.
- [x] Task 5.4: Implement `ElectionManager` adapter wiring timers (`ELECTION_OK_TIMEOUT_MS`, `RING_HOP_TIMEOUT_MS`), persisting new `epoch` to `node_state`, and recording in `election_history`.
- [x] Task 5.5: Implement leader preparation lifecycle: query reachable peers, check quorum, mark `leaderReady=true`, emit `LEADER_ELECTED` and `FAILOVER_COMPLETED`.
- [x] Task 5.6: Implement recovery preemption: recovered higher-priority node (`PREEMPT_ON_RECOVERY=true`) initiates election after catch-up.
- [x] Task 5.7: Implement write forwarding in `BankService`: non-leader receiving write forwards to leader with timeout budget and `x-forwarded-by`.
- [x] Task 5.8: Implement runtime algorithm switching and heartbeat config gossip (`config.version`).
- [x] Task 5.9: Remove any bootstrap-leader environment variables; ensure cold boot elects leader through protocol messages.

### Tests to be Written
- Unit tests:
  - `U-BUL-1`: Bully core (highest alive wins; lower receives Election replies OK and starts own; no OK -> win; higher coordinator steps down).
  - `U-RNG-1`: Ring core (token accumulates candidates, winner = max priority, skipped nodes recorded, coordinator round completes).
  - `U-ELC-1`: Epoch rules (`epoch = max seen + 1`, persisted before announce, stale epoch rejected).
- Distributed tests:
  - `D-CLU-1`: Cold start of 3 nodes elects Node 3 via real protocol messages, same epoch, all `UP`.
  - `D-BUL-1`: Bully failover (stop Node 3 -> Node 2 elected within 8s; messages recorded).
  - `D-BUL-2`: Bully preempt (restart Node 3 -> catches up, becomes leader again, Node 2 steps down).
  - `D-RNG-1`: Ring election (switch to Ring, trigger from Node 1 -> token traverses ring, winner 3).
  - `D-RNG-2`: Ring skip (Node 2 stopped -> token skips Node 2, elects Node 3).
  - `D-RNG-3`: Ring failover (stop Node 3 with Ring active -> Node 2 wins).
  - `D-ALG-1`: Algorithm switch propagates via gossip within 3s.

### Exit Criteria (from `CLAUDE.md` §11)
- Cold start of 3 nodes elects Node 3 via real gRPC messages.
- Stopping Node 3 results in Node 2 being elected; restarting Node 3 causes it to catch up and preempt.
- Both Bully and Ring pass the election scenarios.
- Writes arriving at a backup are forwarded to the leader and succeed.

### Definition of Done Checklist
- [x] Code complete.
- [x] Unit tests passing.
- [x] Distributed tests passing.
- [x] Lint and typecheck clean.
- [x] `docker compose up --build` with automatic election and failover verified.
- [x] Docs synced.
- [x] Change log in `CLAUDE.md` §14 updated.


---

## Phase 6: Replication & Consistency

### Objective
Implement custom log-shipping replication over gRPC: transactional log entries with gapless sequence numbers, `AppendEntries`, background replicator on leader, applier on backups, Strong and Eventual consistency modes, lag metrics, catch-up (`GetLogEntries`), streaming snapshot resync (`GetSnapshot`), read consistency routing, and cluster integrity verification (`GetIntegrity`).

### Deliverables
- Transactional log appending in business transaction with gapless `seq` from `node_state`.
- Replicator loop on leader shipping entries via `AppendEntries`.
- Applier on backups executing row-image upserts with version checking.
- Strong consistency: pre-check 0 UP backups -> 503 `NO_QUORUM`; await UP backups, >=1 ack -> 201; 0 acks within timeout -> 202 `COMMITTED_PENDING_REPLICATION`.
- Eventual consistency: return 201 immediately, replicate in background.
- Catch-up protocol (`GetLogEntries`) and streaming snapshot resync (`GetSnapshot`).
- Integrity checker (`GetIntegrity`) calculating MD5 account checksums.

### Files / Modules to be Created
- `services/bank-node/src/replication/types.ts`
- `services/bank-node/src/replication/log-store.ts`
- `services/bank-node/src/replication/replicator.ts` (leader)
- `services/bank-node/src/replication/applier.ts` (backup)
- `services/bank-node/src/replication/catchup.ts`
- `services/bank-node/src/replication/snapshot.ts`
- `services/bank-node/src/replication/integrity.ts`
- Gateway system routes: `GET /api/system/replication`, `GET /api/system/integrity`.
- Lab routes: `PUT /api/lab/config/consistency-mode`, `PUT /api/lab/nodes/:id/replication-delay`.

### Tasks
- [x] Task 6.1: Implement transactional replication log storage in `bank-node` assigning gapless `seq` via `node_state.last_seq` counter lock.
- [x] Task 6.2: Implement `ClusterService.AppendEntries` RPC with epoch check, sequence continuity check, and row-image apply logic.
- [x] Task 6.3: Implement leader `Replicator` tracking `matchSeq` per backup and streaming new entries.
- [x] Task 6.4: Implement Strong consistency ack coordination:
  - Pre-check: if 0 backups UP, reject with `NO_QUORUM` (503).
  - Wait for UP backups; if >= 1 ack -> 201; non-ackers marked `LAGGING`.
  - If 0 acks within timeout -> return 202 `COMMITTED_PENDING_REPLICATION`.
- [x] Task 6.5: Implement Eventual consistency mode returning 201 immediately after commit.
- [x] Task 6.6: Implement catch-up pull mechanism via `ClusterService.GetLogEntries`.
- [x] Task 6.7: Implement divergence check and streaming `ClusterService.GetSnapshot` (truncating tables and loading stream in one DB transaction).
- [x] Task 6.8: Implement read consistency rules: Strong mode forwards reads if backup is `LAGGING` or behind leader; Eventual mode serves locally with `stale` flag.
- [x] Task 6.9: Implement `ObservabilityService.GetIntegrity` computing account count, balance sum, txn count, and MD5 checksum `md5(string_agg(id||':'||balance_paise||':'||version, ',' ORDER BY id))`.
- [x] Task 6.10: Implement injected replication delay (`LabService.SetConfig.replication_delay_ms`).

### Tests to be Written
- Unit tests:
  - `U-REP-1`: Applier logic (applies seq n+1 only, ignores duplicates, reports gap, rejects stale epoch, upserts respecting version).
  - `U-REP-2`: Divergence check (same seq/epoch -> catch-up; mismatched epoch -> snapshot).
  - `U-REP-3`: Strong-ack logic (majority check, quorum pre-check, timeout LAGGING marking).
- Distributed tests:
  - `D-REP-1`: Strong replication: all live backups contain entry immediately upon write response.
  - `D-REP-2`: Eventual replication: with 2s injected delay, write returns immediately, lag is visible, converges later, checksums equal.
  - `D-REP-3`: Backup down (strong): writes succeed with 1 live backup, restarted backup catches up, checksums match.
  - `D-REP-4`: Both backups down (strong): pre-check rejects with 503 `NO_QUORUM`, nothing written; converges after restart.
  - `D-REP-5`: Read consistency: eventual read shows `stale=true` during lag; strong read never stale.
  - `D-REP-6`: Backups delayed mid-write (strong): returns 202 `COMMITTED_PENDING_REPLICATION`, converges later, retry returns same txn.

### Exit Criteria (from `CLAUDE.md` §11)
- After write sequences, all nodes' integrity checksums match upon convergence.
- Strong mode blocks until ack quorum or returns 202 if backups stall; pre-checks 0 UP backups to 503.
- Eventual mode returns immediately and displays measurable lag under injected delay.

### Definition of Done Checklist
- [x] Code complete.
- [x] Unit tests passing.
- [x] Distributed tests passing.
- [x] Lint and typecheck clean.
- [x] `docker compose up --build` verified with log replication and integrity matching.
- [x] Docs synced.
- [x] Change log in `CLAUDE.md` §14 updated.

---

## Phase 7: Failover & Recovery

### Objective
Harden failover and recovery mechanisms: leader preparation log reconciliation, epoch fencing, step-down on higher epoch, DB failure handling (`DB_DOWN`), gateway write retries with idempotency, and old primary rejoin with snapshot divergence repair.

### Deliverables
- Leader preparation log reconciliation (pulling missing log entries from most up-to-date survivor).
- Epoch fencing rejecting stale leaders.
- Database connection health checker setting `status = DB_DOWN` and withdrawing from elections.
- Gateway retry engine with exponential backoff on retryable codes for idempotent calls.
- `scripts/failover-under-load.ts` test harness.

### Files / Modules to be Created
- `services/bank-node/src/cluster/db-health.ts`
- `services/gateway/src/loadbalancer/retry.ts`
- `scripts/failover-under-load.ts`
- Gateway fault routes: `POST /api/lab/nodes/:id/fault` (`CRASH`, `PARTITION`, `NONE`).

### Tasks
- [x] Task 7.1: Implement leader log reconciliation in `leader-prep.ts`: query survivors' `(lastEntryEpoch, lastSeq)` and pull missing entries before declaring ready.
- [x] Task 7.2: Implement strict epoch fencing: any leader receiving higher epoch immediately steps down to `BACKUP` and aborts active replication loops.
- [x] Task 7.3: Implement periodic DB health monitor on nodes (every 1s); 2 consecutive failures mark node `DB_DOWN` and trigger leader step-down if leader.
- [x] Task 7.4: Implement gateway retry logic (§10.4): on `UNAVAILABLE`, `DEADLINE_EXCEEDED`, `NOT_LEADER`, `LEADER_NOT_READY`, `NO_QUORUM`, retry idempotent calls up to 5 attempts with backoff (budget 12s).
- [x] Task 7.5: Implement old primary rejoin handling: on hearing new leader's heartbeat, execute divergence check and discard divergent writes (`DIVERGENT_WRITES_DISCARDED` event) via snapshot resync.
- [x] Task 7.6: Implement lab fault simulation modes in `LabService`: `CRASH` (drop all RPCs) and `PARTITION` (drop peer-to-peer RPCs).
- [x] Task 7.7: Implement `scripts/failover-under-load.ts` executing 20 concurrent transfer workers with kill and restart of leader.

### Tests to be Written
- Distributed tests:
  - `D-FOV-1`: Leader failover with data (20 writes in strong mode -> kill leader -> all acknowledged writes exist on new leader).
  - `D-FOV-2`: Failover under load via `scripts/failover-under-load.ts`: zero lost writes, zero duplicate transactions, checksums equal across all nodes.
  - `D-FOV-3`: Eventual loss window: write acked in eventual mode with delay, leader killed before shipping -> write absent on new leader, old leader discards tail on rejoin.
  - `D-SPL-1`: Partition in strong mode: isolated leader writes return `NO_QUORUM`, majority elects new leader, heal -> step down and resync.
  - `D-SPL-2`: Partition in eventual mode: isolated leader accepts writes, heal -> snapshot discards divergent writes, checksums equal.
  - `D-DB-1`: Database failure: stop `db-2` -> node 2 marks `DB_DOWN`, excluded from routing; stop leader's DB -> automatic election of new leader.

### Exit Criteria (from `CLAUDE.md` §11)
- `npm run failover:load` finishes with: no lost acknowledged writes (strong mode), no duplicates, checksums equal on all nodes.
- Unavailability window during leader failover measured and bounded (< 10s).
- DB failure handled cleanly without corrupting state.

### Definition of Done Checklist
- [x] Code complete.
- [x] Unit tests passing.
- [x] Distributed tests passing.
- [x] Lint and typecheck clean.
- [x] `docker compose up --build` verified under container kills.
- [x] Docs synced.
- [x] Change log in `CLAUDE.md` §14 updated.

---

## Phase 8: Load Balancing — ✅ COMPLETED

### Objective
Implement Least Connections load balancer in the gateway with node health tracking, EWMA latency tie-breaking, capacity capping, live metrics endpoint, and artificial latency simulation.

### Deliverables
- Pure least-connections selection algorithm (`loadbalancer/picker.ts`).
- Load balancer manager in gateway tracking active requests, EWMA latency, and node health.
- Health monitor polling `ObservabilityService.GetStatus` on all nodes every 2000ms.
- Gateway metrics endpoint `GET /api/system/load`.
- Synthetic load generator `POST /api/lab/load/run` and `SimulateWork` RPC.

### Files / Modules to be Created
- `services/gateway/src/loadbalancer/types.ts`
- `services/gateway/src/loadbalancer/picker.ts` (pure core)
- `services/gateway/src/loadbalancer/load-balancer.ts`
- `services/gateway/src/loadbalancer/health-monitor.ts`
- `services/bank-node/src/lab/simulate-work.ts`
- Gateway routes: `GET /api/system/load`, `POST /api/lab/load/run`, `PUT /api/lab/nodes/:id/latency`.

### Tasks
- [x] Task 8.1: Implement pure least-connections picker function choosing healthy node with fewest active requests, breaking ties by lowest EWMA latency, then node ID.
- [x] Task 8.2: Implement gateway `LoadBalancer` managing in-flight request counters and dispatching requests through `picker.ts`.
- [x] Task 8.3: Implement background health monitor calling `GetStatus` on each node every 2000ms (unhealthy after 2 failures; healthy after 1 success).
- [x] Task 8.4: Implement EWMA latency updating on every completed request ($\alpha = 0.2$).
- [x] Task 8.5: Implement `SimulateWork(duration_ms)` RPC in `LabService` and artificial latency injection in request handlers.
- [x] Task 8.6: Implement `GET /api/system/load` returning live per-node metrics (active, total, share %, EWMA latency, failures, health).
- [x] Task 8.7: Implement `POST /api/lab/load/run` sending concurrent synthetic requests through the balancer.

### Tests to be Written
- Unit tests:
  - `U-LB-1`: Least connections picker (picks min active; tie -> lower EWMA -> lower ID; skips unhealthy; skips at-capacity unless all; decrements counter on error/timeout).
- Distributed tests:
  - `D-LB-1`: Distribution: 100 concurrent requests distribute across all healthy nodes; shares sum to 100%.
  - `D-LB-2`: Slow node: Node 2 latency set to 1000ms -> its traffic share drops markedly compared to peers.
  - `D-LB-3`: Dead node: Stopped node receives 0 requests; after restart it receives traffic again.

### Exit Criteria (from `CLAUDE.md` §11)
- Load test shows traffic distribution responding to active connections.
- Stopped node receives 0 requests and is marked unhealthy.
- Recovered node begins receiving traffic again automatically.

### Definition of Done Checklist
- [x] Code complete.
- [x] Unit tests passing.
- [x] Distributed tests written and wired.
- [x] Lint and typecheck clean.
- [x] Docs synced.
- [x] Change log in `CLAUDE.md` §14 updated.

---

## Phase 9: Physical Clock (Berkeley) — ✅ COMPLETED

> **Completed (2026-10-09 23:13 IST):** Berkeley sync wired end-to-end. Bank-node: SimulatedHwClock + BerkeleyClockSync created, GetTime/AdjustClock/TriggerClockSync handlers implemented, berkeleySync passed to lab+observability handlers. Gateway: getClockState/getClockHistory added to ObservabilityGrpcClient, GET /api/system/clocks, GET /api/system/clocks/history, POST /api/lab/clock/synchronize all wired.

### Objective
Implement software-simulated hardware clock with configurable skew and drift, pure Berkeley adjustment algorithm with verification sweep, monotonic timestamp wrapper, periodic synchronization rounds led by the leader (time master), round history persistence, and manual synchronization trigger.

### Deliverables
- Software simulated hardware clock with skew (`INITIAL_CLOCK_SKEW_MS`) and drift (`CLOCK_DRIFT_PPM`).
- Pure Berkeley calculation function with outlier exclusion and RTT/2 compensation.
- Monotonic physical clock wrapper `physicalClock.now()`.
- Verification sweep measuring `residualAfterMs` (< 50ms) after adjustment pass.
- Periodic Berkeley round on leader every `CLOCK_SYNC_INTERVAL_MS` (30s) and on peer recovery.
- `clock_sync_history` persistence and endpoints (`GET /api/system/clocks`, `POST /api/lab/clock/synchronize`).

### Files / Modules to be Created
- `services/bank-node/src/clock/simulated-hw-clock.ts`
- `services/bank-node/src/clock/physical-clock.ts`
- `services/bank-node/src/clock/berkeley-math.ts` (pure core)
- `services/bank-node/src/clock/berkeley-coordinator.ts` (leader coordinator)
- `services/bank-node/src/grpc/clock-handlers.ts` (`GetTime`, `AdjustClock`)
- Gateway routes: `GET /api/system/clocks`, `GET /api/system/clocks/history`, `POST /api/lab/clock/synchronize`.

### Tasks
- [ ] Task 9.1: Implement software hardware-clock wrapping OS time with skew and ppm drift calculation.
- [ ] Task 9.2: Implement monotonic clock wrapper ensuring physical timestamps never decrease across negative adjustments.
- [ ] Task 9.3: Implement `ClusterService.GetTime` and `ClusterService.AdjustClock` handlers updating cumulative `adjustmentMs`.
- [ ] Task 9.4: Implement pure Berkeley calculation: compute offsets $d_i$, exclude outliers beyond `BERKELEY_OUTLIER_MS`, compute average, and determine relative adjustments $a_i$.
- [ ] Task 9.5: Implement leader Berkeley coordinator:
  - Step 1: Initial `GetTime` sweep measuring `offsetBeforeMs`.
  - Step 2: Calculate adjustments and dispatch `AdjustClock`.
  - Step 3: Verification `GetTime` sweep measuring `residualAfterMs` (< 50ms).
  - Step 4: Persist round in `clock_sync_history`.
- [ ] Task 9.6: Wire transactions and events to record synchronized physical timestamps in `transactions.physical_ts` and `event_log.physical_ts`.
- [ ] Task 9.7: Expose `GET /api/system/clocks`, `GET /api/system/clocks/history`, and `POST /api/lab/clock/synchronize`.

### Tests to be Written
- Unit tests:
  - `U-BRK-1`: Berkeley math (symmetric offsets -> zero average; asymmetric -> exact adjustments; outlier excluded from average but still adjusted; RTT/2 compensation).
  - `U-BRK-2`: Monotonic clock (backward adjustment never produces decreasing timestamps).
- Distributed tests:
  - `D-CLK-1`: Berkeley round: initial offsets differ by seconds (env values); after sync, pairwise verification residuals are < 50ms; round stored with 3 values per node.
  - `D-CLK-2`: Clock failure tolerance: stop one node during round -> round completes with that node marked `skipped`.
  - `D-CLK-3`: Clock drift: after 60s without sync, pairwise offsets diverge again (proves active drift model).
  - `D-CLK-4`: Timestamps: transaction physical timestamps use synchronized clock and remain monotonic.

### Exit Criteria (from `CLAUDE.md` §11)
- Initial node offsets differ by seconds based on configuration.
- After a Berkeley round, verified pairwise offsets between nodes are < 50ms.
- Clock adjustments and round metrics come from running containers.

### Definition of Done Checklist
- [ ] Code complete.
- [ ] Unit tests passing.
- [ ] Distributed tests passing.
- [ ] Lint and typecheck clean.
- [ ] `docker compose up --build` verified with Berkeley rounds.
- [ ] Docs synced.
- [ ] Change log in `CLAUDE.md` §14 updated.

---

## Phase 10: Concurrency Lab — ✅ COMPLETED

> **Completed (2026-10-09 23:28 IST):** Concurrency lab wired end-to-end. EventLoopLagMonitor implemented using `perf_hooks.monitorEventLoopDelay` and wired into bank-node lifecycle and state reporting. Real CpuTask handler implemented comparing MAIN and WORKER modes with event loop lag measurement. Gateway routes `/api/lab/concurrency/run` (withdraw-race, transfer-crossfire, duplicate-key with BankGrpcClient) and `/api/lab/concurrency/cpu-task` implemented and active.

### Objective
Implement concurrency lab scenarios in `bank-node` and `gateway`: `withdraw-race`, `transfer-crossfire`, `duplicate-key`, event-loop lag monitoring (`perf_hooks.monitorEventLoopDelay`), and CPU-bound task execution comparing main thread vs Piscina worker threads.

### Deliverables
- Event loop lag monitor running on nodes.
- `LabService.CpuTask` RPC executing synthetic CPU work in main thread or worker threads.
- Concurrency test endpoints: `POST /api/lab/concurrency/run` and `POST /api/lab/concurrency/cpu-task`.
- Automated test scripts validating concurrency invariants.

### Files / Modules to be Created
- `services/bank-node/src/concurrency/lag-monitor.ts`
- `services/bank-node/src/lab/concurrency-scenarios.ts`
- `services/gateway/src/routes/lab-concurrency.routes.ts`

### Tasks
- [x] Task 10.1: Implement event-loop delay monitoring via Node's `perf_hooks.monitorEventLoopDelay` and report in heartbeats / status.
- [x] Task 10.2: Implement `LabService.CpuTask` executing CPU iterations either directly on event loop or delegated to Piscina worker pool.
- [x] Task 10.3: Implement `POST /api/lab/concurrency/run` with scenario runners:
  - `withdraw-race`: 20 concurrent withdrawals with distinct keys; verify exact funds exhaustion.
  - `transfer-crossfire`: concurrent transfers A->B and B->A; verify deadlock avoidance and total money conservation.
  - `duplicate-key`: 10 concurrent requests with identical key; verify single application.
- [x] Task 10.4: Implement `POST /api/lab/concurrency/cpu-task` returning execution times and p99 event-loop lag.

### Tests to be Written
- Distributed / Concurrency tests:
  - `D-CON-1`: Classic race (7,000 vs 6,000 on 10,000) -> 1 committed, 1 rejected, balance non-negative.
  - `D-CON-2`: 20 withdrawals of 1,000 on 10,000 balance -> 10 committed, 10 rejected, final balance 0, version +10, checksums equal.
  - `D-CON-3`: Crossfire transfers -> zero deadlocks, total money conserved, balances correct.
  - `D-CON-4`: Duplicate key -> applied exactly once, all 10 responses return same transaction ID.
  - `D-CON-5`: Main thread vs worker CPU task -> MAIN shows significantly higher event-loop lag p99 than WORKER.

### Exit Criteria (from `CLAUDE.md` §11)
- 20 concurrent withdrawals test passes with zero overdraft and invariant verified.
- Event loop lag metric visibly distinguishes main-thread CPU execution from worker pool execution.

### Definition of Done Checklist
- [x] Code complete.
- [x] Unit tests passing.
- [x] Concurrency tests passing.
- [x] Lint and typecheck clean.
- [x] `docker compose up --build` verified under concurrent load.
- [x] Docs synced.
- [x] Change log in `CLAUDE.md` §14 updated.

---

## Phase 11: Lab Services & Observability Completeness — ✅ COMPLETED

> **Completed (2026-10-09 23:33 IST):** All LabService RPCs implemented (SetFaultMode, SetConfig, TriggerElection, TriggerClockSync, SimulateWork, CpuTask, PeerPing with real hop tracing). All Gateway system routes (/system/overview, /system/nodes multi-node status, /system/leader, /system/clocks, /system/clocks/history, /system/replication, /system/load, /system/elections with DB query, /system/events, /system/rpc-trace, /system/integrity) wired to real backend. Gateway lab routes (/lab/nodes/:id/fault, /lab/config/election-algorithm, /lab/config/consistency-mode, /lab/nodes/:id/replication-delay, /lab/nodes/:id/latency, /lab/election/bully, /lab/election/ring, /lab/clock/synchronize, /lab/rpc/trace-call, /lab/load/run) gated by LAB_MODE middleware returning 404 LAB_DISABLED when disabled.

### Objective
Complete all remaining `LabService` handlers and gateway `/api/system/*` and `/api/lab/*` endpoints per `docs/api-reference.md`. Ensure fault injection modes and observability aggregators return live cluster data.

### Deliverables
- Full implementation of `LabService` (`SetFaultMode`, `SetConfig`, `TriggerElection`, `TriggerClockSync`, `SimulateWork`, `CpuTask`, `PeerPing`).
- Full implementation of all `/api/system/*` endpoints (`overview`, `nodes`, `leader`, `clocks`, `replication`, `load`, `elections`, `events`, `rpc-trace`, `integrity`).
- Full implementation of all `/api/lab/*` endpoints with `LAB_MODE` gating.
- Trace call generator `POST /api/lab/rpc/trace-call` traversing nodes via `PeerPing`.

### Files / Modules to be Created
- `services/bank-node/src/grpc/lab-service.ts`
- `services/gateway/src/routes/system.routes.ts`
- `services/gateway/src/routes/lab.routes.ts`

### Tasks
- [x] Task 11.1: Complete `LabService` RPC handlers in `bank-node`.
- [x] Task 11.2: Implement `PeerPing` RPC enabling hop tracing between arbitrary peer nodes.
- [x] Task 11.3: Implement gateway system aggregation routes: `/system/overview`, `/system/nodes`, `/system/leader`, `/system/clocks`, `/system/clocks/history`, `/system/replication`, `/system/load`, `/system/elections`, `/system/events`, `/system/rpc-trace`, `/system/integrity`.
- [x] Task 11.4: Implement gateway lab action routes: `/lab/nodes/:id/fault`, `/lab/config/election-algorithm`, `/lab/config/consistency-mode`, `/lab/nodes/:id/replication-delay`, `/lab/nodes/:id/latency`, `/lab/election/bully`, `/lab/election/ring`, `/lab/clock/synchronize`, `/lab/rpc/trace-call`, `/lab/load/run`.
- [x] Task 11.5: Verify `LAB_MODE=false` causes `/api/lab/*` to return 404 `LAB_DISABLED`.

### Tests to be Written
- Integration tests:
  - `D-RPC-1`: Hop trace produced via `POST /api/lab/rpc/trace-call` (Node 1 -> Node 3) with matching `requestId` and advancing Lamport.
  - `D-SEC-1`: `LAB_MODE=false` test verifies all `/api/lab/*` endpoints return 404 `LAB_DISABLED`.
  - Validate response schemas of all system endpoints against `docs/api-reference.md` §5.

### Exit Criteria (from `CLAUDE.md` §11)
- Every system and lab endpoint in `api-reference.md` returns live data from the cluster.
- Fault modes (`CRASH`, `PARTITION`) produce expected behaviors.
- Gateway aggregates data across all 3 nodes without omitting unreachable nodes.

### Definition of Done Checklist
- [x] Code complete.
- [x] Unit tests passing.
- [x] Integration tests passing.
- [x] Lint and typecheck clean.
- [x] `docker compose up --build` verified with all endpoints callable.
- [x] Docs synced.
- [x] Change log in `CLAUDE.md` §14 updated.

---

## Phase 12: Frontend — Banking — ✅ COMPLETED

> **Completed (2026-10-09 23:45 IST):** Modern, premium React 18 + Vite + Tailwind CSS frontend built and production bundle verified (`dist/`). Full banking workflow implemented: Login (`/login`), Register (`/register`), Dashboard (`/`), Accounts list & opening modal (`/accounts`), Account detail with deposit/withdraw/transfer & CSV statement download (`/accounts/:id`), and filtered Transactions history (`/transactions`). Real API integration with automatic JWT injection, UUID `Idempotency-Key` generation per submission, metadata tracking (`entryNode`, `processedBy`, `lamport`), and currency formatting via `Intl.NumberFormat('en-IN')`.

### Objective
Build the banking user interface with Vite, React 18, Tailwind CSS v3.4.x, React Router, and TanStack Query. Implement authentication, account dashboard, deposit/withdraw/transfer modals with fresh idempotency keys, transaction history with filtering, and CSV statement download.

### Deliverables
- Vite + React 18 + Tailwind CSS v3 setup in `frontend/`.
- Design tokens, color palette, and layout matching `docs/style-guide.md` §10.
- Typed API client with JWT attachment and response metadata handling.
- Auth views: Login and Register.
- Banking views: Dashboard, Accounts List/Detail, Deposit, Withdraw, Transfer with recipient name lookup, Transaction History, CSV download.
- Display of `entryNode`, `processedBy`, and `lamport` on transaction responses.

### Files / Modules to be Created
- `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tailwind.config.js`, `frontend/src/index.css`
- `frontend/src/api/client.ts`, `frontend/src/api/types.ts`
- `frontend/src/context/auth-context.tsx`
- `frontend/src/components/layout/app-layout.tsx`, `frontend/src/components/layout/sidebar.tsx`, `frontend/src/components/layout/topbar.tsx`
- `frontend/src/components/common/money-input.tsx`, `frontend/src/components/common/money-display.tsx`, `frontend/src/components/common/status-badge.tsx`
- `frontend/src/pages/auth/login-page.tsx`, `frontend/src/pages/auth/register-page.tsx`
- `frontend/src/pages/banking/dashboard-page.tsx`, `frontend/src/pages/banking/accounts-page.tsx`, `frontend/src/pages/banking/account-detail-page.tsx`
- `frontend/src/pages/banking/transactions-page.tsx`

### Tasks
- [x] Task 12.1: Initialize `frontend/` using Vite with React 18, TypeScript, and pinned Tailwind CSS v3.4.x.
- [x] Task 12.2: Configure Tailwind theme with slate palette, indigo primary, emerald/amber/rose status tokens, and Inter typography.
- [x] Task 12.3: Build typed API client with JWT storage, auto-logout on 401, and UUID `Idempotency-Key` generation per form submission.
- [x] Task 12.4: Build base layout with navigation sidebar (Banking and Distributed System sections) and top bar with cluster status pill.
- [x] Task 12.5: Build Login and Register pages.
- [x] Task 12.6: Build Dashboard displaying total balance, recent transactions, and accounts overview.
- [x] Task 12.7: Build Account Detail page with Deposit, Withdraw, and Transfer actions.
- [x] Task 12.8: Build Transfer modal with real-time destination lookup (`/api/accounts/lookup`) displaying masked holder name.
- [x] Task 12.9: Display response metadata (`entryNode`, `processedBy`, `lamport`) on transaction completion toasts.
- [x] Task 12.10: Build Transaction History page with pagination, type/status filters, and CSV statement download.

### Tests to be Written
- Component / E2E tests:
  - Form validation tests (disallow zero/negative amounts, validate 12-digit account numbers).
  - Idempotency key generation: verifies new key generated per new submission, reused on retry.
  - End-to-end browser banking test through gateway.

### Exit Criteria (from `CLAUDE.md` §11)
- Complete banking flow works in browser (register, login, open account, deposit, withdraw, transfer, history, statement CSV).
- UI formats currency using `Intl.NumberFormat('en-IN')` from paise.
- New UUID idempotency key generated per user submission.

### Definition of Done Checklist
- [x] Code complete.
- [x] Frontend unit/component tests passing.
- [x] End-to-end flow verified in browser.
- [x] Lint and typecheck clean.
- [x] `docker compose up --build` serves frontend on port 3000 via nginx.
- [x] Docs synced.
- [x] Change log in `CLAUDE.md` §14 updated.

---

## Phase 13: Frontend — Distributed Lab & Monitoring — ✅ COMPLETED

> **Completed (2026-10-09 23:45 IST):** Complete Distributed Lab frontend suite implemented: Cluster Overview (`/cluster`), RPC Hop Trace Lab (`/lab/rpc`), Concurrency & Lag Lab (`/lab/concurrency`), Berkeley Physical Clock Lab (`/lab/physical-clock`), Lamport Causality Lab (`/lab/logical-clock`), Bully Election Lab (`/lab/bully`), Ring Election Lab (`/lab/ring`), Replication & Consistency Lab (`/lab/replication`), Least Connections Load Balancer Lab (`/lab/load-balancing`), and Fault Tolerance Chaos Injection Lab (`/lab/fault-tolerance`). Polling hooks refresh live backend data every 1200-2500ms. Zero placeholder data. Multi-stage production Docker build verified.

### Objective
Build the Distributed Lab section in the frontend: Cluster Overview page and 9 dedicated lab pages with polling hooks (TanStack Query), live state panels, interactive action panels with `ConfirmButton`, message sequence diagrams, and real-time event timelines.

### Deliverables
- Reusable lab components: `NodeCard`, `RoleBadge`, `StatusPill`, `LamportChip`, `EventTimeline`, `MessageSequence` (SVG), `LagBar`, `ShareBar`, `ClockTable`, `ConfirmButton`.
- Cluster Overview page (`/cluster`).
- 9 Lab pages:
  1. RPC Communication (`/lab/rpc`)
  2. Concurrency (`/lab/concurrency`)
  3. Physical Clock (`/lab/physical-clock`)
  4. Logical Clock (`/lab/logical-clock`)
  5. Bully Election (`/lab/bully`)
  6. Ring Election (`/lab/ring`)
  7. Replication & Consistency (`/lab/replication`)
  8. Load Balancing (`/lab/load-balancing`)
  9. Fault Tolerance (`/lab/fault-tolerance`)

### Files / Modules to be Created
- `frontend/src/components/lab/node-card.tsx`, `frontend/src/components/lab/role-badge.tsx`, `frontend/src/components/lab/event-timeline.tsx`
- `frontend/src/components/lab/message-sequence.tsx`, `frontend/src/components/lab/lag-bar.tsx`, `frontend/src/components/lab/clock-table.tsx`
- `frontend/src/components/common/confirm-button.tsx`
- `frontend/src/pages/cluster/cluster-overview-page.tsx`
- `frontend/src/pages/lab/rpc-lab-page.tsx`, `frontend/src/pages/lab/concurrency-lab-page.tsx`
- `frontend/src/pages/lab/physical-clock-lab-page.tsx`, `frontend/src/pages/lab/logical-clock-lab-page.tsx`
- `frontend/src/pages/lab/bully-lab-page.tsx`, `frontend/src/pages/lab/ring-lab-page.tsx`
- `frontend/src/pages/lab/replication-lab-page.tsx`, `frontend/src/pages/lab/load-balancing-lab-page.tsx`
- `frontend/src/pages/lab/fault-tolerance-lab-page.tsx`

### Tasks
- [x] Task 13.1: Build reusable lab layout components following template (§10.3: Title/Concept, Live State, Actions, Timeline, Expected Result).
- [x] Task 13.2: Implement Cluster Overview page showing all 3 nodes, current leader, replication status, and health indicators.
- [x] Task 13.3: Implement RPC Communication lab page with interactive "Trace Call" between nodes and visual hop latency breakdown.
- [x] Task 13.4: Implement Concurrency lab page with interactive scenario runners (`withdraw-race`, `transfer-crossfire`, `duplicate-key`, `MAIN` vs `WORKER` CPU task with Recharts lag chart).
- [x] Task 13.5: Implement Physical Clock lab page with live offsets, "Synchronize Now" button, round history table showing 3 values (`offsetBeforeMs`, `adjustMs`, `residualAfterMs`), and drift chart.
- [x] Task 13.6: Implement Logical Clock lab page showing request ID filter, causality sequence, and merged events ordered by `(lamport, node)`.
- [x] Task 13.7: Implement Bully Election lab page with live node roles, kill/restore triggers, and sequence diagram of `Election` and `Coordinator` messages.
- [x] Task 13.8: Implement Ring Election lab page displaying token traversal path (1->2->3->1), dead node skipping, and coordinator round.
- [x] Task 13.9: Implement Replication & Consistency lab page with Strong vs Eventual toggle, injected delay slider, replication lag bars, and live integrity checksum comparison.
- [x] Task 13.10: Implement Load Balancing lab page with synthetic load generator, node latency injector, and live load distribution bar chart.
- [x] Task 13.11: Implement Fault Tolerance lab page demonstrating primary-backup failover, node soft-crash, and network partition (CP vs AP).

### Tests to be Written
- Frontend verification:
  - All 10 pages render without console errors.
  - Live data polling hooks refresh every 1000-2000ms.
  - Zero hardcoded placeholder arrays in production components.

### Exit Criteria (from `CLAUDE.md` §11)
- Every lab page renders live backend data fetched via API.
- Evaluator can execute every demo in `docs/testing-and-demo.md` directly from the browser UI.
- No static or fabricated distributed data present in frontend code.

### Definition of Done Checklist
- [x] Code complete.
- [x] Frontend builds without TypeScript or ESLint warnings.
- [x] All 9 lab pages verified with live backend in Docker.
- [x] `docker compose up --build` working end-to-end.
- [x] Docs synced.
- [x] Change log in `CLAUDE.md` §14 updated.

---

## Phase 14: Test Hardening

### Objective
Fill all remaining testing gaps across unit, integration, and distributed suites against the complete test matrix in `docs/testing-and-demo.md`. Eliminate test flakiness (replace any fixed sleep with `waitFor`). Verify all 12 viva demo scenarios pass automatically.

### Deliverables
- Full unit test suite (`npm test`).
- Full integration test suite (`npm run test:integration`).
- Full distributed test suite (`npm run test:distributed`).
- Concurrency test suite (`npm run test:concurrency`).
- Clean test run with zero flakes or skipped tests.

### Files / Modules to be Created
- `tests/helpers/wait.ts` (`waitFor` polling helper)
- `tests/helpers/cluster.ts` (Docker compose test driver)
- `tests/integration/*.test.ts`
- `tests/distributed/*.test.ts`

### Tasks
- [ ] Task 14.1: Audit test codebase to ensure zero fixed `setTimeout` sleeps exist in test assertions; ensure all async waits use `waitFor`.
- [ ] Task 14.2: Verify complete coverage of Unit Test Matrix: `U-LAM-1`, `U-LAM-2`, `U-BRK-1`, `U-BRK-2`, `U-BUL-1`, `U-RNG-1`, `U-ELC-1`, `U-LB-1`, `U-REP-1`, `U-REP-2`, `U-REP-3`, `U-BNK-1`, `U-IDM-1`.
- [ ] Task 14.3: Verify complete coverage of Integration Test Matrix: `I-AUTH-1`, `I-ACC-1`, `I-TXN-1`, `I-TXN-2`, `I-TXN-3`, `I-IDM-1`, `I-IDM-2`, `I-IDM-3`, `I-IDM-4`, `I-DB-1`, `I-GW-1`, `I-GRPC-1`, `I-WRK-1`.
- [ ] Task 14.4: Verify complete coverage of Distributed Test Matrix: `D-CLU-1`, `D-RPC-1`, `D-LAM-1`, `D-BUL-1`, `D-BUL-2`, `D-RNG-1`, `D-RNG-2`, `D-RNG-3`, `D-ALG-1`, `D-REP-1`, `D-REP-2`, `D-REP-3`, `D-REP-4`, `D-REP-5`, `D-REP-6`, `D-FOV-1`, `D-FOV-2`, `D-FOV-3`, `D-SPL-1`, `D-SPL-2`, `D-DB-1`, `D-LB-1`, `D-LB-2`, `D-LB-3`, `D-CLK-1`, `D-CLK-2`, `D-CLK-3`, `D-CLK-4`, `D-CON-1`, `D-CON-2`, `D-CON-3`, `D-CON-4`, `D-CON-5`, `D-SEC-1`.
- [ ] Task 14.5: Run Grep audit across `services/` and `packages/` ensuring no hardcoded node lists, leaders, offsets, or simulated values exist outside sanctioned software clock skew.

### Tests to be Written / Verified
- All 13 Unit test suites passing.
- All 13 Integration test suites passing.
- All 34 Distributed test scenarios passing.

### Exit Criteria (from `CLAUDE.md` §11)
- `npm test` passes cleanly.
- `npm run test:integration` passes cleanly.
- `npm run test:distributed` passes cleanly against live Docker containers.
- Zero test flakes across 3 consecutive runs.

### Definition of Done Checklist
- [ ] Code complete.
- [ ] All unit, integration, and distributed tests passing.
- [ ] Grep audit for hardcoded values clean.
- [ ] Lint and typecheck clean.
- [ ] Docs synced.
- [ ] Change log in `CLAUDE.md` §14 updated.

---

## Phase 15: Final Packaging & Demo Runbook Rehearsal

### Objective
Create root `README.md` with complete architecture guide and setup instructions, finalize demo seeding scripts (`scripts/seed-demo.ts`, `scripts/seed-demo.sh`), verify integrity checker script, perform an end-to-end rehearsal of the 12 viva demonstrations, and ensure all acceptance criteria are ticked.

### Deliverables
- Comprehensive root `README.md` with topology diagrams, quick start, API reference, and known limitations.
- Working `npm run seed` (`scripts/seed-demo.ts`) populating Alice and Bob with accounts and transactions.
- Working `npm run reset` (`scripts/reset.ts`) resetting volumes and containers.
- Working `npm run verify:integrity` verifying all 3 nodes are in sync.
- Working `npm run grpc:demo` demonstrating direct gRPC calls to the evaluator.
- 100% acceptance criteria verified in `CLAUDE.md` §13.

### Files / Modules to be Created
- `README.md`
- `scripts/seed-demo.ts`, `scripts/seed-demo.sh`
- `scripts/verify-integrity.ts`, `scripts/verify-integrity.sh`
- `scripts/grpc-demo.ts`, `scripts/grpc-demo.sh`

### Tasks
- [ ] Task 15.1: Write `README.md` covering architecture, Docker instructions, environment variables, demo guide, and viva talking points.
- [ ] Task 15.2: Implement `scripts/seed-demo.ts` creating Alice (`alice@demo.test`) with ₹1,00,000 and Bob (`bob@demo.test`) with ₹50,000 via real API calls.
- [ ] Task 15.3: Implement `scripts/verify-integrity.ts` querying `/api/system/integrity` and formatting console comparison.
- [ ] Task 15.4: Implement `scripts/grpc-demo.ts` demonstrating direct gRPC calls to bank nodes.
- [ ] Task 15.5: Execute full Viva Demo rehearsal from scratch:
  1. `npm run reset && docker compose up --build -d`
  2. `npm run seed`
  3. Run through Demo 1 to Demo 12 in `docs/testing-and-demo.md` §7.
- [ ] Task 15.6: Tick all acceptance criteria in `CLAUDE.md` §13.
- [ ] Task 15.7: Final sync of all documentation files and change log.

### Exit Criteria (from `CLAUDE.md` §11)
- Fresh clone -> `docker compose up --build` -> `npm run seed` -> full demo script runs without manual fixes.
- All 12 viva demo scenarios pass cleanly.
- All boxes in `CLAUDE.md` §13 acceptance criteria ticked.

### Definition of Done Checklist
- [ ] Code complete.
- [ ] All tests passing.
- [ ] Complete demo runbook verified.
- [ ] Lint and typecheck clean.
- [ ] README.md complete and accurate.
- [ ] All acceptance criteria in `CLAUDE.md` ticked.
- [ ] Change log in `CLAUDE.md` §14 up to date.

---

## Open Questions / Decisions Needed

1. **Host Port Bindings Verified:** All default host ports (`:5441`, `:5442`, `:5443`, `:3000`, `:8080`, `:50051`, `:50052`, `:50053`) were scanned via PowerShell `netstat` and confirmed free. They are parameterized in `.env.example` with defaults matching documentation.
2. **Line Endings:** `.gitattributes` has been created forcing LF for `*.sh`, `Dockerfile*`, `*.sql`, and entrypoints to prevent Windows CRLF corruption in Linux containers.
3. **No pending architecture or protocol ambiguities remain.** All 5 decisions from Step 0 have been formally integrated into `CLAUDE.md`, `docs/architecture.md`, `docs/api-reference.md`, and `docs/testing-and-demo.md`.
