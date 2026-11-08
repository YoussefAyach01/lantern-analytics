import { Hono, type Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { PLANS, type Config, type Plan } from './config.js';
import type { Db } from './db.js';
import { createKey, findActiveKey, listKeys, revokeKey, type KeyRecord } from './keys.js';
import { createSite, countSitesForKey, getOwnedSite, getSiteByToken, listSitesForKey } from './sites.js';
import { collectBodySchema, recordEvent } from './collect.js';
import { SessionDedup, dayKey } from './dedup.js';
import { runRollup } from './rollup.js';
import { dailyTotals, topPaths, topReferrers, totals } from './stats.js';
import { renderDashboard } from './dashboard.js';
import { RateLimiter } from './ratelimit.js';

export interface Deps {
  config: Config;
  db: Db;
  now?: () => Date;
  dedup?: SessionDedup;
}

type ErrStatus = 400 | 401 | 403 | 404 | 429 | 500;
const err = (c: Context, status: ErrStatus, code: string, message: string) =>
  c.json({ error: { code, message } }, status);

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const asset = (name: string) => readFileSync(publicDir + name, 'utf8');
const sha = (s: string) => createHash('sha256').update(s).digest();
const safeEqual = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));

type Vars = { key: KeyRecord };

export function createApp({ config, db, now = () => new Date(), dedup = new SessionDedup({ now }) }: Deps) {
  const app = new Hono<{ Variables: Vars }>();
  const collectLimiterByIp = new RateLimiter();
  const collectLimiterBySite = new RateLimiter();
  const adminLimiter = new RateLimiter();
  const apiLimiter = new RateLimiter();

  const clientIp = (c: Context): string => {
    if (config.TRUST_PROXY === '1') {
      const xff = c.req.header('x-forwarded-for');
      const last = xff?.split(',').pop()?.trim();
      if (last) return last.slice(0, 64);
    }
    try {
      return getConnInfo(c).remote.address ?? 'unknown';
    } catch {
      return 'unknown';
    }
  };

  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (!c.res.headers.has('Content-Security-Policy')) {
      c.header(
        'Content-Security-Policy',
        "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      );
    }
  });

  app.get('/health', (c) => c.json({ ok: true }));
  app.get('/t.js', (c) => c.body(asset('t.js'), 200, { 'Content-Type': 'text/javascript; charset=utf-8' }));
  app.get('/dashboard.css', (c) =>
    c.body(asset('dashboard.css'), 200, { 'Content-Type': 'text/css; charset=utf-8' }),
  );

  // --------------------------------------------------------- ingest (public write)
  // Intentionally unauthenticated: the snippet runs in the visitor's browser, so the
  // site token it carries is public by design (see sites.ts). Abuse is bounded by the
  // per-IP and per-site rate limits below, not by a secret.
  app.options('/api/collect', (c) => c.body(null, 204));
  app.post('/api/collect', async (c) => {
    const ip = clientIp(c);
    const ipRl = collectLimiterByIp.check(ip, 600);
    if (!ipRl.ok) return err(c, 429, 'RATE_LIMITED', 'Too many requests.');

    const json = await c.req.json().catch(() => null);
    const parsed = collectBodySchema.safeParse(json);
    if (!parsed.success) return err(c, 400, 'VALIDATION', 'Invalid collect payload.');

    const site = getSiteByToken(db, parsed.data.siteToken);
    // Same response whether the token is unknown or rate-limited: no oracle for guessing tokens.
    if (!site) return c.body(null, 204);

    const siteRl = collectLimiterBySite.check(site.id, PLANS.pro.requestsPerMinPerSite);
    if (!siteRl.ok) return c.body(null, 204);

    recordEvent(db, dedup, {
      siteId: site.id,
      siteDomain: site.domain,
      path: parsed.data.path,
      referrer: parsed.data.referrer,
      ip,
      userAgent: c.req.header('user-agent'),
      now: now(),
    });
    return c.body(null, 204);
  });

  // ------------------------------------------------------------ admin (issue API keys)
  app.use('/admin/*', async (c, next) => {
    const rl = adminLimiter.check(clientIp(c), 30);
    if (!rl.ok) return err(c, 429, 'RATE_LIMITED', 'Too many requests.');
    const m = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '');
    if (!m?.[1] || !safeEqual(m[1], config.ADMIN_TOKEN))
      return err(c, 401, 'UNAUTHORIZED', 'Admin token required.');
    await next();
  });
  app.post('/admin/keys', async (c) => {
    const parsed = z
      .object({ label: z.string().min(1).max(80), plan: z.enum(['free', 'pro']) })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return err(c, 400, 'VALIDATION', 'label and plan are required.');
    const { key, record } = createKey(db, parsed.data.label, parsed.data.plan, now());
    return c.json({ key, ...record }, 201);
  });
  app.get('/admin/keys', (c) => c.json({ keys: listKeys(db) }));
  app.delete('/admin/keys/:id', (c) =>
    revokeKey(db, c.req.param('id'), now())
      ? c.body(null, 204)
      : err(c, 404, 'NOT_FOUND', 'Key not found.'),
  );

  // --------------------------------------------------------- owner API (sites + dashboard)
  const apiKeyGuard = async (c: Context<{ Variables: Vars }>, next: () => Promise<void>) => {
    const rl = apiLimiter.check(clientIp(c), 300);
    if (!rl.ok) return err(c, 429, 'RATE_LIMITED', 'Too many requests.');
    const k = c.req.header('x-api-key');
    if (!k) return err(c, 401, 'UNAUTHORIZED', 'x-api-key header required.');
    const key = findActiveKey(db, k);
    if (!key) return err(c, 401, 'INVALID_API_KEY', 'Invalid or revoked API key.');
    c.set('key', key);
    await next();
  };
  app.use('/api/sites/*', apiKeyGuard);
  app.use('/api/sites', apiKeyGuard);
  app.use('/dashboard/*', apiKeyGuard);

  app.post('/api/sites', async (c) => {
    const key = c.get('key');
    const parsed = z
      .object({ name: z.string().min(1).max(120), domain: z.string().min(1).max(255) })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return err(c, 400, 'VALIDATION', 'name and domain are required.');
    if (countSitesForKey(db, key.id) >= PLANS[key.plan as Plan].maxSites) {
      return err(c, 403, 'PLAN_LIMIT', `Your plan allows ${PLANS[key.plan as Plan].maxSites} site(s).`);
    }
    const site = createSite(db, key.id, parsed.data.name, parsed.data.domain, now());
    return c.json(
      {
        id: site.id,
        name: site.name,
        domain: site.domain,
        siteToken: site.siteToken,
        embedSnippet: `<script defer src="${config.PUBLIC_URL}/t.js" data-site="${site.siteToken}"></script>`,
        dashboardUrl: `${config.PUBLIC_URL}/dashboard/${site.id}`,
      },
      201,
    );
  });

  app.get('/api/sites', (c) => {
    const key = c.get('key');
    return c.json({ sites: listSitesForKey(db, key.id) });
  });

  app.get('/dashboard/:siteId', (c) => {
    const key = c.get('key');
    const site = getOwnedSite(db, c.req.param('siteId'), key.id);
    if (!site) return err(c, 404, 'NOT_FOUND', 'Site not found.');

    const rangeDays = 14;
    const t = now();
    const since = new Date(t);
    since.setUTCDate(since.getUTCDate() - (rangeDays - 1));
    const sinceDay = dayKey(since);

    const data = {
      site,
      totals: totals(db, site.id, sinceDay),
      days: dailyTotals(db, site.id, sinceDay),
      paths: topPaths(db, site.id, sinceDay),
      referrers: topReferrers(db, site.id, since.toISOString()),
      publicUrl: config.PUBLIC_URL,
      rangeDays,
    };
    return c.html(renderDashboard(data));
  });

  // ---------------------------------------------------------------- rollup (idempotent)
  app.post('/admin/rollup', (c) => {
    const day = c.req.query('day') ?? dayKey(now());
    const result = runRollup(db, day);
    return c.json({ day, ...result });
  });

  app.notFound((c) => err(c, 404, 'NOT_FOUND', 'Not found.'));
  app.onError((e, c) => {
    console.error(e);
    return err(c, 500, 'INTERNAL', 'Something went wrong.');
  });
  return app;
}
