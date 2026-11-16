-- Cloudflare D1: email-only sign-in, independent of the legacy phone schema.
-- All timestamps below are milliseconds since Unix epoch.
-- Safe to run after the existing nine tables have been created.
CREATE TABLE IF NOT EXISTS email_accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL DEFAULT 'Family member',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS email_challenges (
  id TEXT PRIMARY KEY,
  email_key TEXT NOT NULL,
  code_mac TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  consumed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_email_challenges_lookup
  ON email_challenges(email_key, created_at DESC);

CREATE TABLE IF NOT EXISTS email_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_sessions_account
  ON email_sessions(account_id);

CREATE TABLE IF NOT EXISTS email_auth_limits (
  key_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  hits INTEGER NOT NULL,
  PRIMARY KEY (key_hash, window_start)
);
