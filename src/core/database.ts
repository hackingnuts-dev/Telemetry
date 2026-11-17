import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import type { LocationSnapshot, TelemetryEvent } from './types';

const DB_KEY = 'telemetry.sqlcipher.key.v1';
let promise: Promise<SQLite.SQLiteDatabase> | null = null;

async function openEncrypted(): Promise<SQLite.SQLiteDatabase> {
  let key = await SecureStore.getItemAsync(DB_KEY);
  if (!key) {
    const bytes = await Crypto.getRandomBytesAsync(32);
    key = Array.from(bytes)
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('');
    await SecureStore.setItemAsync(DB_KEY, key);
  }
  const db = await SQLite.openDatabaseAsync('telemetry.db');
  const available = await db.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version');
  if (!available?.cipher_version) {
    await db.closeAsync();
    throw new Error('SQLCipher is missing. Run a native development or release build, not Expo Go.');
  }
  // key is 64 hex characters generated locally, safe to insert in SQLCipher's raw-key syntax.
  if (!/^[0-9a-f]{64}$/.test(key)) throw new Error('Invalid protected database key');
  await db.execAsync(`PRAGMA key = "x'${key}'";`);
  await db.getFirstAsync('SELECT count(*) AS count FROM sqlite_master');
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      latitude REAL NOT NULL, longitude REAL NOT NULL, accuracy REAL,
      recorded_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY, body TEXT NOT NULL,
      created_at INTEGER NOT NULL, retry_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS phone_enrollment (
      id INTEGER PRIMARY KEY CHECK(id=1),
      e164 TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending_verification','verified')),
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

export async function database(): Promise<SQLite.SQLiteDatabase> {
  if (!promise)
    promise = openEncrypted().catch((err) => {
      promise = null;
      throw err;
    });
  return promise;
}

export async function saveObservation(x: LocationSnapshot): Promise<void> {
  const db = await database();
  await db.runAsync(
    'INSERT INTO observations(latitude,longitude,accuracy,recorded_at) VALUES (?,?,?,?)',
    x.latitude,
    x.longitude,
    x.accuracy,
    x.recordedAt,
  );
  // Raw samples have a short rolling retention period; outbox has separate acknowledgements.
  await db.runAsync('DELETE FROM observations WHERE recorded_at < ?', Date.now() - 7 * 86400_000);
}

export async function getLastLocation(): Promise<LocationSnapshot | null> {
  const db = await database();
  const row = await db.getFirstAsync<{
    latitude: number;
    longitude: number;
    accuracy: number | null;
    recorded_at: number;
  }>('SELECT latitude,longitude,accuracy,recorded_at FROM observations ORDER BY recorded_at DESC LIMIT 1');
  return row
    ? {
        latitude: row.latitude,
        longitude: row.longitude,
        accuracy: row.accuracy,
        recordedAt: row.recorded_at,
      }
    : null;
}

export async function getState(key: string): Promise<string | null> {
  const db = await database();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM state WHERE key=?', key);
  return row?.value ?? null;
}
export async function putState(key: string, value: string): Promise<void> {
  const db = await database();
  await db.runAsync(
    'INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    key,
    value,
  );
}
export async function queueEvent(event: TelemetryEvent): Promise<void> {
  const db = await database();
  await db.runAsync(
    'INSERT OR IGNORE INTO outbox(id,body,created_at) VALUES (?,?,?)',
    event.id,
    JSON.stringify(event),
    Date.now(),
  );
}
export async function pendingEvents(): Promise<{ id: string; body: string; retry_count: number }[]> {
  const db = await database();
  return db.getAllAsync(
    'SELECT id,body,retry_count FROM outbox WHERE next_attempt_at <= ? ORDER BY created_at LIMIT 50',
    Date.now(),
  );
}
export async function acknowledgeEvents(ids: string[]): Promise<void> {
  const db = await database();
  for (const id of ids) await db.runAsync('DELETE FROM outbox WHERE id=?', id);
}
export async function deferEvents(ids: string[], retryCount: number): Promise<void> {
  const db = await database();
  const delay =
    Math.min(30_000 * 2 ** Math.min(retryCount, 10), 6 * 3600_000) + Math.floor(Math.random() * 5000);
  for (const id of ids) {
    await db.runAsync(
      'UPDATE outbox SET retry_count=retry_count+1,next_attempt_at=? WHERE id=?',
      Date.now() + delay,
      id,
    );
  }
}
export async function countPending(): Promise<number> {
  const db = await database();
  const row = await db.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM outbox');
  return row?.count ?? 0;
}

/** Explicitly supplied number stored in the already SQLCipher-encrypted database. */
export async function setPhoneEnrollment(
  number: string,
  status: 'pending_verification' | 'verified',
): Promise<void> {
  const db = await database();
  await db.runAsync(
    'INSERT INTO phone_enrollment(id,e164,status,updated_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET e164=excluded.e164,status=excluded.status,updated_at=excluded.updated_at',
    number,
    status,
    Date.now(),
  );
}

export async function getPhoneEnrollment(): Promise<{
  e164: string;
  status: 'pending_verification' | 'verified';
} | null> {
  const db = await database();
  return db.getFirstAsync<{ e164: string; status: 'pending_verification' | 'verified' }>(
    'SELECT e164,status FROM phone_enrollment WHERE id=1',
  );
}
