import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = DatabaseSync;

/**
 * Ordered, append-only migrations tracked with PRAGMA user_version.
 *
 * Privacy note (this is the product's core sellable claim, enforced here in the
 * schema, not just in docs): `events` has NO column for IP address, cookie id, or any
 * persistent fingerprint. `is_new_visit` is a boolean derived at ingest time from an
 * in-memory-only, daily-salted hash (see src/dedup.ts) — the hash itself is never
 * written to any column, only the yes/no "was this a new session" result.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE api_keys (
    id TEXT PRIMARY KEY,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL,
    label TEXT NOT NULL,
    plan TEXT NOT NULL CHECK (plan IN ('free','pro')),
    revoked_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE sites (
    id TEXT PRIMARY KEY,
    api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    domain TEXT NOT NULL,
    site_token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE INDEX sites_owner_idx ON sites (api_key_id);
  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    referrer_host TEXT,
    device_class TEXT NOT NULL CHECK (device_class IN ('desktop','mobile','tablet','other')),
    is_new_visit INTEGER NOT NULL CHECK (is_new_visit IN (0,1)),
    created_at TEXT NOT NULL
  );
  CREATE INDEX events_site_time_idx ON events (site_id, created_at);
  CREATE TABLE daily_stats (
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    path TEXT NOT NULL,
    visits INTEGER NOT NULL DEFAULT 0,
    pageviews INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (site_id, day, path)
  );
  CREATE INDEX daily_stats_site_day_idx ON daily_stats (site_id, day);
  `,
];

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}
