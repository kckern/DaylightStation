import { describe, expect, it, vi } from 'vitest';
import { PlexAdapter, plexContainerFacts } from "./PlexAdapter.mjs";

/**
 * Browse headers (2026-11-27): a show/season/album page shows its art, rating,
 * genres and counts. /api/v1/info used to drop contentRating, Genre (for
 * shows), art, and the season count (childCount was overwritten by leafCount).
 */
function adapterWith(item) {
  const plex = new PlexAdapter(
    { host: 'http://plex.test:32400', token: 't', logger: { error: vi.fn(), warn: vi.fn() } },
    { httpClient: { get: vi.fn(), post: vi.fn() }, logger: { error: vi.fn(), warn: vi.fn() } },
  );
  plex.client.getMetadata = vi.fn().mockResolvedValue({ MediaContainer: { Metadata: [item] } });
  return plex;
}

const SHOW = {
  ratingKey: '59493', type: 'show', title: 'Bluey (2018)', year: 2018, contentRating: 'TV-Y',
  summary: 'A puppy.', studio: 'Ludo Studio', librarySectionTitle: 'TV Shows', librarySectionID: 8,
  childCount: 4, leafCount: 155, thumb: '/library/metadata/59493/thumb/1', art: '/library/metadata/59493/art/1',
  Genre: [{ tag: 'Animation' }, { tag: 'Comedy' }],
};

describe('Plex container facts on /info', () => {
  it('a show carries its rating, genres, art, season count and episode count', async () => {
    const item = await adapterWith(SHOW).getItem('59493');
    expect(item.metadata).toMatchObject({
      contentRating: 'TV-Y', genres: ['Animation', 'Comedy'], seasonCount: 4, leafCount: 155,
      art: '/api/v1/proxy/plex/library/metadata/59493/art/1',
    });
  });

  it('a season counts episodes but no seasons; empty fields are left out', () => {
    expect(plexContainerFacts({ type: 'season', leafCount: 18, childCount: 18 }, '/p'))
      .toEqual({ leafCount: 18 });
    expect(plexContainerFacts(null, '/p')).toEqual({});
  });
});
