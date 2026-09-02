import { describe, expect, it, vi } from 'vitest';
import { PlexAdapter } from './PlexAdapter.mjs';

/**
 * Playlist poster precedence.
 *
 * Plex populates `composite` (the auto-generated 2x2 mosaic) for EVERY playlist,
 * including ones where a custom poster has been uploaded and the thumb field
 * locked. Preferring `composite` therefore makes custom playlist art unreachable
 * — the bug that hid the "STRETCH / MOBILITY" poster on playlist 672606 behind a
 * mosaic of unrelated show covers.
 */

const PLAYLIST_WITH_CUSTOM_POSTER = {
  ratingKey: '672606',
  title: 'Fitness Stretch',
  type: 'playlist',
  composite: '/playlists/672606/composite/1788293999',
  thumb: '/library/metadata/672606/thumb/1788293999',
  Field: [{ locked: true, name: 'thumb' }],
  leafCount: 304,
};

const PLAYLIST_WITHOUT_CUSTOM_POSTER = {
  ratingKey: '672596',
  title: '👟 Fitness',
  type: 'playlist',
  composite: '/playlists/672596/composite/1788293999',
  leafCount: 12,
};

function adapter(item) {
  return new PlexAdapter(
    { host: 'http://plex.test:32400', token: 't', logger: { error: vi.fn(), warn: vi.fn() } },
    {
      httpClient: { get: vi.fn(), post: vi.fn() },
      logger: { error: vi.fn(), warn: vi.fn() },
    },
  );
}

function withMetadata(plex, item) {
  plex.client.getMetadata = vi.fn().mockResolvedValue({ MediaContainer: { Metadata: [item] } });
  return plex;
}

describe('PlexAdapter playlist art precedence', () => {
  it('getContainerInfo serves the custom poster, not the auto composite', async () => {
    const plex = withMetadata(adapter(), PLAYLIST_WITH_CUSTOM_POSTER);

    const info = await plex.getContainerInfo('672606');

    expect(info.image).toBe('/api/v1/proxy/plex/library/metadata/672606/thumb/1788293999');
  });

  it('getContainerInfo falls back to the composite when no custom poster exists', async () => {
    const plex = withMetadata(adapter(), PLAYLIST_WITHOUT_CUSTOM_POSTER);

    const info = await plex.getContainerInfo('672596');

    expect(info.image).toBe('/api/v1/proxy/plex/playlists/672596/composite/1788293999');
  });

  it('getThumbnail serves the custom poster, not the auto composite', async () => {
    const plex = withMetadata(adapter(), PLAYLIST_WITH_CUSTOM_POSTER);

    await expect(plex.getThumbnail('672606')).resolves.toBe(
      '/api/v1/proxy/plex/library/metadata/672606/thumb/1788293999',
    );
  });

  it('loadImgFromKey serves the custom poster as the primary thumb', async () => {
    const plex = withMetadata(adapter(), PLAYLIST_WITH_CUSTOM_POSTER);

    const [primary] = await plex.loadImgFromKey('672606');

    expect(primary).toBe('/api/v1/proxy/plex/library/metadata/672606/thumb/1788293999');
  });

  it('_toListableItem serves the custom poster in list/menu tiles', () => {
    const listed = adapter()._toListableItem(PLAYLIST_WITH_CUSTOM_POSTER);

    expect(listed.thumbnail).toBe('/api/v1/proxy/plex/library/metadata/672606/thumb/1788293999');
  });

  it('_hubResultToListableItem serves the custom poster in search results', () => {
    const found = adapter()._hubResultToListableItem(PLAYLIST_WITH_CUSTOM_POSTER);

    expect(found.thumbnail).toBe('/api/v1/proxy/plex/library/metadata/672606/thumb/1788293999');
  });

  it('leaves non-playlist items — which have no composite — on their thumb', async () => {
    const plex = withMetadata(adapter(), {
      ratingKey: '12345',
      title: 'Some Episode',
      type: 'episode',
      thumb: '/library/metadata/12345/thumb/1700000000',
    });

    const info = await plex.getContainerInfo('12345');

    expect(info.image).toBe('/api/v1/proxy/plex/library/metadata/12345/thumb/1700000000');
  });
});
