import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { createKey } from '../src/keys.js';
import { createSite } from '../src/sites.js';
import { SessionDedup } from '../src/dedup.js';
import { extractReferrerHost, normalizePath, recordEvent } from '../src/collect.js';

describe('normalizePath', () => {
  it('forces a leading slash, strips fragments, caps length', () => {
    expect(normalizePath('/about')).toBe('/about');
    expect(normalizePath('about')).toBe('/about');
    expect(normalizePath('/about#section')).toBe('/about');
    expect(normalizePath('')).toBe('/');
    expect(normalizePath('/' + 'x'.repeat(1000)).length).toBe(512);
  });
});

describe('extractReferrerHost', () => {
  it('returns the hostname for a cross-site referrer', () => {
    expect(extractReferrerHost('https://google.com/search?q=x', 'example.com')).toBe('google.com');
  });
  it('returns null for same-site, missing, or unparseable referrers', () => {
    expect(extractReferrerHost(null, 'example.com')).toBeNull();
    expect(extractReferrerHost(undefined, 'example.com')).toBeNull();
    expect(extractReferrerHost('https://example.com/other-page', 'example.com')).toBeNull();
    expect(extractReferrerHost('not a url', 'example.com')).toBeNull();
  });
});

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
  const dedup = new SessionDedup({ now: () => new Date('2026-11-08T10:00:00Z') });
  return { db, site, dedup };
}

describe('recordEvent', () => {
  it('writes an event row and reports whether it was a new visit', () => {
    const { db, site, dedup } = setup();
    const r1 = recordEvent(db, dedup, {
      siteId: site.id,
      siteDomain: site.domain,
      path: '/',
      referrer: null,
      ip: '1.2.3.4',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari',
      now: new Date('2026-11-08T10:00:00Z'),
    });
    expect(r1.isNewVisit).toBe(true);

    const r2 = recordEvent(db, dedup, {
      siteId: site.id,
      siteDomain: site.domain,
      path: '/pricing',
      referrer: null,
      ip: '1.2.3.4',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari',
      now: new Date('2026-11-08T10:01:00Z'),
    });
    expect(r2.isNewVisit).toBe(false);

    const rows = db.prepare('SELECT * FROM events ORDER BY id').all() as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ path: '/', is_new_visit: 1, device_class: 'desktop' });
    expect(rows[1]).toMatchObject({ path: '/pricing', is_new_visit: 0 });
  });

  it('privacy: no event row contains an IP address, a cookie, or the dedup hash', () => {
    const { db, site, dedup } = setup();
    const ip = '203.0.113.77';
    recordEvent(db, dedup, {
      siteId: site.id,
      siteDomain: site.domain,
      path: '/',
      referrer: null,
      ip,
      userAgent: 'Mozilla/5.0 UA-marker-xyz',
      now: new Date('2026-11-08T10:00:00Z'),
    });
    const row = db.prepare('SELECT * FROM events').get() as Record<string, unknown>;
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(ip);
    expect(serialized).not.toContain('UA-marker-xyz');
    // Only a 0/1 flag derived from the hash is stored — never the hash itself.
    expect(row.is_new_visit === 0 || row.is_new_visit === 1).toBe(true);
    expect(Object.keys(row)).not.toContain('ip');
    expect(Object.keys(row)).not.toContain('cookie');
    expect(Object.keys(row)).not.toContain('hash');
    expect(Object.keys(row)).not.toContain('user_agent');
  });

  it('bot/retry protection: many rapid hits from the same ip+ua count as one visit, many pageviews', () => {
    const { db, site, dedup } = setup();
    for (let i = 0; i < 20; i++) {
      recordEvent(db, dedup, {
        siteId: site.id,
        siteDomain: site.domain,
        path: `/p${i}`,
        referrer: null,
        ip: '9.9.9.9',
        userAgent: 'same-ua',
        now: new Date('2026-11-08T10:00:00Z'),
      });
    }
    const visits = db.prepare('SELECT COUNT(*) AS n FROM events WHERE is_new_visit = 1').get() as {
      n: number;
    };
    const pageviews = db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number };
    expect(visits.n).toBe(1);
    expect(pageviews.n).toBe(20);
  });
});
