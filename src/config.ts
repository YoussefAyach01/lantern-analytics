import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  ADMIN_TOKEN: z.string().min(16, 'ADMIN_TOKEN must be at least 16 chars'),
  DB_PATH: z.string().default('./data/lantern.db'),
  PUBLIC_URL: z.string().default('http://localhost:4100'),
  /** Set to "1" only behind a reverse proxy you control: then X-Forwarded-For is trusted. */
  TRUST_PROXY: z.enum(['0', '1']).default('0'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}

/** Per-api-key plan limits. Pricing/limits are proposed in BUSINESS.md, not final. */
export const PLANS = {
  free: { maxSites: 1, requestsPerMinPerSite: 120 },
  pro: { maxSites: 10, requestsPerMinPerSite: 1_200 },
} as const;
export type Plan = keyof typeof PLANS;
