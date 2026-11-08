import { randomBytes, randomUUID } from 'node:crypto';
import type { Db } from './db.js';

export interface Site {
  id: string;
  apiKeyId: string;
  name: string;
  domain: string;
  siteToken: string;
  createdAt: string;
}

interface Row {
  id: string;
  api_key_id: string;
  name: string;
  domain: string;
  site_token: string;
  created_at: string;
}
const toSite = (r: Row): Site => ({
  id: r.id,
  apiKeyId: r.api_key_id,
  name: r.name,
  domain: r.domain,
  siteToken: r.site_token,
  createdAt: r.created_at,
});

/** Public (not secret) — embedded client-side in the tracking snippet, so it cannot be a secret. */
function newSiteToken(): string {
  return `lnts_${randomBytes(16).toString('base64url')}`;
}

export function countSitesForKey(db: Db, apiKeyId: string): number {
  const r = db
    .prepare('SELECT COUNT(*) AS n FROM sites WHERE api_key_id = ?')
    .get(apiKeyId) as { n: number };
  return r.n;
}

export function createSite(
  db: Db,
  apiKeyId: string,
  name: string,
  domain: string,
  now = new Date(),
): Site {
  const id = randomUUID();
  const siteToken = newSiteToken();
  db.prepare(
    'INSERT INTO sites (id, api_key_id, name, domain, site_token, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, apiKeyId, name, domain, siteToken, now.toISOString());
  return getSiteById(db, id)!;
}

export function getSiteById(db: Db, id: string): Site | null {
  const r = db.prepare('SELECT * FROM sites WHERE id = ?').get(id) as unknown as Row | undefined;
  return r ? toSite(r) : null;
}

export function getSiteByToken(db: Db, token: string): Site | null {
  const r = db
    .prepare('SELECT * FROM sites WHERE site_token = ?')
    .get(token) as unknown as Row | undefined;
  return r ? toSite(r) : null;
}

export function listSitesForKey(db: Db, apiKeyId: string): Site[] {
  const rows = db
    .prepare('SELECT * FROM sites WHERE api_key_id = ? ORDER BY created_at DESC')
    .all(apiKeyId) as unknown as Row[];
  return rows.map(toSite);
}

/** Ownership check used by every dashboard/data route — same site id but a different owner's key 404s. */
export function getOwnedSite(db: Db, siteId: string, apiKeyId: string): Site | null {
  const site = getSiteById(db, siteId);
  return site && site.apiKeyId === apiKeyId ? site : null;
}
