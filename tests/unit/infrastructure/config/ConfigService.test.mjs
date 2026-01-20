// tests/unit/infrastructure/config/ConfigService.test.mjs
import { ConfigService } from '../../../../backend/src/0_infrastructure/config/ConfigService.mjs';

describe('ConfigService', () => {
  let config;
  let service;

  beforeEach(() => {
    config = {
      system: {
        defaultHouseholdId: 'household1',
        timezone: 'America/New_York',
        dataDir: '/data',
        configDir: '/config'
      },
      secrets: {
        API_KEY: 'secret123',
        DB_PASSWORD: 'dbpass'
      },
      households: {
        household1: {
          head: 'john',
          users: ['john', 'jane'],
          timezone: 'America/Los_Angeles'
        }
      },
      users: {
        john: { name: 'John Doe', household_id: 'household1' },
        jane: { name: 'Jane Doe', household_id: 'household1' }
      },
      identityMappings: {
        telegram: { '12345': 'john' },
        garmin: { '67890': 'jane' }
      },
      auth: {
        users: {
          john: { strava: { token: 'strava_token' } }
        },
        households: {
          household1: { plex: { url: 'http://plex.local' } }
        }
      },
      apps: {
        fitness: { zones: { cool: 100, warm: 140 } }
      }
    };
    service = new ConfigService(config);
  });

  describe('secrets', () => {
    test('getSecret returns secret value', () => {
      expect(service.getSecret('API_KEY')).toBe('secret123');
    });

    test('getSecret returns null for missing secret', () => {
      expect(service.getSecret('NONEXISTENT')).toBeNull();
    });
  });

  describe('households', () => {
    test('getDefaultHouseholdId returns default', () => {
      expect(service.getDefaultHouseholdId()).toBe('household1');
    });

    test('getHeadOfHousehold returns head', () => {
      expect(service.getHeadOfHousehold()).toBe('john');
    });

    test('getHouseholdUsers returns users array', () => {
      expect(service.getHouseholdUsers('household1')).toEqual(['john', 'jane']);
    });

    test('getHouseholdTimezone returns household timezone', () => {
      expect(service.getHouseholdTimezone('household1')).toBe('America/Los_Angeles');
    });

    test('getUserHouseholdId returns user household', () => {
      expect(service.getUserHouseholdId('john')).toBe('household1');
    });
  });

  describe('users', () => {
    test('getUserProfile returns user profile', () => {
      expect(service.getUserProfile('john')).toEqual({
        name: 'John Doe',
        household_id: 'household1'
      });
    });

    test('getUserProfile returns null for missing user', () => {
      expect(service.getUserProfile('nonexistent')).toBeNull();
    });

    test('getAllUserProfiles returns Map of users', () => {
      const profiles = service.getAllUserProfiles();
      expect(profiles).toBeInstanceOf(Map);
      expect(profiles.size).toBe(2);
    });

    test('resolveUsername resolves platform identity', () => {
      expect(service.resolveUsername('telegram', '12345')).toBe('john');
      expect(service.resolveUsername('garmin', '67890')).toBe('jane');
    });
  });

  describe('auth', () => {
    test('getUserAuth returns user service auth', () => {
      expect(service.getUserAuth('strava', 'john')).toEqual({ token: 'strava_token' });
    });

    test('getHouseholdAuth returns household service auth', () => {
      expect(service.getHouseholdAuth('plex', 'household1')).toEqual({
        url: 'http://plex.local'
      });
    });
  });

  describe('apps', () => {
    test('getAppConfig returns app config', () => {
      expect(service.getAppConfig('fitness')).toEqual({
        zones: { cool: 100, warm: 140 }
      });
    });

    test('getAppConfig with path returns nested value', () => {
      expect(service.getAppConfig('fitness', 'zones.cool')).toBe(100);
    });

    test('getAppConfig returns null for missing app', () => {
      expect(service.getAppConfig('nonexistent')).toBeNull();
    });
  });

  describe('paths', () => {
    test('getDataDir returns data directory', () => {
      expect(service.getDataDir()).toBe('/data');
    });

    test('getUserDir returns user directory', () => {
      expect(service.getUserDir('john')).toBe('/data/users/john');
    });

    test('getConfigDir returns config directory', () => {
      expect(service.getConfigDir()).toBe('/config');
    });
  });

  describe('isReady', () => {
    test('always returns true', () => {
      expect(service.isReady()).toBe(true);
    });
  });
});
