// tests/unit/domains/fitness/services/ZoneService.test.mjs
import { ZoneService } from '../../../../../backend/src/1_domains/fitness/services/ZoneService.mjs';

describe('ZoneService', () => {
  let service;

  beforeEach(() => {
    service = new ZoneService();
  });

  describe('resolveZone', () => {
    test('resolves zone for heart rate', () => {
      const thresholds = {
        cool: 90,
        active: 110,
        warm: 130,
        hot: 150,
        fire: 170
      };

      expect(service.resolveZone(80, thresholds)).toBe('cool');
      expect(service.resolveZone(115, thresholds)).toBe('active');
      expect(service.resolveZone(140, thresholds)).toBe('warm');
      expect(service.resolveZone(160, thresholds)).toBe('hot');
      expect(service.resolveZone(180, thresholds)).toBe('fire');
    });

    test('uses default thresholds if none provided', () => {
      const zone = service.resolveZone(120);
      expect(['cool', 'active', 'warm', 'hot', 'fire']).toContain(zone);
    });
  });

  describe('getGroupZone', () => {
    test('returns highest zone among participants', () => {
      const heartRates = {
        John: 140,
        Jane: 160,
        Bob: 120
      };
      const thresholds = {
        cool: 90,
        active: 110,
        warm: 130,
        hot: 150,
        fire: 170
      };

      expect(service.getGroupZone(heartRates, thresholds)).toBe('hot');
    });

    test('returns cool for empty heart rates', () => {
      expect(service.getGroupZone({})).toBe('cool');
    });

    test('ignores zero heart rates', () => {
      const heartRates = {
        John: 160,
        Jane: 0
      };
      const thresholds = {
        cool: 90,
        active: 110,
        warm: 130,
        hot: 150,
        fire: 170
      };

      expect(service.getGroupZone(heartRates, thresholds)).toBe('hot');
    });
  });

  describe('getZonePriority', () => {
    test('returns correct priorities', () => {
      expect(service.getZonePriority('cool')).toBe(0);
      expect(service.getZonePriority('fire')).toBe(4);
    });

    test('returns 0 for unknown zone', () => {
      expect(service.getZonePriority('unknown')).toBe(0);
    });
  });

  describe('compareZones', () => {
    test('compares zones correctly', () => {
      expect(service.compareZones('hot', 'cool')).toBeGreaterThan(0);
      expect(service.compareZones('cool', 'fire')).toBeLessThan(0);
      expect(service.compareZones('warm', 'warm')).toBe(0);
    });
  });

  describe('getDefaultThresholds', () => {
    test('creates thresholds from max HR', () => {
      const thresholds = service.getDefaultThresholds(200);
      expect(thresholds.cool).toBe(100);  // 200 * 0.5
      expect(thresholds.fire).toBe(180);  // 200 * 0.9
    });

    test('uses 185 as default max HR', () => {
      const thresholds = service.getDefaultThresholds();
      expect(thresholds.cool).toBe(93);  // 185 * 0.5 rounded
    });
  });

  describe('createZonesForDisplay', () => {
    test('creates zone objects', () => {
      const zones = service.createZonesForDisplay(200);
      expect(zones.cool).toBeDefined();
      expect(zones.fire).toBeDefined();
      expect(zones.warm.name).toBe('warm');
    });
  });

  describe('getZoneColor', () => {
    test('returns color for zone', () => {
      expect(service.getZoneColor('cool')).toBe('#3B82F6');
      expect(service.getZoneColor('fire')).toBe('#EF4444');
    });

    test('returns gray for unknown zone', () => {
      expect(service.getZoneColor('unknown')).toBe('#6B7280');
    });
  });
});
