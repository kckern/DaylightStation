import { describe, expect, it } from 'vitest';
import { MediaAlbumSource } from '#apps/school/sources/MediaAlbumSource.mjs';

const album = (id, title = `Album ${id}`) => ({
  id: `provider:${id}`, title, poster: `/img/${id}`, childCount: 3,
  parent: { title: 'Anthology', poster: '/img/root' },
});
const catalog = (children) => ({
  canonicalId: (value) => String(value).startsWith('provider:') ? value : `provider:${value}`,
  listChildren: async () => children,
});

describe('MediaAlbumSource', () => {
  it('projects a collection and its works without interpreting provider IDs', async () => {
    const source = new MediaAlbumSource({ mediaCatalog: catalog([album('a'), album('b')]) });
    expect(await source.listMaterials('root')).toEqual([{
      id: 'provider:root', title: 'Anthology', poster: '/img/root', source: 'media-album',
      medium: 'audio', kind: 'collection', durationMs: null, unitCount: 2,
    }]);
    expect((await source.listWorks('root'))[0]).toMatchObject({
      id: 'provider:a', title: 'Album a', source: 'media-album', kind: 'work', unitCount: 3,
    });
  });

  it('maps tracks, preserves explicit order fields, and sums duration', async () => {
    const tracks = [
      { id: 'provider:t2', index: 2, title: 'Second', durationMs: 2000, parent: { title: 'Work', poster: '/work' } },
      { id: 'provider:t1', index: 1, title: 'First', durationMs: 1000, parent: { title: 'Work', poster: '/work' } },
    ];
    const material = await new MediaAlbumSource({ mediaCatalog: catalog(tracks) }).getMaterial('work');
    expect(material).toMatchObject({
      id: 'provider:work', title: 'Work', source: 'media-album', durationMs: 3000, unitCount: 2,
    });
    expect(material.units.map((unit) => unit.index)).toEqual([2, 1]);
    expect(material.units.every((unit) => unit.group === null)).toBe(true);
    expect(material.trackParents).toBeUndefined(); // leaf children: nothing to roll up
  });

  it('two-level material (children are albums): maps every leaf track to its parent work via ONE batched listLeaves call', async () => {
    const works = [
      { id: 'provider:w1', kind: 'album', index: 1, title: 'Play One', parent: { title: 'Anthology', poster: '/img/root' } },
      { id: 'provider:w2', kind: 'album', index: 2, title: 'Play Two', parent: { title: 'Anthology', poster: '/img/root' } },
    ];
    let leafCalls = 0;
    const mediaCatalog = {
      ...catalog(works),
      listLeaves: async () => {
        leafCalls += 1;
        return [
          { id: 'provider:c1', parentId: 'provider:w1' },
          { id: 'provider:c2', parentId: 'provider:w1' },
          { id: 'provider:c3', parentId: 'provider:w2' },
        ];
      },
    };
    const material = await new MediaAlbumSource({ mediaCatalog }).getMaterial('root');
    expect(leafCalls).toBe(1);
    expect(material.units.map((u) => u.id)).toEqual(['provider:w1', 'provider:w2']);
    expect(material.trackParents).toEqual(new Map([
      ['provider:c1', 'provider:w1'],
      ['provider:c2', 'provider:w1'],
      ['provider:c3', 'provider:w2'],
    ]));
  });

  it('a FAILING listLeaves degrades to no roll-up (trackParents absent) — the material still resolves, warn-logged', async () => {
    const works = [
      { id: 'provider:w1', kind: 'album', index: 1, title: 'Play One', parent: { title: 'Anthology', poster: '/img/root' } },
    ];
    const warns = [];
    const mediaCatalog = {
      ...catalog(works),
      listLeaves: async () => { throw new Error('plex 503'); },
    };
    const logger = { warn: (event, data) => warns.push({ event, data }) };
    const material = await new MediaAlbumSource({ mediaCatalog, logger }).getMaterial('root');
    // Resolves — a leaf-listing failure must never block the units fetch;
    // gates just degrade to today's needsQuiz behavior (no trackParents).
    expect(material.units.map((u) => u.id)).toEqual(['provider:w1']);
    expect(material.trackParents).toBeUndefined();
    expect(warns).toEqual([{
      event: 'school.material.leaves-failed',
      data: { materialId: 'root', error: 'plex 503' },
    }]);
  });
});
