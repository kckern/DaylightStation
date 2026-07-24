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

// getMaterial now fetches episodes DIRECTLY via the `children` seam (show ->
// seasons -> episodes) instead of the shared fitness getPlayableEpisodes. Raw
// Plex `/children` items carry: ratingKey, title, duration (MILLISECONDS),
// parentTitle (season), grandparentTitle (show), and thumb (already proxied by
// the app.mjs seam). Watch-state fields, if present, must be discarded.
function twoSeasonClient() {
  const seasons = [
    { ratingKey: '7010', type: 'season', title: 'Season 1', index: 1 },
    { ratingKey: '7020', type: 'season', title: 'Season 2', index: 2 },
  ];
  const eps = {
    '7010': [
      { ratingKey: '70011', title: 'The Ghost of the King', duration: 1425000, index: 1, type: 'episode', parentTitle: 'Season 1', grandparentTitle: 'Shakespeare Tales', thumb: '/api/v1/proxy/plex/library/metadata/70011/thumb/1', viewCount: 1, lastViewedAt: 123 },
      { ratingKey: '70012', title: 'To Be or Not to Be', duration: 1380000, index: 2, type: 'episode', parentTitle: 'Season 1', grandparentTitle: 'Shakespeare Tales', thumb: null },
      { ratingKey: '70013', title: 'A Play Within a Play', duration: 1500000, index: 3, type: 'episode', parentTitle: 'Season 1', grandparentTitle: 'Shakespeare Tales', thumb: null },
    ],
    '7020': [
      { ratingKey: '70021', title: 'The Balcony Scene', duration: 1200000, index: 1, type: 'episode', parentTitle: 'Season 2', grandparentTitle: 'Shakespeare Tales', thumb: null }, // per-season index restarts at 1
      { ratingKey: '70022', title: 'The Tragic End', duration: 1350000, index: 2, type: 'episode', parentTitle: 'Season 2', grandparentTitle: 'Shakespeare Tales', thumb: null },
    ],
  };
  const calls = [];
  return {
    calls,
    children: async (id) => { calls.push(id); if (id === '70001') return seasons; return eps[id] || []; },
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
  it('maps a 2-season show to units in absolute returned order, not per-season index', async () => {
    const source = new PlexShowSource({ plexClient: twoSeasonClient() });

    const material = await source.getMaterial('70001');

    expect(material.id).toBe('plex:70001');
    expect(material.title).toBe('Shakespeare Tales'); // from episode grandparentTitle
    expect(material.source).toBe('plex-show');
    expect(material.medium).toBe('video');
    expect(material.unitCount).toBe(5);

    expect(material.units.map((u) => u.index)).toEqual([1, 2, 3, 4, 5]); // absolute position across seasons, NOT Plex's per-season index
    expect(material.units.map((u) => u.group)).toEqual(['Season 1', 'Season 1', 'Season 1', 'Season 2', 'Season 2']);
    expect(material.units.map((u) => u.title)).toEqual([
      'The Ghost of the King', 'To Be or Not to Be', 'A Play Within a Play', 'The Balcony Scene', 'The Tragic End',
    ]);
    expect(material.units.map((u) => u.id)).toEqual(['plex:70011', 'plex:70012', 'plex:70013', 'plex:70021', 'plex:70022']);
  });

  it('fetches episodes DIRECTLY via children (show -> seasons -> episodes), not per-item', async () => {
    const client = twoSeasonClient();
    const source = new PlexShowSource({ plexClient: client });

    await source.getMaterial('plex:70001'); // strips the prefix

    // Exactly: children(show) then children(each season) — 3 calls, no per-episode fetch.
    expect(client.calls).toEqual(['70001', '7010', '7020']);
  });

  it('treats raw Plex duration as milliseconds (no seconds conversion)', async () => {
    const source = new PlexShowSource({ plexClient: twoSeasonClient() });

    const material = await source.getMaterial('70001');

    expect(material.units[0].durationMs).toBe(1425000);
    expect(material.durationMs).toBe(1425000 + 1380000 + 1500000 + 1200000 + 1350000);
  });

  it('a flat show (children are episodes, no seasons) resolves in one call', async () => {
    const client = {
      calls: [],
      children: async (id) => {
        client.calls.push(id);
        return [
          { ratingKey: '81', title: 'Ep One', duration: 600000, type: 'episode', parentTitle: 'Flat Show', grandparentTitle: 'Flat Show', thumb: null },
          { ratingKey: '82', title: 'Ep Two', duration: 620000, type: 'episode', parentTitle: 'Flat Show', grandparentTitle: 'Flat Show', thumb: null },
        ];
      },
    };
    const source = new PlexShowSource({ plexClient: client });

    const material = await source.getMaterial('80000');

    expect(client.calls).toEqual(['80000']); // no season recursion
    expect(material.units.map((u) => u.id)).toEqual(['plex:81', 'plex:82']);
  });

  it('discards ALL watch-state fields — mapped units carry only the allow-listed keys', async () => {
    const source = new PlexShowSource({ plexClient: twoSeasonClient() });

    const material = await source.getMaterial('70001');

    for (const unit of material.units) {
      expect(unit).not.toHaveProperty('viewCount');
      expect(unit).not.toHaveProperty('lastViewedAt');
      expect(unit).not.toHaveProperty('isWatched');
      expect(unit).not.toHaveProperty('percent');
      expect(Object.keys(unit).sort()).toEqual(['durationMs', 'group', 'id', 'index', 'thumb', 'title']);
    }
  });
});
