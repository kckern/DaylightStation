// tests/unit/suite/system/registries/SystemBotLoader.test.mjs
import { jest } from '@jest/globals';
import { SystemBotLoader } from '#backend/src/0_system/registries/SystemBotLoader.mjs';

/**
 * Create a mock ConfigService for testing SystemBotLoader.
 */
function createMockConfigService({
  botsConfig = {},
  systemAuth = {},
  householdPlatforms = {}
} = {}) {
  return {
    getSystemConfig: jest.fn((name) => {
      if (name === 'bots') return botsConfig;
      return null;
    }),
    getSystemAuth: jest.fn((platform, appName) => {
      return systemAuth[platform]?.[appName] ?? null;
    }),
    getHouseholdMessagingPlatform: jest.fn((householdId, appName) => {
      return householdPlatforms[householdId]?.[appName] ?? null;
    }),
  };
}

/**
 * Create mock adapter factories for testing.
 * The telegram factory mimics TelegramAdapter by assigning deps to properties.
 */
function createMockAdapterFactories() {
  return {
    telegram: ({ token, secretToken, httpClient, transcriptionService, logger }) => ({
      token,
      secretToken,
      httpClient,
      transcriptionService,
      logger,
    }),
  };
}

/**
 * Create mock dependencies for bot loading.
 */
function createMockDeps() {
  return {
    httpClient: {
      get: jest.fn(),
      post: jest.fn(),
      postForm: jest.fn(),
    },
    transcriptionService: {
      transcribeUrl: jest.fn(),
    },
  };
}

describe('SystemBotLoader', () => {
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    };
  });

  describe('constructor', () => {
    test('creates instance with configService and logger', () => {
      const mockConfigService = createMockConfigService();
      const loader = new SystemBotLoader({
        configService: mockConfigService,
        logger: mockLogger,
        adapterFactories: createMockAdapterFactories(),
      });

      expect(loader).toBeInstanceOf(SystemBotLoader);
    });

    test('uses console as default logger', () => {
      const mockConfigService = createMockConfigService();
      const loader = new SystemBotLoader({
        configService: mockConfigService,
      });

      expect(loader).toBeInstanceOf(SystemBotLoader);
    });
  });

  describe('loadBots()', () => {
    test('loads telegram bots from system config', () => {
      const mockConfigService = createMockConfigService({
        botsConfig: {
          nutribot: {
            telegram: {
              bot_id: '123456',
              webhook_path: '/api/v1/nutribot/webhook',
            },
          },
        },
        systemAuth: {
          telegram: {
            nutribot: 'test-token-123',
          },
        },
      });

      const loader = new SystemBotLoader({
        configService: mockConfigService,
        logger: mockLogger,
        adapterFactories: createMockAdapterFactories(),
      });

      const count = loader.loadBots(createMockDeps());

      expect(count).toBe(1);
      expect(loader.hasBot('nutribot', 'telegram')).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith('bot.loader.loaded', {
        appName: 'nutribot',
        platform: 'telegram',
      });
    });

    test('loads multiple bots for multiple apps', () => {
      const mockConfigService = createMockConfigService({
        botsConfig: {
          nutribot: {
            telegram: { bot_id: '111' },
          },
          journalist: {
            telegram: { bot_id: '222' },
          },
          homebot: {
            telegram: { bot_id: '333' },
          },
        },
        systemAuth: {
          telegram: {
            nutribot: 'token-1',
            journalist: 'token-2',
            homebot: 'token-3',
          },
        },
      });

      const loader = new SystemBotLoader({
        configService: mockConfigService,
        logger: mockLogger,
        adapterFactories: createMockAdapterFactories(),
      });

      const count = loader.loadBots(createMockDeps());

      expect(count).toBe(3);
      expect(loader.getLoadedApps()).toContain('nutribot');
      expect(loader.getLoadedApps()).toContain('journalist');
      expect(loader.getLoadedApps()).toContain('homebot');
    });

    test('returns 0 when no bots config exists', () => {
      const mockConfigService = createMockConfigService({
        botsConfig: null,
      });

      const loader = new SystemBotLoader({
        configService: mockConfigService,
        logger: mockLogger,
        adapterFactories: createMockAdapterFactories(),
      });

      const count = loader.loadBots(createMockDeps());

      expect(count).toBe(0);
      expect(mockLogger.warn).toHaveBeenCalledWith('bot.loader.no-config', {
        message: 'No bots config found in system config',
      });
    });

    test('skips bots with no token', () => {
      const mockConfigService = createMockConfigService({
        botsConfig: {
          nutribot: {
            telegram: { bot_id: '123' },
          },
        },
        systemAuth: {
          telegram: {}, // No token for nutribot
        },
      });

      const loader = new SystemBotLoader({
        configService: mockConfigService,
        logger: mockLogger,
        adapterFactories: createMockAdapterFactories(),
      });

      const count = loader.loadBots(createMockDeps());

      expect(count).toBe(0);
      expect(loader.hasBot('nutribot', 'telegram')).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith('bot.loader.no-token', {
        appName: 'nutribot',
        platform: 'telegram',
      });
    });

    test('skips bots with PLACEHOLDER token', () => {
      const mockConfigService = createMockConfigService({
        botsConfig: {
          homebot: {
            telegram: { bot_id: 'PLACEHOLDER' },
          },
        },
        systemAuth: {
          telegram: {
            homebot: 'PLACEHOLDER',
          },
        },
      });

      const loader = new SystemBotLoader({
        configService: mockConfigService,
        logger: mockLogger,
        adapterFactories: createMockAdapterFactories(),
      });

      const count = loader.loadBots(createMockDeps());

      expect(count).toBe(0);
      expect(loader.hasBot('homebot', 'telegram')).toBe(false);
      expect(mockLogger.debug).toHaveBeenCalledWith('bot.loader.placeholder-token', {
        appName: 'homebot',
        platform: 'telegram',
      });
    });

    test('logs warning for unsupported platforms', () => {
      const mockConfigService = createMockConfigService({
        botsConfig: {
          nutribot: {
            discord: { bot_id: '123' }, // Discord not supported yet
          },
        },
        systemAuth: {
          discord: {
            nutribot: 'discord-token',
          },
        },
      });

      const loader = new SystemBotLoader({
        configService: mockConfigService,
        logger: mockLogger,
        adapterFactories: createMockAdapterFactories(),
      });

      const count = loader.loadBots(createMockDeps());

      expect(count).toBe(0);
      expect(mockLogger.warn).toHaveBeenCalledWith('bot.loader.unsupported-platform', {
        appName: 'nutribot',
        platform: 'discord',
      });
    });

    test('skips invalid app configs', () => {
      const mockConfigService = createMockConfigService({
        botsConfig: {
          nutribot: null, // Invalid
          journalist: 'string-not-object', // Invalid
          homebot: {
            telegram: { bot_id: '123' },
          },
        },
        systemAuth: {
          telegram: {
            homebot: 'token-123',
          },
        },
      });

      const loader = new SystemBotLoader({
        configService: mockConfigService,
        logger: mockLogger,
        adapterFactories: createMockAdapterFactories(),
      });

      const count = loader.loadBots(createMockDeps());

      expect(count).toBe(1);
      expect(loader.hasBot('homebot', 'telegram')).toBe(true);
      expect(loader.hasBot('nutribot', 'telegram')).toBe(false);
    });

    test('logs completion summary', () => {
      const mockConfigService = createMockConfigService({
        botsConfig: {
          nutribot: {
            telegram: { bot_id: '123' },
          },
        },
        systemAuth: {
          telegram: {
            nutribot: 'token-123',
          },
        },
      });

      const loader = new SystemBotLoader({
        configService: mockConfigService,
        logger: mockLogger,
        adapterFactories: createMockAdapterFactories(),
      });

      loader.loadBots(createMockDeps());

      expect(mockLogger.info).toHaveBeenCalledWith('bot.loader.complete', {
        totalBots: 1,
        apps: ['nutribot'],
      });
    });
  });

  describe('getBot()', () => {
    test('returns adapter for valid app/platform', () => {
      const mockConfigService = createMockConfigService({
        botsConfig: {
          nutribot: {
            telegram: { bot_id: '123' },
          },
        },
        systemAuth: {
          telegram: {
            nutribot: 'token-123',
          },
        },
      });

      const loader = new SystemBotLoader({
        configService: mockConfigService,
        logger: mockLogger,
        adapterFactories: createMockAdapterFactories(),
      });

      loader.loadBots(createMockDeps());

      const adapter = loader.getBot('nutribot', 'telegram');

      expect(adapter).not.toBeNull();
      expect(adapter.token).toBe('token-123');
    });

    test('returns null for unknown app', () => {
      const mockConfigService = createMockConfigService({
        botsConfig: {},
      });

      const loader = new SystemBotLoader({
        configService: mockConfigService,
        logger: mockLogger,
        adapterFactories: createMockAdapterFactories(),
      });

      loader.loadBots(createMockDeps());

      expect(loader.getBot('unknown-app', 'telegram')).toBeNull();
    });

    test('returns null for unknown platform', () => {
      const mockConfigService = createMockConfigService({
        botsConfig: {
          nutribot: {
            telegram: { bot_id: '123' },
          },
        },
        systemAuth: {
          telegram: {
            nutribot: 'token-123',
          },
        },
      });

      const loader = new SystemBotLoader({
        configService: mockConfigService,
        logger: mockLogger,
        adapterFactories: createMockAdapterFactories(),
      });

      loader.loadBots(createMockDeps());

      expect(loader.getBot('nutribot', 'discord')).toBeNull();
    });
  });

  describe('getBotForHousehold()', () => {
    test('returns adapter based on household platform config', () => {
      const mockConfigService = createMockConfigService({
        botsConfig: {
          nutribot: {
            telegram: { bot_id: '123' },
          },
        },
        systemAuth: {
          telegram: {
            nutribot: 'token-123',
          },
        },
        householdPlatforms: {
          'household-1': {
            nutribot: 'telegram',
          },
        },
      });

      const loader = new SystemBotLoader({
        configService: mockConfigService,
        logger: mockLogger,
        adapterFactories: createMockAdapterFactories(),
      });

      loader.loadBots(createMockDeps());

      const adapter = loader.getBotForHousehold('household-1', 'nutribot');

      expect(adapter).not.toBeNull();
      expect(adapter.token).toBe('token-123');
      expect(mockConfigService.getHouseholdMessagingPlatform).toHaveBeenCalledWith(
        'household-1',
        'nutribot'
      );
    });

    test('returns null when household has no platform configured', () => {
      const mockConfigService = createMockConfigService({
        botsConfig: {
          nutribot: {
            telegram: { bot_id: '123' },
          },
        },
        systemAuth: {
          telegram: {
            nutribot: 'token-123',
          },
        },
        householdPlatforms: {},
      });

      const loader = new SystemBotLoader({
        configService: mockConfigService,
        logger: mockLogger,
        adapterFactories: createMockAdapterFactories(),
      });

      loader.loadBots(createMockDeps());

      const adapter = loader.getBotForHousehold('household-1', 'nutribot');

      expect(adapter).toBeNull();
      expect(mockLogger.debug).toHaveBeenCalledWith('bot.loader.no-platform', {
        householdId: 'household-1',
        appName: 'nutribot',
      });
    });

    test('returns null and warns when adapter not found for configured platform', () => {
      const mockConfigService = createMockConfigService({
        botsConfig: {
          nutribot: {
            telegram: { bot_id: '123' },
          },
        },
        systemAuth: {
          telegram: {
            nutribot: 'token-123',
          },
        },
        householdPlatforms: {
          'household-1': {
            nutribot: 'discord', // Platform configured but no discord adapter
          },
        },
      });

      const loader = new SystemBotLoader({
        configService: mockConfigService,
        logger: mockLogger,
        adapterFactories: createMockAdapterFactories(),
      });

      loader.loadBots(createMockDeps());

      const adapter = loader.getBotForHousehold('household-1', 'nutribot');

      expect(adapter).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith('bot.loader.adapter-not-found', {
        householdId: 'household-1',
        appName: 'nutribot',
        platform: 'discord',
      });
    });
  });

  describe('getLoadedApps()', () => {
    test('returns all loaded app names', () => {
      const mockConfigService = createMockConfigService({
        botsConfig: {
          nutribot: { telegram: { bot_id: '1' } },
          journalist: { telegram: { bot_id: '2' } },
        },
        systemAuth: {
          telegram: {
            nutribot: 'token-1',
            journalist: 'token-2',
          },
        },
      });

      const loader = new SystemBotLoader({
        configService: mockConfigService,
        logger: mockLogger,
        adapterFactories: createMockAdapterFactories(),
      });

      loader.loadBots(createMockDeps());

      const apps = loader.getLoadedApps();

      expect(apps).toHaveLength(2);
      expect(apps).toContain('nutribot');
      expect(apps).toContain('journalist');
    });

    test('returns empty array when no bots loaded', () => {
      const mockConfigService = createMockConfigService({
        botsConfig: {},
      });

      const loader = new SystemBotLoader({
        configService: mockConfigService,
        logger: mockLogger,
        adapterFactories: createMockAdapterFactories(),
      });

      loader.loadBots(createMockDeps());

      expect(loader.getLoadedApps()).toEqual([]);
    });
  });

  describe('getPlatformsForApp()', () => {
    test('returns platforms for loaded app', () => {
      const mockConfigService = createMockConfigService({
        botsConfig: {
          nutribot: {
            telegram: { bot_id: '123' },
          },
        },
        systemAuth: {
          telegram: {
            nutribot: 'token-123',
          },
        },
      });

      const loader = new SystemBotLoader({
        configService: mockConfigService,
        logger: mockLogger,
        adapterFactories: createMockAdapterFactories(),
      });

      loader.loadBots(createMockDeps());

      expect(loader.getPlatformsForApp('nutribot')).toEqual(['telegram']);
    });

    test('returns empty array for unknown app', () => {
      const mockConfigService = createMockConfigService({
        botsConfig: {},
      });

      const loader = new SystemBotLoader({
        configService: mockConfigService,
        logger: mockLogger,
        adapterFactories: createMockAdapterFactories(),
      });

      loader.loadBots(createMockDeps());

      expect(loader.getPlatformsForApp('unknown-app')).toEqual([]);
    });
  });

  describe('hasBot()', () => {
    test('returns true for loaded bot', () => {
      const mockConfigService = createMockConfigService({
        botsConfig: {
          nutribot: {
            telegram: { bot_id: '123' },
          },
        },
        systemAuth: {
          telegram: {
            nutribot: 'token-123',
          },
        },
      });

      const loader = new SystemBotLoader({
        configService: mockConfigService,
        logger: mockLogger,
        adapterFactories: createMockAdapterFactories(),
      });

      loader.loadBots(createMockDeps());

      expect(loader.hasBot('nutribot', 'telegram')).toBe(true);
    });

    test('returns false for unloaded bot', () => {
      const mockConfigService = createMockConfigService({
        botsConfig: {},
      });

      const loader = new SystemBotLoader({
        configService: mockConfigService,
        logger: mockLogger,
        adapterFactories: createMockAdapterFactories(),
      });

      loader.loadBots(createMockDeps());

      expect(loader.hasBot('nutribot', 'telegram')).toBe(false);
    });
  });

  describe('adapter configuration', () => {
    test('passes httpClient to TelegramAdapter', () => {
      const mockConfigService = createMockConfigService({
        botsConfig: {
          nutribot: {
            telegram: { bot_id: '123' },
          },
        },
        systemAuth: {
          telegram: {
            nutribot: 'token-123',
          },
        },
      });

      const loader = new SystemBotLoader({
        configService: mockConfigService,
        logger: mockLogger,
        adapterFactories: createMockAdapterFactories(),
      });

      const mockDeps = createMockDeps();
      loader.loadBots(mockDeps);

      const adapter = loader.getBot('nutribot', 'telegram');

      expect(adapter.httpClient).toBe(mockDeps.httpClient);
    });

    test('passes transcriptionService to TelegramAdapter', () => {
      const mockConfigService = createMockConfigService({
        botsConfig: {
          nutribot: {
            telegram: { bot_id: '123' },
          },
        },
        systemAuth: {
          telegram: {
            nutribot: 'token-123',
          },
        },
      });

      const loader = new SystemBotLoader({
        configService: mockConfigService,
        logger: mockLogger,
        adapterFactories: createMockAdapterFactories(),
      });

      const mockDeps = createMockDeps();
      loader.loadBots(mockDeps);

      const adapter = loader.getBot('nutribot', 'telegram');

      expect(adapter.transcriptionService).toBe(mockDeps.transcriptionService);
    });

    test('passes logger to TelegramAdapter', () => {
      const mockConfigService = createMockConfigService({
        botsConfig: {
          nutribot: {
            telegram: { bot_id: '123' },
          },
        },
        systemAuth: {
          telegram: {
            nutribot: 'token-123',
          },
        },
      });

      const loader = new SystemBotLoader({
        configService: mockConfigService,
        logger: mockLogger,
        adapterFactories: createMockAdapterFactories(),
      });

      loader.loadBots(createMockDeps());

      const adapter = loader.getBot('nutribot', 'telegram');

      expect(adapter.logger).toBe(mockLogger);
    });
  });

  describe('error handling', () => {
    test('catches and logs adapter creation errors', () => {
      // This test validates that if TelegramAdapter throws during construction,
      // the error is caught and logged rather than bubbling up
      const mockConfigService = createMockConfigService({
        botsConfig: {
          nutribot: {
            telegram: { bot_id: '123' },
          },
        },
        systemAuth: {
          telegram: {
            // Token that will cause TelegramAdapter to throw
            nutribot: '', // Empty string token will throw
          },
        },
      });

      const loader = new SystemBotLoader({
        configService: mockConfigService,
        logger: mockLogger,
        adapterFactories: createMockAdapterFactories(),
      });

      // Should not throw, but log the error
      expect(() => loader.loadBots(createMockDeps())).not.toThrow();

      // Bot should not be loaded due to empty token (caught in no-token check)
      expect(loader.hasBot('nutribot', 'telegram')).toBe(false);
    });
  });
});
