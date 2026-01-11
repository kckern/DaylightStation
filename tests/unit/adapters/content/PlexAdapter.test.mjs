// tests/unit/adapters/content/PlexAdapter.test.mjs
import { PlexAdapter } from '../../../../backend/src/2_adapters/content/media/plex/PlexAdapter.mjs';
import { PlexClient } from '../../../../backend/src/2_adapters/content/media/plex/PlexClient.mjs';

describe('PlexAdapter', () => {
  describe('constructor', () => {
    test('has correct source and prefixes', () => {
      const adapter = new PlexAdapter({
        host: 'http://localhost:32400',
        token: 'test-token'
      });
      expect(adapter.source).toBe('plex');
      expect(adapter.prefixes).toContainEqual({ prefix: 'plex' });
    });

    test('throws error when host is missing', () => {
      expect(() => new PlexAdapter({})).toThrow('PlexAdapter requires host');
    });

    test('normalizes host URL by removing trailing slash', () => {
      const adapter = new PlexAdapter({
        host: 'http://localhost:32400/',
        token: 'test-token'
      });
      expect(adapter.host).toBe('http://localhost:32400');
    });
  });

  describe('getStoragePath', () => {
    test('returns plex as storage path', async () => {
      const adapter = new PlexAdapter({
        host: 'http://localhost:32400',
        token: 'test-token'
      });
      const storagePath = await adapter.getStoragePath('12345');
      expect(storagePath).toBe('plex');
    });
  });
});

describe('PlexClient', () => {
  describe('constructor', () => {
    test('throws error when host is missing', () => {
      expect(() => new PlexClient({})).toThrow('PlexClient requires host');
    });

    test('normalizes host URL by removing trailing slash', () => {
      const client = new PlexClient({
        host: 'http://localhost:32400/',
        token: 'test-token'
      });
      expect(client.host).toBe('http://localhost:32400');
    });

    test('accepts empty token', () => {
      const client = new PlexClient({
        host: 'http://localhost:32400'
      });
      expect(client.token).toBe('');
    });
  });
});
