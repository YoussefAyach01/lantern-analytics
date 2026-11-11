import type { Site } from './sites.js';
import type { DayTotal, PathTotal, ReferrerTotal } from './stats.js';

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);

export interface DashboardData {
  site: Site;
  totals: { visits: number; pageviews: number };
  days: DayTotal[];
  paths: PathTotal[];
  referrers: ReferrerTotal[];
  publicUrl: string;
  rangeDays: number;
}

/** Server-rendered, script-free, mobile-first at 375px. Every dynamic value goes through esc(). */
export function renderDashboard(d: DashboardData): string {
  const maxPv = Math.max(1, ...d.days.map((x) => x.pageviews));
  const bars = d.days
    .map((day) => {
      // Height as a class, not an inline style: the page ships a strict CSP
      // (default-src 'self') that blocks style attributes, which left the chart blank.
      const h = Math.max(5, Math.round((day.pageviews / maxPv) * 20) * 5);
      return `<li class="bar h${h}" title="${esc(day.day)}: ${day.pageviews} views, ${day.visits} visits"><span class="sr">${esc(day.day)}: ${day.pageviews} views, ${day.visits} visits</span></li>`;
    })
    .join('');

  const pathRows = d.paths.length
    ? d.paths
        .map((p) => `<tr><td>${esc(p.path)}</td><td>${p.visits}</td><td>${p.pageviews}</td></tr>`)
        .join('')
    : '<tr><td colspan="3" class="quiet">No pageviews yet.</td></tr>';

  const refRows = d.referrers.length
    ? d.referrers
        .map(
          (r) =>
            `<tr><td>${r.referrerHost ? esc(r.referrerHost) : 'Direct / none'}</td><td>${r.visits}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="2" class="quiet">No referrers yet.</td></tr>';

  const snippet = `<script defer src="${esc(d.publicUrl)}/t.js" data-site="${esc(d.site.siteToken)}"></script>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.site.name)} · lantern-analytics</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="/dashboard.css">
</head>
<body>
<main class="wrap">
  <p class="brand">lantern-analytics</p>
  <h1>${esc(d.site.name)}</h1>
  <p class="domain">${esc(d.site.domain)}</p>

  <section class="totals" aria-label="Summary for the last ${d.rangeDays} days">
    <div class="stat"><span class="num">${d.totals.visits}</span><span class="label">visits</span></div>
    <div class="stat"><span class="num">${d.totals.pageviews}</span><span class="label">pageviews</span></div>
  </section>

  <section aria-labelledby="chart-h">
    <h2 id="chart-h">Last ${d.rangeDays} days</h2>
    <ol class="chart" aria-label="Daily pageviews">${bars}</ol>
  </section>

  <section aria-labelledby="paths-h">
    <h2 id="paths-h">Top pages</h2>
    <table>
      <thead><tr><th scope="col">Path</th><th scope="col">Visits</th><th scope="col">Pageviews</th></tr></thead>
      <tbody>${pathRows}</tbody>
    </table>
  </section>

  <section aria-labelledby="refs-h">
    <h2 id="refs-h">Top referrers</h2>
    <table>
      <thead><tr><th scope="col">Source</th><th scope="col">Visits</th></tr></thead>
      <tbody>${refRows}</tbody>
    </table>
  </section>

  <section aria-labelledby="embed-h">
    <h2 id="embed-h">Embed snippet</h2>
    <p class="quiet">Paste this once, right before <code>&lt;/body&gt;</code>:</p>
    <pre><code>${esc(snippet)}</code></pre>
  </section>

  <p class="foot">No cookies, no IP storage, no persistent fingerprint.</p>
</main>
</body>
</html>`;
}
