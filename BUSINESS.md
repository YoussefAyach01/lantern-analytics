# BUSINESS: lantern-analytics

**Buyer:** GDPR-conscious small businesses/freelancers (same buyer segment as
`agency-kit`/`site-kit`) who need "how many people visit my site" without a cookie
consent banner, plus developers/agencies who want a cheap, self-hosted alternative
to Plausible/Fathom/Simple Analytics and are fine running it on their own box.
**Problem:** Google Analytics requires a consent banner (cookies + IP processing)
and hands visitor data to Google. Plausible/Fathom solve the privacy problem but are
USD-subscription SaaS with no self-host-for-free tier at meaningful traffic, and
Youssef's portfolio has no analytics/BI product and no AWS-deployable infrastructure
— this closes both gaps with one product (see the `_factory` STATUS/PLAN entries).

## Pricing — PROPOSED, needs Youssef's confirmation before quoting anyone

Two tiers, deliberately simple (see `src/config.ts`'s `PLANS` for what's actually
enforced in code today — just `maxSites`):

| Plan | Sites | Price                                     | Notes                                                                                   |
| ---- | ----- | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| Free | 1     | $0                                        | Self-hosted on your own box; no data retention cap enforced yet.                        |
| Pro  | 10    | $9/mo or $79/yr (~90 MAD/mo, ~790 MAD/yr) | Same self-hosted deployment, higher `maxSites`; no separate hosted offering exists yet. |

**These numbers are placeholders, not researched against Plausible ($9-19/mo) or
Fathom ($14+/mo) — Youssef should sanity-check them against those before quoting a
real customer.** Because this is self-hosted (the buyer runs their own EC2 instance),
"pricing" in practice today means either (a) a one-time setup fee for deploying it on
a client's AWS account, or (b) Youssef hosting a few sites' worth on his own instance
and charging per-site, which the free/pro split above assumes but nothing here
automates billing for.

## First 5 customers

1. Offer it free to 2-3 existing `site-kit`/`agency-kit` web clients as a value-add
   ("see your visitor count, no cookie banner needed") — same playbook as
   `status-page`'s plan.
2. Post on r/selfhosted / Indie Hackers as "a Plausible alternative you can run on a
   $5 VPS" — that audience already wants exactly this trade (self-host, no cookie
   banner, own your data).
3. Pitch directly to 5-10 freelancers/agencies who already avoid Google Analytics for
   privacy reasons but found Plausible/Fathom too expensive for a single small site.

## Accounts needed to go live

- **An AWS account + IAM user**, to ever `terraform apply` the `infra/` module —
  does not exist yet for this project (confirmed with Youssef up front). Nothing in
  this repo needs it until that step; see `infra/README`-equivalent notes and
  `_factory/STATUS.md`.
- A domain, optional (Route 53 record is wired but skipped when no `zone_id` is
  supplied, same safety property as `do-vm-terraform`).
- A payment provider, only once real billing is wanted — nothing bills anyone today.

## Honest limits

- Self-hosted only; there's no multi-tenant hosted SaaS behind a single domain today
  — every buyer either runs their own instance or Youssef runs one instance per
  client (or shares one instance across a few trusted clients using the existing
  per-API-key site limit).
- No consent-banner legal opinion has been obtained; "no cookies/IP storage" is a
  real, tested property of the code, not a substitute for a lawyer confirming your
  specific jurisdiction's requirements.
- Crowded-ish niche (Plausible, Fathom, Simple Analytics, Umami are all established).
  The honest differentiators here are: genuinely zero persistent identifiers (even in
  memory, salted daily) rather than "no third-party cookies" marketing, AWS-native
  Terraform for buyers who specifically want to self-host on AWS, and a much simpler
  single-file SQLite deployment than Umami's Postgres requirement.
- See `README.md`'s "What's missing" section for the full technical gap list (no
  billing UI, in-memory rate limits, no email alerts, etc).
