// tests/isolated/adapter/proxy/KomgaProxyAdapter.test.mjs
import { jest } from '@jest/globals';
import { KomgaProxyAdapter } from '#adapters/proxy/KomgaProxyAdapter.mjs';
import { isProxyAdapter } from '#system/proxy/IProxyAdapter.mjs';

describe('KomgaProxyAdapter', () => {
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  };

  describe('constructor', () => {
    test('creates instance with host and apiKey', () => {
      const adapter = new KomgaProxyAdapter({
        host: 'http://komga.local:25600',
        apiKey: 'test-api-key'
      });

      expect(adapter).toBeDefined();
    });

    test('creates instance with custom logger', () => {
      const adapter = new KomgaProxyAdapter(
        { host: 'http://komga.local:25600', apiKey: 'test-api-key' },
        { logger: mockLogger }
      );

      expect(adapter).toBeDefined();
    });

    test('normalizes host URL by removing trailing slash', () => {
      const adapter = new KomgaProxyAdapter({
        host: 'http://komga.local:25600/',
        apiKey: 'test-api-key'
      });

      expect(adapter.getBaseUrl()).toBe('http://komga.local:25600');
    });
  });

  describe('interface compliance', () => {
    test('implements IProxyAdapter interface', () => {
      const adapter = new KomgaProxyAdapter({
        host: 'http://komga.local:25600',
        apiKey: 'test-api-key'
      });

      expect(isProxyAdapter(adapter)).toBe(true);
    });
  });

  describe('getServiceName', () => {
    test('returns komga', () => {
      const adapter = new KomgaProxyAdapter({
        host: 'http://komga.local',
        apiKey: 'key'
      });

      expect(adapter.getServiceName()).toBe('komga');
    });
  });

  describe('getBaseUrl', () => {
    test('returns configured host', () => {
      const adapter = new KomgaProxyAdapter({
        host: 'http://komga.local:25600',
        apiKey: 'key'
      });

      expect(adapter.getBaseUrl()).toBe('http://komga.local:25600');
    });
  });

  describe('isConfigured', () => {
    test('returns true when both host and apiKey are set', () => {
      const adapter = new KomgaProxyAdapter({
        host: 'http://komga.local:25600',
        apiKey: 'test-api-key'
      });

      expect(adapter.isConfigured()).toBe(true);
    });

    test('returns false when host is missing', () => {
      const adapter = new KomgaProxyAdapter({
        host: '',
        apiKey: 'test-api-key'
      });

      expect(adapter.isConfigured()).toBe(false);
    });

    test('returns false when apiKey is missing', () => {
      const adapter = new KomgaProxyAdapter({
        host: 'http://komga.local:25600',
        apiKey: ''
      });

      expect(adapter.isConfigured()).toBe(false);
    });
  });

  describe('getAuthHeaders', () => {
    test('returns X-API-Key header', () => {
      const adapter = new KomgaProxyAdapter({
        host: 'http://komga.local',
        apiKey: 'my-secret-api-key'
      });

      expect(adapter.getAuthHeaders()).toEqual({
        'X-API-Key': 'my-secret-api-key'
      });
    });
  });

  describe('getAuthParams', () => {
    test('returns null (komga uses headers)', () => {
      const adapter = new KomgaProxyAdapter({
        host: 'http://komga.local',
        apiKey: 'key'
      });

      expect(adapter.getAuthParams()).toBeNull();
    });
  });

  describe('transformPath', () => {
    test('removes /komga prefix', () => {
      const adapter = new KomgaProxyAdapter({
        host: 'http://komga.local',
        apiKey: 'key'
      });

      expect(adapter.transformPath('/komga/api/v1/books/123')).toBe('/api/v1/books/123');
    });

    test('preserves paths without /komga prefix', () => {
      const adapter = new KomgaProxyAdapter({
        host: 'http://komga.local',
        apiKey: 'key'
      });

      expect(adapter.transformPath('/api/v1/books/123')).toBe('/api/v1/books/123');
    });
  });

  describe('getRetryConfig', () => {
    test('returns standard retry config', () => {
      const adapter = new KomgaProxyAdapter({
        host: 'http://komga.local',
        apiKey: 'key'
      });

      const config = adapter.getRetryConfig();

      expect(config.maxRetries).toBe(3);
      expect(config.delayMs).toBe(500);
    });
  });

  describe('shouldRetry', () => {
    test('returns true for rate limiting (429)', () => {
      const adapter = new KomgaProxyAdapter({
        host: 'http://komga.local',
        apiKey: 'key'
      });

      expect(adapter.shouldRetry(429)).toBe(true);
    });

    test('returns true for 5xx errors (transient)', () => {
      const adapter = new KomgaProxyAdapter({
        host: 'http://komga.local',
        apiKey: 'key'
      });

      expect(adapter.shouldRetry(500)).toBe(true);
      expect(adapter.shouldRetry(502)).toBe(true);
      expect(adapter.shouldRetry(503)).toBe(true);
      expect(adapter.shouldRetry(504)).toBe(true);
    });

    test('returns false for 4xx client errors (permanent)', () => {
      const adapter = new KomgaProxyAdapter({
        host: 'http://komga.local',
        apiKey: 'key'
      });

      expect(adapter.shouldRetry(400)).toBe(false);
      expect(adapter.shouldRetry(401)).toBe(false);
      expect(adapter.shouldRetry(403)).toBe(false);
      expect(adapter.shouldRetry(404)).toBe(false);
    });

    test('returns false for success codes', () => {
      const adapter = new KomgaProxyAdapter({
        host: 'http://komga.local',
        apiKey: 'key'
      });

      expect(adapter.shouldRetry(200)).toBe(false);
      expect(adapter.shouldRetry(201)).toBe(false);
    });
  });

  describe('getTimeout', () => {
    test('returns 60 seconds for page image loading', () => {
      const adapter = new KomgaProxyAdapter({
        host: 'http://komga.local',
        apiKey: 'key'
      });

      expect(adapter.getTimeout()).toBe(60000);
    });
  });
});
