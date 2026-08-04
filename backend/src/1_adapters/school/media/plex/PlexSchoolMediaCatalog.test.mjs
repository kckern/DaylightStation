import { describe, expect, it } from 'vitest';
import { PlexSchoolMediaCatalog } from './PlexSchoolMediaCatalog.mjs';

describe('PlexSchoolMediaCatalog', () => {
  it('normalizes provider metadata and proxy paths at the adapter boundary', async () => {
    const plexAdapter = {
      proxyPath: '/api/media',
      client: { getContainer: async () => ({ MediaContainer: { Metadata: [{
        ratingKey: '7', type: 'episode', title: 'Episode', thumb: '/thumb/7',
        duration: 1234, parentTitle: 'Season 1', grandparentTitle: 'Series',
        Label: [{ tag: 'school:on' }],
      }] } }) },
    };
    const [item] = await new PlexSchoolMediaCatalog({ plexAdapter }).listChildren('plex:6');
    expect(item).toEqual({
      id: 'plex:7', kind: 'episode', medium: 'video', title: 'Episode', summary: null,
      poster: '/api/media/thumb/7', durationMs: 1234, index: null, childCount: null,
      labels: ['school:on'], parent: { title: 'Season 1', poster: null }, seriesTitle: 'Series',
    });
  });

  it('degrades to an empty catalog when the provider is not configured', async () => {
    const catalog = new PlexSchoolMediaCatalog();
    expect(await catalog.listChildren('anything')).toEqual([]);
    expect(await catalog.getItem('anything')).toBeNull();
  });
});
