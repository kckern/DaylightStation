import { describe, it, expect, vi } from 'vitest';
import { PlexAdapter } from '#adapters/content/media/plex/PlexAdapter.mjs';

// getStoragePath decides which progress file an item's watch state lives in.
// Every watch-state enrich asked Plex for it — one serialized metadata call per
// show per request — though an item's library section never changes.
function adapterWith(getItem) {
  const a = new PlexAdapter({ host: 'http://x', token: 't' }, { httpClient: { get: async () => ({}) } });
  a.getItem = getItem;
  return a;
}

describe('PlexAdapter.getStoragePath', () => {
  it('asks Plex once per item, then answers from memory', async () => {
    const getItem = vi.fn(async () => ({ metadata: { librarySectionID: 14, librarySectionTitle: 'Fitness' } }));
    const a = adapterWith(getItem);
    expect(await a.getStoragePath('plex:603407')).toBe('plex/14_fitness');
    expect(await a.getStoragePath('603407')).toBe('plex/14_fitness');
    expect(getItem).toHaveBeenCalledTimes(1);
  });

  it('does not remember the fallback when Plex fails', async () => {
    const getItem = vi.fn()
      .mockRejectedValueOnce(new Error('plex down'))
      .mockResolvedValue({ metadata: { librarySectionID: 14, librarySectionTitle: 'Fitness' } });
    const a = adapterWith(getItem);
    expect(await a.getStoragePath('603407')).toBe('plex');
    expect(await a.getStoragePath('603407')).toBe('plex/14_fitness');
    expect(getItem).toHaveBeenCalledTimes(2);
  });
});
