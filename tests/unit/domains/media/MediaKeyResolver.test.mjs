import { describe, it, expect, beforeEach } from '@jest/globals';

import { MediaKeyResolver } from '#domains/media/MediaKeyResolver.mjs';
import { UnknownMediaSourceError, UnresolvableMediaKeyError } from '#domains/media/errors.mjs';

describe('MediaKeyResolver', () => {
  let resolver;

  beforeEach(() => {
    resolver = new MediaKeyResolver({
      knownSources: ['plex', 'folder', 'filesystem', 'immich', 'youtube'],
      defaults: {
        patterns: [
          { match: '^\\d+$', source: 'plex' },
          { match: '^[a-f0-9-]{36}$', source: 'immich' },
          { match: '^[A-Za-z0-9_-]{11}$', source: 'youtube' },
          { match: '/', source: 'filesystem' }
        ],
        fallbackChain: ['plex', 'folder', 'filesystem']
      },
      apps: {
        fitness: { defaultSource: 'plex' },
        media: {
          patterns: [
            { match: '^\\d+$', source: 'plex' },
            { match: '^[a-z][a-z0-9-]*$', source: 'folder' }
          ],
          fallbackChain: ['plex', 'folder']
        }
      }
    });
  });

  describe('isCompound()', () => {
    it('returns true for known source prefixes', () => {
      expect(resolver.isCompound('plex:11282')).toBe(true);
      expect(resolver.isCompound('folder:fhe')).toBe(true);
      expect(resolver.isCompound('filesystem:/path/to/file')).toBe(true);
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
      expect(resolver.parse('folder:fhe')).toEqual({ source: 'folder', id: 'fhe' });
      expect(resolver.parse('youtube:dQw4w9WgXcQ')).toEqual({ source: 'youtube', id: 'dQw4w9WgXcQ' });
    });

    it('handles ids containing colons', () => {
      expect(resolver.parse('filesystem:path/to:file')).toEqual({ source: 'filesystem', id: 'path/to:file' });
      expect(resolver.parse('filesystem:/some/path:with:colons')).toEqual({ source: 'filesystem', id: '/some/path:with:colons' });
    });

    it('returns null source for bare keys', () => {
      expect(resolver.parse('11282')).toEqual({ source: '', id: '11282' });
      expect(resolver.parse('fhe')).toEqual({ source: '', id: 'fhe' });
    });
  });

  describe('resolve()', () => {
    it('passes through compound keys unchanged', () => {
      expect(resolver.resolve('plex:11282')).toBe('plex:11282');
      expect(resolver.resolve('folder:fhe')).toBe('folder:fhe');
      expect(resolver.resolve('filesystem:/path/to/file')).toBe('filesystem:/path/to/file');
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

    it('matches slug pattern to folder in media context', () => {
      expect(resolver.resolve('fhe', 'media')).toBe('folder:fhe');
      expect(resolver.resolve('my-folder-name', 'media')).toBe('folder:my-folder-name');
      expect(resolver.resolve('abc123', 'media')).toBe('folder:abc123');
    });

    it('matches UUID pattern to immich', () => {
      const uuid = '12345678-1234-1234-1234-123456789abc';
      expect(resolver.resolve(uuid)).toBe(`immich:${uuid}`);
    });

    it('matches 11-char pattern to youtube', () => {
      expect(resolver.resolve('dQw4w9WgXcQ')).toBe('youtube:dQw4w9WgXcQ');
      expect(resolver.resolve('abc-123_ABC')).toBe('youtube:abc-123_ABC');
    });

    it('matches path with slash to filesystem', () => {
      expect(resolver.resolve('/path/to/file')).toBe('filesystem:/path/to/file');
      expect(resolver.resolve('relative/path')).toBe('filesystem:relative/path');
    });

    it('throws UnknownMediaSourceError for unknown source prefix', () => {
      expect(() => resolver.resolve('bogus:123')).toThrow(UnknownMediaSourceError);
      expect(() => resolver.resolve('unknown:abc')).toThrow(UnknownMediaSourceError);

      try {
        resolver.resolve('bogus:123');
      } catch (e) {
        expect(e.source).toBe('bogus');
        expect(e.knownSources).toEqual(['plex', 'folder', 'filesystem', 'immich', 'youtube']);
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
        knownSources: ['plex', 'folder', 'filesystem'],
        defaults: {
          patterns: [], // No patterns
          fallbackChain: ['plex', 'folder', 'filesystem']
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
      expect(resolver.tryResolve('fhe', 'media')).toBe('folder:fhe');
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
      expect(resolver.resolveAs('my-folder', 'folder')).toBe('folder:my-folder');
      expect(resolver.resolveAs('/path/to/file', 'filesystem')).toBe('filesystem:/path/to/file');
    });

    it('re-prefixes compound key with new source', () => {
      expect(resolver.resolveAs('plex:11282', 'folder')).toBe('folder:11282');
      expect(resolver.resolveAs('folder:fhe', 'plex')).toBe('plex:fhe');
      expect(resolver.resolveAs('filesystem:/path/to/file', 'folder')).toBe('folder:/path/to/file');
    });

    it('throws for unknown source', () => {
      expect(() => resolver.resolveAs('123', 'bogus')).toThrow(UnknownMediaSourceError);
      expect(() => resolver.resolveAs('123', 'vimeo')).toThrow(UnknownMediaSourceError);

      try {
        resolver.resolveAs('123', 'bogus');
      } catch (e) {
        expect(e.source).toBe('bogus');
        expect(e.knownSources).toEqual(['plex', 'folder', 'filesystem', 'immich', 'youtube']);
      }
    });
  });

  describe('getRulesForApp()', () => {
    it('returns app-specific rules when configured', () => {
      const mediaRules = resolver.getRulesForApp('media');
      expect(mediaRules.patterns).toHaveLength(2);
      expect(mediaRules.patterns[0].source).toBe('plex');
      expect(mediaRules.patterns[1].source).toBe('folder');
      expect(mediaRules.fallbackChain).toEqual(['plex', 'folder']);

      const fitnessRules = resolver.getRulesForApp('fitness');
      expect(fitnessRules.defaultSource).toBe('plex');
    });

    it('returns defaults for unconfigured app', () => {
      const rules = resolver.getRulesForApp('unknownapp');
      expect(rules.patterns).toHaveLength(4);
      expect(rules.fallbackChain).toEqual(['plex', 'folder', 'filesystem']);
      expect(rules.defaultSource).toBe(null);
    });

    it('returns defaults when no context provided', () => {
      const rules = resolver.getRulesForApp(null);
      expect(rules.patterns).toHaveLength(4);
      expect(rules.fallbackChain).toEqual(['plex', 'folder', 'filesystem']);
      expect(rules.defaultSource).toBe(null);

      const rulesUndefined = resolver.getRulesForApp(undefined);
      expect(rulesUndefined.patterns).toHaveLength(4);
    });
  });
});
