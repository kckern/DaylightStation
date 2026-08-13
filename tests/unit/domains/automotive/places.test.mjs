// tests/unit/domains/automotive/places.test.mjs
//
// GeoFix refuses (0,0) because the firmware emits it as the pre-lock value of
// its coordinate struct, and persisted verbatim it reads as a plausible fix in
// the Gulf of Guinea — anchoring journey endpoints and drawing a map line
// across the Atlantic. Place resolution is what makes fill-up detection fall
// out of journey stitching for free, so its overlap behaviour is pinned too.

import { describe, it, expect } from 'vitest';
import { GeoFix } from '#domains/automotive/value-objects/GeoFix.mjs';
import { Place } from '#domains/automotive/value-objects/Place.mjs';
import { resolvePlace, isAtFuelStop } from '#domains/automotive/services/PlaceResolverService.mjs';

// Offset coordinates — never the household's real ones (feedback_no_pii_in_test_fixtures).
const HOME = new GeoFix({ lat: 47.0, lon: -122.0 });

describe('GeoFix', () => {
  it('refuses the (0,0) pre-lock placeholder', () => {
    expect(() => new GeoFix({ lat: 0, lon: 0 })).toThrow(/placeholder|null island/i);
    expect(GeoFix.fromRaw({ lat: 0, lon: 0 })).toBeNull();
  });

  it('accepts a real coordinate that merely contains a zero', () => {
    // Only BOTH being zero is the sentinel; the equator and prime meridian are real.
    expect(new GeoFix({ lat: 0, lon: -122.0 }).lat).toBe(0);
  });

  it('refuses out-of-range and non-finite values', () => {
    expect(() => new GeoFix({ lat: 91, lon: 0 })).toThrow(/range/i);
    expect(() => new GeoFix({ lat: NaN, lon: 0 })).toThrow(/finite/i);
    expect(GeoFix.fromRaw(null)).toBeNull();
    expect(GeoFix.fromRaw({ lat: 'x', lon: 'y' })).toBeNull();
  });

  it('measures great-circle distance', () => {
    // One degree of latitude is ~111.19 km.
    const north = new GeoFix({ lat: 48.0, lon: -122.0 });
    expect(HOME.distanceKmTo(north)).toBeCloseTo(111.19, 1);
  });

  it('is immutable', () => {
    const fix = new GeoFix({ lat: 47, lon: -122 });
    expect(Object.isFrozen(fix)).toBe(true);
  });
});

describe('Place', () => {
  const home = new Place({ id: 'home', label: 'Home', fix: HOME, radiusM: 120, kind: 'home' });

  it('contains a fix inside its radius', () => {
    // ~50 m north.
    expect(home.contains(new GeoFix({ lat: 47.00045, lon: -122.0 }))).toBe(true);
  });

  it('excludes a fix outside its radius', () => {
    // ~550 m north.
    expect(home.contains(new GeoFix({ lat: 47.005, lon: -122.0 }))).toBe(false);
  });

  it('rejects an unknown kind so a places.yml typo surfaces at load', () => {
    expect(() => new Place({ id: 'x', fix: HOME, kind: 'gas-station' })).toThrow(/kind/i);
  });

  it('flags fuel places, which is what drives fill-up detection', () => {
    expect(new Place({ id: 'costco', fix: HOME, kind: 'fuel' }).isFuelStop).toBe(true);
    expect(home.isFuelStop).toBe(false);
  });
});

describe('resolvePlace', () => {
  const centre = new Place({ id: 'plaza', label: 'Shopping plaza', fix: HOME, radiusM: 500, kind: 'store' });
  const pump = new Place({
    id: 'pump', label: 'Costco Gas', kind: 'fuel', radiusM: 80,
    fix: new GeoFix({ lat: 47.001, lon: -122.0 }),
  });

  it('picks the nearest centre when places overlap', () => {
    // A fix at the pump sits inside both the pump and the enclosing plaza.
    // The specific place must win over the general one.
    const atPump = new GeoFix({ lat: 47.001, lon: -122.0 });
    expect(resolvePlace(atPump, [centre, pump]).id).toBe('pump');
  });

  it('falls back to the enclosing place outside the specific one', () => {
    const inPlaza = new GeoFix({ lat: 47.003, lon: -122.0 });
    expect(resolvePlace(inPlaza, [centre, pump]).id).toBe('plaza');
  });

  it('returns null for an unrecognised location rather than guessing', () => {
    const away = new GeoFix({ lat: 48.5, lon: -122.0 });
    expect(resolvePlace(away, [centre, pump])).toBeNull();
  });

  it('returns null for a missing fix or empty registry', () => {
    expect(resolvePlace(null, [centre])).toBeNull();
    expect(resolvePlace(HOME, [])).toBeNull();
  });

  it('answers the fuel-stop question directly', () => {
    expect(isAtFuelStop(new GeoFix({ lat: 47.001, lon: -122.0 }), [centre, pump])).toBe(true);
    expect(isAtFuelStop(new GeoFix({ lat: 47.003, lon: -122.0 }), [centre, pump])).toBe(false);
  });
});
