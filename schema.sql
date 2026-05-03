-- LifeHub PostgreSQL Schema
-- Run this file once to set up the database from scratch.
-- Every statement is idempotent (IF NOT EXISTS / CREATE OR REPLACE)
-- so it is safe to re-run, but it should only be run once in production
-- and thereafter managed via explicit migration scripts.

-- ── Core tables ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(100) NOT NULL,
  email        VARCHAR(150) UNIQUE NOT NULL,
  password     VARCHAR(255) NOT NULL,
  verified     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      VARCHAR(255) NOT NULL,
  completed  BOOLEAN DEFAULT FALSE,
  priority   VARCHAR(10) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expenses (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense')),
  category    VARCHAR(100) NOT NULL,
  amount      NUMERIC(12, 2) NOT NULL,
  description TEXT,
  date        DATE DEFAULT CURRENT_DATE,
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS health_records (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  heartbeat    INTEGER,
  systolic     INTEGER,
  diastolic    INTEGER,
  blood_sugar  NUMERIC(6, 2),
  notes        TEXT,
  recorded_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reminders (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        VARCHAR(255) NOT NULL,
  description  TEXT,
  remind_at    TIMESTAMP NOT NULL,
  notified     BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMP DEFAULT NOW()
);


-- ── Performance indexes ──────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_tasks_user_id
  ON tasks(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_expenses_user_id
  ON expenses(user_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_health_user_recorded
  ON health_records(user_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_reminders_user_remind
  ON reminders(user_id, remind_at ASC);

CREATE INDEX IF NOT EXISTS idx_reminders_due
  ON reminders(user_id, remind_at, notified)
  WHERE notified = FALSE;


-- ── JWT Blacklist ────────────────────────────────────────────────────────────
-- Stores revoked token JTIs so logout survives server restarts.
-- No Redis required — backed entirely by PostgreSQL.

CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti        VARCHAR(128) PRIMARY KEY,
  revoked_at TIMESTAMPTZ  DEFAULT NOW(),
  expires_at TIMESTAMPTZ  NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_revoked_tokens_jti_exp
  ON revoked_tokens(jti, expires_at);


-- ── Rate-limit store ─────────────────────────────────────────────────────────
-- Replaces the in-memory express-rate-limit store so counters survive
-- restarts and work correctly across multiple server instances.

CREATE TABLE IF NOT EXISTS rate_limit_hits (
  key        TEXT        NOT NULL,          -- "<route_group>:<ip>"
  window_end TIMESTAMPTZ NOT NULL,          -- when this window expires
  hits       INTEGER     NOT NULL DEFAULT 1,
  PRIMARY KEY (key, window_end)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_window
  ON rate_limit_hits(key, window_end);


-- ── Email verification tokens ────────────────────────────────────────────────
-- Stores one-time tokens sent to users after registration.

CREATE TABLE IF NOT EXISTS email_verify_tokens (
  token      VARCHAR(64)  PRIMARY KEY,      -- crypto.randomBytes(32).toString('hex')
  user_id    INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ  NOT NULL,         -- 24 hours from creation
  used       BOOLEAN      NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_verify_tokens_user
  ON email_verify_tokens(user_id);


-- ── Password reset tokens ─────────────────────────────────────────────────────
-- One-time tokens sent when a user requests a password reset.
-- Same pattern as email_verify_tokens — 64-char hex, expires in 1 hour.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token      VARCHAR(64)  PRIMARY KEY,
  user_id    INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ  NOT NULL,
  used       BOOLEAN      NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_reset_tokens_user
  ON password_reset_tokens(user_id);


-- ── Cleanup function ─────────────────────────────────────────────────────────
-- Removes expired rows from all housekeeping tables.
-- Called automatically every hour by the Node.js server via setInterval.
-- No pg_cron or external cron job required.

CREATE OR REPLACE FUNCTION cleanup_expired_rows()
RETURNS void LANGUAGE sql AS $$
  DELETE FROM revoked_tokens         WHERE expires_at  <= NOW();
  DELETE FROM rate_limit_hits        WHERE window_end  <= NOW();
  DELETE FROM email_verify_tokens    WHERE expires_at  <= NOW();
  DELETE FROM password_reset_tokens  WHERE expires_at  <= NOW();
$$;

-- Legacy alias kept for backwards compatibility with any tooling
-- that calls cleanup_expired_tokens() directly.
CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS void LANGUAGE sql AS $$
  SELECT cleanup_expired_rows();
$$;


-- ── Migrations for existing databases ───────────────────────────────────────
-- If you already have a running DB and are applying this schema incrementally,
-- run these ALTER statements manually rather than re-running this whole file:
--
--   ALTER TABLE users     ADD COLUMN IF NOT EXISTS verified  BOOLEAN NOT NULL DEFAULT FALSE;
--   ALTER TABLE tasks     ADD COLUMN IF NOT EXISTS priority  VARCHAR(10) NOT NULL DEFAULT 'medium'
--                           CHECK (priority IN ('low', 'medium', 'high'));
--   ALTER TABLE reminders ADD COLUMN IF NOT EXISTS notified  BOOLEAN DEFAULT FALSE;
--   -- Then CREATE the rate_limit_hits, email_verify_tokens, password_reset_tokens tables above.
