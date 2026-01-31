/**
 * DataService Unit Tests
 * @module tests/unit/config/DataService.test
 *
 * Tests for the hierarchical DataService API that provides:
 * - dataService.user.read/write(path, username?)
 * - dataService.household.read/write(path, hid?)
 * - dataService.system.read/write(path)
 */

import { createTestConfigService } from '#backend/src/0_system/config/index.mjs';
import { DataService } from '#backend/src/0_system/config/DataService.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

// Mock config for unit tests (no I/O)
const mockConfig = {
  system: {
    dataDir: '/data',
    configDir: '/data/system',
    defaultHouseholdId: 'home',
    timezone: 'America/Los_Angeles',
  },
  households: {
    home: {
      _folderName: 'household',
      head: 'alice',
      users: ['alice', 'bob'],
      timezone: 'America/New_York',
    },
    secondary: {
      _folderName: 'household-secondary',
      head: 'charlie',
      users: ['charlie'],
    },
  },
  users: {
    alice: { name: 'Alice', household_id: 'home' },
    bob: { name: 'Bob', household_id: 'home' },
    charlie: { name: 'Charlie', household_id: 'secondary' },
  },
};

describe('DataService', () => {
  let configService;
  let dataService;

  beforeEach(() => {
    configService = createTestConfigService(mockConfig);
    dataService = new DataService({ configService });
  });

  describe('constructor', () => {
    test('throws InfrastructureError when configService is missing', () => {
      expect(() => new DataService({})).toThrow(InfrastructureError);
      expect(() => new DataService()).toThrow(InfrastructureError);
    });

    test('accepts configService in constructor', () => {
      const ds = new DataService({ configService });
      expect(ds).toBeDefined();
    });
  });

  describe('API structure', () => {
    test('has user sub-object with read and write functions', () => {
      expect(dataService.user).toBeDefined();
      expect(typeof dataService.user.read).toBe('function');
      expect(typeof dataService.user.write).toBe('function');
    });

    test('has household sub-object with read and write functions', () => {
      expect(dataService.household).toBeDefined();
      expect(typeof dataService.household.read).toBe('function');
      expect(typeof dataService.household.write).toBe('function');
    });

    test('has system sub-object with read and write functions', () => {
      expect(dataService.system).toBeDefined();
      expect(typeof dataService.system.read).toBe('function');
      expect(typeof dataService.system.write).toBe('function');
    });
  });

  describe('path resolution', () => {
    describe('user paths', () => {
      test('resolves user path with explicit username', () => {
        const path = dataService.user.resolvePath('lifelog/nutrition', 'alice');
        expect(path).toBe('/data/users/alice/lifelog/nutrition.yml');
      });

      test('resolves user path with default user (head of household)', () => {
        const path = dataService.user.resolvePath('lifelog/nutrition');
        expect(path).toBe('/data/users/alice/lifelog/nutrition.yml');
      });

      test('auto-appends .yml extension when missing', () => {
        const path = dataService.user.resolvePath('auth/strava', 'bob');
        expect(path).toBe('/data/users/bob/auth/strava.yml');
      });

      test('preserves existing extension', () => {
        const path = dataService.user.resolvePath('data.json', 'alice');
        expect(path).toBe('/data/users/alice/data.json');
      });
    });

    describe('household paths', () => {
      test('resolves default household path (no hid suffix)', () => {
        const path = dataService.household.resolvePath('shared/weather');
        expect(path).toBe('/data/household/shared/weather.yml');
      });

      test('resolves secondary household path (with hid suffix)', () => {
        const path = dataService.household.resolvePath('shared/weather', 'secondary');
        expect(path).toBe('/data/household-secondary/shared/weather.yml');
      });

      test('auto-appends .yml extension when missing', () => {
        const path = dataService.household.resolvePath('apps/fitness/sessions');
        expect(path).toBe('/data/household/apps/fitness/sessions.yml');
      });
    });

    describe('system paths', () => {
      test('resolves system path', () => {
        const path = dataService.system.resolvePath('state/cron-runtime');
        expect(path).toBe('/data/system/state/cron-runtime.yml');
      });

      test('auto-appends .yml extension when missing', () => {
        const path = dataService.system.resolvePath('cache/api-responses');
        expect(path).toBe('/data/system/cache/api-responses.yml');
      });

      test('preserves existing extension', () => {
        const path = dataService.system.resolvePath('locks/scheduler.lock');
        expect(path).toBe('/data/system/locks/scheduler.lock');
      });
    });
  });
});
