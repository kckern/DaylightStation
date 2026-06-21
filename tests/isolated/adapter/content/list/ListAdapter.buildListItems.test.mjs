// tests/isolated/adapter/content/list/ListAdapter.buildListItems.test.mjs
import { describe, it, expect, vi } from 'vitest';

// Mock FileIO so ListAdapter imports without touching the filesystem.
// _buildListItems only touches FileIO for the uid-thumbnail path, which our
// items deliberately avoid (no uid), so these defaults are never exercised.
vi.mock('#system/utils/FileIO.mjs', () => ({
  dirExists: vi.fn(() => false),
  listEntries: vi.fn(() => []),
  fileExists: vi.fn(() => true),
  loadYaml: vi.fn(() => null),
  getStats: vi.fn(() => ({ mtimeMs: 1 })),
}));

const { ListAdapter } = await import('#adapters/content/list/ListAdapter.mjs');

// Progress store double. getAll returns one entity per supplied entry,
// keyed by contentId (matching YamlMediaProgressMemory.getAll's shape).
function makeMemory(entries = []) {
  return {
    get: vi.fn(async () => null),
    getAll: vi.fn(async () => entries.map((e) => ({ ...e }))),
  };
}

function makeAdapter(mediaProgressMemory) {
  return new ListAdapter({
    dataPath: '/fake/data',
    registry: null,
    mediaProgressMemory: mediaProgressMemory || null,
  });
}

function makeReadalongItems(count) {
  return Array.from({ length: count }, (_, i) => ({
    input: `readalong:scripture/ch${i + 1}`,
    title: `Chapter ${i + 1}`,
  }));
}

describe('ListAdapter._buildListItems progress enrichment', () => {
  it('bulk-loads progress once per namespace instead of once per child', async () => {
    const memory = makeMemory([]);
    const adapter = makeAdapter(memory);
    const items = makeReadalongItems(50);

    const result = await adapter._buildListItems(
      items,
      'watchlist',
      'scriptures2026',
      { namespace: 'scriptures' }
    );

    expect(result).toHaveLength(50);
    expect(memory.getAll).toHaveBeenCalledTimes(1);
    expect(memory.getAll).toHaveBeenCalledWith('scriptures');
    expect(memory.get).not.toHaveBeenCalled();
  });

  it('enriches each child with watch state from the bulk-loaded map', async () => {
    const memory = makeMemory([
      { contentId: 'scripture/ch3', percent: 42, playhead: 99, lastPlayed: '2026-06-20' },
    ]);
    const adapter = makeAdapter(memory);
    const items = [
      { input: 'readalong:scripture/ch1', title: 'Ch 1' },
      { input: 'readalong:scripture/ch3', title: 'Ch 3' },
    ];

    const result = await adapter._buildListItems(
      items,
      'watchlist',
      'scriptures2026',
      { namespace: 'scriptures' }
    );

    const ch3 = result.find((r) => r.localId === 'scripture/ch3');
    expect(ch3.metadata.percent).toBe(42);
    expect(ch3.metadata.playhead).toBe(99);
    expect(ch3.metadata.lastPlayed).toBe('2026-06-20');

    const ch1 = result.find((r) => r.localId === 'scripture/ch1');
    expect(ch1.metadata.percent).toBe(0);
    expect(ch1.metadata.playhead).toBe(0);
    expect(ch1.metadata.lastPlayed).toBeNull();
  });
});
