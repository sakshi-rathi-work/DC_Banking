# Gap Analysis — Phases 8–15: Distributed Banking System (DBS)

> **Date:** 2026-10-09  
> **Author:** Antigravity AI Assistant  
> **Status:** Completed Audit & Gap Analysis deliverable prior to Phase 8 implementation.  
> **Scope:** Verification of Phases 1–7 baseline and detailed implementation plan for Phases 8–15.

---

## 1. Executive Summary & Step 1 Audit Findings

An exhaustive repository and environment audit was performed across the codebase prior to modifying any source files.

### 1.1 Baseline Health & Environment Status
- **Git State:** Clean working tree on branch `main` (`1a2a136 first`).
- **Runtime Versions:** Node.js `v24.21.0`, npm `11.19.0`, TypeScript `5.7.3`, Vitest `2.1.8`.
- **Docker Environment:** Docker CLI `29.3.1` and Compose v2 (`v5.1.0`) are installed on the host. However, the Docker daemon (`dockerDesktopLinuxEngine`) was not actively running during the initial audit (`ECONNREFUSED` on docker socket). This is an environmental constraint: container-based suites (`docker compose up`, `npm run failover:load`, integration suites connecting to live containerized Postgres) require the Docker daemon to be running.
- **Dependencies:** `npm install` completed with exit code 0.
- **Typecheck & Lint:**
  - `npm run lint` (`eslint . --ext .ts,.tsx`) passed cleanly with **0 errors**.
  - `npm run typecheck` (`tsc -b`) passed cleanly with **0 errors**.
- **Unit Tests:**
  - All pure unit tests (`packages/shared/src/clock/lamport.test.ts`, `packages/shared/src/config/config.test.ts`, `packages/shared/src/errors/app-error.test.ts`, `packages/shared/src/grpc/interceptors/lamport-interceptor.test.ts`, `packages/shared/src/types/paise.test.ts`, `services/bank-node/src/bank/idempotency.test.ts`, `services/bank-node/src/election/bully.test.ts`, `services/bank-node/src/election/ring.test.ts`, `services/bank-node/src/election/election-manager.test.ts`, `services/bank-node/src/replication/replicator.test.ts`) **passed (52 passing, 20 skipped)**.
- **Identified Pre-Existing Regressions & Tooling Gaps:**
  1. **`scripts/proto-gen.ts` Windows Path Quoting:** When the workspace directory path contains spaces (e.g. `C:\SPIT\SPIT SEM-5\...`), `execSync` invokes `proto-loader-gen-types` without quoting paths, triggering `'C:\SPIT\SPIT' is not recognized as an internal or external command`. Quotes must be added around paths in `scripts/proto-gen.ts`.
  2. **`npm test` Test Discovery:** `package.json` defines `"test": "vitest run"` without a dedicated unit-test config file. As a result, Vitest executes all `*.test.ts` files including `tests/integration/*` and DB-connected tests (`applier.test.ts`, `catchup.test.ts`), which fail when PostgreSQL is not running locally. Per `docs/testing-and-demo.md` §1, `npm test` should target pure unit tests without requiring Docker.

---

## 2. Inventory of Reusable Assets (Phases 1–7)

The following components from earlier phases are present and ready for reuse in Phases 8–15:

1. **Gateway Retry Engine (`services/gateway/src/loadbalancer/retry.ts`):**
   - Implements `executeWithRetry<T>` with 5 attempts, exponential backoff (200ms initial, doubling up to 2000ms), and 12s overall time budget.
   - Retries `UNAVAILABLE`, `DEADLINE_EXCEEDED`, `NOT_LEADER`, `LEADER_NOT_READY`, and `NO_QUORUM` for idempotent requests.
2. **Gateway Bank Client (`services/gateway/src/grpc/bank-client.ts`):**
   - Implements all 12 banking RPC wrappers (`Register`, `Login`, `GetMe`, `CreateAccount`, `ListAccounts`, `GetAccount`, `LookupAccount`, `Deposit`, `Withdraw`, `Transfer`, `ListTransactions`, `GetTransaction`, `GetStatement`).
   - Uses `getDefaultTarget()` targeting node 1 or `GATEWAY_NODES[0]`. Must be updated to query the Phase 8 `LoadBalancer`.
3. **Database Health Monitor (`services/bank-node/src/cluster/db-health.ts`):**
   - `DbHealthMonitor` polls `SELECT 1` every 1000ms; marks node `DB_DOWN` after 2 consecutive failures and notifies on status change.
4. **Protobuf Definitions (`proto/`):**
   - `proto/bank.proto`: Complete banking and statement contracts.
   - `proto/cluster.proto`: Complete cluster membership, Bully/Ring election, Berkeley clock sync (`GetTime`, `AdjustClock`), and replication contracts.
   - `proto/observability.proto`: `NodeStatus`, `GetEvents`, `GetRpcTrace`, `Integrity`, `ReplicationState`.
   - `proto/lab.proto`: `SetFaultMode`, `SetConfig`, `TriggerElection`, `TriggerClockSync`, `SimulateWork`, `CpuTask`, `PeerPing`.
5. **Database Schema & Migrations (`database/migrations/0001_init.sql`):**
   - Tables: `users`, `accounts` (with `CHECK (balance_paise >= 0)`), `transactions` (with `physical_ts`, `lamport`, `epoch`, `log_seq`), `idempotency_keys`, `replication_log`, `node_state` (with `clock_adjust_ms`), `event_log`, `election_history`, `clock_sync_history`.
6. **Replication & Election Modules (`services/bank-node/src/{election,replication}/`):**
   - Pure Bully and Ring election state machines, `ElectionManager` with epoch persistence, `LeaderPrep` reconciliation.
   - `Replicator`, `LogApplier`, `CatchupService`, `SnapshotService`, `IntegrityChecker`.

---

## 3. Detailed Phase-by-Phase Gap Analysis (Phases 8–15)

### PHASE 8 — Load Balancing
- **Requirements Reference:** `CLAUDE.md` §11 Phase 8, `docs/architecture.md` §10, `docs/api-reference.md` §5 (`GET /system/load`), §6.1 (`PUT /lab/nodes/:id/latency`), §6.4 (`POST /lab/load/run`).
- **Existing Implementation:**
  - `services/gateway/src/loadbalancer/retry.ts` (`executeWithRetry`).
  - `proto/lab.proto` has `SimulateWork(SimulateWorkRequest) returns (SimulateWorkReply)`.
  - Node 1-3 endpoints declared in `GATEWAY_NODES`.
- **Missing / Incomplete Behavior:**
  - Missing `services/gateway/src/loadbalancer/types.ts`: Node load state (`nodeId`, `address`, `healthy`, `status`, `activeRequests`, `totalRequests`, `failures`, `ewmaLatencyMs`, `lastHealthCheckAt`, `capacity = 50`).
  - Missing pure core `services/gateway/src/loadbalancer/picker.ts`: Select healthy node with lowest `activeRequests`; tie-break by lowest `ewmaLatencyMs`, then lowest `nodeId`; skip unhealthy nodes; skip at-capacity nodes (capacity >= 50) unless all are at capacity. Decrement active requests on success, error, or timeout.
  - Missing `services/gateway/src/loadbalancer/load-balancer.ts`: State management for all nodes, dispatch tracking, EWMA updating ($\alpha = 0.2$), in-flight counter increments/decrements.
  - Missing `services/gateway/src/loadbalancer/health-monitor.ts`: Polling `ObservabilityService.GetStatus` on all configured nodes every 2000ms; transition to unhealthy after 2 consecutive failures or `status !== 'UP'`; healthy after 1 success.
  - Missing `services/bank-node/src/lab/simulate-work.ts`: Real CPU/timer delay simulation for `SimulateWork`.
  - Incomplete `LabService.SimulateWork` in `services/bank-node/src/grpc/lab-service.ts` (currently returns dummy data without work).
  - Incomplete artificial latency injection in `bank-node` request handlers.
  - Missing gateway routes: `GET /api/system/load`, `POST /api/lab/load/run`, `PUT /api/lab/nodes/:id/latency`.
  - Gateway `bank-client.ts` currently targets only node 1; needs routing via `LoadBalancer`.
- **Dependencies:** Relies on `ObservabilityService.GetStatus` from Phase 4/7 and `executeWithRetry` from Phase 7.
- **Files to Change / Create:**
  - `services/gateway/src/loadbalancer/types.ts` (create)
  - `services/gateway/src/loadbalancer/picker.ts` (create)
  - `services/gateway/src/loadbalancer/load-balancer.ts` (create)
  - `services/gateway/src/loadbalancer/health-monitor.ts` (create)
  - `services/bank-node/src/lab/simulate-work.ts` (create)
  - `services/bank-node/src/grpc/lab-service.ts` (update)
  - `services/gateway/src/grpc/bank-client.ts` (update)
  - `services/gateway/src/routes/system.routes.ts` (update)
  - `services/gateway/src/routes/lab.routes.ts` (update)
- **Tests Needed:** `U-LB-1`, `D-LB-1`, `D-LB-2`, `D-LB-3`.
- **Risks / Blockers:** Ensuring writes forwarded to backups still reach the leader cleanly without double-counting metrics or violating forwarding semantics.

---

### PHASE 9 — Physical Clock (Berkeley)
- **Requirements Reference:** `CLAUDE.md` §11 Phase 9, `docs/architecture.md` §6.2–§6.3, `docs/api-reference.md` §5 (`GET /system/clocks`, `GET /system/clocks/history`), §6.3 (`POST /lab/clock/synchronize`).
- **Existing Implementation:**
  - `proto/cluster.proto` defines `GetTime` and `AdjustClock` RPCs.
  - `database/migrations/0001_init.sql` defines `clock_sync_history` table and `node_state.clock_adjust_ms`.
  - Stubs for `GetTime` and `AdjustClock` in `services/bank-node/src/grpc/cluster-service.ts` return `UNIMPLEMENTED`.
- **Missing / Incomplete Behavior:**
  - Missing `services/bank-node/src/clock/simulated-hw-clock.ts`: Software hardware-clock calculating $hw(t) = realNow(t) + INITIAL\_CLOCK\_SKEW\_MS + CLOCK\_DRIFT\_PPM \times 10^{-6} \times (realNow(t) - processStart)$. Must be explicitly labelled "simulated".
  - Missing `services/bank-node/src/clock/physical-clock.ts`: Monotonic wrapper guaranteeing $synced(t) = max(hw(t) + adjustmentMs, lastIssued + 1ms)$.
  - Missing pure core `services/bank-node/src/clock/berkeley-math.ts`: RTT/2 offset calculation ($d_i = T_i + RTT_i/2 - t_{recv}$), outlier filtering ($|d_i| \le BERKELEY\_OUTLIER\_MS$), average calculation, and relative adjustments ($a_i = avg - d_i$).
  - Missing `services/bank-node/src/clock/berkeley-coordinator.ts`: Leader coordinator executing 4-step sequence: (1) `GetTime` sweep, (2) `AdjustClock` dispatch, (3) verification `GetTime` sweep measuring `residualAfterMs` (< 50ms), (4) persistence in `clock_sync_history`. Scheduled every `CLOCK_SYNC_INTERVAL_MS` (30s) and triggered manually or on peer recovery.
  - Missing implementation in `services/bank-node/src/grpc/cluster-service.ts` for `GetTime` and `AdjustClock`.
  - Missing integration with `transactions.physical_ts` and `event_log.physical_ts`.
  - Missing gateway routes: `GET /api/system/clocks`, `GET /api/system/clocks/history`, `POST /api/lab/clock/synchronize`.
- **Dependencies:** Relies on leader election (Phase 5) since the leader is the time master.
- **Files to Change / Create:**
  - `services/bank-node/src/clock/simulated-hw-clock.ts` (create)
  - `services/bank-node/src/clock/physical-clock.ts` (create)
  - `services/bank-node/src/clock/berkeley-math.ts` (create)
  - `services/bank-node/src/clock/berkeley-coordinator.ts` (create)
  - `services/bank-node/src/grpc/cluster-service.ts` (update)
  - `services/bank-node/src/index.ts` (update)
  - `services/gateway/src/routes/system.routes.ts` (update)
  - `services/gateway/src/routes/lab.routes.ts` (update)
- **Tests Needed:** `U-BRK-1`, `U-BRK-2`, `D-CLK-1`, `D-CLK-2`, `D-CLK-3`, `D-CLK-4`.
- **Risks / Blockers:** Precision of RTT measurement in containerized environments. Verification sweep must tolerate network jitter.

---

### PHASE 10 — Concurrency Lab
- **Requirements Reference:** `CLAUDE.md` §11 Phase 10, `docs/architecture.md` §5.1–§5.3, `docs/api-reference.md` §6.5 (`POST /api/lab/concurrency/run`, `POST /api/lab/concurrency/cpu-task`), `docs/testing-and-demo.md` §4.
- **Existing Implementation:**
  - Piscina worker pool initialized in `services/bank-node/src/concurrency/pool.ts`.
  - Row-lock transactions (`SELECT ... FOR UPDATE` in account ID order) in `services/bank-node/src/db/tx.ts`.
  - Idempotency hashing in `services/bank-node/src/bank/idempotency.ts`.
  - `LabService.CpuTask` stub in `services/bank-node/src/grpc/lab-service.ts`.
- **Missing / Incomplete Behavior:**
  - Missing `services/bank-node/src/concurrency/lag-monitor.ts`: Real event-loop lag monitoring using `perf_hooks.monitorEventLoopDelay({ resolution: 20 })`.
  - Missing `services/bank-node/src/concurrency/workers/cpu-worker.ts`: Worker task for CPU compute.
  - Incomplete `LabService.CpuTask`: Execute CPU iterations on the main thread (`MAIN`) vs. Piscina worker threads (`WORKER`) and report p99 event-loop lag.
  - Missing `services/bank-node/src/lab/concurrency-scenarios.ts` and `services/gateway/src/routes/lab-concurrency.routes.ts`: Scenarios:
    - `withdraw-race`: 20 concurrent withdrawals with distinct idempotency keys against the real banking core.
    - `transfer-crossfire`: Concurrent A→B and B→A transfers; zero deadlock, total money conserved.
    - `duplicate-key`: 10 concurrent requests with identical key; exactly one applied, all return identical txn ID.
- **Dependencies:** Relies on banking transactions (`BankService`), gateway auth, and worker pool.
- **Files to Change / Create:**
  - `services/bank-node/src/concurrency/lag-monitor.ts` (create)
  - `services/bank-node/src/concurrency/workers/cpu-worker.ts` (create)
  - `services/bank-node/src/grpc/lab-service.ts` (update)
  - `services/bank-node/src/lab/concurrency-scenarios.ts` (create)
  - `services/gateway/src/routes/lab-concurrency.routes.ts` (create)
  - `services/gateway/src/index.ts` (mount routes)
- **Tests Needed:** `D-CON-1`, `D-CON-2`, `D-CON-3`, `D-CON-4`, `D-CON-5`.
- **Risks / Blockers:** Concurrency scenarios must operate strictly on caller-owned accounts without bypassing the production banking transaction engine.

---

### PHASE 11 — Lab Services & Observability Completeness
- **Requirements Reference:** `CLAUDE.md` §11 Phase 11, `docs/api-reference.md` §5 & §6, `docs/architecture.md` §3 & §7.
- **Existing Implementation:**
  - Partial routes in `services/gateway/src/routes/system.routes.ts` and `lab.routes.ts`.
  - Partial `LabService` handlers in `services/bank-node/src/grpc/lab-service.ts`.
- **Missing / Incomplete Behavior:**
  - Full `LabService` implementation: `PeerPing` traversing nodes and capturing hop latency with advancing Lamport values; `SetFaultMode` (`NONE`, `CRASH`, `PARTITION`); `SetConfig` for replication delay and artificial latency.
  - Full inventory of `/api/system/*` endpoints:
    - `GET /system/overview` (missing)
    - `GET /system/nodes` (partial; needs real status, event-loop lag, active requests, reachable flag)
    - `GET /system/leader` (missing)
    - `GET /system/clocks` (missing)
    - `GET /system/clocks/history` (missing)
    - `GET /system/replication` (partial; missing per-node breakdown with matchSeq, lagEntries, state)
    - `GET /system/load` (missing)
    - `GET /system/elections` (missing)
    - `GET /system/events` (partial; missing `since` Lamport cursor pagination)
    - `GET /system/rpc-trace` (implemented)
    - `GET /system/integrity` (implemented)
  - Full inventory of `/api/lab/*` endpoints:
    - `POST /lab/nodes/:id/fault` (implemented)
    - `PUT /lab/config/election-algorithm` (implemented)
    - `PUT /lab/config/consistency-mode` (implemented)
    - `PUT /lab/nodes/:id/replication-delay` (implemented)
    - `PUT /lab/nodes/:id/latency` (missing)
    - `POST /lab/election/bully` (implemented)
    - `POST /lab/election/ring` (implemented)
    - `POST /lab/clock/synchronize` (missing)
    - `POST /lab/rpc/trace-call` (missing)
    - `POST /lab/load/run` (missing)
    - `POST /lab/concurrency/run` (missing)
    - `POST /lab/concurrency/cpu-task` (missing)
  - Enforcement of `LAB_MODE=false` returning `404 LAB_DISABLED`.
  - JWT auth enforcement on `/api/system/*` and `/api/lab/*`.
  - Node aggregation resilience: never omit unreachable nodes; mark `reachable: false` with bounded deadlines.
- **Dependencies:** Relies on all backend subsystems (Phases 1–10).
- **Files to Change / Create:**
  - `services/bank-node/src/grpc/lab-service.ts` (update)
  - `services/gateway/src/middleware/lab-mode.ts` (create)
  - `services/gateway/src/routes/system.routes.ts` (update)
  - `services/gateway/src/routes/lab.routes.ts` (update)
  - `services/gateway/src/grpc/observability-client.ts` (update)
- **Tests Needed:** `D-RPC-1`, `D-SEC-1`, system endpoint response schema validation.
- **Risks / Blockers:** Bounded timeout handling so that a dead node never causes a gateway request to hang.

---

### PHASE 12 — Frontend: Banking
- **Requirements Reference:** `CLAUDE.md` §11 Phase 12, `docs/style-guide.md` §10, `docs/api-reference.md` §2–§4.
- **Existing Implementation:**
  - `frontend/package.json` with React 18, Vite, Tailwind CSS 3.4.17, React Router, TanStack Query, Recharts.
  - `frontend/index.html` stub.
- **Missing / Incomplete Behavior:**
  - Missing Vite configuration (`vite.config.ts`), PostCSS, Tailwind theme configuration matching `docs/style-guide.md` §10 tokens (Slate neutrals, Indigo primary, Emerald/Amber/Rose status, Inter font).
  - Missing typed API client (`frontend/src/api/client.ts`, `api/types.ts`) with automatic JWT attachment, auto-logout on 401, response metadata handling (`entryNode`, `processedBy`, `lamport`), and UUID `Idempotency-Key` generation per submission.
  - Missing `AuthContext` (`frontend/src/context/auth-context.tsx`).
  - Missing shell layout: `AppLayout`, `Sidebar` (Banking and Distributed System sections), `Topbar` (user info, cluster status pill).
  - Missing common components: `MoneyInput`, `MoneyDisplay` (using `Intl.NumberFormat('en-IN')` from paise), `StatusBadge`, `ConfirmButton`.
  - Missing pages: Login, Register, Dashboard (balances, recent activity), Accounts list/detail (Deposit, Withdraw, Transfer with `/api/accounts/lookup` live recipient verification), Transactions history (filters, pagination, CSV statement download).
- **Dependencies:** Gateway REST API (Phases 2 & 3).
- **Files to Change / Create:**
  - `frontend/vite.config.ts`, `frontend/tailwind.config.js`, `frontend/postcss.config.js`, `frontend/src/index.css` (create)
  - `frontend/src/main.tsx`, `frontend/src/App.tsx` (create)
  - `frontend/src/api/*`, `frontend/src/context/*`, `frontend/src/components/*`, `frontend/src/pages/*` (create)
  - `docker/frontend.Dockerfile` (update to build Vite app)
- **Tests Needed:** Form validation tests, idempotency-key behavior tests, money formatting/parsing tests.
- **Risks / Blockers:** Ensuring paise integer arithmetic is strictly maintained in the UI without intermediate float corruption.

---

### PHASE 13 — Frontend: Distributed Lab & Monitoring
- **Requirements Reference:** `CLAUDE.md` §11 Phase 13, `docs/style-guide.md` §10.3 (Lab Page Template), §10.4–§10.5, `docs/testing-and-demo.md` §7 (12 Viva Demos).
- **Existing Implementation:** None (to be built on Phase 12 foundation).
- **Missing / Incomplete Behavior:**
  - Missing reusable lab components: `NodeCard`, `RoleBadge`, `StatusPill`, `LamportChip`, `EventTimeline`, `MessageSequence` (SVG), `LagBar`, `ShareBar`, `ClockTable`, `ConfirmButton`.
  - Missing Cluster Overview page (`/cluster`): Live status of all 3 nodes, current leader, replication status, health, and load.
  - Missing 9 dedicated lab pages following the 5-part template (Title/Concept, Live State, Actions, Timeline, Expected Result):
    1. `/lab/rpc`: RPC Communication & Hop Trace
    2. `/lab/concurrency`: Concurrency scenarios & CPU lag chart
    3. `/lab/physical-clock`: Berkeley clock sync, offset table, drift chart
    4. `/lab/logical-clock`: Lamport clock causal event sequence
    5. `/lab/bully`: Bully election sequence & kill triggers
    6. `/lab/ring`: Ring election token path & dead-node skipping
    7. `/lab/replication`: Strong vs Eventual toggle, delay slider, lag bars, checksum comparison
    8. `/lab/load-balancing`: Load generator, node latency injection, distribution chart
    9. `/lab/fault-tolerance`: Failover, crash, network partition
  - TanStack Query polling hooks refreshing every 1000–2000ms.
  - Zero hardcoded mock arrays in production components (all live backend data).
- **Dependencies:** Backend system and lab endpoints (Phases 8–11), frontend foundation (Phase 12).
- **Files to Change / Create:**
  - `frontend/src/components/lab/*` (create)
  - `frontend/src/pages/cluster/*` (create)
  - `frontend/src/pages/lab/*` (create)
  - `frontend/src/routes.tsx` (create/update)
- **Tests Needed:** Verification that all 10 pages render without console errors; polling rates verified; grep audit confirming zero fabricated arrays.
- **Risks / Blockers:** Maintaining responsiveness while polling multiple endpoints across 3 nodes.

---

### PHASE 14 — Test Hardening
- **Requirements Reference:** `CLAUDE.md` §11 Phase 14, `docs/testing-and-demo.md` §3 (Test Matrix).
- **Existing Implementation:**
  - 10 unit test files; 7 integration test files.
- **Missing / Incomplete Behavior:**
  - Fixed sleep removal: Ensure all async tests use `waitFor` instead of hardcoded `setTimeout`.
  - Missing unit tests: `U-BRK-1`, `U-BRK-2`, `U-LB-1`.
  - Missing integration tests: `I-GRPC-1` (deadline exceeded mapping to 504), `I-WRK-1` (worker pool hashing lag check).
  - Missing distributed test suites: `tests/distributed/*.test.ts` covering `D-CLU-1`, `D-RPC-1`, `D-LAM-1`, `D-BUL-1`, `D-BUL-2`, `D-RNG-1`, `D-RNG-2`, `D-RNG-3`, `D-ALG-1`, `D-REP-1..6`, `D-FOV-1..3`, `D-SPL-1..2`, `D-DB-1`, `D-LB-1..3`, `D-CLK-1..4`, `D-CON-1..5`, `D-SEC-1`.
  - Test harness helpers: `tests/helpers/wait.ts`, `tests/helpers/cluster.ts`.
  - Grep audit across `services/` and `packages/` to ensure zero hardcoded node lists, leaders, or offsets outside software clock skew.
- **Dependencies:** Complete backend and gateway (Phases 1–11).
- **Files to Change / Create:**
  - `tests/helpers/wait.ts` (create)
  - `tests/helpers/cluster.ts` (create)
  - `tests/unit/loadbalancer.test.ts` (create, `U-LB-1`)
  - `tests/unit/berkeley.test.ts` (create, `U-BRK-1`, `U-BRK-2`)
  - `tests/integration/grpc-deadline.test.ts` (create, `I-GRPC-1`)
  - `tests/distributed/*.test.ts` (create)
- **Tests Needed:** All 13 Unit, 13 Integration, and 34 Distributed tests in matrix.
- **Risks / Blockers:** Docker availability on developer/test machines for running full compose-driven distributed tests.

---

### PHASE 15 — Final Packaging & Demo Runbook Rehearsal
- **Requirements Reference:** `CLAUDE.md` §11 Phase 15, `docs/testing-and-demo.md` §7 (Viva Demos).
- **Existing Implementation:**
  - Scripts: `node-ctl.ts`, `db-ctl.ts`, `reset.ts`, `failover-under-load.ts`.
  - Shell wrappers: `kill-node.sh`, `start-node.sh`, `kill-db.sh`, `start-db.sh`, `reset.sh`.
- **Missing / Incomplete Behavior:**
  - Missing root `README.md` (topology, service responsibilities, quick start, environment variables, demo guide, limitations, troubleshooting).
  - Missing demo seed scripts: `scripts/seed-demo.ts` and `scripts/seed-demo.sh` (Alice: ₹1,00,000, Bob: ₹50,000).
  - Missing integrity verification scripts: `scripts/verify-integrity.ts` and `scripts/verify-integrity.sh`.
  - Missing raw gRPC showcase scripts: `scripts/grpc-demo.ts` and `scripts/grpc-demo.sh`.
  - End-to-end execution of the 12 viva demos from clean state.
  - Updating `CLAUDE.md` §13 acceptance criteria and §14 change log.
- **Dependencies:** All previous phases (8–14).
- **Files to Change / Create:**
  - `README.md` (create)
  - `scripts/seed-demo.ts`, `scripts/seed-demo.sh` (create)
  - `scripts/verify-integrity.ts`, `scripts/verify-integrity.sh` (create)
  - `scripts/grpc-demo.ts`, `scripts/grpc-demo.sh` (create)
  - `CLAUDE.md` (update change log & acceptance criteria)
  - `implementation_plan.md` (update checklist)
- **Tests Needed:** Demo 1 through Demo 12 verification.
- **Risks / Blockers:** Verification of all 12 demos requires a healthy running cluster.

---

## 4. Complete Endpoint Inventory (`docs/api-reference.md`)

| Endpoint | Method | Scope | Auth Required | Current Implementation Status | Notes |
|---|---|---|---|---|---|
| `/api/health` | GET | Gateway | No | **Implemented** | Gateway liveness |
| `/api/docs` | GET | Gateway | No | **Implemented** | Swagger UI / OpenAPI 3.0 |
| `/api/auth/register` | POST | Banking | No | **Implemented** | Bcrypt in worker pool |
| `/api/auth/login` | POST | Banking | No | **Implemented** | Returns JWT |
| `/api/auth/me` | GET | Banking | Yes | **Implemented** | Current user |
| `/api/accounts` | POST | Banking | Yes | **Implemented** | Requires Idempotency-Key |
| `/api/accounts` | GET | Banking | Yes | **Implemented** | List accounts |
| `/api/accounts/:id` | GET | Banking | Yes | **Implemented** | Account details |
| `/api/accounts/lookup` | GET | Banking | Yes | **Implemented** | Live recipient lookup |
| `/api/accounts/:id/statement.csv` | GET | Banking | Yes | **Implemented** | CSV generated in worker pool |
| `/api/transactions/deposit` | POST | Banking | Yes | **Implemented** | Requires Idempotency-Key |
| `/api/transactions/withdraw` | POST | Banking | Yes | **Implemented** | Requires Idempotency-Key |
| `/api/transactions/transfer` | POST | Banking | Yes | **Implemented** | Requires Idempotency-Key |
| `/api/transactions` | GET | Banking | Yes | **Implemented** | Filtered history |
| `/api/transactions/:id` | GET | Banking | Yes | **Implemented** | Single transaction |
| `/api/system/overview` | GET | System | Yes | **Missing** | To be added in Phase 11 |
| `/api/system/nodes` | GET | System | Yes | **Partial** | Needs live metrics aggregation |
| `/api/system/leader` | GET | System | Yes | **Missing** | To be added in Phase 11 |
| `/api/system/clocks` | GET | System | Yes | **Missing** | To be added in Phase 9/11 |
| `/api/system/clocks/history` | GET | System | Yes | **Missing** | To be added in Phase 9/11 |
| `/api/system/replication` | GET | System | Yes | **Partial** | Needs per-node breakdown |
| `/api/system/load` | GET | System | Yes | **Missing** | To be added in Phase 8 |
| `/api/system/elections` | GET | System | Yes | **Missing** | To be added in Phase 11 |
| `/api/system/events` | GET | System | Yes | **Partial** | Needs Lamport cursor support |
| `/api/system/rpc-trace` | GET | System | Yes | **Implemented** | Merged ring buffers |
| `/api/system/integrity` | GET | System | Yes | **Implemented** | Checksum comparison |
| `/api/lab/nodes/:id/fault` | POST | Lab | Yes (LAB_MODE) | **Implemented** | CRASH / PARTITION / NONE |
| `/api/lab/config/election-algorithm` | PUT | Lab | Yes (LAB_MODE) | **Implemented** | bully / ring switch |
| `/api/lab/config/consistency-mode` | PUT | Lab | Yes (LAB_MODE) | **Implemented** | strong / eventual switch |
| `/api/lab/nodes/:id/replication-delay` | PUT | Lab | Yes (LAB_MODE) | **Implemented** | Leader->backup delay |
| `/api/lab/nodes/:id/latency` | PUT | Lab | Yes (LAB_MODE) | **Missing** | To be added in Phase 8 |
| `/api/lab/election/bully` | POST | Lab | Yes (LAB_MODE) | **Implemented** | Trigger Bully election |
| `/api/lab/election/ring` | POST | Lab | Yes (LAB_MODE) | **Implemented** | Trigger Ring election |
| `/api/lab/clock/synchronize` | POST | Lab | Yes (LAB_MODE) | **Missing** | To be added in Phase 9 |
| `/api/lab/rpc/trace-call` | POST | Lab | Yes (LAB_MODE) | **Missing** | To be added in Phase 11 |
| `/api/lab/load/run` | POST | Lab | Yes (LAB_MODE) | **Missing** | To be added in Phase 8 |
| `/api/lab/concurrency/run` | POST | Lab | Yes (LAB_MODE) | **Missing** | To be added in Phase 10 |
| `/api/lab/concurrency/cpu-task` | POST | Lab | Yes (LAB_MODE) | **Missing** | To be added in Phase 10 |

---

## 5. Test Matrix Coverage Table

### 5.1 Unit Tests (13)
| Test ID | Area | Current Status | Planned Phase | Target File |
|---|---|---|---|---|
| `U-LAM-1` | Lamport Clock | **Passing** (Phase 4) | 4 | `packages/shared/src/clock/lamport.test.ts` |
| `U-LAM-2` | Lamport Interceptor | **Passing** (Phase 4) | 4 | `packages/shared/src/grpc/interceptors/lamport-interceptor.test.ts` |
| `U-BRK-1` | Berkeley Math | **Missing** | 9 | `services/bank-node/src/clock/berkeley-math.test.ts` |
| `U-BRK-2` | Monotonic Clock | **Missing** | 9 | `services/bank-node/src/clock/physical-clock.test.ts` |
| `U-BUL-1` | Bully Core | **Passing** (Phase 5) | 5 | `services/bank-node/src/election/bully.test.ts` |
| `U-RNG-1` | Ring Core | **Passing** (Phase 5) | 5 | `services/bank-node/src/election/ring.test.ts` |
| `U-ELC-1` | Election Manager / Epoch | **Passing** (Phase 5) | 5 | `services/bank-node/src/election/election-manager.test.ts` |
| `U-LB-1` | Least Connections Picker | **Missing** | 8 | `services/gateway/src/loadbalancer/picker.test.ts` |
| `U-REP-1` | Replication Applier | **Implemented** (Needs DB) | 6 | `services/bank-node/src/replication/applier.test.ts` |
| `U-REP-2` | Divergence & Snapshot | **Implemented** (Needs DB) | 6 | `services/bank-node/src/replication/catchup.test.ts` |
| `U-REP-3` | Strong-Ack Quorum Logic | **Passing** (Phase 6) | 6 | `services/bank-node/src/replication/replicator.test.ts` |
| `U-BNK-1` | Banking Money Rules | **Passing** (Phase 2) | 2 | `packages/shared/src/types/paise.test.ts` |
| `U-IDM-1` | Idempotency Key Scoping | **Passing** (Phase 2) | 2 | `services/bank-node/src/bank/idempotency.test.ts` |

### 5.2 Integration Tests (13)
| Test ID | Scenario | Current Status | Planned Phase | Target File |
|---|---|---|---|---|
| `I-AUTH-1` | Auth Register / Login / JWT | **Implemented** (Phase 2/3) | 2, 3 | `tests/integration/gateway.test.ts` |
| `I-ACC-1` | Account CRUD & Ownership | **Implemented** (Phase 2/3) | 2, 3 | `tests/integration/gateway.test.ts` |
| `I-TXN-1` | Transactions Happy Path | **Implemented** (Phase 2/3) | 2, 3 | `tests/integration/phase2.test.ts` |
| `I-TXN-2` | Insufficient Funds / 422 | **Implemented** (Phase 2/3) | 2, 3 | `tests/integration/phase2.test.ts` |
| `I-TXN-3` | Unknown / Frozen Account | **Implemented** (Phase 2/3) | 2, 3 | `tests/integration/phase2.test.ts` |
| `I-IDM-1` | Idempotency Replay | **Implemented** (Phase 2/3) | 2, 3 | `tests/integration/phase2.test.ts` |
| `I-IDM-2` | Key Reused Different Payload | **Implemented** (Phase 2/3) | 2, 3 | `tests/integration/phase2.test.ts` |
| `I-IDM-3` | 4xx Validation Not Consuming Key | **Implemented** (Phase 2/3) | 2, 3 | `tests/integration/phase2.test.ts` |
| `I-IDM-4` | 422 Business Error Persistence | **Implemented** (Phase 2/3) | 2, 3 | `tests/integration/phase2.test.ts` |
| `I-DB-1` | DB Negative Balance Constraint | **Implemented** (Phase 1) | 1 | `tests/integration/migrator.test.ts` |
| `I-GW-1` | Gateway Validation / Rate Limit | **Implemented** (Phase 3) | 3 | `tests/integration/gateway.test.ts` |
| `I-GRPC-1` | Deadlines & 504 Mapping | **Missing** | 14 | `tests/integration/grpc-deadline.test.ts` |
| `I-WRK-1` | Worker Pool Non-blocking Lag | **Implemented** (Phase 2) | 2 | `tests/integration/phase2.test.ts` |

### 5.3 Distributed Tests (34)
| Test ID | Scenario | Current Status | Planned Phase | Target File |
|---|---|---|---|---|
| `D-CLU-1` | Cold Start Leader & Epoch | **Missing** | 14 | `tests/distributed/cluster.test.ts` |
| `D-RPC-1` | RPC Trace Correlation & Lamport | **Missing** | 11, 14 | `tests/distributed/rpc-trace.test.ts` |
| `D-LAM-1` | Causal Event Ordering | **Missing** | 14 | `tests/distributed/lamport.test.ts` |
| `D-BUL-1` | Bully Failover on Leader Stop | **Missing** | 14 | `tests/distributed/election.test.ts` |
| `D-BUL-2` | Bully Preemption on Recovery | **Missing** | 14 | `tests/distributed/election.test.ts` |
| `D-RNG-1` | Ring Election Token Traversal | **Missing** | 14 | `tests/distributed/election.test.ts` |
| `D-RNG-2` | Ring Election Skip Dead Node | **Missing** | 14 | `tests/distributed/election.test.ts` |
| `D-RNG-3` | Ring Election Failover | **Missing** | 14 | `tests/distributed/election.test.ts` |
| `D-ALG-1` | Runtime Algorithm Switch | **Missing** | 14 | `tests/distributed/election.test.ts` |
| `D-REP-1` | Strong Replication Immediate Ack | **Missing** | 14 | `tests/distributed/replication.test.ts` |
| `D-REP-2` | Eventual Replication with Delay | **Missing** | 14 | `tests/distributed/replication.test.ts` |
| `D-REP-3` | Strong Mode with 1 Backup Down | **Missing** | 14 | `tests/distributed/replication.test.ts` |
| `D-REP-4` | Strong Mode with 0 Backups (503) | **Missing** | 14 | `tests/distributed/replication.test.ts` |
| `D-REP-5` | Read Stale Indicator (Eventual) | **Missing** | 14 | `tests/distributed/replication.test.ts` |
| `D-REP-6` | Strong Mode Timeout (202 Pending) | **Missing** | 14 | `tests/distributed/replication.test.ts` |
| `D-FOV-1` | Leader Failover with Data Retention | **Missing** | 14 | `tests/distributed/failover.test.ts` |
| `D-FOV-2` | Failover Under Load Harness | **Implemented** | 7, 14 | `scripts/failover-under-load.ts` |
| `D-FOV-3` | Eventual Loss Window on Crash | **Missing** | 14 | `tests/distributed/failover.test.ts` |
| `D-SPL-1` | Partition in Strong Mode (CP) | **Missing** | 14 | `tests/distributed/partition.test.ts` |
| `D-SPL-2` | Partition in Eventual Mode (AP) | **Missing** | 14 | `tests/distributed/partition.test.ts` |
| `D-DB-1` | Database Failure (`DB_DOWN`) | **Missing** | 14 | `tests/distributed/db-fail.test.ts` |
| `D-LB-1` | Load Balancing Distribution | **Missing** | 8, 14 | `tests/distributed/loadbalancer.test.ts` |
| `D-LB-2` | Slow Node Traffic Reduction | **Missing** | 8, 14 | `tests/distributed/loadbalancer.test.ts` |
| `D-LB-3` | Stopped Node Traffic Removal | **Missing** | 8, 14 | `tests/distributed/loadbalancer.test.ts` |
| `D-CLK-1` | Berkeley Round Offset Reduction | **Missing** | 9, 14 | `tests/distributed/clock.test.ts` |
| `D-CLK-2` | Berkeley Round Skipping Dead Node | **Missing** | 9, 14 | `tests/distributed/clock.test.ts` |
| `D-CLK-3` | Clock Active Drift Over Time | **Missing** | 9, 14 | `tests/distributed/clock.test.ts` |
| `D-CLK-4` | Monotonic Physical Timestamps | **Missing** | 9, 14 | `tests/distributed/clock.test.ts` |
| `D-CON-1` | Classic Race (7k vs 6k on 10k) | **Missing** | 10, 14 | `tests/distributed/concurrency.test.ts` |
| `D-CON-2` | 20 Concurrent Withdrawals | **Missing** | 10, 14 | `tests/distributed/concurrency.test.ts` |
| `D-CON-3` | Crossfire Transfers (A<->B) | **Missing** | 10, 14 | `tests/distributed/concurrency.test.ts` |
| `D-CON-4` | Duplicate Idempotency Key | **Missing** | 10, 14 | `tests/distributed/concurrency.test.ts` |
| `D-CON-5` | MAIN vs WORKER Lag Differential | **Missing** | 10, 14 | `tests/distributed/concurrency.test.ts` |
| `D-SEC-1` | Gating, Auth, and SQL Injection | **Missing** | 11, 14 | `tests/distributed/security.test.ts` |

---

## 6. Known Tensions & Document Conflict Resolutions

1. **Visual Polish vs. Correctness (Prompt §6.1 & CLAUDE.md §9.4 rule 22):**
   - *Resolution:* Correctness and truthfulness remain paramount. All visual data must originate from live backend endpoints. UI polish is implemented strictly within the design tokens in `docs/style-guide.md` §10 using pinned Tailwind 3.4.17, without unvetted external component libraries.
2. **Missing Concurrency & System Routes in Task 11.4 list (Prompt §6.2):**
   - *Resolution:* Concurrency endpoints (`POST /api/lab/concurrency/run` and `POST /api/lab/concurrency/cpu-task`) are implemented in Phase 10. In Phase 11, the complete inventory from `docs/api-reference.md` §5 & §6 is verified.
3. **Definition of `I-GRPC-1` (Prompt §6.3):**
   - *Resolution:* Confirmed from `docs/testing-and-demo.md` §3.2: "Deadlines: slow handler -> DEADLINE_EXCEEDED maps to 504".
4. **Browser Testing Strategy for Phase 12 (Prompt §6.4):**
   - *Resolution:* No unapproved browser automation dependencies (Playwright/Cypress) will be introduced without an explicit decision log entry. Verification will use Vitest component/form tests alongside manual browser inspection via our available subagent/preview tooling.
5. **Concurrency Safety in Banking Core (Prompt §6.5):**
   - *Resolution:* The production banking core will **never** contain an unsafe write path. Concurrency demonstrations operate against the real row-lock protected transaction path (`SELECT ... FOR UPDATE` in account ID order).
6. **`LAB_MODE` Gating & Single-Role Model (Prompt §6.6):**
   - *Resolution:* All `/api/lab/*` routes return `404 LAB_DISABLED` when `LAB_MODE=false`. Any authenticated user can access lab pages, but user accounts remain owner-scoped.

---

## 7. Immediate Next Step: Phase 8 Implementation Plan

With the audit and gap analysis complete, Phase 8 (Load Balancing) can proceed immediately:

1. **Step 8.1:** Fix `scripts/proto-gen.ts` cross-platform quoting bug so proto generation succeeds on Windows.
2. **Step 8.2:** Implement pure core `services/gateway/src/loadbalancer/picker.ts` and `types.ts`, with unit tests `U-LB-1`.
3. **Step 8.3:** Implement `services/gateway/src/loadbalancer/load-balancer.ts` and `health-monitor.ts`.
4. **Step 8.4:** Implement `SimulateWork` in `bank-node` (`services/bank-node/src/lab/simulate-work.ts` and `LabService.SimulateWork`) and per-node artificial latency injection.
5. **Step 8.5:** Wire gateway `bank-client.ts` to route requests through `LoadBalancer`.
6. **Step 8.6:** Expose `GET /api/system/load`, `POST /api/lab/load/run`, and `PUT /api/lab/nodes/:id/latency`.
7. **Step 8.7:** Verify unit tests, typecheck, lint, and run live load-balancing verification.
