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
      poster: '/api/media/thumb/7', durationMs: 1234, index: null, childCount: null, parentId: null,
      labels: ['school:on'], parent: { title: 'Season 1', poster: null }, seriesTitle: 'Series',
    });
  });

  it('listLeaves batches every leaf under a container and carries each parentId (one provider call)', async () => {
    const calls = [];
    const plexAdapter = {
      proxyPath: '/api/media',
      client: { getContainer: async (path) => {
        calls.push(path);
        return { MediaContainer: { Metadata: [
          { ratingKey: '11', type: 'track', title: 'Ch 1', parentRatingKey: '10' },
          { ratingKey: '12', type: 'track', title: 'Ch 2', parentRatingKey: '10' },
        ] } };
      } },
    };
    const leaves = await new PlexSchoolMediaCatalog({ plexAdapter }).listLeaves('plex:9');
    expect(calls).toEqual(['/library/metadata/9/allLeaves']);
    expect(leaves.map((l) => ({ id: l.id, parentId: l.parentId }))).toEqual([
      { id: 'plex:11', parentId: 'plex:10' },
      { id: 'plex:12', parentId: 'plex:10' },
    ]);
  });

  it('degrades to an empty catalog when the provider is not configured', async () => {
    const catalog = new PlexSchoolMediaCatalog();
    expect(await catalog.listChildren('anything')).toEqual([]);
    expect(await catalog.listLeaves('anything')).toEqual([]);
    expect(await catalog.getItem('anything')).toBeNull();
  });
});
