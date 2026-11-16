-- One-time Access-to-native code exchange. Apply after email_auth migration.
CREATE TABLE IF NOT EXISTS access_login_codes (
 code_hash TEXT PRIMARY KEY,
 state_hash TEXT NOT NULL,
 verifier_hash TEXT NOT NULL,
 authenticated_email TEXT NOT NULL,
 issued_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 consumed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_access_login_expiry ON access_login_codes(expires_at);
