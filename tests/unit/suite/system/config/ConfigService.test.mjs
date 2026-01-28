/**
 * ConfigService Unit Tests - Household Path Resolution
 * @module tests/unit/suite/system/config/ConfigService.test
 */

import { ConfigService } from '#backend/src/0_system/config/ConfigService.mjs';

describe('ConfigService household paths', () => {
  describe('getHouseholdPath() with flat structure', () => {
    test('resolves flat structure paths', () => {
      const config = {
        system: { dataDir: '/data' },
        households: {
          default: { _folderName: 'household', name: 'Default' },
          jones: { _folderName: 'household-jones', name: 'Jones' },
        },
      };
      const service = new ConfigService(config);

      expect(service.getHouseholdPath('', 'default')).toBe('/data/household');
      expect(service.getHouseholdPath('', 'jones')).toBe('/data/household-jones');
      expect(service.getHouseholdPath('apps/fitness', 'default')).toBe('/data/household/apps/fitness');
    });

    test('uses default household when householdId not provided', () => {
      const config = {
        system: { dataDir: '/data', defaultHouseholdId: 'default' },
        households: {
          default: { _folderName: 'household', name: 'Default' },
        },
      };
      const service = new ConfigService(config);

      expect(service.getHouseholdPath('apps/fitness')).toBe('/data/household/apps/fitness');
    });
  });

  describe('getHouseholdPath() error handling', () => {
    test('throws error for non-existent household', () => {
      const config = {
        system: { dataDir: '/data' },
        households: {},
      };
      const service = new ConfigService(config);

      expect(() => service.getHouseholdPath('', 'nonexistent')).toThrow('Household not found: nonexistent');
    });

    test('throws error when default household does not exist', () => {
      const config = {
        system: { dataDir: '/data', defaultHouseholdId: 'missing' },
        households: {},
      };
      const service = new ConfigService(config);

      expect(() => service.getHouseholdPath('apps/fitness')).toThrow('Household not found: missing');
    });
  });

  describe('getHouseholdPath() fallback behavior', () => {
    test('uses householdId as folderName when _folderName not set', () => {
      const config = {
        system: { dataDir: '/data' },
        households: {
          myhouse: { name: 'My House' }, // No _folderName
        },
      };
      const service = new ConfigService(config);

      // Without _folderName, uses hid as folder name
      expect(service.getHouseholdPath('apps/fitness', 'myhouse')).toBe('/data/myhouse/apps/fitness');
    });
  });

  describe('householdExists()', () => {
    test('returns true for existing household', () => {
      const config = {
        system: {},
        households: { default: { name: 'Default' } },
      };
      const service = new ConfigService(config);

      expect(service.householdExists('default')).toBe(true);
    });

    test('returns false for non-existent household', () => {
      const config = {
        system: {},
        households: {},
      };
      const service = new ConfigService(config);

      expect(service.householdExists('fake')).toBe(false);
    });

    test('returns false when households is undefined', () => {
      const config = {
        system: {},
      };
      const service = new ConfigService(config);

      expect(service.householdExists('anything')).toBe(false);
    });
  });

  describe('getPrimaryHouseholdId()', () => {
    test('returns configured default household', () => {
      const config = {
        system: { defaultHouseholdId: 'jones' },
        households: { jones: { name: 'Jones' } },
      };
      const service = new ConfigService(config);

      expect(service.getPrimaryHouseholdId()).toBe('jones');
    });

    test('returns "default" when not configured', () => {
      const config = {
        system: {},
        households: {},
      };
      const service = new ConfigService(config);

      expect(service.getPrimaryHouseholdId()).toBe('default');
    });
  });

  describe('getAllHouseholdIds()', () => {
    test('returns all household IDs', () => {
      const config = {
        system: {},
        households: {
          default: { name: 'Default' },
          jones: { name: 'Jones' },
        },
      };
      const service = new ConfigService(config);

      expect(service.getAllHouseholdIds()).toEqual(['default', 'jones']);
    });

    test('returns empty array when no households', () => {
      const config = {
        system: {},
        households: {},
      };
      const service = new ConfigService(config);

      expect(service.getAllHouseholdIds()).toEqual([]);
    });

    test('returns empty array when households is undefined', () => {
      const config = {
        system: {},
      };
      const service = new ConfigService(config);

      expect(service.getAllHouseholdIds()).toEqual([]);
    });
  });
});
