// tests/unit/suite/system/registries/IntegrationLoader.test.mjs
import { jest } from '@jest/globals';
import { IntegrationLoader } from '#backend/src/0_system/registries/IntegrationLoader.mjs';
import { HouseholdAdapters } from '#backend/src/0_system/registries/HouseholdAdapters.mjs';

/**
 * Create a mock ConfigService with integrations config and auth.
 * Uses new getIntegrationsConfig API instead of old getCapabilityIntegrations.
 */
function createMockConfigService({ integrationsConfig = {}, auth = {}, serviceUrls = {}, secrets = {} } = {}) {
  return {
    getIntegrationsConfig: jest.fn((householdId) => integrationsConfig),
    getHouseholdAuth: jest.fn((provider, householdId) => auth[provider] ?? null),
    resolveServiceUrl: jest.fn((provider) => serviceUrls[provider] ?? null),
    getSecret: jest.fn((key) => secrets[key] ?? null),
  };
}

describe('IntegrationLoader', () => {
  let mockRegistry;
  let mockLogger;

  beforeEach(() => {
    mockRegistry = {
      getManifest: jest.fn(),
    };
    mockLogger = {
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    };
  });

  describe('loadForHousehold()', () => {
    test('returns HouseholdAdapters instance', async () => {
      const MockAdapter = class TestAdapter {
        constructor(config) { this.config = config; }
      };

      mockRegistry.getManifest.mockReturnValue({
        provider: 'plex',
        capability: 'media',
        adapter: () => Promise.resolve({ default: MockAdapter }),
      });

      const mockConfigService = createMockConfigService({
        integrationsConfig: {
          plex: { port: 32400, protocol: 'dash' },
        },
        auth: { plex: { token: 'test-token' } },
        serviceUrls: { plex: 'http://localhost:32400' },
      });

      const loader = new IntegrationLoader({
        registry: mockRegistry,
        configService: mockConfigService,
        logger: mockLogger,
      });

      const adapters = await loader.loadForHousehold('default', {});

      expect(adapters).toBeInstanceOf(HouseholdAdapters);
    });

    test('loads adapters from service entries', async () => {
      const MockAdapter = class TestAdapter {
        constructor(config) { this.config = config; }
        isConfigured() { return true; }
      };

      mockRegistry.getManifest.mockReturnValue({
        provider: 'plex',
        capability: 'media',
        adapter: () => Promise.resolve({ default: MockAdapter }),
      });

      const mockConfigService = createMockConfigService({
        integrationsConfig: {
          plex: { port: 32400, protocol: 'dash' },
        },
        auth: { plex: { token: 'test-token' } },
        serviceUrls: { plex: 'http://localhost:32400' },
      });

      const loader = new IntegrationLoader({
        registry: mockRegistry,
        configService: mockConfigService,
        logger: mockLogger,
      });

      const adapters = await loader.loadForHousehold('default', {});

      expect(adapters.has('media')).toBe(true);
      const adapter = adapters.get('media');
      expect(adapter.config.host).toBe('http://localhost:32400');
      expect(adapter.config.token).toBe('test-token');
      expect(adapter.config.protocol).toBe('dash');
    });

    test('loads adapters from app routing sections', async () => {
      const MockOpenAI = class OpenAIAdapter {
        constructor(config) { this.config = config; this.name = 'openai'; }
        isConfigured() { return true; }
      };
      const MockAnthropic = class AnthropicAdapter {
        constructor(config) { this.config = config; this.name = 'anthropic'; }
        isConfigured() { return true; }
      };

      mockRegistry.getManifest.mockImplementation((capability, provider) => {
        if (provider === 'openai') {
          return {
            provider: 'openai',
            capability: 'ai',
            adapter: () => Promise.resolve({ default: MockOpenAI }),
          };
        }
        if (provider === 'anthropic') {
          return {
            provider: 'anthropic',
            capability: 'ai',
            adapter: () => Promise.resolve({ default: MockAnthropic }),
          };
        }
        return undefined;
      });

      const mockConfigService = createMockConfigService({
        integrationsConfig: {
          ai: {
            nutribot: [{ provider: 'openai' }],
            journalist: [{ provider: 'anthropic' }],
          },
        },
        secrets: { OPENAI_API_KEY: 'sk-test', ANTHROPIC_API_KEY: 'sk-anthro' },
      });

      const loader = new IntegrationLoader({
        registry: mockRegistry,
        configService: mockConfigService,
        logger: mockLogger,
      });

      const adapters = await loader.loadForHousehold('default', {});

      expect(adapters.has('ai')).toBe(true);
      expect(adapters.get('ai', 'nutribot').name).toBe('openai');
      expect(adapters.get('ai', 'journalist').name).toBe('anthropic');
    });

    test('returns NoOp adapter for unconfigured capabilities', async () => {
      const mockConfigService = createMockConfigService({
        integrationsConfig: {},
      });

      const loader = new IntegrationLoader({
        registry: mockRegistry,
        configService: mockConfigService,
        logger: mockLogger,
      });

      const adapters = await loader.loadForHousehold('default', {});

      expect(adapters.has('media')).toBe(false);
      expect(adapters.has('ai')).toBe(false);
      expect(adapters.get('media').isAvailable()).toBe(false);
    });

    test('merges auth config with service config', async () => {
      const MockAdapter = class TestAdapter {
        constructor(config) { this.config = config; }
      };

      mockRegistry.getManifest.mockReturnValue({
        provider: 'plex',
        capability: 'media',
        adapter: () => Promise.resolve({ default: MockAdapter }),
      });

      const mockConfigService = createMockConfigService({
        integrationsConfig: {
          plex: { port: 32400 },
        },
        auth: { plex: { token: 'auth-token' } },
      });

      const loader = new IntegrationLoader({
        registry: mockRegistry,
        configService: mockConfigService,
        logger: mockLogger,
      });

      const adapters = await loader.loadForHousehold('default', {});

      const adapter = adapters.get('media');
      expect(adapter.config.port).toBe(32400);
      expect(adapter.config.token).toBe('auth-token');
    });

    test('logs warning for unknown config keys', async () => {
      const mockConfigService = createMockConfigService({
        integrationsConfig: {
          unknown_service: { foo: 'bar' },
        },
      });

      const loader = new IntegrationLoader({
        registry: mockRegistry,
        configService: mockConfigService,
        logger: mockLogger,
      });

      await loader.loadForHousehold('default', {});

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'integration.unknown-key',
        { householdId: 'default', key: 'unknown_service' }
      );
    });

    test('logs warning when provider not discovered', async () => {
      mockRegistry.getManifest.mockReturnValue(undefined);

      const mockConfigService = createMockConfigService({
        integrationsConfig: {
          plex: { port: 32400 },
        },
      });

      const loader = new IntegrationLoader({
        registry: mockRegistry,
        configService: mockConfigService,
        logger: mockLogger,
      });

      await loader.loadForHousehold('default', {});

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'integration.provider-not-discovered',
        { capability: 'media', provider: 'plex' }
      );
    });

    test('handles null integrationsConfig', async () => {
      const mockConfigService = createMockConfigService({
        integrationsConfig: null,
      });
      // Override to return null instead of the object
      mockConfigService.getIntegrationsConfig = jest.fn(() => null);

      const loader = new IntegrationLoader({
        registry: mockRegistry,
        configService: mockConfigService,
        logger: mockLogger,
      });

      const adapters = await loader.loadForHousehold('default', {});

      expect(adapters).toBeInstanceOf(HouseholdAdapters);
      expect(adapters.has('media')).toBe(false);
    });
  });

  describe('Config-driven loading', () => {
    test('parses service entries and loads adapters by convention', async () => {
      const MockAdapter = class TestAdapter {
        constructor(config) { this.config = config; }
        isConfigured() { return true; }
      };

      mockRegistry.getManifest.mockReturnValue({
        provider: 'plex',
        capability: 'media',
        adapter: () => Promise.resolve({ default: MockAdapter }),
      });

      // Config uses convention: plex → media capability
      const mockConfigService = createMockConfigService({
        integrationsConfig: {
          plex: { port: 32400 },
        },
      });

      const loader = new IntegrationLoader({
        registry: mockRegistry,
        configService: mockConfigService,
        logger: mockLogger,
      });

      const adapters = await loader.loadForHousehold('default', {});

      expect(adapters.has('media')).toBe(true);
      expect(adapters.providers('media')).toContain('plex');
    });

    test('builds app routing from capability sections', async () => {
      const MockOpenAI = class OpenAIAdapter {
        constructor(config) { this.config = config; this.name = 'openai'; }
        isConfigured() { return true; }
      };

      mockRegistry.getManifest.mockReturnValue({
        provider: 'openai',
        capability: 'ai',
        adapter: () => Promise.resolve({ default: MockOpenAI }),
      });

      // Config uses capability section with app routing
      const mockConfigService = createMockConfigService({
        integrationsConfig: {
          ai: {
            nutribot: [{ provider: 'openai' }],
          },
        },
        secrets: { OPENAI_API_KEY: 'sk-test' },
      });

      const loader = new IntegrationLoader({
        registry: mockRegistry,
        configService: mockConfigService,
        logger: mockLogger,
      });

      const adapters = await loader.loadForHousehold('default', {});

      // App routing should work
      expect(adapters.get('ai', 'nutribot').name).toBe('openai');
      expect(adapters.get('ai', 'nutribot').config.apiKey).toBe('sk-test');
    });

    test('handles object config that was causing "not iterable" error', async () => {
      const MockPlexAdapter = class PlexAdapter {
        constructor(config) { this.config = config; }
        isConfigured() { return true; }
      };
      const MockHAAdapter = class HAAdapter {
        constructor(config) { this.config = config; }
        isConfigured() { return true; }
      };
      const MockOpenAI = class OpenAIAdapter {
        constructor(config) { this.config = config; }
        isConfigured() { return true; }
      };
      const MockTelegram = class TelegramAdapter {
        constructor(config) { this.config = config; }
        isConfigured() { return true; }
      };

      mockRegistry.getManifest.mockImplementation((capability, provider) => {
        const adapters = {
          plex: { adapter: () => Promise.resolve({ default: MockPlexAdapter }) },
          homeassistant: { adapter: () => Promise.resolve({ default: MockHAAdapter }) },
          openai: { adapter: () => Promise.resolve({ default: MockOpenAI }) },
          telegram: { adapter: () => Promise.resolve({ default: MockTelegram }) },
        };
        return adapters[provider] ? { provider, capability, ...adapters[provider] } : undefined;
      });

      // Exact config structure from production that was causing the error
      const mockConfigService = createMockConfigService({
        integrationsConfig: {
          plex: { port: 32400, protocol: 'dash' },
          homeassistant: { port: 8123 },
          ai: {
            nutribot: [{ provider: 'openai' }],
            journalist: [{ provider: 'openai' }],
          },
          messaging: {
            nutribot: [{ platform: 'telegram' }],
            homebot: [{ platform: 'telegram' }],
          },
        },
      });

      const loader = new IntegrationLoader({
        registry: mockRegistry,
        configService: mockConfigService,
        logger: mockLogger,
      });

      // This should NOT throw "integrations is not iterable"
      const adapters = await loader.loadForHousehold('default', {});

      expect(adapters).toBeInstanceOf(HouseholdAdapters);
      expect(adapters.has('media')).toBe(true);
      expect(adapters.has('home_automation')).toBe(true);
      expect(adapters.has('ai')).toBe(true);
      expect(adapters.has('messaging')).toBe(true);
    });

    test('loads multiple providers for same capability', async () => {
      const MockOpenAI = class OpenAIAdapter {
        constructor(config) { this.config = config; this.name = 'openai'; }
        isConfigured() { return true; }
      };
      const MockAnthropic = class AnthropicAdapter {
        constructor(config) { this.config = config; this.name = 'anthropic'; }
        isConfigured() { return true; }
      };

      mockRegistry.getManifest.mockImplementation((capability, provider) => {
        if (provider === 'openai') {
          return {
            provider: 'openai',
            capability: 'ai',
            adapter: () => Promise.resolve({ default: MockOpenAI }),
          };
        }
        if (provider === 'anthropic') {
          return {
            provider: 'anthropic',
            capability: 'ai',
            adapter: () => Promise.resolve({ default: MockAnthropic }),
          };
        }
        return undefined;
      });

      const mockConfigService = createMockConfigService({
        integrationsConfig: {
          ai: {
            nutribot: [{ provider: 'openai' }],
            journalist: [{ provider: 'anthropic' }],
          },
        },
      });

      const loader = new IntegrationLoader({
        registry: mockRegistry,
        configService: mockConfigService,
        logger: mockLogger,
      });

      const adapters = await loader.loadForHousehold('default', {});

      // Both providers should be available
      expect(adapters.providers('ai')).toEqual(expect.arrayContaining(['openai', 'anthropic']));
      expect(adapters.get('ai', 'nutribot').name).toBe('openai');
      expect(adapters.get('ai', 'journalist').name).toBe('anthropic');
    });

    test('deduplicates providers when multiple apps use same provider', async () => {
      const MockOpenAI = class OpenAIAdapter {
        constructor(config) { this.config = config; }
        isConfigured() { return true; }
      };

      let constructorCalls = 0;
      mockRegistry.getManifest.mockReturnValue({
        provider: 'openai',
        capability: 'ai',
        adapter: () => {
          constructorCalls++;
          return Promise.resolve({ default: MockOpenAI });
        },
      });

      const mockConfigService = createMockConfigService({
        integrationsConfig: {
          ai: {
            nutribot: [{ provider: 'openai' }],
            journalist: [{ provider: 'openai' }],  // Same provider
            homebot: [{ provider: 'openai' }],     // Same provider
          },
        },
      });

      const loader = new IntegrationLoader({
        registry: mockRegistry,
        configService: mockConfigService,
        logger: mockLogger,
      });

      await loader.loadForHousehold('default', {});

      // Should only load OpenAI adapter once, not three times
      expect(constructorCalls).toBe(1);
    });
  });

  describe('getAdapters()', () => {
    test('returns cached adapters for a household', async () => {
      const MockAdapter = class TestAdapter {
        constructor(config) { this.config = config; }
      };

      mockRegistry.getManifest.mockReturnValue({
        provider: 'plex',
        capability: 'media',
        adapter: () => Promise.resolve({ default: MockAdapter }),
      });

      const mockConfigService = createMockConfigService({
        integrationsConfig: { plex: { port: 32400 } },
      });

      const loader = new IntegrationLoader({
        registry: mockRegistry,
        configService: mockConfigService,
        logger: mockLogger,
      });

      await loader.loadForHousehold('household-1', {});

      const cached = loader.getAdapters('household-1');
      expect(cached).toBeInstanceOf(HouseholdAdapters);
    });

    test('returns undefined for unknown household', () => {
      const mockConfigService = createMockConfigService();
      const loader = new IntegrationLoader({
        registry: mockRegistry,
        configService: mockConfigService,
        logger: mockLogger,
      });
      expect(loader.getAdapters('unknown')).toBeUndefined();
    });
  });

  describe('hasCapability()', () => {
    test('returns true for configured capability', async () => {
      const MockAdapter = class TestAdapter {
        constructor(config) { this.config = config; }
        isConfigured() { return true; }
      };

      mockRegistry.getManifest.mockReturnValue({
        provider: 'plex',
        capability: 'media',
        adapter: () => Promise.resolve({ default: MockAdapter }),
      });

      const mockConfigService = createMockConfigService({
        integrationsConfig: { plex: { port: 32400 } },
      });

      const loader = new IntegrationLoader({
        registry: mockRegistry,
        configService: mockConfigService,
        logger: mockLogger,
      });

      await loader.loadForHousehold('default', {});

      expect(loader.hasCapability('default', 'media')).toBe(true);
    });

    test('returns false for unconfigured capability', async () => {
      const mockConfigService = createMockConfigService({
        integrationsConfig: {},
      });

      const loader = new IntegrationLoader({
        registry: mockRegistry,
        configService: mockConfigService,
        logger: mockLogger,
      });

      await loader.loadForHousehold('default', {});

      expect(loader.hasCapability('default', 'media')).toBe(false);
    });

    test('supports per-app capability check', async () => {
      const MockOpenAI = class OpenAIAdapter {
        constructor(config) { this.config = config; }
        isConfigured() { return true; }
      };

      mockRegistry.getManifest.mockReturnValue({
        provider: 'openai',
        capability: 'ai',
        adapter: () => Promise.resolve({ default: MockOpenAI }),
      });

      const mockConfigService = createMockConfigService({
        integrationsConfig: {
          ai: {
            nutribot: [{ provider: 'openai' }],
          },
        },
      });

      const loader = new IntegrationLoader({
        registry: mockRegistry,
        configService: mockConfigService,
        logger: mockLogger,
      });

      await loader.loadForHousehold('default', {});

      expect(loader.hasCapability('default', 'ai', 'nutribot')).toBe(true);
    });
  });

  describe('edge cases', () => {
    test('handles empty deps object', async () => {
      const MockAdapter = class TestAdapter {
        constructor(config, deps) {
          this.config = config;
          this.deps = deps;
        }
      };

      mockRegistry.getManifest.mockReturnValue({
        provider: 'plex',
        capability: 'media',
        adapter: () => Promise.resolve({ default: MockAdapter }),
      });

      const mockConfigService = createMockConfigService({
        integrationsConfig: { plex: { port: 32400 } },
      });

      const loader = new IntegrationLoader({
        registry: mockRegistry,
        configService: mockConfigService,
        logger: mockLogger,
      });

      const adapters = await loader.loadForHousehold('default', {});

      expect(adapters.get('media').deps).toEqual({});
    });

    test('passes deps to adapter constructor', async () => {
      const MockAdapter = class TestAdapter {
        constructor(config, deps) {
          this.config = config;
          this.httpClient = deps.httpClient;
        }
      };

      const mockHttpClient = { get: jest.fn() };

      mockRegistry.getManifest.mockReturnValue({
        provider: 'plex',
        capability: 'media',
        adapter: () => Promise.resolve({ default: MockAdapter }),
      });

      const mockConfigService = createMockConfigService({
        integrationsConfig: { plex: { port: 32400 } },
      });

      const loader = new IntegrationLoader({
        registry: mockRegistry,
        configService: mockConfigService,
        logger: mockLogger,
      });

      const adapters = await loader.loadForHousehold('default', { httpClient: mockHttpClient });

      expect(adapters.get('media').httpClient).toBe(mockHttpClient);
    });

    test('auth config values override service config values', async () => {
      const MockAdapter = class TestAdapter {
        constructor(config) { this.config = config; }
      };

      mockRegistry.getManifest.mockReturnValue({
        provider: 'plex',
        capability: 'media',
        adapter: () => Promise.resolve({ default: MockAdapter }),
      });

      const mockConfigService = createMockConfigService({
        integrationsConfig: {
          plex: { token: 'old-token', port: 32400 },
        },
        auth: { plex: { token: 'new-secret-token' } },
      });

      const loader = new IntegrationLoader({
        registry: mockRegistry,
        configService: mockConfigService,
        logger: mockLogger,
      });

      const adapters = await loader.loadForHousehold('default', {});

      // Auth config should override service config
      expect(adapters.get('media').config.token).toBe('new-secret-token');
      expect(adapters.get('media').config.port).toBe(32400);
    });

    test('normalizes api_key to apiKey', async () => {
      const MockAdapter = class TestAdapter {
        constructor(config) { this.config = config; }
      };

      mockRegistry.getManifest.mockReturnValue({
        provider: 'openai',
        capability: 'ai',
        adapter: () => Promise.resolve({ default: MockAdapter }),
      });

      const mockConfigService = createMockConfigService({
        integrationsConfig: {
          ai: { nutribot: [{ provider: 'openai' }] },
        },
        auth: { openai: { api_key: 'sk-secret' } },
      });

      const loader = new IntegrationLoader({
        registry: mockRegistry,
        configService: mockConfigService,
        logger: mockLogger,
      });

      const adapters = await loader.loadForHousehold('default', {});

      // api_key should be normalized to apiKey
      expect(adapters.get('ai').config.apiKey).toBe('sk-secret');
      expect(adapters.get('ai').config.api_key).toBeUndefined();
    });

    test('normalizes homeassistant host to baseUrl', async () => {
      const MockAdapter = class TestAdapter {
        constructor(config) { this.config = config; }
      };

      mockRegistry.getManifest.mockReturnValue({
        provider: 'homeassistant',
        capability: 'home_automation',
        adapter: () => Promise.resolve({ default: MockAdapter }),
      });

      const mockConfigService = createMockConfigService({
        integrationsConfig: {
          homeassistant: { port: 8123 },
        },
        serviceUrls: { homeassistant: 'http://ha.local:8123' },
      });

      const loader = new IntegrationLoader({
        registry: mockRegistry,
        configService: mockConfigService,
        logger: mockLogger,
      });

      const adapters = await loader.loadForHousehold('default', {});

      // host should be normalized to baseUrl for homeassistant
      expect(adapters.get('home_automation').config.baseUrl).toBe('http://ha.local:8123');
      expect(adapters.get('home_automation').config.host).toBeUndefined();
    });

    test('handles adapter load failure gracefully', async () => {
      mockRegistry.getManifest.mockReturnValue({
        provider: 'plex',
        capability: 'media',
        adapter: () => Promise.reject(new Error('Module not found')),
      });

      const mockConfigService = createMockConfigService({
        integrationsConfig: { plex: { port: 32400 } },
      });

      const loader = new IntegrationLoader({
        registry: mockRegistry,
        configService: mockConfigService,
        logger: mockLogger,
      });

      const adapters = await loader.loadForHousehold('default', {});

      // Should not throw, should log error and return empty adapters
      expect(mockLogger.error).toHaveBeenCalledWith(
        'integration.adapter.failed',
        expect.objectContaining({ capability: 'media', provider: 'plex' })
      );
      expect(adapters.has('media')).toBe(false);
    });

    test('injects secrets from secrets.yml', async () => {
      const MockAdapter = class TestAdapter {
        constructor(config) { this.config = config; }
      };

      mockRegistry.getManifest.mockReturnValue({
        provider: 'openai',
        capability: 'ai',
        adapter: () => Promise.resolve({ default: MockAdapter }),
      });

      const mockConfigService = createMockConfigService({
        integrationsConfig: {
          ai: { nutribot: [{ provider: 'openai' }] },
        },
        secrets: { OPENAI_API_KEY: 'sk-from-secrets' },
      });

      const loader = new IntegrationLoader({
        registry: mockRegistry,
        configService: mockConfigService,
        logger: mockLogger,
      });

      const adapters = await loader.loadForHousehold('default', {});

      expect(adapters.get('ai').config.apiKey).toBe('sk-from-secrets');
    });
  });
});
