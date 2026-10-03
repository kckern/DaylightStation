import { describe, expect, it, vi } from 'vitest';
import { PlexAdapter, plexAddedAt } from './PlexAdapter.mjs';

/**
 * "New" suggestions (RQ-FIND-16): what the library gained lately, with an
 * ISO `addedAt` on every item (Plex sends epoch seconds, or nothing).
 */
function adapter(metadata) {
  const plex = new PlexAdapter(
    { host: 'http://plex.test:32400', token: 't', logger: { error: vi.fn(), warn: vi.fn() } },
    { httpClient: { get: vi.fn(), post: vi.fn() }, logger: { error: vi.fn(), warn: vi.fn() } },
  );
  plex.client.request = vi.fn(async () => ({ MediaContainer: { Metadata: metadata } }));
  return plex;
}

const T = (iso) => Math.floor(Date.parse(iso) / 1000);

describe('plexAddedAt', () => {
  it('normalizes epoch seconds (number or string) to ISO; absent or junk is null', () => {
    expect(plexAddedAt({ addedAt: T('2026-10-01T12:00:00Z') })).toBe('2026-10-01T12:00:00.000Z');
    expect(plexAddedAt({ addedAt: String(T('2026-10-01T12:00:00Z')) })).toBe('2026-10-01T12:00:00.000Z');
    expect(plexAddedAt({})).toBeNull();
    expect(plexAddedAt({ addedAt: 'soon' })).toBeNull();
  });
});

describe('PlexAdapter item metadata carries addedAt', () => {
  it('on listable and playable items', () => {
    const plex = adapter([]);
    const movie = plex._toListableItem({ ratingKey: '5', type: 'movie', title: 'M', addedAt: T('2026-09-30T00:00:00Z') });
    expect(movie.metadata.addedAt).toBe('2026-09-30T00:00:00.000Z');
    const episode = plex._toPlayableItem({ ratingKey: '6', type: 'episode', title: 'E', addedAt: T('2026-09-29T00:00:00Z') });
    expect(episode.metadata.addedAt).toBe('2026-09-29T00:00:00.000Z');
    const show = plex._toPlayableItem({ ratingKey: '7', type: 'show', title: 'S' });
    expect(show.metadata.addedAt).toBeNull();
  });
});

describe('PlexAdapter.getRecentlyAdded', () => {
  it('collapses episodes and seasons to their show and tracks to their album, newest first, since the cutoff', async () => {
    const plex = adapter([
      { ratingKey: '11', type: 'episode', title: 'Ep 2', grandparentRatingKey: '100', grandparentTitle: 'Bluey', grandparentThumb: '/library/metadata/100/thumb/1', addedAt: T('2026-10-02T00:00:00Z') },
      { ratingKey: '10', type: 'episode', title: 'Ep 1', grandparentRatingKey: '100', grandparentTitle: 'Bluey', addedAt: T('2026-10-01T00:00:00Z') },
      { ratingKey: '20', type: 'season', title: 'Season 3', parentRatingKey: '200', parentTitle: 'Other Show', addedAt: T('2026-09-30T00:00:00Z') },
      { ratingKey: '30', type: 'track', title: 'Song', parentRatingKey: '300', parentTitle: 'Album', parentThumb: '/library/metadata/300/thumb/2', addedAt: T('2026-09-29T00:00:00Z') },
      { ratingKey: '40', type: 'movie', title: 'Film', thumb: '/library/metadata/40/thumb/3', addedAt: T('2026-09-28T00:00:00Z') },
      { ratingKey: '50', type: 'movie', title: 'Old film', addedAt: T('2026-08-01T00:00:00Z') },
    ]);
    const items = await plex.getRecentlyAdded({ since: '2026-09-19T00:00:00Z', limit: 10 });
    expect(items.map((i) => [i.id, i.type, i.title, i.addedAt])).toEqual([
      ['plex:100', 'show', 'Bluey', '2026-10-02T00:00:00.000Z'],
      ['plex:200', 'show', 'Other Show', '2026-09-30T00:00:00.000Z'],
      ['plex:300', 'album', 'Album', '2026-09-29T00:00:00.000Z'],
      ['plex:40', 'movie', 'Film', '2026-09-28T00:00:00.000Z'],
    ]);
    expect(items[0]).toMatchObject({ thumbnail: '/api/v1/proxy/plex/library/metadata/100/thumb/1', latestId: 'plex:11', latestTitle: 'Ep 2' });
    expect(plex.client.request).toHaveBeenCalledWith(expect.stringContaining('/library/recentlyAdded'));
  });
  it('a Plex failure is an empty list, logged', async () => {
    const plex = adapter([]);
    plex.client.request = vi.fn(async () => { throw new Error('down'); });
    expect(await plex.getRecentlyAdded({ since: '2026-09-19T00:00:00Z' })).toEqual([]);
  });
});
