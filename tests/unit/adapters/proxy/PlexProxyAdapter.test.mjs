// tests/unit/adapters/proxy/PlexProxyAdapter.test.mjs
import { jest } from '@jest/globals';
import { PlexProxyAdapter } from '../../../../backend/src/2_adapters/proxy/PlexProxyAdapter.mjs';

describe('PlexProxyAdapter', () => {
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  };

  describe('constructor', () => {
    test('creates instance with config', () => {
      const adapter = new PlexProxyAdapter({
        host: 'http://plex.local:32400',
        token: 'test-token'
      });

      expect(adapter).toBeDefined();
    });

    test('creates instance with custom logger', () => {
      const adapter = new PlexProxyAdapter(
        { host: 'http://plex.local:32400', token: 'test-token' },
        { logger: mockLogger }
      );

      expect(adapter).toBeDefined();
    });
  });

  describe('getServiceName', () => {
    test('returns plex', () => {
      const adapter = new PlexProxyAdapter({ host: 'http://plex.local', token: 'token' });
      expect(adapter.getServiceName()).toBe('plex');
    });
  });

  describe('getBaseUrl', () => {
    test('returns configured host', () => {
      const adapter = new PlexProxyAdapter({
        host: 'http://plex.local:32400',
        token: 'token'
      });

      expect(adapter.getBaseUrl()).toBe('http://plex.local:32400');
    });
  });

  describe('isConfigured', () => {
    test('returns true when host and token are set', () => {
      const adapter = new PlexProxyAdapter({
        host: 'http://plex.local:32400',
        token: 'test-token'
      });

      expect(adapter.isConfigured()).toBe(true);
    });

    test('returns false when host is missing', () => {
      const adapter = new PlexProxyAdapter({
        host: '',
        token: 'test-token'
      });

      expect(adapter.isConfigured()).toBe(false);
    });

    test('returns false when token is missing', () => {
      const adapter = new PlexProxyAdapter({
        host: 'http://plex.local:32400',
        token: ''
      });

      expect(adapter.isConfigured()).toBe(false);
    });
  });

  describe('getAuthParams', () => {
    test('returns X-Plex-Token param', () => {
      const adapter = new PlexProxyAdapter({
        host: 'http://plex.local',
        token: 'my-secret-token'
      });

      expect(adapter.getAuthParams()).toEqual({
        'X-Plex-Token': 'my-secret-token'
      });
    });
  });

  describe('getAuthHeaders', () => {
    test('returns null (plex uses query params)', () => {
      const adapter = new PlexProxyAdapter({
        host: 'http://plex.local',
        token: 'token'
      });

      expect(adapter.getAuthHeaders()).toBeNull();
    });
  });

  describe('transformPath', () => {
    test('removes /plex_proxy prefix', () => {
      const adapter = new PlexProxyAdapter({
        host: 'http://plex.local',
        token: 'token'
      });

      expect(adapter.transformPath('/plex_proxy/library/metadata/123')).toBe('/library/metadata/123');
    });

    test('preserves paths without prefix', () => {
      const adapter = new PlexProxyAdapter({
        host: 'http://plex.local',
        token: 'token'
      });

      expect(adapter.transformPath('/library/metadata/123')).toBe('/library/metadata/123');
    });
  });

  describe('getRetryConfig', () => {
    test('returns plex-specific retry config', () => {
      const adapter = new PlexProxyAdapter({
        host: 'http://plex.local',
        token: 'token'
      });

      const config = adapter.getRetryConfig();

      expect(config.maxRetries).toBe(20);
      expect(config.delayMs).toBe(500);
    });
  });

  describe('shouldRetry', () => {
    test('returns true for 4xx errors', () => {
      const adapter = new PlexProxyAdapter({
        host: 'http://plex.local',
        token: 'token'
      });

      expect(adapter.shouldRetry(400, 0)).toBe(true);
      expect(adapter.shouldRetry(404, 0)).toBe(true);
      expect(adapter.shouldRetry(429, 0)).toBe(true);
    });

    test('returns true for 5xx errors', () => {
      const adapter = new PlexProxyAdapter({
        host: 'http://plex.local',
        token: 'token'
      });

      expect(adapter.shouldRetry(500, 0)).toBe(true);
      expect(adapter.shouldRetry(502, 0)).toBe(true);
      expect(adapter.shouldRetry(503, 0)).toBe(true);
    });

    test('returns false for success codes', () => {
      const adapter = new PlexProxyAdapter({
        host: 'http://plex.local',
        token: 'token'
      });

      expect(adapter.shouldRetry(200, 0)).toBe(false);
      expect(adapter.shouldRetry(201, 0)).toBe(false);
      expect(adapter.shouldRetry(301, 0)).toBe(false);
    });
  });

  describe('getTimeout', () => {
    test('returns 60 seconds for media operations', () => {
      const adapter = new PlexProxyAdapter({
        host: 'http://plex.local',
        token: 'token'
      });

      expect(adapter.getTimeout()).toBe(60000);
    });
  });
});
