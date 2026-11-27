import { describe, expect, it, vi } from 'vitest';
import { PlexAdapter } from './PlexAdapter.mjs';

// An album's /children answer names its library on the container, not on each
// track. getList carries it to the children, so the queue can tell a book's
// parts (play_on_demand.library_kinds) from an album's songs.
function setup(container) {
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  const plex = new PlexAdapter({ host: 'http://plex.test:32400', token: 't', logger }, { httpClient: { get: vi.fn() }, logger });
  plex.client.getMetadata = vi.fn(async () => ({ MediaContainer: { Metadata: [{ type: 'album' }] } }));
  plex.client.getContainer = vi.fn(async () => ({ MediaContainer: container }));
  return plex;
}

const track = (n, extra = {}) => ({
  ratingKey: String(n), key: `/library/metadata/${n}`, type: 'track', title: `Part ${n}`, index: n,
  duration: 1_800_000, Media: [{ Part: [{ id: n, key: `/library/parts/${n}/file.mp3` }] }], ...extra,
});

describe('PlexAdapter.getList library carry', () => {
  it("gives each child the container's library when the child names none", async () => {
    const plex = setup({ librarySectionID: 9, librarySectionTitle: 'Audiobooks', Metadata: [track(1), track(2)] });
    const items = await plex.getList('727787');
    expect(items.map((item) => item.metadata?.librarySectionTitle)).toEqual(['Audiobooks', 'Audiobooks']);
    expect(items.map((item) => String(item.metadata?.librarySectionID))).toEqual(['9', '9']);
  });

  it('keeps a library the child names itself (a playlist mixing libraries)', async () => {
    const plex = setup({ librarySectionID: 9, librarySectionTitle: 'Audiobooks', Metadata: [track(1, { librarySectionID: 3, librarySectionTitle: 'Music' })] });
    const [item] = await plex.getList('727787');
    expect(item.metadata?.librarySectionTitle).toBe('Music');
  });
});
