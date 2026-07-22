import { describe, it, expect } from 'vitest';
import { PlexShowSource } from '#apps/school/sources/PlexShowSource.mjs';

// Fixtures shaped like real Plex responses / FitnessPlayableService.getPlayableEpisodes()
// output (backend/src/3_applications/fitness/FitnessPlayableService.mjs:47-120).
// Real field names verified by reading the method + PlexAdapter#_toPlayableItem
// (backend/src/1_adapters/content/media/plex/PlexAdapter.mjs:749-863):
//   - item.id is already `plex:<ratingKey>`
//   - item.title
//   - item.duration is Plex's ms value ALREADY DIVIDED DOWN TO SECONDS by the
//     adapter (PlexAdapter.mjs:858: `Math.floor(item.duration / 1000)`)
//   - item.metadata.parentTitle is the season title, for type 'episode' (PlexAdapter.mjs:791)
//   - watch-state fields added on top by FitnessPlayableService#classifyItem:
//     watchProgress, watchSeconds, watchedDate, isWatched — plus whatever
//     ContentQueryService#enrichWithWatchState merges in (percent, playhead,
//     viewCount, lastPlayed, completedAt). School must discard all of these.

function twoSeasonShow() {
  return {
    compoundId: 'plex:70001',
    showId: '70001',
    info: { key: '70001', title: 'Shakespeare Tales', image: '/api/v1/proxy/plex/library/metadata/70001/thumb/1', type: 'show' },
    containerItem: null,
    parents: null,
    items: [
      {
        id: 'plex:70011', title: 'The Ghost of the King', duration: 1425, // seconds, per adapter conversion
        metadata: { parentTitle: 'Season 1', parentIndex: 1, itemIndex: 1, viewCount: 1 },
        isWatched: true, watchProgress: 100, watchSeconds: 1425, watchedDate: '2026-01-01',
        percent: 100, playhead: 1425, completedAt: '2026-01-01', lastPlayed: '2026-01-01',
      },
      {
        id: 'plex:70012', title: 'To Be or Not to Be', duration: 1380,
        metadata: { parentTitle: 'Season 1', parentIndex: 1, itemIndex: 2 },
        isWatched: false, watchProgress: 40, watchSeconds: 550, watchedDate: null,
        percent: 40, playhead: 550,
      },
      {
        id: 'plex:70013', title: 'A Play Within a Play', duration: 1500,
        metadata: { parentTitle: 'Season 1', parentIndex: 1, itemIndex: 3 },
        isWatched: false, watchProgress: 0, watchSeconds: 0, watchedDate: null,
      },
      {
        id: 'plex:70021', title: 'The Balcony Scene', duration: 1200,
        metadata: { parentTitle: 'Season 2', parentIndex: 2, itemIndex: 1 }, // per-season index restarts at 1
        isWatched: false, watchProgress: 0, watchSeconds: 0, watchedDate: null,
      },
      {
        id: 'plex:70022', title: 'The Tragic End', duration: 1350,
        metadata: { parentTitle: 'Season 2', parentIndex: 2, itemIndex: 2 },
        isWatched: false, watchProgress: 0, watchSeconds: 0, watchedDate: null,
      },
    ],
  };
}

describe('PlexShowSource.listMaterials', () => {
  it('maps shows (children of a collection) to Material[] with no units', async () => {
    // `thumb` is given already-proxied here, matching the plexClient contract
    // documented on PlexShowSource's constructor: the real app.mjs
    // `schoolPlexClient` seam rewrites Plex's raw `/library/metadata/...`
    // paths to the app's image proxy before this source ever sees them.
    const plexClient = {
      children: async () => [
        { ratingKey: '70001', title: 'Shakespeare Tales', thumb: '/api/v1/proxy/plex/library/metadata/70001/thumb/1', leafCount: 5, type: 'show' },
        { ratingKey: '70002', title: 'Art Lessons', thumb: '/api/v1/proxy/plex/library/metadata/70002/thumb/1', leafCount: 12, type: 'show' },
      ],
    };
    const source = new PlexShowSource({ plexClient, fitnessPlayableService: { getPlayableEpisodes: async () => { throw new Error('not called'); } } });

    const materials = await source.listMaterials('60000');

    expect(materials).toEqual([
      { id: 'plex:70001', title: 'Shakespeare Tales', poster: '/api/v1/proxy/plex/library/metadata/70001/thumb/1', source: 'plex-show', medium: 'video', durationMs: null, unitCount: 5 },
      { id: 'plex:70002', title: 'Art Lessons', poster: '/api/v1/proxy/plex/library/metadata/70002/thumb/1', source: 'plex-show', medium: 'video', durationMs: null, unitCount: 12 },
    ]);
    for (const m of materials) {
      expect(m.units).toBeUndefined();
      // Catches the poster-unproxied regression: this source must pass the
      // already-proxied plexClient poster through untouched, never a raw
      // `/library/metadata/...` Plex path the frontend can't load.
      expect(m.poster.startsWith('/api/v1/proxy/plex')).toBe(true);
    }
  });

  it('passes the bare rating key to plexClient.children, stripping a plex: prefix if given', async () => {
    let seen = null;
    const plexClient = { children: async (id) => { seen = id; return []; } };
    const source = new PlexShowSource({ plexClient, fitnessPlayableService: {} });

    await source.listMaterials('plex:60000');

    expect(seen).toBe('60000');
  });

  it('falls back to null poster/unitCount when a show child has no thumb/leafCount', async () => {
    const plexClient = { children: async () => [{ ratingKey: '1', title: 'No Art', type: 'show' }] };
    const source = new PlexShowSource({ plexClient, fitnessPlayableService: {} });

    const [material] = await source.listMaterials('60000');

    expect(material.poster).toBeNull();
    expect(material.unitCount).toBeNull();
  });
});

describe('PlexShowSource.getMaterial', () => {
  it('maps a 2-season show to units in absolute returned order, not per-season itemIndex', async () => {
    const fitnessPlayableService = { getPlayableEpisodes: async () => twoSeasonShow() };
    const source = new PlexShowSource({ fitnessPlayableService, plexClient: {} });

    const material = await source.getMaterial('70001');

    expect(material.id).toBe('plex:70001');
    expect(material.title).toBe('Shakespeare Tales');
    expect(material.poster).toBe('/api/v1/proxy/plex/library/metadata/70001/thumb/1');
    expect(material.source).toBe('plex-show');
    expect(material.medium).toBe('video');
    expect(material.unitCount).toBe(5);

    expect(material.units.map((u) => u.index)).toEqual([1, 2, 3, 4, 5]); // absolute position, NOT metadata.itemIndex (which restarts per season)
    expect(material.units.map((u) => u.group)).toEqual(['Season 1', 'Season 1', 'Season 1', 'Season 2', 'Season 2']);
    expect(material.units.map((u) => u.title)).toEqual([
      'The Ghost of the King', 'To Be or Not to Be', 'A Play Within a Play', 'The Balcony Scene', 'The Tragic End',
    ]);
  });

  it('converts durationMs from the seconds-valued duration field the adapter hands back', async () => {
    const fitnessPlayableService = { getPlayableEpisodes: async () => twoSeasonShow() };
    const source = new PlexShowSource({ fitnessPlayableService, plexClient: {} });

    const material = await source.getMaterial('70001');

    expect(material.units[0].durationMs).toBe(1425000); // 1425s * 1000
    expect(material.durationMs).toBe((1425 + 1380 + 1500 + 1200 + 1350) * 1000);
  });

  it('discards ALL watch-state fields — mapped units carry no isWatched/watched/viewCount/percent keys', async () => {
    const fitnessPlayableService = { getPlayableEpisodes: async () => twoSeasonShow() };
    const source = new PlexShowSource({ fitnessPlayableService, plexClient: {} });

    const material = await source.getMaterial('70001');

    for (const unit of material.units) {
      expect(unit).not.toHaveProperty('isWatched');
      expect(unit).not.toHaveProperty('watched');
      expect(unit).not.toHaveProperty('viewCount');
      expect(unit).not.toHaveProperty('percent');
      expect(unit).not.toHaveProperty('watchProgress');
      expect(unit).not.toHaveProperty('watchSeconds');
      expect(unit).not.toHaveProperty('watchedDate');
      expect(unit).not.toHaveProperty('playhead');
      expect(unit).not.toHaveProperty('completedAt');
      expect(unit).not.toHaveProperty('lastPlayed');
      expect(Object.keys(unit).sort()).toEqual(['durationMs', 'group', 'id', 'index', 'thumb', 'title']);
    }
  });

  it('strips a plex: prefix on materialPlexId and forwards the bare showId + configured householdId to getPlayableEpisodes', async () => {
    let seenArgs = null;
    const fitnessPlayableService = { getPlayableEpisodes: async (...args) => { seenArgs = args; return twoSeasonShow(); } };
    const source = new PlexShowSource({ fitnessPlayableService, plexClient: {}, householdId: 'hh1' });

    await source.getMaterial('plex:70001');

    expect(seenArgs).toEqual(['70001', 'hh1']);
  });

  it('defaults householdId to null when not configured', async () => {
    let seenArgs = null;
    const fitnessPlayableService = { getPlayableEpisodes: async (...args) => { seenArgs = args; return twoSeasonShow(); } };
    const source = new PlexShowSource({ fitnessPlayableService, plexClient: {} });

    await source.getMaterial('70001');

    expect(seenArgs).toEqual(['70001', null]);
  });
});
