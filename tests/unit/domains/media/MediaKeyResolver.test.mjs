import { describe, it, expect, beforeEach } from '@jest/globals';

import { MediaKeyResolver } from '#domains/media/MediaKeyResolver.mjs';
import { UnknownMediaSourceError, UnresolvableMediaKeyError } from '#domains/media/errors.mjs';

describe('MediaKeyResolver', () => {
  let resolver;

  beforeEach(() => {
    resolver = new MediaKeyResolver({
      knownSources: ['plex', 'watchlist', 'files', 'immich', 'youtube'],
      defaults: {
        patterns: [
          { match: '^\\d+$', source: 'plex' },
          { match: '^[a-f0-9-]{36}$', source: 'immich' },
          { match: '^[A-Za-z0-9_-]{11}$', source: 'youtube' },
          { match: '/', source: 'files' }
        ],
        fallbackChain: ['plex', 'watchlist', 'files']
      },
      apps: {
        fitness: { defaultSource: 'plex' },
        media: {
          patterns: [
            { match: '^\\d+$', source: 'plex' },
            { match: '^[a-z][a-z0-9-]*$', source: 'watchlist' }
          ],
          fallbackChain: ['plex', 'watchlist']
        }
      }
    });
  });

  describe('isCompound()', () => {
    it('returns true for known source prefixes', () => {
      expect(resolver.isCompound('plex:11282')).toBe(true);
      expect(resolver.isCompound('watchlist:fhe')).toBe(true);
      expect(resolver.isCompound('files:/path/to/file')).toBe(true);
      expect(resolver.isCompound('immich:abc-123')).toBe(true);
      expect(resolver.isCompound('youtube:dQw4w9WgXcQ')).toBe(true);
    });

    it('returns false for bare keys', () => {
      expect(resolver.isCompound('11282')).toBe(false);
      expect(resolver.isCompound('fhe')).toBe(false);
      expect(resolver.isCompound('some-video-id')).toBe(false);
    });

    it('returns false for unknown prefixes', () => {
      expect(resolver.isCompound('bogus:123')).toBe(false);
      expect(resolver.isCompound('unknown:abc')).toBe(false);
      expect(resolver.isCompound('vimeo:12345')).toBe(false);
    });

    it('returns false for null/undefined', () => {
      expect(resolver.isCompound(null)).toBe(false);
      expect(resolver.isCompound(undefined)).toBe(false);
    });
  });

  describe('parse()', () => {
    it('splits source and id correctly', () => {
      expect(resolver.parse('plex:11282')).toEqual({ source: 'plex', id: '11282' });
      expect(resolver.parse('watchlist:fhe')).toEqual({ source: 'watchlist', id: 'fhe' });
      expect(resolver.parse('youtube:dQw4w9WgXcQ')).toEqual({ source: 'youtube', id: 'dQw4w9WgXcQ' });
    });

    it('handles ids containing colons', () => {
      expect(resolver.parse('files:path/to:file')).toEqual({ source: 'files', id: 'path/to:file' });
      expect(resolver.parse('files:/some/path:with:colons')).toEqual({ source: 'files', id: '/some/path:with:colons' });
    });

    it('returns null source for bare keys', () => {
      expect(resolver.parse('11282')).toEqual({ source: '', id: '11282' });
      expect(resolver.parse('fhe')).toEqual({ source: '', id: 'fhe' });
    });
  });

  describe('resolve()', () => {
    it('passes through compound keys unchanged', () => {
      expect(resolver.resolve('plex:11282')).toBe('plex:11282');
      expect(resolver.resolve('watchlist:fhe')).toBe('watchlist:fhe');
      expect(resolver.resolve('files:/path/to/file')).toBe('files:/path/to/file');
    });

    it('uses app defaultSource when configured (fitness context)', () => {
      expect(resolver.resolve('11282', 'fitness')).toBe('plex:11282');
      expect(resolver.resolve('any-key', 'fitness')).toBe('plex:any-key');
    });

    it('matches numeric pattern to plex', () => {
      expect(resolver.resolve('11282')).toBe('plex:11282');
      expect(resolver.resolve('99999')).toBe('plex:99999');
      expect(resolver.resolve('1')).toBe('plex:1');
    });

    it('matches slug pattern to watchlist in media context', () => {
      expect(resolver.resolve('fhe', 'media')).toBe('watchlist:fhe');
      expect(resolver.resolve('my-watchlist-name', 'media')).toBe('watchlist:my-watchlist-name');
      expect(resolver.resolve('abc123', 'media')).toBe('watchlist:abc123');
    });

    it('matches UUID pattern to immich', () => {
      const uuid = '12345678-1234-1234-1234-123456789abc';
      expect(resolver.resolve(uuid)).toBe(`immich:${uuid}`);
    });

    it('matches 11-char pattern to youtube', () => {
      expect(resolver.resolve('dQw4w9WgXcQ')).toBe('youtube:dQw4w9WgXcQ');
      expect(resolver.resolve('abc-123_ABC')).toBe('youtube:abc-123_ABC');
    });

    it('matches path with slash to files', () => {
      expect(resolver.resolve('/path/to/file')).toBe('files:/path/to/file');
      expect(resolver.resolve('relative/path')).toBe('files:relative/path');
    });

    it('throws UnknownMediaSourceError for unknown source prefix', () => {
      expect(() => resolver.resolve('bogus:123')).toThrow(UnknownMediaSourceError);
      expect(() => resolver.resolve('unknown:abc')).toThrow(UnknownMediaSourceError);

      try {
        resolver.resolve('bogus:123');
      } catch (e) {
        expect(e.source).toBe('bogus');
        expect(e.knownSources).toEqual(['plex', 'watchlist', 'files', 'immich', 'youtube']);
      }
    });

    it('throws UnresolvableMediaKeyError for empty key', () => {
      expect(() => resolver.resolve(null)).toThrow(UnresolvableMediaKeyError);
      expect(() => resolver.resolve(undefined)).toThrow(UnresolvableMediaKeyError);

      try {
        resolver.resolve(null);
      } catch (e) {
        expect(e.key).toBe(null);
      }
    });

    it('uses fallback chain when no pattern matches', () => {
      // Key that doesn't match any pattern (not numeric, not UUID, not 11 chars, no slash)
      // but is not in media context so doesn't match slug pattern
      const resolverWithNoPatterns = new MediaKeyResolver({
        knownSources: ['plex', 'watchlist', 'files'],
        defaults: {
          patterns: [], // No patterns
          fallbackChain: ['plex', 'watchlist', 'files']
        },
        apps: {}
      });

      expect(resolverWithNoPatterns.resolve('random-key')).toBe('plex:random-key');
    });
  });

  describe('tryResolve()', () => {
    it('returns resolved key on success', () => {
      expect(resolver.tryResolve('plex:11282')).toBe('plex:11282');
      expect(resolver.tryResolve('11282')).toBe('plex:11282');
      expect(resolver.tryResolve('fhe', 'media')).toBe('watchlist:fhe');
    });

    it('returns null on failure', () => {
      expect(resolver.tryResolve('bogus:123')).toBe(null);
      expect(resolver.tryResolve(null)).toBe(null);
      expect(resolver.tryResolve(undefined)).toBe(null);
    });
  });

  describe('resolveAs()', () => {
    it('resolves bare key with explicit source', () => {
      expect(resolver.resolveAs('11282', 'plex')).toBe('plex:11282');
      expect(resolver.resolveAs('my-watchlist', 'watchlist')).toBe('watchlist:my-watchlist');
      expect(resolver.resolveAs('/path/to/file', 'files')).toBe('files:/path/to/file');
    });

    it('re-prefixes compound key with new source', () => {
      expect(resolver.resolveAs('plex:11282', 'watchlist')).toBe('watchlist:11282');
      expect(resolver.resolveAs('watchlist:fhe', 'plex')).toBe('plex:fhe');
      expect(resolver.resolveAs('files:/path/to/file', 'watchlist')).toBe('watchlist:/path/to/file');
    });

    it('throws for unknown source', () => {
      expect(() => resolver.resolveAs('123', 'bogus')).toThrow(UnknownMediaSourceError);
      expect(() => resolver.resolveAs('123', 'vimeo')).toThrow(UnknownMediaSourceError);

      try {
        resolver.resolveAs('123', 'bogus');
      } catch (e) {
        expect(e.source).toBe('bogus');
        expect(e.knownSources).toEqual(['plex', 'watchlist', 'files', 'immich', 'youtube']);
      }
    });
  });

  describe('getRulesForApp()', () => {
    it('returns app-specific rules when configured', () => {
      const mediaRules = resolver.getRulesForApp('media');
      expect(mediaRules.patterns).toHaveLength(2);
      expect(mediaRules.patterns[0].source).toBe('plex');
      expect(mediaRules.patterns[1].source).toBe('watchlist');
      expect(mediaRules.fallbackChain).toEqual(['plex', 'watchlist']);

      const fitnessRules = resolver.getRulesForApp('fitness');
      expect(fitnessRules.defaultSource).toBe('plex');
    });

    it('returns defaults for unconfigured app', () => {
      const rules = resolver.getRulesForApp('unknownapp');
      expect(rules.patterns).toHaveLength(4);
      expect(rules.fallbackChain).toEqual(['plex', 'watchlist', 'files']);
      expect(rules.defaultSource).toBe(null);
    });

    it('returns defaults when no context provided', () => {
      const rules = resolver.getRulesForApp(null);
      expect(rules.patterns).toHaveLength(4);
      expect(rules.fallbackChain).toEqual(['plex', 'watchlist', 'files']);
      expect(rules.defaultSource).toBe(null);

      const rulesUndefined = resolver.getRulesForApp(undefined);
      expect(rulesUndefined.patterns).toHaveLength(4);
    });
  });

  describe('Immich UUID pattern', () => {
    it('recognizes immich as known source', () => {
      const resolver = new MediaKeyResolver({
        knownSources: ['plex', 'immich', 'watchlist']
      });
      expect(resolver.isCompound('immich:abc-123-def')).toBe(true);
    });

    it('resolves UUID pattern to immich source', () => {
      const resolver = new MediaKeyResolver({
        knownSources: ['plex', 'immich', 'watchlist'],
        defaults: {
          patterns: [
            { match: '^\\d+$', source: 'plex' },
            { match: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$', source: 'immich' }
          ],
          fallbackChain: ['plex', 'immich']
        }
      });

      const result = resolver.resolve('931cb18f-2642-489b-bff5-c554e8ad4249');
      expect(result).toBe('immich:931cb18f-2642-489b-bff5-c554e8ad4249');
    });

    it('numeric ID still resolves to plex', () => {
      const resolver = new MediaKeyResolver({
        knownSources: ['plex', 'immich', 'watchlist'],
        defaults: {
          patterns: [
            { match: '^\\d+$', source: 'plex' },
            { match: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$', source: 'immich' }
          ],
          fallbackChain: ['plex', 'immich']
        }
      });

      const result = resolver.resolve('12345');
      expect(result).toBe('plex:12345');
    });
  });
});
