import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { runRollup } from './rollup.js';
import { dayKey } from './dedup.js';

try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the real environment.
}
const config = loadConfig();
const db = openDb(config.DB_PATH);
const app = createApp({ config, db });

// Roll up today's (and, in case a tick was missed, yesterday's) events periodically.
// Idempotent (see rollup.ts), so overlapping/retried runs are harmless.
function rollupNow() {
  const now = new Date();
  runRollup(db, dayKey(now));
  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  runRollup(db, dayKey(yesterday));
}
setInterval(rollupNow, 60_000).unref();
rollupNow();

serve({ fetch: app.fetch, port: config.PORT }, (i) =>
  console.log(`lantern-analytics listening on :${i.port}`),
);
