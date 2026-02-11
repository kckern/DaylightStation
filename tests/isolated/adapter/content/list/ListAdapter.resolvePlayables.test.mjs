// tests/isolated/adapter/content/list/ListAdapter.resolvePlayables.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock FileIO so ListAdapter can be imported without touching the filesystem
vi.mock('#system/utils/FileIO.mjs', () => ({
  dirExists: vi.fn(() => false),
  listEntries: vi.fn(() => []),
  fileExists: vi.fn(() => false),
  loadYaml: vi.fn(() => null),
}));

const { ListAdapter } = await import('#adapters/content/list/ListAdapter.mjs');

// ── Helpers ───────────────────────────────────────────────────────────

function makeEpisodes(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `plex:ep${i + 1}`,
    localId: `ep${i + 1}`,
    title: `Episode ${i + 1}`,
    mediaUrl: `/media/ep${i + 1}.mp4`,
  }));
}

function makeMockRegistry(episodes) {
  return {
    resolve: vi.fn(() => ({
      adapter: {
        resolvePlayables: vi.fn(async () => episodes),
        getStoragePath: vi.fn(() => 'plex'),
      },
      localId: 'show123',
    })),
  };
}

function makeMockMemory(progressMap = {}) {
  return {
    get: vi.fn(async (mediaKey) => {
      const percent = progressMap[mediaKey] ?? 0;
      return { percent };
    }),
    getAll: vi.fn(async () => {
      return Object.entries(progressMap).map(([itemId, percent]) => ({
        itemId,
        percent,
      }));
    }),
  };
}

function makeAdapter({ registry, mediaProgressMemory } = {}) {
  const adapter = new ListAdapter({
    dataPath: '/fake/data',
    registry: registry || null,
    mediaProgressMemory: mediaProgressMemory || null,
  });
  return adapter;
}

/** Build a normalized list cache entry (matches normalizeListConfig output) */
function makeNormalizedList(items) {
  return {
    title: undefined,
    description: undefined,
    image: undefined,
    metadata: {},
    sections: [{ items: items.map(i => ({
      title: i.label || i.title,
      play: { contentId: i.input?.replace(/^(\w+):\s+/, '$1:') || i.play?.contentId },
      ...(i.uid ? { uid: i.uid } : {}),
    })) }]
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('ListAdapter.resolvePlayables — program "next up" resolution', () => {
  const episodes = makeEpisodes(5);

  it('program returns 1 item per slot (not all episodes)', async () => {
    const registry = makeMockRegistry(episodes);
    const memory = makeMockMemory(); // all at 0% → picks first unwatched
    const adapter = makeAdapter({ registry, mediaProgressMemory: memory });

    // Pre-populate list cache: program with one slot pointing to a plex show
    adapter._listCache.set('programs:morning-program', makeNormalizedList([
      { label: 'Kids Show', input: 'plex:show123' },
    ]));

    const result = await adapter.resolvePlayables('program:morning-program', { applySchedule: false });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('plex:ep1');
  });

  it('prefers in-progress episode over unwatched', async () => {
    const registry = makeMockRegistry(episodes);
    const memory = makeMockMemory({
      ep1: 0,
      ep2: 0,
      ep3: 45, // in-progress
      ep4: 0,
      ep5: 0,
    });
    const adapter = makeAdapter({ registry, mediaProgressMemory: memory });

    adapter._listCache.set('programs:test-program', makeNormalizedList([
      { label: 'Show', input: 'plex:show123' },
    ]));

    const result = await adapter.resolvePlayables('program:test-program', { applySchedule: false });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('plex:ep3');
  });

  it('falls back to first item when all episodes are watched', async () => {
    const registry = makeMockRegistry(episodes);
    const memory = makeMockMemory({
      ep1: 95,
      ep2: 95,
      ep3: 95,
      ep4: 95,
      ep5: 95,
    });
    const adapter = makeAdapter({ registry, mediaProgressMemory: memory });

    adapter._listCache.set('programs:watched-program', makeNormalizedList([
      { label: 'Show', input: 'plex:show123' },
    ]));

    const result = await adapter.resolvePlayables('program:watched-program', { applySchedule: false });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('plex:ep1'); // fallback to first
  });

  it('menu still returns ALL playables (not affected by program fix)', async () => {
    const registry = makeMockRegistry(episodes);
    const memory = makeMockMemory();
    const adapter = makeAdapter({ registry, mediaProgressMemory: memory });

    adapter._listCache.set('menus:main-menu', makeNormalizedList([
      { label: 'Show', input: 'plex:show123' },
    ]));

    const result = await adapter.resolvePlayables('menu:main-menu');

    expect(result).toHaveLength(5); // all episodes, not just 1
  });
});

// ── Fast path tests ──────────────────────────────────────────────────

describe('_getNextPlayableFromChild — Plex fast path', () => {
  it('uses loadPlayableItemFromKey when available (skips resolvePlayables)', async () => {
    const fastItem = { id: 'plex:ep42', title: 'Smart Pick', mediaUrl: '/media/ep42.mp4' };
    const resolvePlayables = vi.fn(async () => { throw new Error('should not be called'); });
    const loadPlayableItemFromKey = vi.fn(async () => fastItem);

    const registry = {
      resolve: vi.fn(() => ({
        adapter: {
          loadPlayableItemFromKey,
          resolvePlayables,
          getStoragePath: vi.fn(async () => 'plex/17_lectures'),
          source: 'plex',
        },
        localId: 'show123',
      })),
    };
    const memory = makeMockMemory();
    const adapter = makeAdapter({ registry, mediaProgressMemory: memory });

    adapter._listCache.set('programs:fast-program', makeNormalizedList([
      { label: 'Show', input: 'plex:show123' },
    ]));

    const result = await adapter.resolvePlayables('program:fast-program', { applySchedule: false });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('plex:ep42');
    expect(loadPlayableItemFromKey).toHaveBeenCalledWith('plex:show123', { storagePath: 'plex/17_lectures' });
    expect(resolvePlayables).not.toHaveBeenCalled();
  });

  it('falls back to adapter source when getStoragePath is not available', async () => {
    const fastItem = { id: 'plex:ep42', title: 'Smart Pick', mediaUrl: '/media/ep42.mp4' };
    const loadPlayableItemFromKey = vi.fn(async () => fastItem);

    const registry = {
      resolve: vi.fn(() => ({
        adapter: {
          loadPlayableItemFromKey,
          source: 'plex',
          // no getStoragePath
        },
        localId: 'show123',
      })),
    };
    const memory = makeMockMemory();
    const adapter = makeAdapter({ registry, mediaProgressMemory: memory });

    adapter._listCache.set('programs:fallback-program', makeNormalizedList([
      { label: 'Show', input: 'plex:show123' },
    ]));

    const result = await adapter.resolvePlayables('program:fallback-program', { applySchedule: false });

    expect(result).toHaveLength(1);
    expect(loadPlayableItemFromKey).toHaveBeenCalledWith('plex:show123', { storagePath: 'plex' });
  });

  it('returns null when loadPlayableItemFromKey returns nothing', async () => {
    const loadPlayableItemFromKey = vi.fn(async () => null);

    const registry = {
      resolve: vi.fn(() => ({
        adapter: {
          loadPlayableItemFromKey,
          getStoragePath: vi.fn(async () => 'plex/17_lectures'),
          source: 'plex',
        },
        localId: 'show123',
      })),
    };
    const memory = makeMockMemory();
    const adapter = makeAdapter({ registry, mediaProgressMemory: memory });

    adapter._listCache.set('programs:empty-program', makeNormalizedList([
      { label: 'Show', input: 'plex:show123' },
    ]));

    const result = await adapter.resolvePlayables('program:empty-program', { applySchedule: false });

    // null items are filtered out, resulting in empty array
    expect(result).toHaveLength(0);
  });
});

describe('_getNextPlayableFromChild — generic fallback with bulk getAll', () => {
  const episodes = makeEpisodes(5);

  it('uses getAll for bulk progress lookup (not individual .get())', async () => {
    const registry = makeMockRegistry(episodes);
    const memory = makeMockMemory({ ep1: 0, ep2: 0, ep3: 50, ep4: 0, ep5: 0 });
    const adapter = makeAdapter({ registry, mediaProgressMemory: memory });

    adapter._listCache.set('programs:bulk-program', makeNormalizedList([
      { label: 'Show', input: 'plex:show123' },
    ]));

    const result = await adapter.resolvePlayables('program:bulk-program', { applySchedule: false });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('plex:ep3'); // in-progress at 50%
    expect(memory.getAll).toHaveBeenCalledWith('plex');
    expect(memory.get).not.toHaveBeenCalled(); // should use bulk, not individual
  });
});

describe('Watchlist "never empty" fallback', () => {
  it('returns first item when all watchlist items are filtered out', async () => {
    const episodes = makeEpisodes(3);
    const registry = makeMockRegistry(episodes);
    const memory = makeMockMemory();
    const adapter = makeAdapter({ registry, mediaProgressMemory: memory });

    // Simulate a watchlist where ALL items have expired skipAfter dates
    const mockChildren = [
      {
        id: 'plex:item1',
        source: 'plex',
        actions: { play: { url: '/play' } },
        metadata: { skipAfter: '2025-01-01', percent: 0 },
      },
      {
        id: 'plex:item2',
        source: 'plex',
        actions: { play: { url: '/play' } },
        metadata: { skipAfter: '2025-06-01', percent: 0 },
      },
    ];

    // Override getList to return a mock watchlist with children
    adapter.getList = vi.fn(async () => ({
      id: 'watchlist:cfmscripture',
      title: 'Scripture',
      children: mockChildren,
    }));

    const result = await adapter.resolvePlayables('watchlist:cfmscripture');

    // Should NOT be empty — fallback to first item
    expect(result.length).toBeGreaterThan(0);
  });
});
