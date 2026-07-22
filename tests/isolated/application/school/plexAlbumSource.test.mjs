import { describe, it, expect } from 'vitest';
import { PlexAlbumSource } from '#apps/school/sources/PlexAlbumSource.mjs';

// Fixtures shaped like real Plex `/library/metadata/{id}/children` responses
// (spec §4: verified 2026-07-22 against artist 619778 / album 619862).
//
// `thumb`/`parentThumb` here are given already-proxied (`/api/v1/proxy/plex/...`),
// matching the plexClient contract documented on PlexAlbumSource's constructor:
// the real app.mjs `schoolPlexClient` seam rewrites Plex's raw
// `/library/metadata/...` paths to the app's image proxy before this source
// ever sees them (PlexAdapter#proxyPath). This source passes `poster` through
// unmodified, so these fixtures prove that pass-through, not any prefixing.
const PROXY = '/api/v1/proxy/plex';

function sixteenAlbums() {
  return Array.from({ length: 16 }, (_, i) => ({
    ratingKey: String(619800 + i),
    title: `Tale ${i + 1}`,
    thumb: `${PROXY}/library/metadata/${619800 + i}/thumb/1`,
    leafCount: 3,
    type: 'album',
  }));
}

function fiveTracksWithExplicitIndex() {
  // Deliberately out of array order to prove `index` (not position) drives ordering-derived fields.
  return [
    { ratingKey: '619867', title: 'Track 5', index: 5, duration: 180000, parentTitle: 'Hamlet', parentThumb: `${PROXY}/library/metadata/619862/thumb/1`, type: 'track' },
    { ratingKey: '619863', title: 'Track 1', index: 1, duration: 200000, parentTitle: 'Hamlet', parentThumb: `${PROXY}/library/metadata/619862/thumb/1`, type: 'track' },
    { ratingKey: '619864', title: 'Track 2', index: 2, duration: 210000, parentTitle: 'Hamlet', parentThumb: `${PROXY}/library/metadata/619862/thumb/1`, type: 'track' },
    { ratingKey: '619865', title: 'Track 3', index: 3, duration: 190000, parentTitle: 'Hamlet', parentThumb: `${PROXY}/library/metadata/619862/thumb/1`, type: 'track' },
    { ratingKey: '619866', title: 'Track 4', index: 4, duration: 220000, parentTitle: 'Hamlet', parentThumb: `${PROXY}/library/metadata/619862/thumb/1`, type: 'track' },
  ];
}

function oneTrackAlbum() {
  // "I Survived" arity (spec §4): artist 483195, album 483214, a single ~68min track.
  return [
    { ratingKey: '483215', title: 'I Survived the Sinking of the Titanic', duration: 4080000, parentTitle: 'I Survived the Sinking of the Titanic', parentThumb: `${PROXY}/library/metadata/483214/thumb/1`, type: 'track' },
  ];
}

describe('PlexAlbumSource.listMaterials', () => {
  it('maps a 16-album artist to Material[] with no units', async () => {
    const plexClient = { children: async () => sixteenAlbums() };
    const source = new PlexAlbumSource({ plexClient, logger: { warn() {}, error() {} } });

    const materials = await source.listMaterials('619778');

    expect(materials).toHaveLength(16);
    expect(materials[0]).toEqual({
      id: 'plex:619800',
      title: 'Tale 1',
      poster: `${PROXY}/library/metadata/619800/thumb/1`,
      source: 'plex-album',
      medium: 'audio',
      durationMs: null,
      unitCount: 3,
    });
    for (const m of materials) {
      expect(m.units).toBeUndefined();
      expect(m.durationMs).toBeNull(); // spec §4: albums carry no duration; never guessed at list level
      // Catches the poster-unproxied regression: this source must pass the
      // already-proxied plexClient poster through untouched, never a raw
      // `/library/metadata/...` Plex path the frontend can't load.
      expect(m.poster.startsWith(PROXY)).toBe(true);
    }
  });

  it('passes the bare rating key to plexClient.children, stripping a plex: prefix if given', async () => {
    let seen = null;
    const plexClient = { children: async (id) => { seen = id; return []; } };
    const source = new PlexAlbumSource({ plexClient });

    await source.listMaterials('plex:619778');

    expect(seen).toBe('619778');
  });

  it('falls back to null poster when a child has no thumb, and null unitCount when it has no leafCount', async () => {
    const plexClient = { children: async () => [{ ratingKey: '1', title: 'No Art', type: 'album' }] };
    const source = new PlexAlbumSource({ plexClient });

    const [material] = await source.listMaterials('artist1');

    expect(material.poster).toBeNull();
    expect(material.unitCount).toBeNull();
  });
});

describe('PlexAlbumSource.getMaterial', () => {
  it('maps a 5-track album to units ordered by explicit index, summing durations (albums carry no duration attribute)', async () => {
    const plexClient = { children: async () => fiveTracksWithExplicitIndex() };
    const source = new PlexAlbumSource({ plexClient });

    const material = await source.getMaterial('619862');

    expect(material.id).toBe('plex:619862');
    expect(material.title).toBe('Hamlet');
    expect(material.poster).toBe(`${PROXY}/library/metadata/619862/thumb/1`);
    expect(material.source).toBe('plex-album');
    expect(material.medium).toBe('audio');
    expect(material.unitCount).toBe(5);
    // 200000+210000+190000+220000+180000
    expect(material.durationMs).toBe(1000000);

    expect(material.units).toHaveLength(5);
    expect(material.units.map((u) => u.index)).toEqual([5, 1, 2, 3, 4]); // preserves explicit index, not array position
    const track1 = material.units.find((u) => u.index === 1);
    expect(track1).toEqual({ id: 'plex:619863', index: 1, title: 'Track 1', durationMs: 200000, group: null });
  });

  it('handles the I Survived arity case: a single-track album still yields exactly one unit', async () => {
    const plexClient = { children: async () => oneTrackAlbum() };
    const source = new PlexAlbumSource({ plexClient });

    const material = await source.getMaterial('483214');

    expect(material.unitCount).toBe(1);
    expect(material.durationMs).toBe(4080000);
    expect(material.units).toEqual([
      { id: 'plex:483215', index: 1, title: 'I Survived the Sinking of the Titanic', durationMs: 4080000, group: null },
    ]);
  });

  it('falls back to array position + 1 when a track has no explicit index', async () => {
    const plexClient = {
      children: async () => [
        { ratingKey: 'a', title: 'First', duration: 1000, parentTitle: 'X', type: 'track' },
        { ratingKey: 'b', title: 'Second', duration: 2000, parentTitle: 'X', type: 'track' },
      ],
    };
    const source = new PlexAlbumSource({ plexClient });

    const material = await source.getMaterial('album1');

    expect(material.units.map((u) => u.index)).toEqual([1, 2]);
  });

  it('strips a plex: prefix on materialPlexId before calling plexClient.children', async () => {
    let seen = null;
    const plexClient = { children: async (id) => { seen = id; return oneTrackAlbum(); } };
    const source = new PlexAlbumSource({ plexClient });

    await source.getMaterial('plex:483214');

    expect(seen).toBe('483214');
  });

  it('group is always null for audio tracks (flat hierarchy, no season concept)', async () => {
    const plexClient = { children: async () => fiveTracksWithExplicitIndex() };
    const source = new PlexAlbumSource({ plexClient });

    const material = await source.getMaterial('619862');

    expect(material.units.every((u) => u.group === null)).toBe(true);
  });
});
