import { describe, it, expect } from 'vitest';
import {
  formatPeopleList, getTimeOfDayLabel, formatDayPeriod, buildPhotoTitle, formatPhotoDate,
} from '../../../backend/src/1_adapters/content/gallery/immich/photoLabels.mjs';

// Shared Immich label helpers (used by ImmichFeedAdapter + art/immichSource).
const ISO = '2025-06-15T17:30:00Z';

describe('formatPeopleList', () => {
  it('formats 1, 2, and 3+ names', () => {
    expect(formatPeopleList(['A'])).toBe('A');
    expect(formatPeopleList(['A', 'B'])).toBe('A and B');
    expect(formatPeopleList(['A', 'B', 'C'])).toBe('A, B, and C');
  });
  it('caps at five names, rolling the rest into "and N others"', () => {
    expect(formatPeopleList(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C, D, and E');       // exactly 5: all named
    expect(formatPeopleList(['A', 'B', 'C', 'D', 'E', 'F'])).toBe('A, B, C, D, E, and 1 other');
    expect(formatPeopleList(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])).toBe('A, B, C, D, E, and 3 others');
  });
});

describe('buildPhotoTitle', () => {
  it('people + location → "names • location"', () => {
    expect(buildPhotoTitle(['Bob', 'Bill', 'Biff'], 'New York City', ISO))
      .toBe('Bob, Bill, and Biff • New York City');
  });
  it('people only → names', () => {
    expect(buildPhotoTitle(['Alice', 'Bob'], null, ISO)).toBe('Alice and Bob');
  });
  it('no people, location + date → "{period} in location"', () => {
    expect(buildPhotoTitle([], 'Seattle', ISO)).toMatch(/^.+ in Seattle$/);
  });
  it('no people, location only → location', () => {
    expect(buildPhotoTitle([], 'Seattle', null)).toBe('Seattle');
  });
  it('no people/location, date only → "Weekday Period"', () => {
    expect(buildPhotoTitle([], null, ISO))
      .toMatch(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday) (Late Night|Morning|Mid-Morning|Lunchtime|Afternoon|Evening|Night)$/);
  });
  it('nothing → "Memory"', () => {
    expect(buildPhotoTitle([], null, null)).toBe('Memory');
  });
  it('ignores blank names', () => {
    expect(buildPhotoTitle(['', '  ', null], 'Paris', ISO)).toMatch(/ in Paris$/);
  });
});

describe('formatPhotoDate', () => {
  it('renders a full weekday-date-time string', () => {
    expect(formatPhotoDate(ISO)).toMatch(/^\w{3} 15 Jun, 2025 \d{1,2}:\d{2}(am|pm)$/);
  });
  it('null for a missing date, "Memory" for an unparseable one', () => {
    expect(formatPhotoDate(null)).toBeNull();
    expect(formatPhotoDate('not-a-date')).toBe('Memory');
  });
  // The 3am bug: localDateTime is wall-clock serialized with a `Z`; reading it with
  // UTC getters renders it verbatim regardless of the server timezone. Reading with
  // local getters re-applied the host offset and a 10am photo printed as 3am.
  it('renders wall-clock verbatim (TZ-independent), not shifted by server offset', () => {
    expect(formatPhotoDate('2026-06-14T17:26:17.743Z')).toBe('Sun 14 Jun, 2026 5:26pm');
    expect(formatPhotoDate('2026-06-14T10:00:00.000Z')).toBe('Sun 14 Jun, 2026 10:00am');
    expect(formatPhotoDate('2026-06-14T00:05:00.000Z')).toBe('Sun 14 Jun, 2026 12:05am');
  });
});

describe('getTimeOfDayLabel / formatDayPeriod', () => {
  it('null on bad input; a label on good input', () => {
    expect(getTimeOfDayLabel('nope')).toBeNull();
    expect(getTimeOfDayLabel(ISO)).toMatch(/Night|Morning|Lunchtime|Afternoon|Evening/);
  });
  it('formatDayPeriod is "Weekday Period" or "Memory"', () => {
    expect(formatDayPeriod('nope')).toBe('Memory');
    // 2025-06-15T17:30Z → Sunday, 17h UTC → Evening (deterministic, TZ-independent).
    expect(formatDayPeriod(ISO)).toBe('Sunday Evening');
  });
});
