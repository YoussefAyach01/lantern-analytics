import { describe, expect, it } from 'vitest';
import { SessionDedup, classifyDevice, dayKey } from '../src/dedup.js';

describe('dayKey', () => {
  it('formats a UTC calendar day', () => {
    expect(dayKey(new Date('2026-11-08T23:59:59.999Z'))).toBe('2026-11-08');
    expect(dayKey(new Date('2026-11-09T00:00:00.000Z'))).toBe('2026-11-09');
  });
});

describe('SessionDedup: dedup within a day', () => {
  it('counts the first (site, ip, ua) as a new visit, repeats as not-new', () => {
    const dedup = new SessionDedup({ now: () => new Date('2026-11-08T10:00:00Z') });
    expect(dedup.isNewVisit('site1', '1.2.3.4', 'UA-A')).toBe(true);
    expect(dedup.isNewVisit('site1', '1.2.3.4', 'UA-A')).toBe(false);
    expect(dedup.isNewVisit('site1', '1.2.3.4', 'UA-A')).toBe(false);
  });

  it('treats a different IP+UA as a different session', () => {
    const dedup = new SessionDedup({ now: () => new Date('2026-11-08T10:00:00Z') });
    expect(dedup.isNewVisit('site1', '1.2.3.4', 'UA-A')).toBe(true);
    expect(dedup.isNewVisit('site1', '5.6.7.8', 'UA-A')).toBe(true);
    expect(dedup.isNewVisit('site1', '1.2.3.4', 'UA-B')).toBe(true);
  });

  it('scopes dedup per site: same ip+ua is a new visit on each distinct site', () => {
    const dedup = new SessionDedup({ now: () => new Date('2026-11-08T10:00:00Z') });
    expect(dedup.isNewVisit('siteA', '1.2.3.4', 'UA-A')).toBe(true);
    expect(dedup.isNewVisit('siteB', '1.2.3.4', 'UA-A')).toBe(true);
    expect(dedup.isNewVisit('siteA', '1.2.3.4', 'UA-A')).toBe(false);
  });
});

describe('SessionDedup: hash rotation at the midnight (UTC) boundary', () => {
  it('rotates the salt and clears seen state exactly when the UTC day changes', () => {
    let clock = new Date('2026-11-08T23:59:59.900Z');
    const dedup = new SessionDedup({ now: () => clock });

    const hashBefore = dedup.hashFor('site1', '1.2.3.4', 'UA-A');
    expect(dedup.isNewVisit('site1', '1.2.3.4', 'UA-A')).toBe(true);
    // Repeat just before midnight: still the same day, so it's deduped.
    expect(dedup.isNewVisit('site1', '1.2.3.4', 'UA-A')).toBe(false);
    expect(dedup.currentDay()).toBe('2026-11-08');

    // Cross midnight.
    clock = new Date('2026-11-09T00:00:00.100Z');
    expect(dedup.currentDay()).toBe('2026-11-09');
    const hashAfter = dedup.hashFor('site1', '1.2.3.4', 'UA-A');

    // Same visitor, same site, but the hash is different post-rotation...
    expect(hashAfter).not.toBe(hashBefore);
    // ...and the same visitor counts as a brand-new visit on the new day, because the
    // whole in-memory `seen` set was discarded along with the old salt.
    expect(dedup.isNewVisit('site1', '1.2.3.4', 'UA-A')).toBe(true);
  });

  it('never rotates mid-day, however many times isNewVisit/hashFor are called', () => {
    let clock = new Date('2026-11-08T00:00:01Z');
    const dedup = new SessionDedup({ now: () => clock });
    const first = dedup.hashFor('site1', '9.9.9.9', 'UA-X');
    for (let h = 1; h < 23; h++) {
      clock = new Date(`2026-11-08T${String(h).padStart(2, '0')}:00:00Z`);
      expect(dedup.hashFor('site1', '9.9.9.9', 'UA-X')).toBe(first);
      expect(dedup.currentDay()).toBe('2026-11-08');
    }
  });

  it('uses a fresh random salt per day when none is injected (no accidental determinism)', () => {
    const d1 = new SessionDedup({ now: () => new Date('2026-11-08T00:00:00Z') });
    const d2 = new SessionDedup({ now: () => new Date('2026-11-08T00:00:00Z') });
    expect(d1.hashFor('site1', '1.1.1.1', 'UA')).not.toBe(d2.hashFor('site1', '1.1.1.1', 'UA'));
  });
});

describe('classifyDevice', () => {
  it('classifies common user agents', () => {
    expect(
      classifyDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit'),
    ).toBe('mobile');
    expect(classifyDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit Mobi')).toBe(
      'mobile',
    );
    expect(classifyDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit')).toBe(
      'tablet',
    );
    expect(
      classifyDevice(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari',
      ),
    ).toBe('desktop');
    expect(classifyDevice(null)).toBe('other');
    expect(classifyDevice('some-bot/1.0')).toBe('other');
  });
});
