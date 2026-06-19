import { describe, it, expect } from 'vitest';
import {
  formatPeopleList, getTimeOfDayLabel, formatDayPeriod, buildPhotoTitle, formatPhotoDate,
  orderPeopleByFace,
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

describe('orderPeopleByFace', () => {
  // A person with one face box, in raw 2000×1000 sensor space.
  const person = (name, x1, x2, over = {}) => ({
    name,
    faces: [{ boundingBoxX1: x1, boundingBoxX2: x2, boundingBoxY1: over.y1 ?? 0,
      boundingBoxY2: over.y2 ?? 100, imageWidth: 2000, imageHeight: 1000 }],
  });
  const names = (arr) => arr.map((p) => p.name);

  it('orders names left-to-right by face center X (normal orientation)', () => {
    const right = person('Right', 1600, 1800);
    const left = person('Left', 100, 300);
    const mid = person('Mid', 900, 1100);
    expect(names(orderPeopleByFace([right, mid, left], 1))).toEqual(['Left', 'Mid', 'Right']);
  });

  it('sorts people with no face box last, preserving their original order', () => {
    const a = person('A', 1500, 1700);
    const noFaceX = { name: 'NoFaceX', faces: [] };
    const noFaceY = { name: 'NoFaceY' };
    const b = person('B', 200, 400);
    const out = names(orderPeopleByFace([a, noFaceX, noFaceY, b], 1));
    expect(out).toEqual(['B', 'A', 'NoFaceX', 'NoFaceY']);
  });

  it('projects through a 90° CW orientation (raw-Y drives display-X)', () => {
    // Orientation 6: display-X = imageHeight - centerY. Lower raw-Y ⇒ further right.
    const top = person('Top', 0, 100, { y1: 100, y2: 200 });      // small Y → right
    const bottom = person('Bottom', 0, 100, { y1: 800, y2: 900 }); // large Y → left
    expect(names(orderPeopleByFace([top, bottom], 6))).toEqual(['Bottom', 'Top']);
  });

  it('uses the leftmost face when a person has several', () => {
    const multi = { name: 'Multi', faces: [
      { boundingBoxX1: 1800, boundingBoxX2: 1900, boundingBoxY1: 0, boundingBoxY2: 100, imageWidth: 2000, imageHeight: 1000 },
      { boundingBoxX1: 50, boundingBoxX2: 150, boundingBoxY1: 0, boundingBoxY2: 100, imageWidth: 2000, imageHeight: 1000 },
    ] };
    const other = person('Other', 800, 900);
    expect(names(orderPeopleByFace([other, multi], 1))).toEqual(['Multi', 'Other']);
  });

  it('returns [] / passthrough for empty or missing input', () => {
    expect(orderPeopleByFace([], 1)).toEqual([]);
    expect(orderPeopleByFace(null, 1)).toEqual([]);
  });

  // ImmichAdapter.getViewable curates faces to {x1,y1,x2,y2} (the shape the
  // frontend ImageFrame depends on), while the raw client gives boundingBoxX1…
  // The helper must order either shape so /home/photo and the art path agree.
  it('also accepts the adapter-curated face shape (x1/x2)', () => {
    const curated = (name, x1, x2) => ({
      name,
      faces: [{ x1, x2, y1: 0, y2: 100, imageWidth: 2000, imageHeight: 1000 }],
    });
    const right = curated('Right', 1600, 1800);
    const left = curated('Left', 100, 300);
    const mid = curated('Mid', 900, 1100);
    expect(names(orderPeopleByFace([right, mid, left], 1))).toEqual(['Left', 'Mid', 'Right']);
  });
});
