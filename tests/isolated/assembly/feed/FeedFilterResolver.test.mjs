// tests/isolated/assembly/feed/FeedFilterResolver.test.mjs
import { FeedFilterResolver } from '#apps/feed/services/FeedFilterResolver.mjs';

describe('FeedFilterResolver', () => {
  let resolver;

  beforeEach(() => {
    resolver = new FeedFilterResolver({
      sourceTypes: ['reddit', 'youtube', 'googlenews', 'headlines', 'freshrss', 'komga', 'weather', 'health'],
      queryNames: ['scripture-bom', 'goodreads'],
      aliases: { photos: 'immich', news: 'headlines' },
    });
  });

  describe('null/empty input', () => {
    test('returns null for empty string', () => {
      expect(resolver.resolve('')).toBeNull();
    });

    test('returns null for undefined', () => {
      expect(resolver.resolve(undefined)).toBeNull();
    });
  });

  describe('Layer 1: tier match', () => {
    test('resolves bare tier name', () => {
      expect(resolver.resolve('compass')).toEqual({ type: 'tier', tier: 'compass' });
    });

    test('resolves all four tiers', () => {
      for (const tier of ['wire', 'library', 'scrapbook', 'compass']) {
        expect(resolver.resolve(tier)).toEqual({ type: 'tier', tier });
      }
    });

    test('tier match is case-insensitive', () => {
      expect(resolver.resolve('Compass')).toEqual({ type: 'tier', tier: 'compass' });
    });
  });

  describe('Layer 2: source type match', () => {
    test('resolves bare source type', () => {
      expect(resolver.resolve('reddit')).toEqual({
        type: 'source', sourceType: 'reddit', subsources: null,
      });
    });

    test('resolves source with subsources', () => {
      expect(resolver.resolve('reddit:worldnews,usnews')).toEqual({
        type: 'source', sourceType: 'reddit', subsources: ['worldnews', 'usnews'],
      });
    });

    test('resolves source with single subsource', () => {
      expect(resolver.resolve('youtube:veritasium')).toEqual({
        type: 'source', sourceType: 'youtube', subsources: ['veritasium'],
      });
    });

    test('trims whitespace from subsources', () => {
      expect(resolver.resolve('reddit:worldnews, usnews')).toEqual({
        type: 'source', sourceType: 'reddit', subsources: ['worldnews', 'usnews'],
      });
    });
  });

  describe('Layer 3: query name match (exact)', () => {
    test('resolves exact query name', () => {
      expect(resolver.resolve('scripture-bom')).toEqual({
        type: 'query', queryName: 'scripture-bom',
      });
    });

    test('does not partial-match query names', () => {
      expect(resolver.resolve('scripture')).toBeNull();
    });
  });

  describe('Layer 4: alias', () => {
    test('resolves alias to source type', () => {
      expect(resolver.resolve('photos')).toEqual({
        type: 'source', sourceType: 'immich', subsources: null,
      });
    });

    test('resolves alias with subsource', () => {
      expect(resolver.resolve('photos:felix')).toEqual({
        type: 'source', sourceType: 'immich', subsources: ['felix'],
      });
    });

    test('resolves alias to query name', () => {
      const r = new FeedFilterResolver({
        sourceTypes: ['reddit'],
        queryNames: ['scripture-bom'],
        aliases: { scripture: 'scripture-bom' },
      });
      expect(r.resolve('scripture')).toEqual({
        type: 'query', queryName: 'scripture-bom',
      });
    });

    test('alias to unregistered source type resolves as source (authoritative)', () => {
      const r = new FeedFilterResolver({
        sourceTypes: [],
        queryNames: [],
        aliases: { photos: 'immich' },
      });
      expect(r.resolve('photos')).toEqual({
        type: 'source', sourceType: 'immich', subsources: null,
      });
    });

    test('alias source type check wins over query name check (matches Layer 2/3 precedence)', () => {
      const r = new FeedFilterResolver({
        sourceTypes: ['dualname'],
        queryNames: ['dualname'],
        aliases: { shortcut: 'dualname' },
      });
      expect(r.resolve('shortcut')).toEqual({
        type: 'source', sourceType: 'dualname', subsources: null,
      });
    });
  });

  describe('Layer priority', () => {
    test('tier wins over source type if same name', () => {
      const r = new FeedFilterResolver({
        sourceTypes: ['wire'],
        queryNames: [],
        aliases: {},
      });
      expect(r.resolve('wire')).toEqual({ type: 'tier', tier: 'wire' });
    });

    test('source type wins over query name if same name', () => {
      const r = new FeedFilterResolver({
        sourceTypes: ['reddit'],
        queryNames: ['reddit'],
        aliases: {},
      });
      expect(r.resolve('reddit')).toEqual({
        type: 'source', sourceType: 'reddit', subsources: null,
      });
    });
  });

  describe('no match', () => {
    test('returns null for unknown prefix', () => {
      expect(resolver.resolve('xyzzy')).toBeNull();
    });

    test('returns null for unknown prefix with rest', () => {
      expect(resolver.resolve('xyzzy:foo')).toBeNull();
    });
  });
});
