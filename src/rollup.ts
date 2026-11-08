import type { Db } from './db.js';

/**
 * Recomputes `daily_stats` for one UTC day from the raw `events` rows.
 *
 * Idempotent by construction: it first deletes any existing `daily_stats` rows for
 * that day, then re-derives them fresh from `events` with a single GROUP BY. Running
 * this twice (or a hundred times) in a row for the same day always leaves exactly the
 * same numbers — nothing is incremented, so there is no double-counting from retries,
 * crons overlapping, or a crash-and-retry.
 */
export function runRollup(db: Db, day: string): { siteDays: number } {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM daily_stats WHERE day = ?').run(day);
    const stmt = db.prepare(`
      INSERT INTO daily_stats (site_id, day, path, visits, pageviews)
      SELECT site_id, ? AS day, path, SUM(is_new_visit) AS visits, COUNT(*) AS pageviews
      FROM events
      WHERE substr(created_at, 1, 10) = ?
      GROUP BY site_id, path
    `);
    const res = stmt.run(day, day);
    db.exec('COMMIT');
    return { siteDays: Number(res.changes) };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
