# lantern-analytics

A cookieless, privacy-first web analytics tool: a <2KB tracking snippet, an ingest
API, and a server-rendered dashboard. No cookies, no IP storage, no persistent
fingerprint — ever. Self-hostable on your own box instead of handing visitor data to
Google Analytics.

## How it's different

Most "lightweight" analytics tools still write _something_ identifying to disk (a
hashed cookie, a stored IP, a long-lived fingerprint) so they can tell repeat
pageviews from new sessions. This one doesn't:

- Session dedup (same visitor browsing multiple pages = one "visit", many
  "pageviews") is computed from an **in-memory-only**, **daily-salted** hash of
  `IP + User-Agent`. The hash is never written to any column, file, or log — see
  `src/dedup.ts`. The salt (and the whole set of hashes seen "today") is thrown away
  and regenerated every UTC midnight, so even in memory nothing links one day's
  visitors to the next.
- `src/db.ts`'s `events` table has **no column** for IP address, cookie id, or any
  fingerprint — only `path`, `referrer_host`, `device_class`, and a `0/1` flag
  (`is_new_visit`) that's the _result_ of the in-memory check above, never the hash
  itself.
- This is enforced in code (schema + tests), not just claimed in this README — see
  `tests/collect.test.ts`'s "privacy" test, which serializes a real event row and
  asserts the IP/UA never appear in it.

## Architecture

```
public/t.js        the tracking snippet (<2KB): fires on load + SPA route changes
                    (history.pushState hook) via navigator.sendBeacon
src/db.ts           schema: api_keys -> sites -> events, + a daily_stats rollup table
src/dedup.ts        the hard part: in-memory daily-salted session/bot dedup
src/collect.ts      POST /api/collect: validates + writes one event row
src/rollup.ts       idempotent recompute of daily_stats from raw events
src/stats.ts        read queries the dashboard uses
src/dashboard.ts    server-rendered HTML dashboard (no client framework)
src/sites.ts        site CRUD + the public (non-secret) per-site token
src/keys.ts         API key issuance/lookup (SHA-256 hashed, shown once)
src/ratelimit.ts    fixed-window in-memory rate limiter
src/app.ts          Hono wiring: routes, auth, rate limits, security headers
src/server.ts       entrypoint + periodic rollup
```

Multi-tenant shape: one `api_key` owns many `sites`; each `site` has a public
`site_token` embedded in its snippet (it has to be public — the snippet runs in the
visitor's browser) and is only ever reachable for _writes_ (`/api/collect`). Reading
a site's data (the dashboard, `/api/sites`) always requires the owning `x-api-key`.

## Run locally

```bash
npm install
cp .env.example .env     # edit ADMIN_TOKEN at minimum
npm run dev               # http://localhost:4100
```

Issue yourself an API key (admin-only call):

```bash
curl -X POST http://localhost:4100/admin/keys \
  -H "authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"label":"my site","plan":"free"}'
# => { "key": "lntk_...", ... }  -- save the key, it is shown once
```

Create a site with that key:

```bash
curl -X POST http://localhost:4100/api/sites \
  -H "x-api-key: lntk_..." -H "content-type: application/json" \
  -d '{"name":"My Blog","domain":"myblog.example"}'
# => { "siteToken": "lnts_...", "embedSnippet": "<script defer src=...>...", "dashboardUrl": ... }
```

Paste the returned `embedSnippet` into your site, right before `</body>`. View the
dashboard at `http://localhost:4100/dashboard/<siteId>` with your `x-api-key` header
(or just open it in a client that lets you set headers — a bookmarklet or browser
extension, since this is an API-key-gated page, not a cookie session).

## Development

```bash
npm run typecheck && npm run lint && npm run test
```

33 vitest tests cover: `SessionDedup`'s salt rotation at the UTC midnight boundary
and per-site/per-visitor scoping (the hard, test-worthy problem this product leans
on), `runRollup`'s idempotency (running it any number of times for the same day never
double-counts), the privacy guarantee above, API-key auth, cross-tenant isolation
(IDOR), no-oracle behavior on an unknown site token, and rate limiting.

## Deploy

See `infra/` for a Terraform module that provisions a single EC2 instance + Elastic
IP + Security Group on AWS (same shape as `../do-vm-terraform`'s DigitalOcean
module), and `Dockerfile` / `docker-compose.yml` for the container that instance
would run. **Status: Terraform-validated, not yet applied** — see
`infra/README` section below and `BUSINESS.md` for why.

```bash
docker compose up --build   # local parity check: same image the EC2 user-data runs
```

## What's missing / honest limits

- **Not yet deployed to real AWS.** No AWS account exists for this project yet; the
  Terraform module is validated (`fmt`, `validate`, `terraform test` against a mocked
  provider) but never `apply`'d. See `infra/` and `BUSINESS.md`.
- **Single SQLite file, single instance.** Fine for a handful to low hundreds of
  sites; not a multi-region or high-write-volume design. WAL mode is on, but there's
  no replication.
- **Rate limiters are in-memory, per-process.** They reset on restart and don't share
  state across multiple instances behind a load balancer.
- **No signup/billing UI.** API keys are minted by an admin curling `/admin/keys`;
  there is no self-serve flow, no Stripe integration, no dashboard login (the
  dashboard is reached with a bearer-style `x-api-key` header, not a session cookie).
- **No email/alerting**, no funnels/goals, no real-time view, no data export/CSV, no
  UTM parsing beyond keeping the raw query string in `path`.
- **Device classification is a simple User-Agent regex**, not a maintained database —
  it will misclassify unusual or future browsers/devices.
- **Referrer parsing is hostname-only** — no bot-crawler filtering beyond the
  dedup/rate-limit layer, so a UA-spoofing bot script will still "count" (same
  limitation most lightweight analytics tools have).
- **No GDPR/legal review** — the no-cookie/no-IP-storage property is real and tested,
  but "cookieless and GDPR-light" is not the same as "a lawyer confirmed this needs
  no consent banner in your jurisdiction." Say the honest thing to buyers.

## Accounts needed to go live

- An AWS account + IAM user (for `terraform apply`) — Youssef's to create; not needed
  for anything in this repo up to that point.
- A domain, if you want the dashboard/snippet reachable from a hostname rather than a
  raw instance IP (the Terraform module supports an optional Route 53 record once a
  `zone_id` is supplied).
- Nothing else: no payment provider is wired in yet (see `BUSINESS.md` for the
  proposed pricing, not yet charged anywhere).
