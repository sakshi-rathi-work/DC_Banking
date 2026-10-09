-- Migration: 0001_init.sql
-- Initial database schema for Distributed Banking System
-- Matches docs/architecture.md §11

-- ===== Migration tracking table =====
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INT PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Replicated tables =====

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (lower(email));

CREATE TABLE IF NOT EXISTS accounts (
  id             UUID PRIMARY KEY,
  user_id        UUID NOT NULL REFERENCES users(id),
  account_number CHAR(12) NOT NULL UNIQUE,
  nickname       TEXT,
  balance_paise  BIGINT NOT NULL DEFAULT 0 CHECK (balance_paise >= 0),
  currency       CHAR(3) NOT NULL DEFAULT 'INR',
  status         TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','FROZEN','CLOSED')),
  version        BIGINT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS accounts_user_idx ON accounts(user_id);

CREATE TABLE IF NOT EXISTS transactions (
  id                        UUID PRIMARY KEY,
  reference                 TEXT NOT NULL UNIQUE,
  type                      TEXT NOT NULL CHECK (type IN ('DEPOSIT','WITHDRAWAL','TRANSFER')),
  source_account_id         UUID REFERENCES accounts(id),
  destination_account_id    UUID REFERENCES accounts(id),
  amount_paise              BIGINT NOT NULL CHECK (amount_paise > 0),
  status                    TEXT NOT NULL CHECK (status IN ('COMMITTED','REJECTED')),
  reject_reason             TEXT,
  note                      TEXT,
  source_balance_after      BIGINT,
  destination_balance_after BIGINT,
  entry_node                SMALLINT NOT NULL,
  processed_by_node         SMALLINT NOT NULL,
  epoch                     BIGINT NOT NULL,
  log_seq                   BIGINT NOT NULL,
  lamport                   BIGINT NOT NULL,
  physical_ts               TIMESTAMPTZ NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tx_source_idx ON transactions(source_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tx_dest_idx   ON transactions(destination_account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id      UUID NOT NULL,
  key          TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response     JSONB,
  http_status  INT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS replication_log (
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

CREATE TABLE IF NOT EXISTS node_state (
  node_id            SMALLINT PRIMARY KEY,
  epoch              BIGINT NOT NULL DEFAULT 0,
  last_seq           BIGINT NOT NULL DEFAULT 0,
  leader_id          SMALLINT,
  lamport_checkpoint BIGINT NOT NULL DEFAULT 0,
  clock_adjust_ms    DOUBLE PRECISION NOT NULL DEFAULT 0,
  config             JSONB NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_log (
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
);

CREATE TABLE IF NOT EXISTS election_history (
  election_id  UUID PRIMARY KEY,
  algorithm    TEXT NOT NULL,
  trigger      TEXT NOT NULL,
  initiator    SMALLINT NOT NULL,
  winner       SMALLINT,
  epoch        BIGINT,
  participants SMALLINT[],
  messages     JSONB NOT NULL DEFAULT '[]',
  outcome      TEXT NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS clock_sync_history (
  round_id    UUID PRIMARY KEY,
  master_node SMALLINT NOT NULL,
  average_ms  DOUBLE PRECISION,
  per_node    JSONB NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
