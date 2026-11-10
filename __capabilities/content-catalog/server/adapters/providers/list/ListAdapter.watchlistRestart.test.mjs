// A watchlist whose first entry is finished (its next-up pick is a restart)
// must move on to the next entry instead of replaying the finished one.
import { describe, it, expect, vi } from 'vitest';

vi.mock('#system/utils/FileIO.mjs', () => ({
  dirExists: vi.fn(() => false),
  listEntries: vi.fn(() => []),
  fileExists: vi.fn(() => true),
  loadYaml: vi.fn(() => null),
  getStats: vi.fn(() => ({ mtimeMs: 1 })),
}));

const { ListAdapter } = await import('./ListAdapter.mjs');

function makeAdapter(picks) {
  const plex = {
    source: 'plex',
    loadPlayableItemFromKey: vi.fn(async (key) => picks[key.replace(/^plex:/, '')]),
    getStoragePath: vi.fn(async () => 'plex/17_lectures'),
  };
  const adapter = new ListAdapter({
    dataPath: '/fake/data',
    registry: { resolve: vi.fn((input) => ({ localId: input.split(':')[1], adapter: plex })) },
    mediaProgressMemory: null,
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  });
  adapter._listCache.set('watchlists:courses', {
    mtime: 1,
    data: {
      metadata: {},
      sections: [{ items: [
        { title: 'Economics', play: { contentId: 'plex:649182' } },
        { title: 'Sermon on the Mount', play: { contentId: 'plex:649053' } },
      ] }],
    },
  });
  return adapter;
}

const ep = (id, extra = {}) => ({ id: `plex:${id}`, title: id, mediaUrl: `/m/${id}`, metadata: {}, ...extra });

describe('ListAdapter — watchlist skips finished entries', () => {
  it('drops a restarted pick when a later entry has something new', async () => {
    const adapter = makeAdapter({ 649182: ep('649183', { restarted: true }), 649053: ep('649057') });
    const items = await adapter.resolvePlayables('watchlist:courses');
    expect(items.map(i => i.id)).toEqual(['plex:649057']);
  });

  it('keeps the restart when every entry is finished (never empty)', async () => {
    const adapter = makeAdapter({ 649182: ep('649183', { restarted: true }), 649053: ep('649054', { restarted: true }) });
    const items = await adapter.resolvePlayables('watchlist:courses');
    expect(items.length).toBeGreaterThan(0);
  });
});
