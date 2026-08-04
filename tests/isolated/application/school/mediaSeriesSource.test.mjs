import { describe, expect, it } from 'vitest';
import { MediaSeriesSource } from '#apps/school/sources/MediaSeriesSource.mjs';

describe('MediaSeriesSource', () => {
  it('projects neutral series metadata', async () => {
    const mediaCatalog = {
      canonicalId: (id) => id,
      listChildren: async () => [{ id: 'opaque:series', title: 'Series', poster: '/poster', summary: 'About', childCount: 5 }],
    };
    expect(await new MediaSeriesSource({ mediaCatalog }).listMaterials('opaque:root')).toEqual([{
      id: 'opaque:series', title: 'Series', poster: '/poster', summary: 'About',
      source: 'media-series', medium: 'video', durationMs: null, unitCount: 5,
    }]);
  });

  it('walks seasons in parallel and exposes only the School unit allow-list', async () => {
    const calls = [];
    const rows = {
      'opaque:series': [{ id: 'opaque:s1', kind: 'season' }, { id: 'opaque:s2', kind: 'season' }],
      'opaque:s1': [{ id: 'opaque:e1', title: 'One', durationMs: 1000, parent: { title: 'S1' }, seriesTitle: 'Series', watched: true }],
      'opaque:s2': [{ id: 'opaque:e2', title: 'Two', durationMs: 2000, parent: { title: 'S2' }, seriesTitle: 'Series', percent: 99 }],
    };
    const mediaCatalog = {
      canonicalId: (id) => id,
      listChildren: async (id) => { calls.push(id); return rows[id] ?? []; },
    };
    const material = await new MediaSeriesSource({ mediaCatalog }).getMaterial('opaque:series');
    expect(calls).toEqual(['opaque:series', 'opaque:s1', 'opaque:s2']);
    expect(material).toMatchObject({ title: 'Series', source: 'media-series', durationMs: 3000, unitCount: 2 });
    expect(material.units.map((unit) => unit.group)).toEqual(['S1', 'S2']);
    expect(Object.keys(material.units[0]).sort()).toEqual(['durationMs', 'group', 'id', 'index', 'thumb', 'title']);
  });
});
