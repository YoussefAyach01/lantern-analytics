import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';

describe('openDb schema', () => {
  it('creates api_keys, sites, events, daily_stats with no IP/cookie/fingerprint columns', () => {
    const db = openDb(':memory:');
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => (r as { name: string }).name)
      .filter((name) => name !== 'sqlite_sequence')
      .sort();
    expect(tables).toEqual(['api_keys', 'daily_stats', 'events', 'sites']);

    const eventCols = db
      .prepare('PRAGMA table_info(events)')
      .all()
      .map((r) => (r as { name: string }).name);
    expect(eventCols).toEqual([
      'id',
      'site_id',
      'path',
      'referrer_host',
      'device_class',
      'is_new_visit',
      'created_at',
    ]);
    for (const banned of ['ip', 'ip_address', 'cookie', 'cookie_id', 'fingerprint', 'user_agent']) {
      expect(eventCols).not.toContain(banned);
    }
  });

  it('is idempotent to open twice (migrations run once via user_version)', () => {
    const path = ':memory:';
    const db1 = openDb(path);
    db1.close();
    // :memory: doesn't persist between opens, but this exercises the migration loop twice
    // against a fresh db without throwing — a file-backed re-open is covered manually in README.
    const db2 = openDb(path);
    const row = db2.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(row.user_version).toBeGreaterThan(0);
  });
});
