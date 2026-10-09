# API Reference — REST & gRPC

Part of [CLAUDE.md](../CLAUDE.md). Behavior and algorithms are defined in [architecture.md](architecture.md). The gateway serves the live OpenAPI document at `/api/docs`; this file is the source of truth for contracts — keep both in sync.

**Contents**
1. Conventions
2. Error codes
3. Auth & accounts
4. Transactions
5. System (monitoring) endpoints
6. Lab endpoints
7. gRPC contracts (`.proto`)
8. Internal RPC table

---

## 1. Conventions

- **Base URL:** `http://localhost:8080/api` · JSON only · UTF-8 · field names `camelCase`.
- **Auth:** `Authorization: Bearer <jwt>` on everything except `/auth/*` and `/health`.
- **Money:** integer **paise** in fields named `*Paise` (₹100.50 = `10050`). Currency is always `INR`.
- **IDs:** UUID strings. Account *numbers* are 12-digit strings.
- **Idempotency:** `Idempotency-Key` header (UUID, 16–64 chars) is **required** on `POST /transactions/*` and `POST /accounts`. Same key + same body → original response replayed (`Idempotent-Replay: true` header). Same key + different body → `422 IDEMPOTENCY_KEY_REUSED`.
  - *Scoping rule:* Gateway errors (400, 401, 429) and pre-transaction checks do not consume or store the key.
  - Transactions rolling back due to `NOT_FOUND` or `FORBIDDEN` do not persist the key.
  - Business failures (`INSUFFICIENT_FUNDS`, `ACCOUNT_NOT_ACTIVE`) record a `REJECTED` transaction and store the 422 response against the key.
  - Infrastructure errors (503 lock timeout, DB down, no leader) rollback without storing the key, allowing retry.
  - Frontend generates a new UUID per new submission so corrected attempts succeed.
- **Correlation:** optional `X-Request-Id`; otherwise generated. Echoed in `meta.requestId` and the response header.
- **Timestamps:** ISO-8601 UTC.
- **Pagination:** `limit` (default 20, max 100) + opaque `cursor`; response includes `nextCursor` or `null`.

### 1.1 Response envelope

Success:
```json
{
  "data": { },
  "meta": {
    "requestId": "7f3c…",
    "entryNode": 1,
    "servedBy": 1,
    "processedBy": 3,
    "lamport": 142,
    "appliedSeq": 87,
    "leaderSeq": 87,
    "stale": false
  }
}
```
`meta` fields marked as "when applicable": `processedBy` (writes), `appliedSeq/leaderSeq/stale` (reads).

Error:
```json
{
  "error": { "code": "INSUFFICIENT_FUNDS", "message": "Balance is lower than the requested amount.", "details": { "balancePaise": 300000 }, "retryable": false },
  "meta": { "requestId": "7f3c…", "lamport": 143 }
}
```

---

## 2. Error codes

| Code | HTTP | gRPC status | Retryable | Meaning |
|---|---|---|---|---|
| `VALIDATION_ERROR` | 400 | `INVALID_ARGUMENT` | no | Body/params failed schema (key not stored) |
| `UNAUTHENTICATED` | 401 | — | no | Missing/invalid/expired JWT |
| `INVALID_CREDENTIALS` | 401 | `UNAUTHENTICATED` | no | Wrong email/password |
| `FORBIDDEN` | 403 | `PERMISSION_DENIED` | no | Account not owned by caller (key not stored) |
| `NOT_FOUND` | 404 | `NOT_FOUND` | no | Account/transaction/user not found (key not stored) |
| `EMAIL_TAKEN` | 409 | `ALREADY_EXISTS` | no | Duplicate registration |
| `CONFLICT_LOCK_TIMEOUT` | 409 | `ABORTED` | yes | Row-lock wait timed out (key not stored) |
| `INSUFFICIENT_FUNDS` | 422 | `FAILED_PRECONDITION` | no | Balance too low (`REJECTED` txn recorded, key stores 422) |
| `ACCOUNT_NOT_ACTIVE` | 422 | `FAILED_PRECONDITION` | no | Source/destination frozen or closed (`REJECTED` txn recorded, key stores 422) |
| `SAME_ACCOUNT` | 422 | `INVALID_ARGUMENT` | no | Transfer source = destination (pre-check, key not stored) |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | `INVALID_ARGUMENT` | no | Missing header |
| `IDEMPOTENCY_KEY_REUSED` | 422 | `FAILED_PRECONDITION` | no | Same key, different payload |
| `RATE_LIMITED` | 429 | — | yes | Too many requests |
| `NOT_LEADER` | 503 | `FAILED_PRECONDITION` | yes | Node can't reach/identify a leader for forwarding |
| `NO_LEADER` | 503 | `UNAVAILABLE` | yes | Election in progress |
| `LEADER_NOT_READY` | 503 | `FAILED_PRECONDITION` | yes | Leader still in preparation |
| `NO_QUORUM` | 503 | `FAILED_PRECONDITION` | yes | Strong mode: zero backups believed UP at write time (pre-check rejected before commit) |
| `COMMITTED_PENDING_REPLICATION` | 202 | — | yes (same key) | Committed on leader; backups believed UP but zero acked within timeout; client retry with same key returns result once replicated |
| `NODE_UNAVAILABLE` | 503 | `UNAVAILABLE` | yes | No healthy node |
| `DEADLINE_EXCEEDED` | 504 | `DEADLINE_EXCEEDED` | yes | Timeout |
| `LAB_DISABLED` | 404 | — | no | `LAB_MODE=false` |
| `INTERNAL` | 500 | `INTERNAL` | no | Bug — log with request ID |

Gateway rule: retryable codes on idempotent calls are retried automatically (architecture §10.4) before the client sees the error.

---

## 3. Auth & accounts

### POST `/auth/register`
Request: `{ "name": "Alice Rao", "email": "alice@example.com", "password": "min 8 chars" }`
`201`: `{ "data": { "user": { "id", "name", "email" }, "token": "<jwt>" } }`
Errors: `VALIDATION_ERROR`, `EMAIL_TAKEN`. (Processed by leader.)

### POST `/auth/login`
Request: `{ "email", "password" }` → `200` same shape as register. Errors: `INVALID_CREDENTIALS`. (Processed by leader.)

### GET `/auth/me`
`200`: `{ "data": { "id", "name", "email" } }`

### POST `/accounts`  *(Idempotency-Key required)*
Request: `{ "nickname": "Savings" }` (optional)
`201`:
```json
{ "data": { "id": "uuid", "accountNumber": "402918374655", "nickname": "Savings",
            "balancePaise": 0, "currency": "INR", "status": "ACTIVE", "version": 0,
            "createdAt": "2026-10-07T09:30:00Z" } }
```

### GET `/accounts`
All accounts owned by the caller: `{ "data": [ Account, … ] }`

### GET `/accounts/:id`
One account (owner only) → `Account`. Errors: `NOT_FOUND`, `FORBIDDEN`.

### GET `/accounts/lookup?accountNumber=402918374655`
Used by the transfer form to validate the destination. `200`: `{ "data": { "accountNumber", "holderName": "Bob S." } }` (masked to first name + initial). `404` if not found.

### GET `/accounts/:id/statement.csv?from=&to=`
CSV download generated in a worker thread. Columns: `date, reference, type, description, debitPaise, creditPaise, balanceAfterPaise, status`.

---

## 4. Transactions

All three require `Idempotency-Key`. Business failures return a recorded `REJECTED` transaction (HTTP 422 with an error body that includes `details.transactionId`).

### POST `/transactions/deposit`
Request: `{ "accountId": "uuid", "amountPaise": 500000, "note": "Cash deposit" }`

### POST `/transactions/withdraw`
Request: `{ "accountId": "uuid", "amountPaise": 700000, "note": "ATM" }`

### POST `/transactions/transfer`
Request: `{ "fromAccountId": "uuid", "toAccountNumber": "402918374655", "amountPaise": 250000, "note": "Rent" }`

**201** (all three):
```json
{
  "data": {
    "id": "uuid", "reference": "TXN-20261007-9F3KQ2",
    "type": "TRANSFER", "status": "COMMITTED",
    "sourceAccountId": "uuid", "destinationAccountId": "uuid",
    "amountPaise": 250000,
    "sourceBalanceAfterPaise": 750000, "destinationBalanceAfterPaise": 1250000,
    "entryNode": 1, "processedByNode": 3, "epoch": 4, "logSeq": 88,
    "lamport": 142, "physicalTs": "2026-10-07T09:31:02.114Z",
    "replication": { "mode": "strong", "ackedBy": [2], "pendingNodes": [], "durationMs": 14 }
  },
  "meta": { "requestId": "…", "entryNode": 1, "processedBy": 3, "lamport": 143 }
}
```
Errors: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `INSUFFICIENT_FUNDS`, `ACCOUNT_NOT_ACTIVE`, `SAME_ACCOUNT`, `IDEMPOTENCY_*`, `LEADER_NOT_READY`, `NO_QUORUM`, `NO_LEADER`. `202 COMMITTED_PENDING_REPLICATION` when strong mode couldn't confirm a majority yet.

### GET `/transactions?accountId=&type=&status=&limit=&cursor=`
Caller's transactions (as source or destination), newest first → `{ "data": [Transaction…], "nextCursor": "…" }`. Reads may be served by any node; see `meta.stale` in eventual mode.

### GET `/transactions/:id`
One transaction (must involve one of the caller's accounts).

---

## 5. System (monitoring) endpoints

All authenticated; read-only; data assembled by the gateway from `ObservabilityService` calls to every node (unreachable nodes appear with `reachable:false`, never omitted).

| Endpoint | Returns |
|---|---|
| `GET /system/overview` | Compact summary for the dashboard: leader, epoch, node count up/down, consistency mode, election algorithm, last election, max replication lag |
| `GET /system/nodes` | Per node: `{nodeId, priority, status, role, leaderReady, epoch, leaderId, lastSeq, lamport, activeRequests, eventLoopLagMs, lastHeartbeatAgeMs, reachable, faultMode}` |
| `GET /system/leader` | `{leaderId, epoch, since, readyAt, agreeingNodes[], disagreeingNodes[]}` (consensus of node views) |
| `GET /system/clocks` | Per node: `{nodeId, syncedTime, hardwareTime, adjustmentMs, offsetFromMasterMs, groundTruthErrorMs, lamport, lastSyncAt}` + last Berkeley round |
| `GET /system/clocks/history?limit=` | `clock_sync_history` rounds (per-node before/after) |
| `GET /system/replication` | `{mode, leaderId, leaderSeq, nodes:[{nodeId, role, lastSeq, matchSeq, lagEntries, lagMs, state: IN_SYNC/LAGGING/RECOVERING, checksum}]}` |
| `GET /system/load` | `{algorithm:"least-connections", nodes:[{nodeId, healthy, activeRequests, totalRequests, sharePct, ewmaLatencyMs, failures, lastCheckAt}], retries, requestsPerMin}` |
| `GET /system/elections?limit=` | Merged `election_history` incl. `messages[]` with Lamport values |
| `GET /system/events?since=&limit=&type=&node=&requestId=` | Merged `event_log` sorted by `(lamport, nodeId)`; `since` is a Lamport cursor |
| `GET /system/rpc-trace?limit=&requestId=` | Merged RPC trace ring buffers |
| `GET /system/integrity` | Per node `{lastSeq, accountCount, txnCount, totalBalancePaise, accountsChecksum}` + `inSync: boolean` |
| `GET /health` (no auth) | Gateway liveness |

Example `GET /system/nodes` item:
```json
{ "nodeId": 3, "priority": 3, "status": "UP", "role": "LEADER", "leaderReady": true,
  "epoch": 4, "leaderId": 3, "lastSeq": 88, "lamport": 311, "activeRequests": 2,
  "eventLoopLagMs": 3.1, "lastHeartbeatAgeMs": 420, "reachable": true, "faultMode": "NONE" }
```

Example `GET /system/events` item:
```json
{ "lamport": 15, "nodeId": 3, "physicalTs": "2026-10-07T09:31:02.130Z", "service": "replication",
  "eventType": "REPLICATION_SENT", "severity": "info", "requestId": "7f3c…",
  "transactionId": "uuid", "peerNodeId": 2, "details": { "seq": 88, "entries": 1 } }
```

---

## 6. Lab endpoints

Prefix `/api/lab`. Require `LAB_MODE=true` (else `404 LAB_DISABLED`) and a valid JWT. Every action records an event.

### 6.1 Faults & config
| Endpoint | Body | Effect |
|---|---|---|
| `POST /lab/nodes/:id/fault` | `{ "mode": "NONE" \| "CRASH" \| "PARTITION" }` | Sets fault mode on that node (`NONE` = heal/rejoin) |
| `PUT /lab/config/election-algorithm` | `{ "algorithm": "bully" \| "ring" }` | Cluster-wide via gossip |
| `PUT /lab/config/consistency-mode` | `{ "mode": "strong" \| "eventual" }` | Cluster-wide via gossip |
| `PUT /lab/nodes/:id/replication-delay` | `{ "delayMs": 0..5000 }` | Delay leader→that backup sender loop |
| `PUT /lab/nodes/:id/latency` | `{ "latencyMs": 0..5000 }` | Artificial handler latency on that node |

Response: `{ "data": { "applied": true, "node": 3, "mode": "CRASH" } }`.

### 6.2 Elections
`POST /lab/election/bully` and `POST /lab/election/ring` — body `{ "initiatorNodeId": 1 }`. Runs the real algorithm from that node. Response: `{ "data": { "electionId": "uuid", "algorithm": "bully", "accepted": true } }` — poll `/system/elections` for messages/result.

### 6.3 Clocks
`POST /lab/clock/synchronize` → runs a Berkeley round on the leader and returns the round synchronously:
```json
{ "data": { "roundId": "uuid", "master": 3, "averageMs": 166.7, "nodes": [
  { "nodeId": 1, "rttMs": 2.1, "offsetBeforeMs": 3011.4, "included": true, "adjustMs": -2844.7, "residualAfterMs": 12.3 },
  { "nodeId": 2, "rttMs": 1.8, "offsetBeforeMs": -2013.2, "included": true, "adjustMs": 2179.9, "residualAfterMs": -14.1 },
  { "nodeId": 3, "rttMs": 0, "offsetBeforeMs": 0, "included": true, "adjustMs": 166.7, "residualAfterMs": 0 } ] } }
```
(Three separate real values per node: `offsetBeforeMs` initial RTT/2-compensated offset [UI "Before"], `adjustMs` applied correction, `residualAfterMs` measured post-adjustment offset via verification sweep [UI "After", < 50 ms]. `averageMs` is informational.)

### 6.4 RPC / load
| Endpoint | Body | Behavior |
|---|---|---|
| `POST /lab/rpc/trace-call` | `{ "fromNodeId": 1, "toNodeId": 3 }` | Gateway→node1 `PeerPing` → node1→node3 `Ping`; returns hop list `{from,to,method,lamportSend,lamportRecv,latencyMs}` |
| `POST /lab/load/run` | `{ "count": 100, "concurrency": 20, "workMs": 150 }` | Sends `count` `SimulateWork` requests through the **same balancer**; returns per-node counts, peak active, latency percentiles |

### 6.5 Concurrency
| Endpoint | Body | Behavior |
|---|---|---|
| `POST /lab/concurrency/run` | `{ "scenario": "withdraw-race", "accountId": "uuid", "amountPaise": 100000, "count": 20 }` | Fires `count` simultaneous real withdrawals with distinct idempotency keys; returns `{committed, rejected, errors, balanceBeforePaise, balanceAfterPaise, sumCommittedPaise, invariantOk}` |
| | `{ "scenario": "transfer-crossfire", "accountAId", "accountBId", "amountPaise", "count": 10 }` | A→B and B→A concurrently (deadlock-avoidance check); returns same summary + total-money-conserved check |
| | `{ "scenario": "duplicate-key", "accountId", "amountPaise", "count": 10 }` | Same idempotency key sent `count` times concurrently; expect `applied = 1` |
| `POST /lab/concurrency/cpu-task` | `{ "nodeId": 2, "mode": "MAIN" \| "WORKER", "iterations": 20000000, "parallel": 4 }` | Runs CPU-bound task(s); returns durations and `eventLoopLagP99Ms` during the run |

Concurrency scenarios operate only on accounts owned by the caller.

---

## 7. gRPC contracts (`proto/`)

`package bank.v1;` — shown abridged; the agent writes the complete files. Field numbers are stable once released.

### 7.1 `bank.proto`

```proto
syntax = "proto3";
package bank.v1;

message Ctx {                       // present on every BankService request
  string request_id      = 1;
  string user_id         = 2;       // authenticated by gateway
  string idempotency_key = 3;
}

service BankService {
  rpc Register(RegisterRequest)             returns (AuthResponse);
  rpc Login(LoginRequest)                   returns (AuthResponse);
  rpc CreateAccount(CreateAccountRequest)   returns (Account);
  rpc ListAccounts(ListAccountsRequest)     returns (ListAccountsResponse);
  rpc GetAccount(GetAccountRequest)         returns (Account);
  rpc LookupAccount(LookupAccountRequest)   returns (LookupAccountResponse);
  rpc Deposit(MoneyRequest)                 returns (TransactionResult);
  rpc Withdraw(MoneyRequest)                returns (TransactionResult);
  rpc Transfer(TransferRequest)             returns (TransactionResult);
  rpc ListTransactions(ListTransactionsRequest) returns (ListTransactionsResponse);
  rpc GetTransaction(GetTransactionRequest) returns (Transaction);
  rpc GetStatement(StatementRequest)        returns (StatementResponse);   // CSV bytes built in worker thread
}

message MoneyRequest    { Ctx ctx = 1; string account_id = 2; int64 amount_paise = 3; string note = 4; }
message TransferRequest { Ctx ctx = 1; string from_account_id = 2; string to_account_number = 3; int64 amount_paise = 4; string note = 5; }

message Account {
  string id = 1; string account_number = 2; string nickname = 3;
  int64 balance_paise = 4; string currency = 5; string status = 6;
  int64 version = 7; string created_at = 8;
}

message Transaction {
  string id = 1; string reference = 2; string type = 3; string status = 4; string reject_reason = 5;
  string source_account_id = 6; string destination_account_id = 7; int64 amount_paise = 8;
  int64 source_balance_after = 9; int64 destination_balance_after = 10; string note = 11;
  int32 entry_node = 12; int32 processed_by_node = 13; int64 epoch = 14; int64 log_seq = 15;
  int64 lamport = 16; string physical_ts = 17;
}

message ReplicationInfo { string mode = 1; repeated int32 acked_by = 2; repeated int32 pending_nodes = 3; int64 duration_ms = 4; }
message ReadMeta        { int32 served_by = 1; int64 applied_seq = 2; int64 leader_seq = 3; bool stale = 4; }
message TransactionResult { Transaction transaction = 1; ReplicationInfo replication = 2; }
// Reads return ReadMeta in a trailing-metadata field `x-read-meta` (JSON) to keep response messages clean.
```
(Other request/response messages mirror the REST bodies in §3–4.)

### 7.2 `cluster.proto`

```proto
service ClusterService {
  // membership
  rpc Heartbeat(HeartbeatMsg)        returns (HeartbeatAck);
  rpc Ping(PingRequest)              returns (PingReply);
  // Bully
  rpc Election(ElectionMsg)          returns (ElectionReply);       // reply = OK
  rpc Coordinator(CoordinatorMsg)    returns (Empty);
  // Ring (handler returns empty ack immediately and forwards to successor asynchronously)
  rpc RingElection(RingToken)        returns (Empty);
  rpc RingCoordinator(RingCoordinatorMsg) returns (Empty);
  // Berkeley
  rpc GetTime(GetTimeRequest)        returns (GetTimeReply);
  rpc AdjustClock(AdjustClockRequest) returns (AdjustClockReply);
  // Replication
  rpc AppendEntries(AppendEntriesRequest) returns (AppendEntriesReply);
  rpc GetLogEntries(GetLogEntriesRequest) returns (GetLogEntriesReply);
  rpc GetSnapshot(SnapshotRequest)   returns (stream SnapshotChunk);
}

message HeartbeatMsg {
  int32 node_id = 1; string status = 2; string role = 3; int64 epoch = 4; int32 leader_id = 5;
  int64 last_seq = 6; int64 last_entry_epoch = 7; int64 lamport = 8; NodeConfig config = 9;
  int32 active_requests = 10; double event_loop_lag_ms = 11; int64 sent_at_ms = 12;
}
message NodeConfig { string election_algorithm = 1; string consistency_mode = 2; int64 version = 3; }

message ElectionMsg    { string election_id = 1; int32 from_node = 2; int32 from_priority = 3; int64 epoch = 4; }
message ElectionReply  { bool ok = 1; int32 node_id = 2; int64 epoch = 3; }
message CoordinatorMsg { string election_id = 1; int32 leader_id = 2; int64 epoch = 3; }

message RingCandidate  { int32 id = 1; int32 priority = 2; }
message RingToken      { string election_id = 1; int32 initiator = 2; repeated RingCandidate candidates = 3; repeated int32 skipped = 4; }
message RingCoordinatorMsg { string election_id = 1; int32 initiator = 2; int32 winner = 3; int64 epoch = 4; repeated int32 participants = 5; }

message GetTimeRequest   { string round_id = 1; }
message GetTimeReply     { int64 synced_time_us = 1; }
message AdjustClockRequest { string round_id = 1; double adjust_ms = 2; }
message AdjustClockReply   { double adjustment_before_ms = 1; double adjustment_after_ms = 2; }

message LogEntry { int64 seq = 1; int64 epoch = 2; string op_type = 3; string payload_json = 4; int64 lamport = 5; int32 origin_node = 6; string physical_ts = 7; }
message AppendEntriesRequest { int64 epoch = 1; int32 leader_id = 2; int64 prev_seq = 3; int64 prev_epoch = 4; repeated LogEntry entries = 5; int64 leader_last_seq = 6; }
message AppendEntriesReply   { bool ok = 1; int64 last_seq = 2; int64 epoch = 3; string reason = 4; } // reason: STALE_EPOCH | GAP | CONFLICT
message GetLogEntriesRequest { int64 from_seq = 1; int32 max_entries = 2; }
message GetLogEntriesReply   { repeated LogEntry entries = 1; int64 last_seq = 2; }
message SnapshotRequest      { int64 requester_last_seq = 1; }
message SnapshotChunk        { string table = 1; repeated string rows_json = 2; bool last = 3; int64 snapshot_seq = 4; }
```

### 7.3 `observability.proto`

```proto
service ObservabilityService {
  rpc GetStatus(Empty)              returns (NodeStatus);
  rpc GetEvents(GetEventsRequest)   returns (GetEventsReply);
  rpc GetRpcTrace(GetRpcTraceRequest) returns (GetRpcTraceReply);
  rpc GetElections(GetElectionsRequest) returns (GetElectionsReply);
  rpc GetClockState(Empty)          returns (ClockState);
  rpc GetClockHistory(GetHistoryRequest) returns (ClockHistoryReply);
  rpc GetReplicationState(Empty)    returns (ReplicationState);
  rpc GetIntegrity(Empty)           returns (Integrity);
}
```
Messages mirror the JSON in api-reference §5 (fields snake_case in proto, camelCase in REST).

### 7.4 `lab.proto` (LAB_MODE only)

```proto
service LabService {
  rpc SetFaultMode(FaultModeRequest)  returns (Empty);        // NONE | CRASH | PARTITION
  rpc SetConfig(LabConfigRequest)     returns (Empty);        // election_algorithm, consistency_mode, replication_delay_ms, artificial_latency_ms
  rpc TriggerElection(TriggerElectionRequest) returns (TriggerElectionReply);
  rpc TriggerClockSync(Empty)         returns (ClockSyncRound);
  rpc SimulateWork(SimulateWorkRequest) returns (SimulateWorkReply);
  rpc CpuTask(CpuTaskRequest)         returns (CpuTaskReply);
  rpc PeerPing(PeerPingRequest)       returns (PeerPingReply);  // node calls another node; returns hop trace
}
```
`LabService.SetFaultMode(NONE)` and `ObservabilityService.GetStatus` remain callable while a node is in `CRASH_SIM` (so the UI can heal it); all other RPCs fail with `UNAVAILABLE`.

---

## 8. Internal RPC table

| RPC | Caller → Callee | Deadline | Triggered by | Lamport |
|---|---|---|---|---|
| `BankService.*` | gateway → entry node | 3 s read / 8 s write | REST request | yes |
| `BankService.*` (write) | entry node → leader | remaining − 0.5 s | write arriving at backup | yes |
| `ClusterService.Heartbeat` | every node → every peer | 1 s | timer (1 s) | yes |
| `ClusterService.Ping` | gateway/node → node | 1 s | LB checks, RPC lab | yes |
| `ClusterService.Election` / `Coordinator` | node → higher / all nodes | 1.5 s | Bully | yes |
| `ClusterService.RingElection` / `RingCoordinator` | node → successor | 1 s per hop | Ring | yes |
| `ClusterService.GetTime` / `AdjustClock` | leader → each node | 1 s | Berkeley round | yes |
| `ClusterService.AppendEntries` | leader → backup | 2 s | every committed write + idle keepalive | yes |
| `ClusterService.GetLogEntries` | node → peer | 2 s | catch-up / leader prep | yes |
| `ClusterService.GetSnapshot` | node → leader (stream) | 30 s | divergence / far behind | yes |
| `ObservabilityService.*` | gateway → node | 1–2 s | monitoring polls (1–2 s) | yes |
| `LabService.*` | gateway → node | 2–5 s | lab actions | yes |
