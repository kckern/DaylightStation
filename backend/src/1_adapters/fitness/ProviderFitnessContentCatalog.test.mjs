import { describe, expect, it, vi } from 'vitest';
import { ProviderFitnessContentCatalog } from './ProviderFitnessContentCatalog.mjs';

describe('ProviderFitnessContentCatalog contract', () => {
  it('normalizes provider hierarchy/watch fields without removing legacy response fields', async () => {
    const getList = vi.fn(async () => [{
      id: 'plex:9', localId: '9', title: 'Show', itemType: 'container',
      metadata: { childCount: 4 },
    }]);
    const adapter = {
      source: 'plex', getList,
      resolvePlayables: vi.fn(async () => [{
        id: 'plex:11', metadata: { viewCount: 2, grandparentRatingKey: '9' },
      }]),
      getContainerInfo: vi.fn(async () => ({ type: 'season', parentRatingKey: '9' })),
      getItem: vi.fn(async () => ({ id: 'plex:9', title: 'Show' })),
    };
    const catalog = new ProviderFitnessContentCatalog({ contentAdapter: adapter, source: 'plex' });

    const [item] = await catalog.resolvePlayables('plex:plex:9');
    expect(item.metadata).toMatchObject({
      viewCount: 2,
      grandparentRatingKey: '9',
      completedPlayCount: 2,
      showContentId: 'plex:9',
    });
    expect(await catalog.getContainerInfo('9')).toEqual({
      type: 'season', parentRatingKey: '9', parentContentId: 'plex:9',
    });
    expect(await catalog.listConfiguredShows()).toEqual({ libraryId: 14, shows: [{
      id: '9', title: 'Show', type: 'container', episodeCount: 4,
    }] });
    expect(getList).toHaveBeenCalledWith('library/sections/14/all');
  });

  it('owns collection member provider fields and returns bare semantic show ids', async () => {
    const catalog = new ProviderFitnessContentCatalog({
      source: 'plex',
      contentAdapter: {
        source: 'plex',
        getList: async () => [
          { metadata: { grandparentRatingKey: '7' } },
          { id: 'plex:8' },
        ],
      },
    });
    expect(await catalog.collectionShowIds('collection:1')).toEqual(['7', '8']);
  });

  it('enriches provider playlist config without changing its legacy response shape', async () => {
    const catalog = new ProviderFitnessContentCatalog({
      source: 'plex',
      contentAdapter: {
        source: 'plex',
        getThumbnail: vi.fn(async (id) => `/api/v1/content/plex/${id}/image`),
      },
    });
    const config = {
      content_source: 'plex',
      plex: { music_playlists: [{ id: '42', title: 'Cardio' }, { id: '43', thumb: '/kept.jpg' }] },
    };

    await expect(catalog.enrichConfiguredPlaylists(config)).resolves.toEqual({
      content_source: 'plex',
      plex: {
        music_playlists: [
          { id: '42', title: 'Cardio', thumb: '/api/v1/content/plex/42/image' },
          { id: '43', thumb: '/kept.jpg' },
        ],
      },
    });
  });

  it('keeps governed-label provider querying behind the fitness catalog', async () => {
    const getItemsByLabel = vi.fn(async () => [{ id: 'plex:1' }]);
    const catalog = new ProviderFitnessContentCatalog({
      source: 'plex',
      contentAdapter: { source: 'plex', getItemsByLabel },
    });

    await expect(catalog.getGovernedItems(['Workout'], { types: ['show'], limit: 10 }))
      .resolves.toEqual([{ id: 'plex:1' }]);
    expect(getItemsByLabel).toHaveBeenCalledWith(['Workout'], { types: ['show'], limit: 10 });
  });
});
