import { describe, it, expect, vi } from 'vitest';
import { WatchmodeAvailabilityGateway } from './WatchmodeAvailabilityGateway.mjs';
import { PlexTitleIdentityReader } from './PlexTitleIdentityReader.mjs';

const response = (status, body, headers = {}) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => body,
});

describe('WatchmodeAvailabilityGateway', () => {
  it('maps sources and reports quota from headers', async () => {
    const fetchImpl = vi.fn(async () => response(200, [
      { name: 'Hoopla', type: 'free', region: 'US', web_url: 'https://h' },
      { name: 'Netflix', type: 'sub', region: 'CA' },
    ], { 'x-account-quota': '2500', 'x-account-quota-used': '12' }));
    const gw = new WatchmodeAvailabilityGateway({ apiKey: 'k', fetchImpl });
    const out = await gw.sources('tt0065126');
    expect(out).toEqual({ sources: [{ name: 'Hoopla', type: 'free', url: 'https://h' }], quota: 2500, quotaUsed: 12 });
    expect(fetchImpl.mock.calls[0][0]).toMatch(/\/title\/tt0065126\/sources\/\?apiKey=k&regions=US$/);
  });
  it('treats 404 and non-array bodies as found nowhere', async () => {
    const gw404 = new WatchmodeAvailabilityGateway({ apiKey: 'k', fetchImpl: async () => response(404, null) });
    expect((await gw404.sources('movie-1')).sources).toEqual([]);
    const gwObj = new WatchmodeAvailabilityGateway({ apiKey: 'k', fetchImpl: async () => response(200, { success: false }) });
    expect((await gwObj.sources('tv-1')).sources).toEqual([]);
  });
  it('throws on server errors and rejects bad ids', async () => {
    const gw = new WatchmodeAvailabilityGateway({ apiKey: 'k', fetchImpl: async () => response(429, null) });
    await expect(gw.sources('tt1')).rejects.toMatchObject({ status: 429 });
    await expect(gw.sources('../x')).rejects.toThrow(/bad lookup id/);
  });
});

describe('PlexTitleIdentityReader', () => {
  const meta = {
    100: { ratingKey: '100', type: 'movie', title: 'True Grit', year: 1969, Guid: [{ id: 'imdb://tt0065126' }, { id: 'tmdb://17529' }],
      studio: 'Wallis-Hazen Inc.', duration: 7684704, librarySectionTitle: 'Movies', Collection: [{ tag: 'Western' }], Label: [{ tag: 'Family' }], Genre: [{ tag: 'Western' }, { tag: 'Drama' }] },
    200: { ratingKey: '200', type: 'show', title: 'Show', Guid: [{ id: 'tmdb://1396' }] },
    201: { ratingKey: '201', type: 'episode', grandparentRatingKey: '200' },
    300: { ratingKey: '300', type: 'track' },
  };
  const plexClient = { request: vi.fn(async (p) => ({ MediaContainer: { Metadata: [meta[p.match(/metadata\/(\d+)/)[1]]].filter(Boolean) } })) };
  const reader = new PlexTitleIdentityReader({ plexClient });

  it('reads a movie', async () => {
    expect(await reader.identify('100')).toEqual({
      key: '100', kind: 'movie', title: 'True Grit', year: 1969, imdb: 'tt0065126', tmdb: '17529',
      studio: 'Wallis-Hazen Inc.', durationMs: 7684704, collections: ['Western'], labels: ['Family'], genres: ['Western', 'Drama'], library: 'Movies',
    });
    expect(plexClient.request).toHaveBeenCalledWith('/library/metadata/100?includeGuids=1');
  });
  it('answers an episode as its show', async () => {
    expect(await reader.identify('201')).toMatchObject({ key: '200', kind: 'show', tmdb: '1396', imdb: null });
  });
  it('ignores other item types and missing items', async () => {
    expect(await reader.identify('300')).toBeNull();
    expect(await reader.identify('999')).toBeNull();
    expect(await reader.identify('abc')).toBeNull();
  });
});
