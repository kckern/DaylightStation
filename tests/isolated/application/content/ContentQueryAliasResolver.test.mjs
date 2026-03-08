// tests/isolated/application/content/ContentQueryAliasResolver.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { ContentQueryAliasResolver } from '#apps/content/services/ContentQueryAliasResolver.mjs';

function createMockRegistry(sources = []) {
  return {
    get: vi.fn(() => null),
    list: vi.fn(() => sources),
    getByProvider: vi.fn(() => []),
    getByCategory: vi.fn(() => []),
  };
}

function createMockConfigService() {
  return {
    getAppConfig: vi.fn(() => null),
  };
}

describe('ContentQueryAliasResolver', () => {
  describe('prefix alias resolution', () => {
    it('resolves "primary" to singalong source via prefixAliases', () => {
      const registry = createMockRegistry(['singalong', 'plex', 'abs']);
      registry.get.mockImplementation(s => s === 'singalong' ? { source: 'singalong' } : null);
      const configService = createMockConfigService();
      const prefixAliases = {
        primary: 'singalong:primary',
        hymn: 'singalong:hymn',
        scripture: 'readalong:scripture',
      };

      const resolver = new ContentQueryAliasResolver({ registry, configService, prefixAliases });
      const result = resolver.resolveContentQuery('primary');

      expect(result.sources).toEqual(['singalong']);
      expect(result.isPassthrough).toBeFalsy();
    });

    it('resolves "hymn" to singalong source via prefixAliases', () => {
      const registry = createMockRegistry(['singalong', 'plex']);
      registry.get.mockImplementation(s => s === 'singalong' ? { source: 'singalong' } : null);
      const configService = createMockConfigService();
      const prefixAliases = { hymn: 'singalong:hymn' };

      const resolver = new ContentQueryAliasResolver({ registry, configService, prefixAliases });
      const result = resolver.resolveContentQuery('hymn');

      expect(result.sources).toEqual(['singalong']);
    });

    it('resolves "scripture" to readalong source via prefixAliases', () => {
      const registry = createMockRegistry(['readalong', 'plex']);
      registry.get.mockImplementation(s => s === 'readalong' ? { source: 'readalong' } : null);
      const configService = createMockConfigService();
      const prefixAliases = { scripture: 'readalong:scripture' };

      const resolver = new ContentQueryAliasResolver({ registry, configService, prefixAliases });
      const result = resolver.resolveContentQuery('scripture');

      expect(result.sources).toEqual(['readalong']);
    });

    it('falls through to passthrough when prefix not in any alias system', () => {
      const registry = createMockRegistry(['plex', 'abs']);
      const configService = createMockConfigService();
      const prefixAliases = { primary: 'singalong:primary' };

      const resolver = new ContentQueryAliasResolver({ registry, configService, prefixAliases });
      const result = resolver.resolveContentQuery('unknownprefix');

      expect(result.isPassthrough).toBe(true);
    });

    it('user config aliases take priority over prefixAliases', () => {
      const registry = createMockRegistry(['custom-source', 'singalong']);
      registry.get.mockImplementation(s => s === 'custom-source' ? { source: 'custom-source' } : null);
      const configService = createMockConfigService();
      configService.getAppConfig.mockReturnValue({
        primary: 'source:custom-source',
      });
      const prefixAliases = { primary: 'singalong:primary' };

      const resolver = new ContentQueryAliasResolver({ registry, configService, prefixAliases });
      const result = resolver.resolveContentQuery('primary');

      expect(result.sources).toEqual(['custom-source']);
      expect(result.isUserDefined).toBe(true);
    });

    it('built-in aliases take priority over prefixAliases', () => {
      const registry = createMockRegistry(['plex', 'singalong']);
      const configService = createMockConfigService();
      const prefixAliases = { music: 'singalong:hymn' };

      const resolver = new ContentQueryAliasResolver({ registry, configService, prefixAliases });
      const result = resolver.resolveContentQuery('music');

      expect(result.isBuiltIn).toBe(true);
    });

    it('works without prefixAliases (backwards compatible)', () => {
      const registry = createMockRegistry(['plex']);
      const configService = createMockConfigService();

      const resolver = new ContentQueryAliasResolver({ registry, configService });
      const result = resolver.resolveContentQuery('primary');

      expect(result.isPassthrough).toBe(true);
    });
  });
});
