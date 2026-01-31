// tests/unit/domains/fitness/entities/Zone.test.mjs
import {
  Zone,
  ZONE_NAMES,
  ZONE_PRIORITY,
  resolveZone,
  getHigherZone,
  createDefaultZones
} from '#domains/fitness/entities/Zone.mjs';

describe('Zone', () => {
  describe('ZONE_NAMES', () => {
    test('contains all zone names', () => {
      expect(ZONE_NAMES).toEqual(['cool', 'active', 'warm', 'hot', 'fire']);
    });
  });

  describe('ZONE_PRIORITY', () => {
    test('assigns correct priorities', () => {
      expect(ZONE_PRIORITY.cool).toBe(0);
      expect(ZONE_PRIORITY.active).toBe(1);
      expect(ZONE_PRIORITY.warm).toBe(2);
      expect(ZONE_PRIORITY.hot).toBe(3);
      expect(ZONE_PRIORITY.fire).toBe(4);
    });
  });

  describe('Zone class', () => {
    let zone;

    beforeEach(() => {
      zone = new Zone({
        name: 'warm',
        minHr: 120,
        maxHr: 140,
        color: '#F59E0B'
      });
    });

    test('creates zone with properties', () => {
      expect(zone.name).toBe('warm');
      expect(zone.minHr).toBe(120);
      expect(zone.maxHr).toBe(140);
      expect(zone.color).toBe('#F59E0B');
    });

    test('throws for invalid zone name', () => {
      expect(() => new Zone({ name: 'invalid', minHr: 0, maxHr: 100 }))
        .toThrow('Invalid zone name');
    });

    test('getPriority returns correct priority', () => {
      expect(zone.getPriority()).toBe(2);
    });

    test('containsHeartRate works correctly', () => {
      expect(zone.containsHeartRate(130)).toBe(true);
      expect(zone.containsHeartRate(120)).toBe(true);
      expect(zone.containsHeartRate(140)).toBe(false);
      expect(zone.containsHeartRate(100)).toBe(false);
    });

    test('isHigherThan compares correctly', () => {
      const coolZone = new Zone({ name: 'cool', minHr: 0, maxHr: 100 });
      const hotZone = new Zone({ name: 'hot', minHr: 140, maxHr: 160 });

      expect(zone.isHigherThan(coolZone)).toBe(true);
      expect(zone.isHigherThan(hotZone)).toBe(false);
    });

    test('isLowerThan compares correctly', () => {
      const coolZone = new Zone({ name: 'cool', minHr: 0, maxHr: 100 });
      const hotZone = new Zone({ name: 'hot', minHr: 140, maxHr: 160 });

      expect(zone.isLowerThan(coolZone)).toBe(false);
      expect(zone.isLowerThan(hotZone)).toBe(true);
    });

    test('toJSON/fromJSON round-trips', () => {
      const json = zone.toJSON();
      const restored = Zone.fromJSON(json);
      expect(restored.name).toBe(zone.name);
      expect(restored.minHr).toBe(zone.minHr);
    });
  });

  describe('resolveZone', () => {
    const thresholds = {
      cool: 90,
      active: 110,
      warm: 130,
      hot: 150,
      fire: 170
    };

    test('returns cool for low heart rate', () => {
      expect(resolveZone(80, thresholds)).toBe('cool');
    });

    test('returns active for moderate heart rate', () => {
      expect(resolveZone(115, thresholds)).toBe('active');
    });

    test('returns warm for elevated heart rate', () => {
      expect(resolveZone(135, thresholds)).toBe('warm');
    });

    test('returns hot for high heart rate', () => {
      expect(resolveZone(155, thresholds)).toBe('hot');
    });

    test('returns fire for very high heart rate', () => {
      expect(resolveZone(175, thresholds)).toBe('fire');
    });
  });

  describe('getHigherZone', () => {
    test('returns higher priority zone', () => {
      expect(getHigherZone('cool', 'warm')).toBe('warm');
      expect(getHigherZone('hot', 'active')).toBe('hot');
      expect(getHigherZone('fire', 'fire')).toBe('fire');
    });
  });

  describe('createDefaultZones', () => {
    test('creates zones based on max heart rate', () => {
      const zones = createDefaultZones(200);
      expect(zones.cool).toBeDefined();
      expect(zones.fire).toBeDefined();
      expect(zones.cool.maxHr).toBe(100); // 200 * 0.5
    });
  });
});
