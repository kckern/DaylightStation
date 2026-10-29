// A single-pick program slot with `shuffle: true` used to ignore the flag and
// take the default next-up pick (Fixate served its intro on every run). It now
// means rotation, the same as `strategy: rotation`.
import { describe, it, expect, vi } from 'vitest';

vi.mock('#system/utils/FileIO.mjs', () => ({
  dirExists: vi.fn(() => false),
  listEntries: vi.fn(() => []),
  fileExists: vi.fn(() => true),
  loadYaml: vi.fn(() => null),
  getStats: vi.fn(() => ({ mtimeMs: 1 })),
}));

const { ListAdapter } = await import('./ListAdapter.mjs');

const track = (id) => ({ id, localId: id.split(':')[1], title: id, mediaUrl: `/m/${id}` });

function makeAdapter(slot) {
  const plex = {
    source: 'plex',
    resolvePlayables: vi.fn(async () => ['plex:e1', 'plex:e2', 'plex:e3'].map(track)),
    loadPlayableItemFromKey: vi.fn(async () => track('plex:e1')),
    getStoragePath: vi.fn(() => 'plex'),
  };
  const adapter = new ListAdapter({
    dataPath: '/fake/data',
    registry: { resolve: vi.fn((input) => ({ localId: input.split(':')[1], adapter: plex })) },
    mediaProgressMemory: null,
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  });
  adapter._listCache.set('programs:office', {
    mtime: 1,
    data: { metadata: {}, sections: [{ items: [{ title: 'Fixate', play: { contentId: 'plex:364980' }, ...slot }] }] },
  });
  const pick = vi.spyOn(adapter, '_pickViaStrategy').mockResolvedValue([track('plex:e2')]);
  return { adapter, plex, pick };
}

describe('ListAdapter — shuffle on a single-pick program slot', () => {
  it('shuffle: true picks through rotation, not the default next-up', async () => {
    const { adapter, plex, pick } = makeAdapter({ shuffle: true });
    const items = await adapter.resolvePlayables('program:office', { applySchedule: false });
    expect(pick).toHaveBeenCalledWith('rotation', expect.anything(), expect.anything());
    expect(plex.loadPlayableItemFromKey).not.toHaveBeenCalled();
    expect(items.map(i => i.id)).toEqual(['plex:e2']);
  });

  it('an explicit strategy still wins over shuffle', async () => {
    const { adapter, pick } = makeAdapter({ shuffle: true, strategy: 'freshest' });
    await adapter.resolvePlayables('program:office', { applySchedule: false });
    expect(pick).toHaveBeenCalledWith('freshest', expect.anything(), expect.anything());
  });

  it('no shuffle and no strategy keeps the default next-up pick', async () => {
    const { adapter, plex, pick } = makeAdapter({});
    await adapter.resolvePlayables('program:office', { applySchedule: false });
    expect(pick).not.toHaveBeenCalled();
    expect(plex.loadPlayableItemFromKey).toHaveBeenCalled();
  });
});
