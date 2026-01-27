// tests/unit/suite/system/registries/AdapterRegistry.test.mjs
import { jest } from '@jest/globals';
import { AdapterRegistry } from '#backend/src/0_system/registries/AdapterRegistry.mjs';

describe('AdapterRegistry', () => {
  describe('discover()', () => {
    test('discovers manifest files and indexes by capability/provider', async () => {
      const registry = new AdapterRegistry();

      // Mock glob to return test manifests
      registry._glob = jest.fn().mockResolvedValue([
        '/fake/path/plex/manifest.mjs',
        '/fake/path/openai/manifest.mjs',
      ]);

      // Mock dynamic import
      registry._import = jest.fn()
        .mockResolvedValueOnce({
          default: {
            provider: 'plex',
            capability: 'media',
            displayName: 'Plex Media Server',
            adapter: () => Promise.resolve({ default: class PlexAdapter {} }),
          }
        })
        .mockResolvedValueOnce({
          default: {
            provider: 'openai',
            capability: 'ai',
            displayName: 'OpenAI',
            adapter: () => Promise.resolve({ default: class OpenAIAdapter {} }),
          }
        });

      await registry.discover();

      expect(registry.getProviders('media')).toContain('plex');
      expect(registry.getProviders('ai')).toContain('openai');
      expect(registry.getAllCapabilities()).toContain('media');
      expect(registry.getAllCapabilities()).toContain('ai');
    });
  });

  describe('getManifest()', () => {
    test('returns manifest for capability/provider pair', async () => {
      const registry = new AdapterRegistry();
      registry._glob = jest.fn().mockResolvedValue(['/fake/path/plex/manifest.mjs']);
      registry._import = jest.fn().mockResolvedValue({
        default: {
          provider: 'plex',
          capability: 'media',
          displayName: 'Plex Media Server',
          adapter: () => Promise.resolve({ default: class {} }),
        }
      });

      await registry.discover();

      const manifest = registry.getManifest('media', 'plex');
      expect(manifest.provider).toBe('plex');
      expect(manifest.displayName).toBe('Plex Media Server');
    });

    test('returns undefined for unknown capability/provider', async () => {
      const registry = new AdapterRegistry();
      registry._glob = jest.fn().mockResolvedValue([]);
      await registry.discover();

      expect(registry.getManifest('unknown', 'fake')).toBeUndefined();
    });
  });

  describe('getProviders()', () => {
    test('returns empty array for unknown capability', async () => {
      const registry = new AdapterRegistry();
      registry._glob = jest.fn().mockResolvedValue([]);
      await registry.discover();

      expect(registry.getProviders('unknown')).toEqual([]);
    });

    test('returns all providers for a capability', async () => {
      const registry = new AdapterRegistry();
      registry._glob = jest.fn().mockResolvedValue([
        '/fake/path/plex/manifest.mjs',
        '/fake/path/filesystem/manifest.mjs',
      ]);
      registry._import = jest.fn()
        .mockResolvedValueOnce({
          default: { provider: 'plex', capability: 'media', displayName: 'Plex' }
        })
        .mockResolvedValueOnce({
          default: { provider: 'filesystem', capability: 'media', displayName: 'Filesystem' }
        });

      await registry.discover();

      const providers = registry.getProviders('media');
      expect(providers).toContain('plex');
      expect(providers).toContain('filesystem');
      expect(providers.length).toBe(2);
    });
  });

  describe('error handling', () => {
    test('skips manifests missing capability', async () => {
      const registry = new AdapterRegistry();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      registry._glob = jest.fn().mockResolvedValue(['/fake/path/bad/manifest.mjs']);
      registry._import = jest.fn().mockResolvedValue({
        default: { provider: 'bad', displayName: 'Bad Manifest' } // missing capability
      });

      await registry.discover();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing capability or provider'));
      expect(registry.getAllCapabilities()).toEqual([]);

      warnSpy.mockRestore();
    });

    test('skips manifests missing provider', async () => {
      const registry = new AdapterRegistry();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      registry._glob = jest.fn().mockResolvedValue(['/fake/path/bad/manifest.mjs']);
      registry._import = jest.fn().mockResolvedValue({
        default: { capability: 'media', displayName: 'Bad Manifest' } // missing provider
      });

      await registry.discover();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing capability or provider'));

      warnSpy.mockRestore();
    });

    test('continues loading after manifest import error', async () => {
      const registry = new AdapterRegistry();
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      registry._glob = jest.fn().mockResolvedValue([
        '/fake/path/broken/manifest.mjs',
        '/fake/path/good/manifest.mjs',
      ]);
      registry._import = jest.fn()
        .mockRejectedValueOnce(new Error('Import failed'))
        .mockResolvedValueOnce({
          default: { provider: 'good', capability: 'media', displayName: 'Good' }
        });

      await registry.discover();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load manifest'),
        'Import failed'
      );
      expect(registry.getProviders('media')).toContain('good');

      errorSpy.mockRestore();
    });
  });

  describe('constructor', () => {
    test('accepts custom adaptersRoot', () => {
      const registry = new AdapterRegistry({ adaptersRoot: '/custom/path' });
      // The custom path is used internally, we can verify via _glob calls
      registry._glob = jest.fn().mockResolvedValue([]);
      registry.discover();

      expect(registry._glob).toHaveBeenCalledWith('**/manifest.mjs', '/custom/path');
    });
  });
});
