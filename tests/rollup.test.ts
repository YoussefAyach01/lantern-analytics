import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { runRollup } from '../src/rollup.js';
import { createKey } from '../src/keys.js';
import { createSite } from '../src/sites.js';

function insertEvent(
  db: ReturnType<typeof openDb>,
  siteId: string,
  path: string,
  isNewVisit: boolean,
  createdAt: string,
) {
  db.prepare(
    `INSERT INTO events (site_id, path, referrer_host, device_class, is_new_visit, created_at)
     VALUES (?, ?, NULL, 'desktop', ?, ?)`,
  ).run(siteId, path, isNewVisit ? 1 : 0, createdAt);
}

function setup() {
  const db = openDb(':memory:');
  const { record } = createKey(db, 'test', 'free', new Date('2026-11-01T00:00:00Z'));
  const site = createSite(
    db,
    record.id,
    'Test Site',
    'example.com',
    new Date('2026-11-01T00:00:00Z'),
  );
  return { db, site };
}

describe('runRollup: correctness', () => {
  it('aggregates visits (new-session flags) and pageviews (row counts) per path for the day', () => {
    const { db, site } = setup();
    insertEvent(db, site.id, '/', true, '2026-11-08T09:00:00.000Z');
    insertEvent(db, site.id, '/', false, '2026-11-08T09:05:00.000Z'); // same visit, another pageview
    insertEvent(db, site.id, '/about', true, '2026-11-08T09:10:00.000Z');

    runRollup(db, '2026-11-08');

    const rows = db
      .prepare('SELECT path, visits, pageviews FROM daily_stats WHERE site_id = ? ORDER BY path')
      .all(site.id) as { path: string; visits: number; pageviews: number }[];
    expect(rows).toEqual([
      { path: '/', visits: 1, pageviews: 2 },
      { path: '/about', visits: 1, pageviews: 1 },
    ]);
  });

  it('only rolls up events whose UTC day matches, leaving other days alone', () => {
    const { db, site } = setup();
    insertEvent(db, site.id, '/', true, '2026-11-07T23:59:59.000Z');
    insertEvent(db, site.id, '/', true, '2026-11-08T00:00:01.000Z');

    runRollup(db, '2026-11-07');
    runRollup(db, '2026-11-08');

    const rows = db
      .prepare('SELECT day, path, visits FROM daily_stats WHERE site_id = ? ORDER BY day')
      .all(site.id) as { day: string; path: string; visits: number }[];
    expect(rows).toEqual([
      { day: '2026-11-07', path: '/', visits: 1 },
      { day: '2026-11-08', path: '/', visits: 1 },
    ]);
  });
});

describe('runRollup: idempotency', () => {
  it('running the rollup twice for the same day does not double-count', () => {
    const { db, site } = setup();
    insertEvent(db, site.id, '/', true, '2026-11-08T09:00:00.000Z');
    insertEvent(db, site.id, '/', false, '2026-11-08T09:05:00.000Z');
    insertEvent(db, site.id, '/pricing', true, '2026-11-08T10:00:00.000Z');

    runRollup(db, '2026-11-08');
    const after1 = db
      .prepare('SELECT path, visits, pageviews FROM daily_stats WHERE site_id = ? ORDER BY path')
      .all(site.id);

    runRollup(db, '2026-11-08');
    runRollup(db, '2026-11-08');
    const after3 = db
      .prepare('SELECT path, visits, pageviews FROM daily_stats WHERE site_id = ? ORDER BY path')
      .all(site.id);

    expect(after3).toEqual(after1);
    expect(after3).toEqual([
      { path: '/', visits: 1, pageviews: 2 },
      { path: '/pricing', visits: 1, pageviews: 1 },
    ]);
  });

  it('re-running after new events for the SAME day arrive reflects the new totals exactly once', () => {
    const { db, site } = setup();
    insertEvent(db, site.id, '/', true, '2026-11-08T09:00:00.000Z');
    runRollup(db, '2026-11-08');

    insertEvent(db, site.id, '/', false, '2026-11-08T09:30:00.000Z');
    runRollup(db, '2026-11-08');
    runRollup(db, '2026-11-08'); // extra run should change nothing further

    const row = db
      .prepare('SELECT visits, pageviews FROM daily_stats WHERE site_id = ? AND path = ?')
      .get(site.id, '/') as { visits: number; pageviews: number };
    expect(row).toEqual({ visits: 1, pageviews: 2 });
  });

  it('a crash-and-retry pattern (rollup called an unknown number of times) stays correct', () => {
    const { db, site } = setup();
    for (let i = 0; i < 5; i++)
      insertEvent(db, site.id, '/', i === 0, `2026-11-08T0${i}:00:00.000Z`);

    const runs = 1 + Math.floor(Math.random() * 5);
    for (let i = 0; i < runs; i++) runRollup(db, '2026-11-08');

    const row = db
      .prepare('SELECT visits, pageviews FROM daily_stats WHERE site_id = ? AND path = ?')
      .get(site.id, '/') as { visits: number; pageviews: number };
    expect(row).toEqual({ visits: 1, pageviews: 5 });
  });
});
