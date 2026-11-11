import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { SessionDedup } from '../src/dedup.js';
import { runRollup } from '../src/rollup.js';
import { dayKey } from '../src/dedup.js';

const ADMIN = 'a'.repeat(32);
const config = {
  PORT: 4100,
  ADMIN_TOKEN: ADMIN,
  DB_PATH: ':memory:',
  PUBLIC_URL: 'http://x',
  TRUST_PROXY: '0' as const,
};

function setup() {
  let t = new Date('2026-11-08T10:00:00Z').getTime();
  const clock = { advance: (ms: number) => (t += ms) };
  const db = openDb(':memory:');
  const dedup = new SessionDedup({ now: () => new Date(t) });
  const app = createApp({ config, db, now: () => new Date(t), dedup });
  return { db, app, clock, nowMs: () => t };
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const withApiKey = (k: string) => ({ 'x-api-key': k });

async function issueKey(app: ReturnType<typeof setup>['app'], plan: 'free' | 'pro' = 'free') {
  const r = await app.request('/admin/keys', {
    method: 'POST',
    headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ label: 'test', plan }),
  });
  return (await r.json()) as { key: string; id: string };
}

async function createSiteViaApi(app: ReturnType<typeof setup>['app'], apiKey: string) {
  const r = await app.request('/api/sites', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...withApiKey(apiKey) },
    body: JSON.stringify({ name: 'My Blog', domain: 'myblog.example' }),
  });
  return { status: r.status, json: (await r.json()) as { id: string; siteToken: string } };
}

describe('smoke', () => {
  it('serves health and the snippet', async () => {
    const { app } = setup();
    expect((await app.request('/health')).status).toBe(200);
    const snippet = await app.request('/t.js');
    expect(snippet.status).toBe(200);
    expect(snippet.headers.get('content-type')).toContain('javascript');
  });
});

describe('admin key issuance', () => {
  it('requires the admin token and stores only a hash', async () => {
    const { app, db } = setup();
    expect((await app.request('/admin/keys')).status).toBe(401);
    const k = await issueKey(app);
    const row = db.prepare('SELECT key_hash FROM api_keys').get() as { key_hash: string };
    expect(JSON.stringify(row)).not.toContain(k.key);
  });
});

describe('site creation + plan limits', () => {
  it('creates a site and returns a public site token + embed snippet', async () => {
    const { app } = setup();
    const k = await issueKey(app);
    const { status, json } = await createSiteViaApi(app, k.key);
    expect(status).toBe(201);
    expect(json.siteToken).toMatch(/^lnts_/);
  });

  it('free plan allows exactly one site', async () => {
    const { app } = setup();
    const k = await issueKey(app, 'free');
    expect((await createSiteViaApi(app, k.key)).status).toBe(201);
    expect((await createSiteViaApi(app, k.key)).status).toBe(403);
  });

  it('rejects site creation with no / an invalid api key', async () => {
    const { app } = setup();
    expect((await createSiteViaApi(app, 'nope')).status).toBe(401);
    const r = await app.request('/api/sites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', domain: 'x.com' }),
    });
    expect(r.status).toBe(401);
  });
});

describe('collection + dashboard end-to-end', () => {
  it('a collected pageview shows up on the dashboard after rollup', async () => {
    const { app, db, nowMs } = setup();
    const k = await issueKey(app);
    const { json: site } = await createSiteViaApi(app, k.key);

    const collect = await app.request('/api/collect', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'TestAgent/1.0' },
      body: JSON.stringify({ siteToken: site.siteToken, path: '/', referrer: null }),
    });
    expect(collect.status).toBe(204);

    runRollup(db, dayKey(new Date(nowMs())));

    const dash = await app.request(`/dashboard/${site.id}`, { headers: withApiKey(k.key) });
    expect(dash.status).toBe(200);
    const html = await dash.text();
    expect(html).toContain('My Blog');
    expect(html).toContain('1'); // at least one visit/pageview rendered somewhere
    // The CSP is default-src 'self' with no 'unsafe-inline', so any inline style
    // attribute would be silently dropped by the browser (the chart was blank once).
    expect(html).not.toContain('style="');
    expect(html).toMatch(/class="bar h\d+"/);
  });

  it('an unknown site token is silently accepted (no 404 oracle for guessing tokens)', async () => {
    const { app } = setup();
    const r = await app.request('/api/collect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ siteToken: 'lnts_doesnotexist', path: '/' }),
    });
    expect(r.status).toBe(204);
  });

  it('rejects a malformed collect payload', async () => {
    const { app } = setup();
    const r = await app.request('/api/collect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/' }), // missing siteToken
    });
    expect(r.status).toBe(400);
  });
});

describe('ownership / IDOR', () => {
  it("one key's dashboard cannot be read with another key", async () => {
    const { app } = setup();
    const kA = await issueKey(app);
    const kB = await issueKey(app);
    const { json: siteA } = await createSiteViaApi(app, kA.key);
    const dash = await app.request(`/dashboard/${siteA.id}`, { headers: withApiKey(kB.key) });
    expect(dash.status).toBe(404);
  });

  it('a revoked key can no longer create sites or read dashboards', async () => {
    const { app } = setup();
    const k = await issueKey(app);
    const { json: site } = await createSiteViaApi(app, k.key);
    await app.request(`/admin/keys/${k.id}`, { method: 'DELETE', headers: auth(ADMIN) });
    expect(
      (await app.request(`/dashboard/${site.id}`, { headers: withApiKey(k.key) })).status,
    ).toBe(401);
    expect((await createSiteViaApi(app, k.key)).status).toBe(401);
  });

  it('never leaks internals on errors', async () => {
    const { app } = setup();
    const r = await app.request('/dashboard/x', { headers: withApiKey('nope') });
    expect(JSON.stringify(await r.json())).not.toMatch(/sqlite|stack|node_modules/i);
  });
});

describe('rate limiting', () => {
  it('rate limits the collect endpoint per IP', async () => {
    const { app } = setup();
    const k = await issueKey(app);
    const { json: site } = await createSiteViaApi(app, k.key);
    let okCount = 0;
    for (let i = 0; i < 605; i++) {
      const r = await app.request('/api/collect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteToken: site.siteToken, path: '/' }),
      });
      if (r.status === 204) okCount++;
    }
    expect(okCount).toBeLessThan(605);
  });
});
