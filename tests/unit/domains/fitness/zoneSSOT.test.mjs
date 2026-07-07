// tests/unit/domains/fitness/zoneSSOT.test.mjs
//
// Audit X-5: the fitness domain shipped TWO disagreeing default zone-threshold
// sets — ZoneService.getDefaultThresholds (hot = 0.8·maxHr, fire = 0.9) vs
// Zone.createDefaultZones (hot = 0.7, fire = 0.85). This suite pins the domain
// as the single source of truth: ZoneService's default thresholds must agree with
// the Zone entity's default zones for every zone, there must be exactly one
// ZONE_ORDER, and zone colors must come from one domain palette.
import { ZoneService } from '#domains/fitness/services/ZoneService.mjs';
import {
  ZONE_ORDER,
  ZONE_NAMES,
  createDefaultZones,
  getDefaultThresholds,
  ZONE_COLORS,
} from '#domains/fitness/entities/Zone.mjs';

describe('Zone SSOT (audit X-5)', () => {
  const service = new ZoneService();

  test('ZONE_ORDER is the single canonical ordered zone set', () => {
    expect(ZONE_ORDER).toEqual(['cool', 'active', 'warm', 'hot', 'fire']);
    // Order literal and the value-object name list must be the same source.
    expect([...ZONE_ORDER]).toEqual([...ZONE_NAMES]);
  });

  test.each([185, 200, 190])(
    'ZoneService default thresholds agree with Zone entity defaults for every zone (maxHr=%i)',
    (maxHr) => {
      const thresholds = service.getDefaultThresholds(maxHr);
      const zones = createDefaultZones(maxHr);
      for (const name of ZONE_ORDER) {
        // A threshold value is the HR at which that zone begins == entity minHr.
        expect(thresholds[name]).toBe(zones[name].minHr);
      }
    }
  );

  test('ZoneService.getDefaultThresholds delegates to the domain function', () => {
    expect(service.getDefaultThresholds(200)).toEqual(getDefaultThresholds(200));
  });

  test('resolveZone with default thresholds lands in the entity band for each zone', () => {
    // service.resolveZone() with no thresholds falls back to getDefaultThresholds(185),
    // so sample the entity bands at the same maxHr to prove they align.
    const maxHr = 185;
    const zones = createDefaultZones(maxHr);
    for (const name of ZONE_ORDER) {
      const z = zones[name];
      const sample = name === 'fire' ? z.minHr + 5 : Math.round((z.minHr + z.maxHr) / 2);
      expect(service.resolveZone(sample)).toBe(name);
    }
  });

  test('zone colors resolve from one domain palette', () => {
    for (const name of ZONE_ORDER) {
      expect(service.getZoneColor(name)).toBe(ZONE_COLORS[name]);
    }
  });
});
