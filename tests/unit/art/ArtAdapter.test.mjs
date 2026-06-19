import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { Jimp } from 'jimp';
import { createArtAdapter } from '../../../backend/src/1_adapters/content/art/ArtAdapter.mjs';

const solid = (w, h, hex) => new Jimp({ width: w, height: h, color: hex });

const cand = (id, kind, over = {}) => ({
  id, kind,
  image: `/media/img/${id}.jpg`,
  width: kind === 'landscape' ? 1600 : 800,
  height: kind === 'landscape' ? 1000 : 1200,
  meta: { title: id, artist: 'A', credit: 'C' },
  loadImage: async () => solid(8, 8, 0x3344ffff),
  ...over,
});

const fakeSource = (byDef) => ({ resolveCandidates: async (def) => byDef(def) });

describe('ArtAdapter.selectFeatured', () => {
  it('landscape primary → single panel with matte', async () => {
    const adapter = createArtAdapter({
      collections: { all: {} },
      artSource: fakeSource(() => [cand('land', 'landscape')]),
    });
    const r = await adapter.selectFeatured({ pick: (a) => a[0] });
    expect(r.mode).toBe('single');
    expect(r.panels).toHaveLength(1);
    expect(r.panels[0].image).toBe('/media/img/land.jpg');
    expect(r.matte).toBeTruthy();
  });

  it('portrait primary + companion → diptych', async () => {
    const adapter = createArtAdapter({
      collections: { all: {} },
      artSource: fakeSource(() => [cand('p1', 'portrait'), cand('p2', 'portrait')]),
    });
    const r = await adapter.selectFeatured({ pick: (a) => a[0] });
    expect(r.mode).toBe('diptych');
    expect(r.panels.map((p) => p.image)).toEqual(['/media/img/p1.jpg', '/media/img/p2.jpg']);
  });

  it('unknown collection falls back to all', async () => {
    const calls = [];
    const adapter = createArtAdapter({
      collections: { all: {} },
      artSource: fakeSource((def) => { calls.push(def); return [cand('land', 'landscape')]; }),
    });
    const r = await adapter.selectFeatured({ collection: 'nope', pick: (a) => a[0] });
    expect(r.mode).toBe('single');
    expect(calls[0]).toEqual({});
  });

  it('empty collection result falls back to the all pool', async () => {
    const adapter = createArtAdapter({
      collections: { all: {}, empty: { dateMin: 9999 } },
      artSource: fakeSource((def) => (def.dateMin === 9999 ? [] : [cand('land', 'landscape')])),
    });
    const r = await adapter.selectFeatured({ collection: 'empty', pick: (a) => a[0] });
    expect(r.mode).toBe('single');
    expect(r.panels[0].image).toBe('/media/img/land.jpg');
  });

  it('pairs a companion across artist/credit via the any tier', async () => {
    const adapter = createArtAdapter({
      collections: { all: {} },
      artSource: fakeSource(() => [
        cand('p1', 'portrait', { meta: { title: 'p1', artist: 'A', credit: 'C' } }),
        cand('p2', 'portrait', { meta: { title: 'p2', artist: 'Z', credit: 'Q' } }),
      ]),
    });
    const r = await adapter.selectFeatured({ pick: (a) => a[0] });
    expect(r.mode).toBe('diptych');
    expect(r.panels.map((p) => p.image)).toEqual(['/media/img/p1.jpg', '/media/img/p2.jpg']);
  });

  it('a lone portrait with no companion → single', async () => {
    const adapter = createArtAdapter({
      collections: { all: {} },
      artSource: fakeSource(() => [cand('p1', 'portrait')]),
    });
    const r = await adapter.selectFeatured({ pick: (a) => a[0] });
    expect(r.mode).toBe('single');
    expect(r.panels[0].image).toBe('/media/img/p1.jpg');
  });

  it('caches per-candidate color (loadImage called once across selects)', async () => {
    let loads = 0;
    const one = { ...cand('land', 'landscape'), loadImage: async () => { loads += 1; return solid(8, 8, 0x223344ff); } };
    const adapter = createArtAdapter({ collections: { all: {} }, artSource: fakeSource(() => [one]) });
    await adapter.selectFeatured({ pick: (a) => a[0] });
    await adapter.selectFeatured({ pick: (a) => a[0] });
    expect(loads).toBe(1);
  });

  it('survives a loadImage failure → single with null matte', async () => {
    const broken = { ...cand('land', 'landscape'), loadImage: async () => { throw new Error('decode boom'); } };
    const adapter = createArtAdapter({ collections: { all: {} }, artSource: fakeSource(() => [broken]) });
    const r = await adapter.selectFeatured({ pick: (a) => a[0] });
    expect(r.mode).toBe('single');
    expect(r.matte).toBeNull();
    expect(r.panels[0].image).toBe('/media/img/land.jpg');
  });

  it('immich-sourced collection uses the immich source', async () => {
    const immichSource = {
      resolveCandidates: async () => [{
        id: 'immich:x', kind: 'landscape', image: '/p/x?size=preview',
        width: 1600, height: 1000, meta: { title: 'Lisbon', artist: 'August 2019' },
        loadImage: async () => new Jimp({ width: 4, height: 4, color: 0x112233ff }),
      }],
    };
    const adapter = createArtAdapter({
      collections: { all: {}, fam: { source: 'immich', album: 'Family' } },
      artSource: { resolveCandidates: async () => [] },     // art empty
      immichSource,
    });
    const r = await adapter.selectFeatured({ collection: 'fam', pick: (a) => a[0] });
    expect(r.mode).toBe('single');
    expect(r.panels[0].image).toBe('/p/x?size=preview');
    expect(r.panels[0].meta.title).toBe('Lisbon');
  });
});

describe('ArtAdapter.getThumbnailUrl', () => {
  it('exposes source = "art" for content-registry registration', () => {
    const adapter = createArtAdapter({ collections: {}, artSource: fakeSource(() => []) });
    expect(adapter.source).toBe('art');
  });

  it('picks a deterministic representative (first by sorted id), no color analysis', async () => {
    let loads = 0;
    const c = (id) => ({ ...cand(id, 'landscape'), loadImage: async () => { loads += 1; return solid(4, 4, 0); } });
    const adapter = createArtAdapter({
      collections: { all: {} },
      artSource: fakeSource(() => [c('zeta'), c('alpha'), c('mid')]),
    });
    expect(await adapter.getThumbnailUrl('all')).toBe('/media/img/alpha.jpg');
    expect(loads).toBe(0);                                    // representative ≠ color-analyzed
  });

  it('caches per collection (source resolved once across calls)', async () => {
    let calls = 0;
    const adapter = createArtAdapter({
      collections: { all: {} },
      artSource: fakeSource(() => { calls += 1; return [cand('only', 'landscape')]; }),
    });
    await adapter.getThumbnailUrl('all');
    await adapter.getThumbnailUrl('all');
    expect(calls).toBe(1);
  });

  it('returns null for an empty unfiltered collection', async () => {
    const adapter = createArtAdapter({
      collections: { all: {} },
      artSource: fakeSource(() => []),
    });
    expect(await adapter.getThumbnailUrl('all')).toBeNull();
  });

  describe('with artmode.yml presets on disk', () => {
    let dpath;
    beforeAll(async () => {
      dpath = await fs.mkdtemp(path.join(os.tmpdir(), 'artthumb-'));
      const cfg = path.join(dpath, 'household', 'config');
      await fs.mkdir(cfg, { recursive: true });
      await fs.writeFile(path.join(cfg, 'artmode.yml'),
        'presets:\n  july-4th:\n    collection: americana\n');
    });
    afterAll(async () => { await fs.rm(dpath, { recursive: true, force: true }); });

    it('maps a preset name to its collection', async () => {
      const seen = [];
      const adapter = createArtAdapter({
        dataPath: dpath,
        collections: { americana: { folder: 'americana' } },
        artSource: fakeSource((def) => { seen.push(def); return [cand('flag', 'landscape')]; }),
      });
      expect(await adapter.getThumbnailUrl('july-4th')).toBe('/media/img/flag.jpg');
      expect(seen[0]).toEqual({ folder: 'americana' });      // resolved via preset→collection
    });
  });
});

describe('ArtAdapter recency tempering', () => {
  // A fake media_memory store: `seed` marks ids recently-shown; `recorded`
  // captures what selectFeatured stamps after a pick.
  const fakeStore = (seed = {}) => {
    const recorded = [];
    return {
      recorded,
      load: async () => new Map(Object.entries(seed)),
      record: async (ids) => { recorded.push(...ids); },
    };
  };

  it('benches the most-recently-shown works from the pick pool (~55% window)', async () => {
    let pool = null;
    const store = fakeStore({
      a: '2026-06-17T13:00:00Z',                    // two most-recent → benched
      b: '2026-06-17T14:00:00Z',
    });
    const adapter = createArtAdapter({
      collections: { all: {} },
      recencyStore: store,
      artSource: fakeSource(() => ['a', 'b', 'c', 'd'].map((id) => cand(id, 'landscape'))),
    });
    await adapter.selectFeatured({ pick: (a) => { pool = a; return a[0]; } });
    expect(pool.map((c) => c.id).sort()).toEqual(['c', 'd']);   // a,b held back
  });

  it('records the shown work so it is benched next time', async () => {
    const store = fakeStore();
    const adapter = createArtAdapter({
      collections: { all: {} },
      recencyStore: store,
      artSource: fakeSource(() => [cand('land', 'landscape'), cand('x', 'landscape')]),
    });
    await adapter.selectFeatured({ pick: (a) => a[0] });
    expect(store.recorded).toEqual(['land']);
  });

  it('records both panels of a diptych', async () => {
    const store = fakeStore();
    const adapter = createArtAdapter({
      collections: { all: {} },
      recencyStore: store,
      artSource: fakeSource(() => [cand('p1', 'portrait'), cand('p2', 'portrait')]),
    });
    const r = await adapter.selectFeatured({ pick: (a) => a[0] });
    expect(r.mode).toBe('diptych');
    expect(store.recorded.sort()).toEqual(['p1', 'p2']);
  });

  it('is disabled when recencyStore is null (no tempering, no recording)', async () => {
    let pool = null;
    const adapter = createArtAdapter({
      collections: { all: {} },
      recencyStore: null,
      artSource: fakeSource(() => ['a', 'b', 'c'].map((id) => cand(id, 'landscape'))),
    });
    await adapter.selectFeatured({ pick: (a) => { pool = a; return a[0]; } });
    expect(pool.map((c) => c.id)).toEqual(['a', 'b', 'c']);     // full pool
  });
});

describe('ArtAdapter.collectionAssetIds (e-ink photo pool)', () => {
  it('resolves an immich collection to raw asset IDs (immich: prefix stripped)', async () => {
    const seen = [];
    const immichSource = {
      resolveCandidates: async (def) => {
        seen.push(def);
        return [cand('immich:aaa', 'landscape'), cand('immich:bbb', 'portrait')];
      },
    };
    const adapter = createArtAdapter({
      collections: { all: {}, kids: { source: 'immich', people: ['Felix'], minPeople: 2 } },
      artSource: fakeSource(() => []),
      immichSource,
    });
    const ids = await adapter.collectionAssetIds('kids');
    expect(ids).toEqual(['aaa', 'bbb']);
    expect(seen[0]).toEqual({ source: 'immich', people: ['Felix'], minPeople: 2 });
  });

  it('returns [] for a non-immich (file-based art) collection', async () => {
    const adapter = createArtAdapter({
      collections: { all: {}, americana: { folder: 'americana' } },
      artSource: fakeSource(() => [cand('flag', 'landscape')]),
    });
    expect(await adapter.collectionAssetIds('americana')).toEqual([]);
  });

  it('does NOT widen to the art pool when the immich collection is empty', async () => {
    let artCalled = false;
    const adapter = createArtAdapter({
      collections: { all: {}, kids: { source: 'immich', people: ['Felix'] } },
      artSource: fakeSource(() => { artCalled = true; return [cand('land', 'landscape')]; }),
      immichSource: { resolveCandidates: async () => [] },
    });
    expect(await adapter.collectionAssetIds('kids')).toEqual([]);
    expect(artCalled).toBe(false);
  });

  it('returns [] when the immich source is unavailable', async () => {
    const adapter = createArtAdapter({
      collections: { all: {}, kids: { source: 'immich', people: ['Felix'] } },
      artSource: fakeSource(() => []),
      immichSource: null,
    });
    expect(await adapter.collectionAssetIds('kids')).toEqual([]);
  });
});
