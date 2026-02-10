// tests/unit/infrastructure/bootstrap.test.mjs
import { jest } from '@jest/globals';
import { createContentRegistry, createFitnessSyncerAdapter } from '#backend/src/0_system/bootstrap.mjs';

describe('bootstrap', () => {
  describe('createContentRegistry', () => {
    it('registers FileAdapter', () => {
      const { registry } = createContentRegistry({
        mediaBasePath: '/media',
        plex: {
          host: 'http://localhost:32400',
          token: 'test'
        }
      });

      const adapter = registry.get('files');
      expect(adapter).not.toBeNull();
      expect(adapter.source).toBe('files');
    });

    it('registers PlexAdapter', () => {
      const { registry } = createContentRegistry({
        mediaBasePath: '/media',
        plex: {
          host: 'http://localhost:32400',
          token: 'test'
        }
      });

      const adapter = registry.get('plex');
      expect(adapter).not.toBeNull();
      expect(adapter.source).toBe('plex');
    });

    it('registers LocalContentAdapter when dataPath provided', () => {
      const { registry } = createContentRegistry({
        mediaBasePath: '/media',
        plex: {
          host: 'http://localhost:32400',
          token: 'test'
        },
        dataPath: '/data'
      });

      const adapter = registry.get('local-content');
      expect(adapter).not.toBeNull();
      expect(adapter.source).toBe('local-content');
    });

    it('registers FolderAdapter when watchlistPath provided', () => {
      const { registry } = createContentRegistry({
        mediaBasePath: '/media',
        plex: {
          host: 'http://localhost:32400',
          token: 'test'
        },
        dataPath: '/data',
        watchlistPath: '/data/state/watchlist'
      });

      const adapter = registry.get('watchlist');
      expect(adapter).not.toBeNull();
      expect(adapter.source).toBe('watchlist');
    });

    it('does not register LocalContentAdapter without mediaBasePath', () => {
      const { registry } = createContentRegistry({
        plex: {
          host: 'http://localhost:32400',
          token: 'test'
        },
        dataPath: '/data'
      });

      const adapter = registry.get('local-content');
      expect(adapter).toBeUndefined();
    });

    it('does not register LocalContentAdapter without dataPath', () => {
      const { registry } = createContentRegistry({
        mediaBasePath: '/media',
        plex: {
          host: 'http://localhost:32400',
          token: 'test'
        }
      });

      const adapter = registry.get('local-content');
      expect(adapter).toBeUndefined();
    });
  });

  describe('createFitnessSyncerAdapter', () => {
    const mockHttpClient = {
      get: jest.fn(),
      post: jest.fn()
    };

    const mockAuthStore = {
      get: jest.fn(),
      set: jest.fn()
    };

    const mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    it('creates FitnessSyncerAdapter with required dependencies', () => {
      const adapter = createFitnessSyncerAdapter({
        httpClient: mockHttpClient,
        authStore: mockAuthStore,
        logger: mockLogger
      });

      expect(adapter).toBeDefined();
      expect(typeof adapter.getAccessToken).toBe('function');
      expect(typeof adapter.harvest).toBe('function');
      expect(typeof adapter.getSourceId).toBe('function');
    });

    it('creates adapter with optional OAuth credentials', () => {
      const adapter = createFitnessSyncerAdapter({
        httpClient: mockHttpClient,
        authStore: mockAuthStore,
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        logger: mockLogger
      });

      expect(adapter).toBeDefined();
    });

    it('creates adapter with custom cooldown', () => {
      const adapter = createFitnessSyncerAdapter({
        httpClient: mockHttpClient,
        authStore: mockAuthStore,
        cooldownMinutes: 10,
        logger: mockLogger
      });

      expect(adapter).toBeDefined();
      // Cooldown is internal, but adapter should be created without error
    });

    it('uses default logger if not provided', () => {
      const adapter = createFitnessSyncerAdapter({
        httpClient: mockHttpClient,
        authStore: mockAuthStore
      });

      expect(adapter).toBeDefined();
    });

    it('throws if httpClient is missing', () => {
      expect(() => createFitnessSyncerAdapter({
        authStore: mockAuthStore,
        logger: mockLogger
      })).toThrow('FitnessSyncerAdapter requires httpClient');
    });

    it('throws if authStore is missing', () => {
      expect(() => createFitnessSyncerAdapter({
        httpClient: mockHttpClient,
        logger: mockLogger
      })).toThrow('FitnessSyncerAdapter requires authStore');
    });
  });
});
