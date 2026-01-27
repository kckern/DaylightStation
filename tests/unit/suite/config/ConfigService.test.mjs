/**
 * ConfigService Unit Tests
 * @module tests/unit/config/ConfigService.test
 */

import { fileURLToPath } from 'url';
import path from 'path';
import {
  createTestConfigService,
  createConfigService,
  initConfigService,
  getConfigService,
  resetConfigService,
  ConfigValidationError,
} from '#backend/src/0_system/config/index.mjs';
import { validateConfig } from '#backend/src/0_system/config/configValidator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

// Mock config for unit tests (no I/O)
const mockConfig = {
  system: {
    dataDir: '/data',
    configDir: '/data/system',
    defaultHouseholdId: 'home',
    timezone: 'America/Los_Angeles',
  },
  secrets: {
    OPENAI_API_KEY: 'sk-test-key',
    TELEGRAM_NUTRIBOT_TOKEN: 'bot-token',
  },
  households: {
    home: {
      head: 'alice',
      users: ['alice', 'bob'],
      timezone: 'America/New_York',
    },
  },
  users: {
    alice: {
      name: 'Alice',
      identities: { telegram: { user_id: '12345' } },
      household_id: 'home',
    },
    bob: { name: 'Bob' },
  },
  auth: {
    users: {
      alice: { strava: { token: 'strava-token' } },
    },
    households: {
      home: { plex: { token: 'plex-token' } },
    },
  },
  apps: {
    chatbots: { bots: { nutribot: { telegram_bot_id: '999' } } },
  },
  identityMappings: {
    telegram: { '12345': 'alice' },
  },
};

describe('ConfigService', () => {
  let svc;

  beforeEach(() => {
    svc = createTestConfigService(mockConfig);
  });

  describe('secrets', () => {
    test('returns secret by key', () => {
      expect(svc.getSecret('OPENAI_API_KEY')).toBe('sk-test-key');
    });

    test('returns null for missing secret', () => {
      expect(svc.getSecret('MISSING_KEY')).toBeNull();
    });
  });

  describe('households', () => {
    test('returns default household id', () => {
      expect(svc.getDefaultHouseholdId()).toBe('home');
    });

    test('returns head of household', () => {
      expect(svc.getHeadOfHousehold()).toBe('alice');
      expect(svc.getHeadOfHousehold('home')).toBe('alice');
    });

    test('returns null for unknown household', () => {
      expect(svc.getHeadOfHousehold('unknown')).toBeNull();
    });

    test('returns household users', () => {
      expect(svc.getHouseholdUsers('home')).toEqual(['alice', 'bob']);
    });

    test('returns empty array for unknown household', () => {
      expect(svc.getHouseholdUsers('unknown')).toEqual([]);
    });

    test('returns household timezone', () => {
      expect(svc.getHouseholdTimezone('home')).toBe('America/New_York');
    });

    test('falls back to system timezone', () => {
      const configNoHouseholdTz = {
        ...mockConfig,
        households: {
          home: { head: 'alice', users: ['alice'] }, // no timezone
        },
      };
      const svc2 = createTestConfigService(configNoHouseholdTz);
      expect(svc2.getHouseholdTimezone('home')).toBe('America/Los_Angeles');
    });
  });

  describe('users', () => {
    test('returns user profile', () => {
      expect(svc.getUserProfile('alice').name).toBe('Alice');
    });

    test('returns null for missing user', () => {
      expect(svc.getUserProfile('unknown')).toBeNull();
    });

    test('returns all user profiles as Map', () => {
      const profiles = svc.getAllUserProfiles();
      expect(profiles).toBeInstanceOf(Map);
      expect(profiles.size).toBe(2);
      expect(profiles.get('alice').name).toBe('Alice');
    });

    test('resolves username from platform identity', () => {
      expect(svc.resolveUsername('telegram', '12345')).toBe('alice');
      expect(svc.resolveUsername('telegram', 12345)).toBe('alice'); // number coercion
    });

    test('returns null for unknown identity', () => {
      expect(svc.resolveUsername('telegram', '99999')).toBeNull();
      expect(svc.resolveUsername('unknown_platform', '12345')).toBeNull();
    });

    test('returns user household id', () => {
      expect(svc.getUserHouseholdId('alice')).toBe('home');
    });

    test('falls back to default household id', () => {
      expect(svc.getUserHouseholdId('bob')).toBe('home');
    });
  });

  describe('auth', () => {
    test('returns user auth', () => {
      expect(svc.getUserAuth('strava', 'alice').token).toBe('strava-token');
    });

    test('uses head of household as default user', () => {
      expect(svc.getUserAuth('strava').token).toBe('strava-token');
    });

    test('returns null for missing user auth', () => {
      expect(svc.getUserAuth('unknown_service', 'alice')).toBeNull();
      expect(svc.getUserAuth('strava', 'bob')).toBeNull();
    });

    test('returns household auth', () => {
      expect(svc.getHouseholdAuth('plex', 'home').token).toBe('plex-token');
    });

    test('uses default household', () => {
      expect(svc.getHouseholdAuth('plex').token).toBe('plex-token');
    });

    test('returns null for missing household auth', () => {
      expect(svc.getHouseholdAuth('unknown_service', 'home')).toBeNull();
    });
  });

  describe('apps', () => {
    test('returns full app config', () => {
      const config = svc.getAppConfig('chatbots');
      expect(config.bots.nutribot.telegram_bot_id).toBe('999');
    });

    test('returns nested app config by path', () => {
      expect(svc.getAppConfig('chatbots', 'bots.nutribot.telegram_bot_id')).toBe('999');
    });

    test('returns null for missing app', () => {
      expect(svc.getAppConfig('unknown_app')).toBeNull();
    });

    test('returns null for missing path', () => {
      expect(svc.getAppConfig('chatbots', 'bots.unknown.id')).toBeNull();
    });
  });

  describe('paths', () => {
    test('returns data dir', () => {
      expect(svc.getDataDir()).toBe('/data');
    });

    test('returns config dir', () => {
      expect(svc.getConfigDir()).toBe('/data/system');
    });

    test('returns user dir', () => {
      expect(svc.getUserDir('alice')).toBe('/data/users/alice');
    });
  });

  describe('isReady', () => {
    test('always returns true', () => {
      expect(svc.isReady()).toBe(true);
    });
  });
});

describe('ConfigService integration', () => {
  test('loads config from fixtures directory', () => {
    const svc = createConfigService(fixturesDir);

    expect(svc.getDefaultHouseholdId()).toBe('test-household');
    expect(svc.getHeadOfHousehold()).toBe('testuser');
    expect(svc.getSecret('OPENAI_API_KEY')).toBe('sk-test-key-12345');
    expect(svc.getUserProfile('testuser').name).toBe('Test User');
    expect(svc.getHouseholdUsers('test-household')).toEqual(['testuser']);
    expect(svc.getAppConfig('chatbots', 'bots.nutribot.telegram_bot_id')).toBe('6898194425');
  });

  test('builds identity mappings from user profiles', () => {
    const svc = createConfigService(fixturesDir);

    expect(svc.resolveUsername('telegram', '12345')).toBe('testuser');
    expect(svc.resolveUsername('garmin', '67890')).toBe('testuser');
  });

  describe('services', () => {
    test('loads services from services.yml', () => {
      const svc = createConfigService(fixturesDir);
      const services = svc.getAllServices();
      expect(services.plex).toBeDefined();
      expect(services.plex.docker).toBe('plex');
      expect(services.plex['test-env']).toBe('localhost');
    });
  });

  describe('service resolution', () => {
    test('resolves service host for current environment', () => {
      // Set env for test
      const originalEnv = process.env.DAYLIGHT_ENV;
      process.env.DAYLIGHT_ENV = 'test-env';

      try {
        const svc = createConfigService(fixturesDir);
        const host = svc.resolveServiceHost('plex');
        expect(host).toBe('localhost');
      } finally {
        process.env.DAYLIGHT_ENV = originalEnv;
      }
    });

    test('returns null for unknown service', () => {
      const svc = createConfigService(fixturesDir);
      const host = svc.resolveServiceHost('unknown-service');
      expect(host).toBeNull();
    });
  });

  test('loads household integrations', () => {
    const svc = createConfigService(fixturesDir);
    const integrations = svc.getHouseholdIntegrations('test-household');
    expect(integrations).toBeDefined();
    expect(integrations.plex.service).toBe('plex');
    expect(integrations.plex.port).toBe(32400);
  });
});

describe('Singleton management', () => {
  beforeEach(() => {
    resetConfigService();
  });

  afterEach(() => {
    resetConfigService();
  });

  test('initConfigService initializes singleton', () => {
    const svc = initConfigService(fixturesDir);
    expect(svc.isReady()).toBe(true);
    expect(getConfigService()).toBe(svc);
  });

  test('initConfigService throws if already initialized', () => {
    initConfigService(fixturesDir);
    expect(() => initConfigService(fixturesDir)).toThrow('already initialized');
  });

  test('getConfigService throws if not initialized', () => {
    expect(() => getConfigService()).toThrow('not initialized');
  });

  test('resetConfigService allows re-initialization', () => {
    initConfigService(fixturesDir);
    resetConfigService();
    expect(() => getConfigService()).toThrow('not initialized');
    initConfigService(fixturesDir); // Should not throw
  });
});

describe('Validation errors', () => {
  test('throws ConfigValidationError for missing secrets', () => {
    const invalidConfig = {
      system: {
        dataDir: '/data',
        configDir: '/data/system',
        defaultHouseholdId: 'home',
        timezone: 'UTC',
      },
      secrets: {}, // Missing OPENAI_API_KEY
      households: {
        home: { head: 'alice', users: ['alice'] },
      },
      users: {
        alice: { name: 'Alice' },
      },
      auth: { users: {}, households: {} },
      apps: {},
      identityMappings: {},
    };

    expect(() => validateConfig(invalidConfig, '/data')).toThrow(ConfigValidationError);
  });

  test('throws ConfigValidationError for missing households', () => {
    const invalidConfig = {
      system: {
        dataDir: '/data',
        configDir: '/data/system',
        defaultHouseholdId: 'home',
        timezone: 'UTC',
      },
      secrets: { OPENAI_API_KEY: 'key' },
      households: {}, // Empty
      users: { alice: { name: 'Alice' } },
      auth: { users: {}, households: {} },
      apps: {},
      identityMappings: {},
    };

    expect(() => validateConfig(invalidConfig, '/data')).toThrow(ConfigValidationError);
  });

  test('throws ConfigValidationError for missing user referenced in household', () => {
    const invalidConfig = {
      system: {
        dataDir: '/data',
        configDir: '/data/system',
        defaultHouseholdId: 'home',
        timezone: 'UTC',
      },
      secrets: { OPENAI_API_KEY: 'key' },
      households: {
        home: { head: 'alice', users: ['alice', 'missing_user'] },
      },
      users: {
        alice: { name: 'Alice' },
        // missing_user not defined
      },
      auth: { users: {}, households: {} },
      apps: {},
      identityMappings: {},
    };

    expect(() => validateConfig(invalidConfig, '/data')).toThrow(ConfigValidationError);
    try {
      validateConfig(invalidConfig, '/data');
    } catch (e) {
      expect(e.message).toContain('missing_user');
    }
  });

  test('error message includes checked file paths', () => {
    const invalidConfig = {
      system: {
        dataDir: '/data',
        configDir: '/data/system',
        defaultHouseholdId: 'home',
        timezone: 'UTC',
      },
      secrets: {},
      households: {},
      users: {},
      auth: { users: {}, households: {} },
      apps: {},
      identityMappings: {},
    };

    try {
      validateConfig(invalidConfig, '/data');
    } catch (e) {
      expect(e.message).toContain('/data/system/system.yml');
      expect(e.message).toContain('/data/system/secrets.yml');
    }
  });
});
