-- Telemetry Family: Cloudflare D1 (SQLite). No PostgreSQL syntax.
-- IDs, epoch-millisecond timestamps, and passwordless OTP verification
-- are generated/validated by the Worker, not by this schema.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone_e164 TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT 'Family member',
  sharing_enabled INTEGER NOT NULL DEFAULT 0 CHECK (sharing_enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  CHECK (phone_e164 GLOB '+[1-9]*')
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  inviter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_phone TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  accepted_at INTEGER,
  declined_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_invitations_phone ON invitations(invited_phone, expires_at);

CREATE TABLE IF NOT EXISTS shares (
  subject_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consented_at INTEGER NOT NULL,
  PRIMARY KEY (subject_id, viewer_id),
  CHECK (subject_id <> viewer_id)
);
CREATE INDEX IF NOT EXISTS idx_shares_viewer ON shares(viewer_id);

CREATE TABLE IF NOT EXISTS latest_locations (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m REAL,
  battery_percent INTEGER CHECK (battery_percent BETWEEN 0 AND 100),
  recorded_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS location_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m REAL,
  battery_percent INTEGER CHECK (battery_percent BETWEEN 0 AND 100),
  recorded_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_location_history_user_time
  ON location_history(user_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS safe_zones (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  radius_m INTEGER NOT NULL CHECK (radius_m BETWEEN 100 AND 2000),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_safe_zones_subject ON safe_zones(subject_id);

CREATE TABLE IF NOT EXISTS zone_presence (
  zone_id TEXT PRIMARY KEY REFERENCES safe_zones(id) ON DELETE CASCADE,
  inside INTEGER NOT NULL CHECK (inside IN (0, 1)),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  viewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  safe_zone_id TEXT REFERENCES safe_zones(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_viewer_time ON alerts(viewer_id, created_at DESC);
