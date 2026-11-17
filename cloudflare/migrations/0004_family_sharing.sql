-- Telemetry Family D1 v4: email-based invitation and opt-in sharing.
-- Existing phone-based tables remain untouched.
CREATE TABLE IF NOT EXISTS family_invites (
 id TEXT PRIMARY KEY,
 inviter_id TEXT NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
 invitee_email TEXT NOT NULL COLLATE NOCASE,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 accepted_at INTEGER,
 declined_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_family_invites_recipient ON family_invites(invitee_email,expires_at);
CREATE TABLE IF NOT EXISTS family_shares (
 subject_id TEXT NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
 viewer_id TEXT NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
 consented_at INTEGER NOT NULL,
 PRIMARY KEY(subject_id,viewer_id),
 CHECK(subject_id<>viewer_id)
);
CREATE INDEX IF NOT EXISTS idx_family_shares_viewer ON family_shares(viewer_id);
CREATE TABLE IF NOT EXISTS family_privacy (
 account_id TEXT PRIMARY KEY REFERENCES email_accounts(id) ON DELETE CASCADE,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS family_latest (
 account_id TEXT PRIMARY KEY REFERENCES email_accounts(id) ON DELETE CASCADE,
 latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 accuracy REAL,
 battery INTEGER CHECK(battery BETWEEN 0 AND 100),
 observed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS family_history (
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
 latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 accuracy REAL,
 battery INTEGER CHECK(battery BETWEEN 0 AND 100),
 observed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_family_history_account_time ON family_history(account_id,observed_at DESC);
