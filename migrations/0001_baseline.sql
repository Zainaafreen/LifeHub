-- Migration 0001 — baseline schema
-- This is the initial schema extracted from schema.sql.
-- All subsequent changes must be added as new numbered migration files
-- (0002_add_foo.sql, 0003_rename_bar.sql, …) and never by editing this file.

-- ── Schema migrations bookkeeping table ─────────────────────────────────────
-- Created here so it exists before any migration tries to record itself.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    VARCHAR(10)  PRIMARY KEY,        -- e.g. '0001'
  name       TEXT         NOT NULL,           -- human-readable name
  applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

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

-- ── Performance indexes ───────────────────────────────────────────────────────

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

-- ── JWT Blacklist ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti        VARCHAR(128) PRIMARY KEY,
  revoked_at TIMESTAMPTZ  DEFAULT NOW(),
  expires_at TIMESTAMPTZ  NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_revoked_tokens_jti_exp
  ON revoked_tokens(jti, expires_at);

-- ── Rate-limit store ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rate_limit_hits (
  key        TEXT        NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  hits       INTEGER     NOT NULL DEFAULT 1,
  PRIMARY KEY (key, window_end)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_window
  ON rate_limit_hits(key, window_end);

-- ── Email verification tokens ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS email_verify_tokens (
  token      VARCHAR(64)  PRIMARY KEY,
  user_id    INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ  NOT NULL,
  used       BOOLEAN      NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_verify_tokens_user
  ON email_verify_tokens(user_id);

-- ── Password reset tokens ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token      VARCHAR(64)  PRIMARY KEY,
  user_id    INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ  NOT NULL,
  used       BOOLEAN      NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_reset_tokens_user
  ON password_reset_tokens(user_id);

-- ── Cleanup function ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION cleanup_expired_rows()
RETURNS void LANGUAGE sql AS $$
  DELETE FROM revoked_tokens         WHERE expires_at  <= NOW();
  DELETE FROM rate_limit_hits        WHERE window_end  <= NOW();
  DELETE FROM email_verify_tokens    WHERE expires_at  <= NOW();
  DELETE FROM password_reset_tokens  WHERE expires_at  <= NOW();
$$;

CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS void LANGUAGE sql AS $$
  SELECT cleanup_expired_rows();
$$;

-- ── Record this migration ─────────────────────────────────────────────────────
INSERT INTO schema_migrations (version, name)
VALUES ('0001', 'baseline')
ON CONFLICT (version) DO NOTHING;
