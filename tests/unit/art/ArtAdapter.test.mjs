import { describe, it, expect } from 'vitest';
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
});
