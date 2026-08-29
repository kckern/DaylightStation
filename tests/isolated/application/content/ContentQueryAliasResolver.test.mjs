// tests/isolated/application/content/ContentQueryAliasResolver.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { ContentQueryAliasResolver } from '#apps/content/services/ContentQueryAliasResolver.mjs';

function createMockContentCatalog(sources = []) {
  const knownSources = new Set(sources);
  return {
    hasSource: vi.fn(source => knownSources.has(source)),
    sourceNames: vi.fn(() => sources),
    resolveQueryScope: vi.fn((selector, kind = 'auto') => ({
      kind: kind === 'auto' ? null : kind,
      sources: kind === 'source' && knownSources.has(selector) ? [selector] : [],
    })),
  };
}

describe('ContentQueryAliasResolver', () => {
  describe('semantic catalog scope resolution', () => {
    it('uses the catalog classification for an unconfigured provider prefix', () => {
      const contentCatalog = createMockContentCatalog(['plex-movies', 'plex-shows']);
      contentCatalog.resolveQueryScope.mockImplementation((selector, kind = 'auto') => (
        selector === 'plex' && kind === 'auto'
          ? { kind: 'provider', sources: ['plex-movies', 'plex-shows'] }
          : { kind: null, sources: [] }
      ));

      const resolver = new ContentQueryAliasResolver({
        contentCatalog,
      });

      expect(resolver.resolveContentQuery('plex')).toMatchObject({
        intent: 'provider-plex',
        sources: ['plex-movies', 'plex-shows'],
        isRegistryResolved: true,
      });
    });

    it('uses an explicit category scope for configured aliases', () => {
      const contentCatalog = createMockContentCatalog(['immich', 'filesystem-canvas']);
      contentCatalog.resolveQueryScope.mockImplementation((selector, kind = 'auto') => (
        selector === 'gallery' && kind === 'category'
          ? { kind: 'category', sources: ['immich', 'filesystem-canvas'] }
          : { kind: null, sources: [] }
      ));
      const resolver = new ContentQueryAliasResolver({
        contentCatalog,
        loadUserAliases: () => ({ memories: 'category:gallery' }),
      });

      expect(resolver.resolveContentQuery('memories')).toMatchObject({
        sources: ['immich', 'filesystem-canvas'],
        isUserDefined: true,
      });
      expect(contentCatalog.resolveQueryScope).toHaveBeenCalledWith('gallery', 'category');
    });
  });

  describe('prefix alias resolution', () => {
    it('resolves "primary" to singalong source via prefixAliases', () => {
      const contentCatalog = createMockContentCatalog(['singalong', 'plex', 'abs']);
      const prefixAliases = {
        primary: 'singalong:primary',
        hymn: 'singalong:hymn',
        scripture: 'readalong:scripture',
      };

      const resolver = new ContentQueryAliasResolver({ contentCatalog, prefixAliases });
      const result = resolver.resolveContentQuery('primary');

      expect(result.sources).toEqual(['singalong']);
      expect(result.isPassthrough).toBeFalsy();
    });

    it('resolves "hymn" to singalong source via prefixAliases', () => {
      const contentCatalog = createMockContentCatalog(['singalong', 'plex']);
      const prefixAliases = { hymn: 'singalong:hymn' };

      const resolver = new ContentQueryAliasResolver({ contentCatalog, prefixAliases });
      const result = resolver.resolveContentQuery('hymn');

      expect(result.sources).toEqual(['singalong']);
    });

    it('resolves "scripture" to readalong source via prefixAliases', () => {
      const contentCatalog = createMockContentCatalog(['readalong', 'plex']);
      const prefixAliases = { scripture: 'readalong:scripture' };

      const resolver = new ContentQueryAliasResolver({ contentCatalog, prefixAliases });
      const result = resolver.resolveContentQuery('scripture');

      expect(result.sources).toEqual(['readalong']);
    });

    it('falls through to passthrough when prefix not in any alias system', () => {
      const contentCatalog = createMockContentCatalog(['plex', 'abs']);
      const prefixAliases = { primary: 'singalong:primary' };

      const resolver = new ContentQueryAliasResolver({ contentCatalog, prefixAliases });
      const result = resolver.resolveContentQuery('unknownprefix');

      expect(result.isPassthrough).toBe(true);
    });

    it('user config aliases take priority over prefixAliases', () => {
      const contentCatalog = createMockContentCatalog(['custom-source', 'singalong']);
      const prefixAliases = { primary: 'singalong:primary' };

      const resolver = new ContentQueryAliasResolver({
        contentCatalog,
        loadUserAliases: () => ({ primary: 'source:custom-source' }),
        prefixAliases,
      });
      const result = resolver.resolveContentQuery('primary');

      expect(result.sources).toEqual(['custom-source']);
      expect(result.isUserDefined).toBe(true);
    });

    it('built-in aliases take priority over prefixAliases', () => {
      const contentCatalog = createMockContentCatalog(['plex', 'singalong']);
      const prefixAliases = { music: 'singalong:hymn' };

      const resolver = new ContentQueryAliasResolver({ contentCatalog, prefixAliases });
      const result = resolver.resolveContentQuery('music');

      expect(result.isBuiltIn).toBe(true);
    });

    it('works without prefixAliases (backwards compatible)', () => {
      const contentCatalog = createMockContentCatalog(['plex']);

      const resolver = new ContentQueryAliasResolver({ contentCatalog });
      const result = resolver.resolveContentQuery('primary');

      expect(result.isPassthrough).toBe(true);
    });
  });
});
