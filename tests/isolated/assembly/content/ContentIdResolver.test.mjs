// tests/isolated/assembly/content/ContentIdResolver.test.mjs
import { describe, it, test, expect, beforeEach } from 'vitest';
import { ContentIdResolver } from '#apps/content/ContentIdResolver.mjs';

function createMockRegistry() {
  const sources = new Map();
  const prefixes = new Map();
  return {
    register(name, adapter) { sources.set(name, adapter); },
    get(name) { return sources.get(name); },
    resolveFromPrefix(prefix, value) {
      const entry = prefixes.get(prefix);
      if (!entry) return null;
      const localId = entry.transform ? entry.transform(value) : value;
      return { adapter: entry.adapter, localId };
    },
    addPrefix(prefix, adapter, transform) {
      prefixes.set(prefix, { adapter, transform });
    },
  };
}

function createMockAdapter(source) {
  return {
    source,
    prefixes: [{ prefix: source }],
    getItem: async (id) => ({ id: `${source}:${id}`, title: `Item ${id}` }),
    getList: async () => [],
    resolvePlayables: async () => [],
    resolveSiblings: async () => null,
  };
}

describe('ContentIdResolver', () => {
  let resolver;
  let registry;
  let plexAdapter, singalongAdapter, readalongAdapter, mediaAdapter, watchlistAdapter, filesAdapter, menuAdapter;

  beforeEach(() => {
    registry = createMockRegistry();
    plexAdapter = createMockAdapter('plex');
    singalongAdapter = createMockAdapter('singalong');
    readalongAdapter = createMockAdapter('readalong');
    mediaAdapter = createMockAdapter('media');
    watchlistAdapter = createMockAdapter('watchlist');
    filesAdapter = createMockAdapter('files');
    menuAdapter = createMockAdapter('menu');

    registry.register('plex', plexAdapter);
    registry.register('singalong', singalongAdapter);
    registry.register('readalong', readalongAdapter);
    registry.register('media', mediaAdapter);
    registry.register('watchlist', watchlistAdapter);
    registry.register('files', filesAdapter);
    registry.register('menu', menuAdapter);

    const systemAliases = {
      hymn: 'singalong:hymn',
      primary: 'singalong:primary',
      scripture: 'readalong:scripture',
      talk: 'readalong:talks',
      poem: 'readalong:poetry',
      // Simple source renames (empty path after colon)
      local: 'watchlist:',
      // Note: "media" is NOT a system alias — FileAdapter handles it via prefix (Layer 2)
      singing: 'singalong:',
      narrated: 'readalong:',
      list: 'menu:',
    };

    const householdAliases = {
      music: 'plex:12345',
    };

    resolver = new ContentIdResolver(registry, { systemAliases, householdAliases });
  });

  test('Layer 1: resolves exact source match', () => {
    const result = resolver.resolve('plex:457385');
    expect(result.source).toBe('plex');
    expect(result.localId).toBe('457385');
    expect(result.adapter).toBe(plexAdapter);
  });

  test('Layer 1: resolves singalong source', () => {
    const result = resolver.resolve('singalong:hymn/166');
    expect(result.source).toBe('singalong');
    expect(result.localId).toBe('hymn/166');
  });

  test('Layer 3: resolves system alias "hymn"', () => {
    const result = resolver.resolve('hymn:166');
    expect(result.source).toBe('singalong');
    expect(result.localId).toBe('hymn/166');
  });

  test('Layer 3: resolves system alias "scripture"', () => {
    const result = resolver.resolve('scripture:alma-32');
    expect(result.source).toBe('readalong');
    expect(result.localId).toBe('scripture/alma-32');
  });

  test('Layer 3: resolves system alias "talk"', () => {
    const result = resolver.resolve('talk:ldsgc');
    expect(result.source).toBe('readalong');
    expect(result.localId).toBe('talks/ldsgc');
  });

  test('Layer 3: resolves system alias "poem"', () => {
    const result = resolver.resolve('poem:remedy/01');
    expect(result.source).toBe('readalong');
    expect(result.localId).toBe('poetry/remedy/01');
  });

  test('Layer 5: resolves household alias', () => {
    const result = resolver.resolve('music:');
    expect(result.source).toBe('plex');
    expect(result.localId).toBe('12345');
  });

  test('Layer 4: defaults no-colon input to media adapter', () => {
    const result = resolver.resolve('sfx/intro');
    expect(result.source).toBe('media');
    expect(result.localId).toBe('sfx/intro');
  });

  test('handles space-after-colon YAML quirk', () => {
    const result = resolver.resolve('plex: 457385');
    expect(result.source).toBe('plex');
    expect(result.localId).toBe('457385');
  });

  test('returns null for completely unknown source', () => {
    const result = resolver.resolve('nonexistent:abc');
    expect(result).toBeNull();
  });

  test('returns null for null/undefined input', () => {
    expect(resolver.resolve(null)).toBeNull();
    expect(resolver.resolve(undefined)).toBeNull();
    expect(resolver.resolve('')).toBeNull();
  });

  test('Layer 2: uses registry prefix resolution before system aliases', () => {
    // Register a prefix transform in the mock registry
    registry.addPrefix('hymn', singalongAdapter, (id) => `hymn/${id}`);

    const result = resolver.resolve('hymn:166');
    expect(result.source).toBe('singalong');
    expect(result.localId).toBe('hymn/166');
  });

  // Simple rename aliases (empty aliasPath — moved from actionRouteParser SOURCE_ALIASES)
  test('Layer 3: resolves simple rename "local" → "watchlist"', () => {
    const result = resolver.resolve('local:TVApp');
    expect(result.source).toBe('watchlist');
    expect(result.localId).toBe('TVApp');
    expect(result.adapter).toBe(watchlistAdapter);
  });

  // Note: "media:X" resolves via Layer 2 (FileAdapter prefix) in the real system.
  // No system alias needed. Layer 2 is tested above via the hymn prefix test.

  test('Layer 3: resolves simple rename "singing" → "singalong"', () => {
    const result = resolver.resolve('singing:hymn/166');
    expect(result.source).toBe('singalong');
    expect(result.localId).toBe('hymn/166');
    expect(result.adapter).toBe(singalongAdapter);
  });

  test('Layer 3: resolves simple rename "narrated" → "readalong"', () => {
    const result = resolver.resolve('narrated:scripture/alma-32');
    expect(result.source).toBe('readalong');
    expect(result.localId).toBe('scripture/alma-32');
    expect(result.adapter).toBe(readalongAdapter);
  });

  test('Layer 3: resolves simple rename "list" → "menu"', () => {
    const result = resolver.resolve('list:fhe');
    expect(result.source).toBe('menu');
    expect(result.localId).toBe('fhe');
    expect(result.adapter).toBe(menuAdapter);
  });
});

describe('ContentIdResolver — Layer 4a bareNameMap', () => {
  let registry, mediaAdapter, menuAdapter, programAdapter;

  beforeEach(() => {
    registry = createMockRegistry();
    mediaAdapter = createMockAdapter('media');
    menuAdapter = createMockAdapter('menu');
    programAdapter = createMockAdapter('program');

    registry.register('media', mediaAdapter);
    registry.register('menu', menuAdapter);
    registry.register('program', programAdapter);
  });

  test('Layer 4a: bare name resolves to menu via bareNameMap', () => {
    const resolver = new ContentIdResolver(registry, { bareNameMap: { fhe: 'menu' } });
    const result = resolver.resolve('fhe');
    expect(result.source).toBe('menu');
    expect(result.localId).toBe('fhe');
    expect(result.adapter).toBe(menuAdapter);
  });

  test('Layer 4a: bare name resolves to program via bareNameMap', () => {
    const resolver = new ContentIdResolver(registry, { bareNameMap: { morningprogram: 'program' } });
    const result = resolver.resolve('morningprogram');
    expect(result.source).toBe('program');
    expect(result.localId).toBe('morningprogram');
    expect(result.adapter).toBe(programAdapter);
  });

  test('Layer 4b: bare name not in bareNameMap falls back to media', () => {
    const resolver = new ContentIdResolver(registry, { bareNameMap: { fhe: 'menu' } });
    const result = resolver.resolve('sfx/intro');
    expect(result.source).toBe('media');
    expect(result.localId).toBe('sfx/intro');
    expect(result.adapter).toBe(mediaAdapter);
  });

  test('Layer 4a: collision priority — menu wins over program', () => {
    // bareNameMap is built with menu last, so menu overwrites program for shared names
    const resolver = new ContentIdResolver(registry, { bareNameMap: { shared: 'menu' } });
    const result = resolver.resolve('shared');
    expect(result.source).toBe('menu');
    expect(result.localId).toBe('shared');
    expect(result.adapter).toBe(menuAdapter);
  });

  test('Layer 6: "fhe:" (empty rest) falls back to bareNameMap → menu', () => {
    // parseActionRouteId produces "fhe:" when path is empty — colon with empty rest
    const resolver = new ContentIdResolver(registry, { bareNameMap: { fhe: 'menu' } });
    const result = resolver.resolve('fhe:');
    expect(result.source).toBe('menu');
    expect(result.localId).toBe('fhe');
    expect(result.adapter).toBe(menuAdapter);
  });

  test('Layer 6: "unknown:" without bareNameMap entry still returns null', () => {
    const resolver = new ContentIdResolver(registry, { bareNameMap: { fhe: 'menu' } });
    const result = resolver.resolve('unknown:');
    expect(result).toBeNull();
  });
});
