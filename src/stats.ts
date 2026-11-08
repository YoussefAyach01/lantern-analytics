import type { Db } from './db.js';

export interface DayTotal {
  day: string;
  visits: number;
  pageviews: number;
}
export interface PathTotal {
  path: string;
  visits: number;
  pageviews: number;
}
export interface ReferrerTotal {
  referrerHost: string | null;
  visits: number;
}

/** Totals per UTC day for the last `days` days (including today), from the rollup table. */
export function dailyTotals(db: Db, siteId: string, sinceDay: string): DayTotal[] {
  const rows = db
    .prepare(
      `SELECT day, SUM(visits) AS visits, SUM(pageviews) AS pageviews
       FROM daily_stats WHERE site_id = ? AND day >= ?
       GROUP BY day ORDER BY day ASC`,
    )
    .all(siteId, sinceDay) as { day: string; visits: number; pageviews: number }[];
  return rows;
}

export function topPaths(db: Db, siteId: string, sinceDay: string, limit = 10): PathTotal[] {
  const rows = db
    .prepare(
      `SELECT path, SUM(visits) AS visits, SUM(pageviews) AS pageviews
       FROM daily_stats WHERE site_id = ? AND day >= ?
       GROUP BY path ORDER BY pageviews DESC LIMIT ?`,
    )
    .all(siteId, sinceDay, limit) as { path: string; visits: number; pageviews: number }[];
  return rows;
}

/** Referrer hosts are read straight from raw `events` (daily_stats doesn't carry them, by design — it rolls up per path only), scoped to the same window. */
export function topReferrers(db: Db, siteId: string, sinceIso: string, limit = 10): ReferrerTotal[] {
  const rows = db
    .prepare(
      `SELECT referrer_host AS referrerHost, COUNT(*) AS visits
       FROM events WHERE site_id = ? AND created_at >= ? AND is_new_visit = 1
       GROUP BY referrer_host ORDER BY visits DESC LIMIT ?`,
    )
    .all(siteId, sinceIso, limit) as { referrerHost: string | null; visits: number }[];
  return rows;
}

export function totals(db: Db, siteId: string, sinceDay: string): { visits: number; pageviews: number } {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(visits),0) AS visits, COALESCE(SUM(pageviews),0) AS pageviews
       FROM daily_stats WHERE site_id = ? AND day >= ?`,
    )
    .get(siteId, sinceDay) as { visits: number; pageviews: number };
  return r;
}
