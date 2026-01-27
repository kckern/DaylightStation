// tests/unit/suite/system/registries/IntegrationLoader.test.mjs
import { jest } from '@jest/globals';
import { IntegrationLoader } from '#backend/src/0_system/registries/IntegrationLoader.mjs';

describe('IntegrationLoader', () => {
  let mockRegistry;
  let mockLogger;

  beforeEach(() => {
    mockRegistry = {
      getAllCapabilities: jest.fn().mockReturnValue(['media', 'ai']),
      getManifest: jest.fn(),
    };
    mockLogger = {
      warn: jest.fn(),
      info: jest.fn(),
    };
  });

  describe('loadForHousehold()', () => {
    test('loads adapters for configured providers', async () => {
      const MockAdapter = class TestAdapter {
        constructor(config) { this.config = config; }
      };

      mockRegistry.getManifest
        .mockReturnValueOnce({
          provider: 'plex',
          capability: 'media',
          adapter: () => Promise.resolve({ default: MockAdapter }),
        })
        .mockReturnValueOnce(undefined);  // ai not configured

      const loader = new IntegrationLoader({ registry: mockRegistry, logger: mockLogger });

      const householdConfig = {
        media: [{ provider: 'plex', host: 'http://localhost:32400' }],
        ai: [],  // Not configured
      };
      const authConfig = { plex: { token: 'test-token' } };

      const adapters = await loader.loadForHousehold('default', householdConfig, authConfig, {});

      expect(adapters.media).toBeDefined();
      expect(adapters.media.config.host).toBe('http://localhost:32400');
      expect(adapters.media.config.token).toBe('test-token');
    });

    test('returns NoOp adapter for unconfigured capabilities', async () => {
      mockRegistry.getManifest.mockReturnValue(undefined);

      const loader = new IntegrationLoader({ registry: mockRegistry, logger: mockLogger });

      const adapters = await loader.loadForHousehold('default', {}, {}, {});

      expect(adapters.media.isAvailable()).toBe(false);
      expect(adapters.ai.isConfigured()).toBe(false);
    });

    test('merges auth config with provider config', async () => {
      const MockAdapter = class TestAdapter {
        constructor(config) { this.config = config; }
      };

      mockRegistry.getManifest.mockReturnValue({
        provider: 'openai',
        capability: 'ai',
        adapter: () => Promise.resolve({ default: MockAdapter }),
      });

      const loader = new IntegrationLoader({ registry: mockRegistry, logger: mockLogger });

      const householdConfig = {
        ai: [{ provider: 'openai', model: 'gpt-4o' }],
      };
      const authConfig = { openai: { api_key: 'sk-secret' } };

      const adapters = await loader.loadForHousehold('default', householdConfig, authConfig, {});

      expect(adapters.ai.config.model).toBe('gpt-4o');
      expect(adapters.ai.config.api_key).toBe('sk-secret');
    });

    test('handles null configs array as unconfigured', async () => {
      const loader = new IntegrationLoader({ registry: mockRegistry, logger: mockLogger });

      const householdConfig = {
        media: null,
        ai: null,
      };

      const adapters = await loader.loadForHousehold('default', householdConfig, {}, {});

      expect(adapters.media.isAvailable()).toBe(false);
      expect(adapters.ai.isConfigured()).toBe(false);
    });

    test('logs warning when provider not discovered', async () => {
      mockRegistry.getManifest.mockReturnValue(undefined);

      const loader = new IntegrationLoader({ registry: mockRegistry, logger: mockLogger });

      const householdConfig = {
        media: [{ provider: 'unknown-provider', host: 'http://localhost' }],
      };

      const adapters = await loader.loadForHousehold('default', householdConfig, {}, {});

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'provider-not-discovered',
        { capability: 'media', provider: 'unknown-provider' }
      );
      // Should fall back to NoOp
      expect(adapters.media.isAvailable()).toBe(false);
    });
  });

  describe('MultiProviderAdapter', () => {
    test('wraps multiple providers of the same capability', async () => {
      const MockPlexAdapter = class PlexAdapter {
        constructor(config) { this.config = config; this.name = 'plex'; }
      };
      const MockFilesystemAdapter = class FilesystemAdapter {
        constructor(config) { this.config = config; this.name = 'filesystem'; }
      };

      mockRegistry.getManifest
        .mockReturnValueOnce({
          provider: 'plex',
          capability: 'media',
          adapter: () => Promise.resolve({ default: MockPlexAdapter }),
        })
        .mockReturnValueOnce({
          provider: 'filesystem',
          capability: 'media',
          adapter: () => Promise.resolve({ default: MockFilesystemAdapter }),
        })
        .mockReturnValueOnce(undefined);  // ai not configured

      const loader = new IntegrationLoader({ registry: mockRegistry, logger: mockLogger });

      const householdConfig = {
        media: [
          { provider: 'plex', host: 'http://localhost:32400' },
          { provider: 'filesystem', basePath: '/data/media' },
        ],
      };

      const adapters = await loader.loadForHousehold('default', householdConfig, {}, {});

      // Should be wrapped in MultiProviderAdapter
      expect(adapters.media.isAvailable()).toBe(true);
      expect(adapters.media.getProvider('plex').name).toBe('plex');
      expect(adapters.media.getProvider('filesystem').name).toBe('filesystem');
      expect(adapters.media.getPrimary().name).toBe('plex');
      expect(adapters.media.getAllProviders().length).toBe(2);
    });

    test('returns single adapter directly without wrapping', async () => {
      const MockAdapter = class TestAdapter {
        constructor(config) { this.config = config; }
      };

      mockRegistry.getManifest
        .mockReturnValueOnce({
          provider: 'plex',
          capability: 'media',
          adapter: () => Promise.resolve({ default: MockAdapter }),
        })
        .mockReturnValueOnce(undefined);

      const loader = new IntegrationLoader({ registry: mockRegistry, logger: mockLogger });

      const householdConfig = {
        media: [{ provider: 'plex', host: 'http://localhost:32400' }],
      };

      const adapters = await loader.loadForHousehold('default', householdConfig, {}, {});

      // Single adapter should not be wrapped
      expect(adapters.media).toBeInstanceOf(MockAdapter);
      expect(adapters.media.getProvider).toBeUndefined();
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

      const loader = new IntegrationLoader({ registry: mockRegistry, logger: mockLogger });

      const householdConfig = {
        media: [{ provider: 'plex' }],
      };

      await loader.loadForHousehold('household-1', householdConfig, {}, {});

      const cached = loader.getAdapters('household-1');
      expect(cached).toBeDefined();
      expect(cached.media).toBeDefined();
    });

    test('returns undefined for unknown household', () => {
      const loader = new IntegrationLoader({ registry: mockRegistry, logger: mockLogger });
      expect(loader.getAdapters('unknown')).toBeUndefined();
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

      const loader = new IntegrationLoader({ registry: mockRegistry, logger: mockLogger });

      const adapters = await loader.loadForHousehold('default', {
        media: [{ provider: 'plex' }],
      }, {}, {});

      expect(adapters.media.deps).toEqual({});
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

      const loader = new IntegrationLoader({ registry: mockRegistry, logger: mockLogger });

      const adapters = await loader.loadForHousehold('default', {
        media: [{ provider: 'plex' }],
      }, {}, { httpClient: mockHttpClient });

      expect(adapters.media.httpClient).toBe(mockHttpClient);
    });

    test('auth config values override provider config values', async () => {
      const MockAdapter = class TestAdapter {
        constructor(config) { this.config = config; }
      };

      mockRegistry.getManifest.mockReturnValue({
        provider: 'openai',
        capability: 'ai',
        adapter: () => Promise.resolve({ default: MockAdapter }),
      });

      const loader = new IntegrationLoader({ registry: mockRegistry, logger: mockLogger });

      const householdConfig = {
        ai: [{ provider: 'openai', api_key: 'old-key', model: 'gpt-4o' }],
      };
      const authConfig = { openai: { api_key: 'new-secret-key' } };

      const adapters = await loader.loadForHousehold('default', householdConfig, authConfig, {});

      // Auth config should override provider config
      expect(adapters.ai.config.api_key).toBe('new-secret-key');
      expect(adapters.ai.config.model).toBe('gpt-4o');
    });
  });

  describe('NoOp fallbacks for all capabilities', () => {
    test('creates NoOp for home_automation capability', async () => {
      mockRegistry.getAllCapabilities.mockReturnValue(['home_automation']);
      mockRegistry.getManifest.mockReturnValue(undefined);

      const loader = new IntegrationLoader({ registry: mockRegistry, logger: mockLogger });
      const adapters = await loader.loadForHousehold('default', {}, {}, {});

      expect(adapters.home_automation.isConnected()).toBe(false);
      expect(adapters.home_automation.getProviderName()).toBe('noop');
    });

    test('creates NoOp for messaging capability', async () => {
      mockRegistry.getAllCapabilities.mockReturnValue(['messaging']);
      mockRegistry.getManifest.mockReturnValue(undefined);

      const loader = new IntegrationLoader({ registry: mockRegistry, logger: mockLogger });
      const adapters = await loader.loadForHousehold('default', {}, {}, {});

      expect(adapters.messaging.isConfigured()).toBe(false);
    });

    test('creates NoOp for finance capability', async () => {
      mockRegistry.getAllCapabilities.mockReturnValue(['finance']);
      mockRegistry.getManifest.mockReturnValue(undefined);

      const loader = new IntegrationLoader({ registry: mockRegistry, logger: mockLogger });
      const adapters = await loader.loadForHousehold('default', {}, {}, {});

      expect(adapters.finance.isConfigured()).toBe(false);
    });

    test('returns empty object for unknown capability', async () => {
      mockRegistry.getAllCapabilities.mockReturnValue(['unknown_capability']);
      mockRegistry.getManifest.mockReturnValue(undefined);

      const loader = new IntegrationLoader({ registry: mockRegistry, logger: mockLogger });
      const adapters = await loader.loadForHousehold('default', {}, {}, {});

      expect(adapters.unknown_capability).toEqual({});
    });
  });
});
