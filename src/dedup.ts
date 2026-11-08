import { createHash, randomBytes } from 'node:crypto';

/** UTC calendar day, e.g. "2026-11-08". The salt rotates on this boundary. */
export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface SessionDedupOptions {
  now?: () => Date;
  /** Injectable for deterministic tests; defaults to a real random salt. */
  randomSalt?: () => string;
}

/**
 * Cookieless session/bot dedup.
 *
 * Core privacy property: the only state kept is an in-process `Set` of
 * `${salt}:${siteId}:${ip}:${ua}` SHA-256 hashes for the *current UTC day*. Nothing
 * here is ever written to disk — `openDb`/`events` has no column for it (see db.ts).
 * The salt is random and generated fresh every UTC day, and the whole set is thrown
 * away on rotation, so:
 *   - the same visitor hashes differently from one day to the next (no cross-day
 *     tracking, and a restart loses all history anyway since nothing persists),
 *   - an attacker who somehow read process memory on day N learns nothing usable
 *     to re-identify the same visitor on day N+1.
 *
 * `isNewVisit` returns true the first time a given (site, ip, ua) hash is seen in the
 * current day — that's counted as a new "visit" (session). Every later pageview in
 * the same day from the same hash returns false and is counted as a pageview only.
 */
export class SessionDedup {
  private day: string;
  private salt: string;
  private seen = new Set<string>();
  private readonly now: () => Date;
  private readonly randomSalt: () => string;

  constructor(opts: SessionDedupOptions = {}) {
    this.now = opts.now ?? (() => new Date());
    this.randomSalt = opts.randomSalt ?? (() => randomBytes(16).toString('hex'));
    this.day = dayKey(this.now());
    this.salt = this.randomSalt();
  }

  private rotateIfNeeded(): void {
    const today = dayKey(this.now());
    if (today !== this.day) {
      this.day = today;
      this.salt = this.randomSalt();
      this.seen = new Set();
    }
  }

  /** Never persisted — exposed only so tests can assert rotation, not for storage. */
  hashFor(siteId: string, ip: string, ua: string): string {
    this.rotateIfNeeded();
    return createHash('sha256').update(`${this.salt}:${siteId}:${ip}:${ua}`).digest('hex');
  }

  isNewVisit(siteId: string, ip: string, ua: string): boolean {
    this.rotateIfNeeded();
    const hash = this.hashFor(siteId, ip, ua);
    const key = `${siteId}:${hash}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }

  /** Current UTC day the dedup set belongs to; for diagnostics/tests only. */
  currentDay(): string {
    this.rotateIfNeeded();
    return this.day;
  }
}

const MOBILE_RE = /Mobi|Android(?!.*Tablet)|iPhone/i;
const TABLET_RE = /iPad|Tablet|Android(?=.*Tablet)/i;

export type DeviceClass = 'desktop' | 'mobile' | 'tablet' | 'other';

export function classifyDevice(userAgent: string | null | undefined): DeviceClass {
  if (!userAgent) return 'other';
  if (TABLET_RE.test(userAgent)) return 'tablet';
  if (MOBILE_RE.test(userAgent)) return 'mobile';
  if (/Mozilla|Chrome|Safari|Firefox|Edg/i.test(userAgent)) return 'desktop';
  return 'other';
}
