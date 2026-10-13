// tests/isolated/adapter/content/list/ListAdapter.stationSequence.test.mjs
import { describe, it, expect, vi } from 'vitest';

// Same FileIO mock as the other ListAdapter suites: lists come from a
// pre-seeded _listCache, never from disk.
vi.mock('#system/utils/FileIO.mjs', () => ({
  dirExists: vi.fn(() => false),
  listEntries: vi.fn(() => []),
  fileExists: vi.fn(() => true),
  loadYaml: vi.fn(() => null),
  getStats: vi.fn(() => ({ mtimeMs: 1 })),
}));

const { ListAdapter } = await import('./ListAdapter.mjs');

const track = (id) => ({ id, localId: id.split(':')[1], title: id, mediaUrl: `/m/${id}` });
const ids = (items) => items.map((it) => it.id);
const SONGS = ['plex:s1', 'plex:s2', 'plex:s3', 'plex:s4', 'plex:s5', 'plex:s6'];

function makeRegistry() {
  return {
    resolve: vi.fn((input) => {
      const localId = input.split(':')[1];
      return {
        localId,
        adapter: {
          source: 'plex',
          resolvePlayables: vi.fn(async (id) => (id === 'plex:757556'
            ? ['plex:j1', ...SONGS].map(track)
            : [track(id)])),
          getStoragePath: vi.fn(() => 'plex'),
        },
      };
    }),
  };
}

function seedProgram(adapter) {
  adapter._listCache.set('programs:music-queue', {
    mtime: 1,
    data: {
      title: undefined, description: undefined, image: undefined, metadata: {},
      sections: [{ items: [{ title: 'FM100', queue: { contentId: 'plex:757556' }, shuffle: true }] }],
    },
  });
}

function makeAdapter(sequenceStore) {
  const logger = { info: vi.fn(), warn: vi.fn() };
  const adapter = new ListAdapter({
    dataPath: '/fake/data', registry: makeRegistry(), mediaProgressMemory: null, sequenceStore, logger,
  });
  seedProgram(adapter);
  return { adapter, logger };
}

describe('ListAdapter — station sequences in a program Queue item', () => {
  it('keeps the jingle first and interleaves station IDs among the shuffled songs', async () => {
    const store = { lookup: vi.fn(() => ({ head: 1, idents: { every: [3, 3], pool: ['plex:j2'] } })) };
    const { adapter, logger } = makeAdapter(store);

    const result = await adapter.resolvePlayables('program:music-queue', { applySchedule: false });

    expect(store.lookup).toHaveBeenCalledWith('plex:757556');
    expect(result[0].id).toBe('plex:j1');
    expect(ids(result).filter((id) => id === 'plex:j2')).toHaveLength(1);
    expect(result[4].id).toBe('plex:j2');
    expect(ids(result).filter((id) => id.includes(':s')).sort()).toEqual(SONGS);
    expect(result).toHaveLength(8);
    expect(logger.info).toHaveBeenCalledWith('station.sequence.applied', expect.objectContaining({
      containerId: 'plex:757556', path: 'list', head: 1, songs: 6, idents: 1,
    }));
  });

  it('falls back to the plain inline shuffle when the store throws', async () => {
    const store = { lookup: vi.fn(() => { throw new Error('boom'); }) };
    const { adapter } = makeAdapter(store);
    const result = await adapter.resolvePlayables('program:music-queue', { applySchedule: false });
    expect(ids(result).sort()).toEqual(['plex:j1', ...SONGS].sort());
  });

  it('behaves exactly as before with no store', async () => {
    const { adapter } = makeAdapter(null);
    const result = await adapter.resolvePlayables('program:music-queue', { applySchedule: false });
    expect(result).toHaveLength(7);
  });
});
