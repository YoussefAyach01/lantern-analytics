import { z } from 'zod';
import type { Db } from './db.js';
import { classifyDevice, type SessionDedup } from './dedup.js';

export const collectBodySchema = z.object({
  siteToken: z.string().min(1).max(200),
  path: z.string().min(1).max(2048),
  referrer: z.string().max(2048).nullish(),
});
export type CollectBody = z.infer<typeof collectBodySchema>;

/** Keeps only the path (+ at most a short query string), capped, always leading "/". */
export function normalizePath(raw: string): string {
  let p = raw.trim();
  if (!p.startsWith('/')) p = '/' + p;
  // Drop a fragment; keep the path and query since some dashboards care about UTM-free query use,
  // but cap total length so a crafted path can't bloat storage.
  const hashIdx = p.indexOf('#');
  if (hashIdx !== -1) p = p.slice(0, hashIdx);
  return p.slice(0, 512) || '/';
}

/** Returns the referrer's hostname, or null for "direct" / same-site / unparseable referrers. */
export function extractReferrerHost(referrer: string | null | undefined, ownDomain: string): string | null {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    const host = url.hostname.toLowerCase();
    if (host === ownDomain.toLowerCase()) return null;
    return host.slice(0, 255);
  } catch {
    return null;
  }
}

export interface RecordEventInput {
  siteId: string;
  siteDomain: string;
  path: string;
  referrer?: string | null;
  ip: string;
  userAgent: string | null | undefined;
  now?: Date;
}

/**
 * The ingest write. No IP, no cookie, no persistent fingerprint is ever included in the
 * INSERT below — only a boolean (`isNewVisit`) derived from the in-memory-only dedup hash.
 */
export function recordEvent(
  db: Db,
  dedup: SessionDedup,
  input: RecordEventInput,
): { isNewVisit: boolean } {
  const now = input.now ?? new Date();
  const isNewVisit = dedup.isNewVisit(input.siteId, input.ip, input.userAgent ?? '');
  const referrerHost = extractReferrerHost(input.referrer, input.siteDomain);
  const deviceClass = classifyDevice(input.userAgent);
  const path = normalizePath(input.path);
  db.prepare(
    `INSERT INTO events (site_id, path, referrer_host, device_class, is_new_visit, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(input.siteId, path, referrerHost, deviceClass, isNewVisit ? 1 : 0, now.toISOString());
  return { isNewVisit };
}
