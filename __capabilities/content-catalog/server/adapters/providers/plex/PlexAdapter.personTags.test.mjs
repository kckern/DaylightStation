import { describe, expect, it, vi } from 'vitest';
import { PlexAdapter, plexPersonTags } from "./PlexAdapter.mjs";

/**
 * The phone's author and artist pages (lookup spec §8a): /api/v1/info passes Plex's
 * Country, Genre and Style tags as metadata.countries / genres / styles.
 */
function adapterWith(item) {
  const plex = new PlexAdapter(
    { host: 'http://plex.test:32400', token: 't', logger: { error: vi.fn(), warn: vi.fn() } },
    { httpClient: { get: vi.fn(), post: vi.fn() }, logger: { error: vi.fn(), warn: vi.fn() } },
  );
  plex.client.getMetadata = vi.fn().mockResolvedValue({ MediaContainer: { Metadata: [item] } });
  return plex;
}

const AUTHOR = {
  ratingKey: '727118', type: 'artist', title: 'Boethius', librarySectionTitle: 'Audiobooks', librarySectionID: 9,
  summary: 'A Roman senator.', Country: [{ id: 1, tag: 'Italy' }], Genre: [{ id: 2, tag: 'Ancient' }],
};

describe('Plex country, genre and style tags', () => {
  it('an author’s info carries its country and genre', async () => {
    const item = await adapterWith(AUTHOR).getItem('727118');
    expect(item.metadata.countries).toEqual(['Italy']);
    expect(item.metadata.genres).toEqual(['Ancient']);
    expect(item.metadata).not.toHaveProperty('styles');
  });

  it('an album keeps its styles; a track has none of these fields', () => {
    expect(plexPersonTags({ type: 'album', Style: [{ tag: 'Art Pop' }, { tag: ' ' }], Genre: ['Rock'] }))
      .toEqual({ styles: ['Art Pop'], genres: ['Rock'] });
    expect(plexPersonTags({ type: 'track', Genre: [{ tag: 'Rock' }] })).toEqual({});
    expect(plexPersonTags(null)).toEqual({});
  });

  it('a listed album (a list level) carries them too', () => {
    const listed = adapterWith(AUTHOR)._toListableItem({ ratingKey: '1', type: 'album', title: 'A', Country: [{ tag: 'United Kingdom' }] });
    expect(listed.metadata.countries).toEqual(['United Kingdom']);
  });
});
