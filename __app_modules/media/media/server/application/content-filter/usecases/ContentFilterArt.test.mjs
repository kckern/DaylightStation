import { describe, it, expect, vi } from 'vitest';
import { ContentFilterArt } from './ContentFilterArt.mjs';
import { imageSize } from '../../../domain/content-filter/imageSize.mjs';

const png = (w, h = 10) => { const b = Buffer.alloc(32); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const jpeg = (w, h) => { const b = Buffer.alloc(40); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xc0; b.writeUInt16BE(17, 4); b[6] = 8; b.writeUInt16BE(h, 7); b.writeUInt16BE(w, 9); return b; };
const logger = () => ({ info: vi.fn(), warn: vi.fn() });

function fake({ selectedW, alts = [], images, putFails = false } = {}) {
  const heads = { '/sel': selectedW != null ? png(selectedW) : null };
  for (const a of alts) heads[a.key] = a.buf;
  return {
    getMetadata: vi.fn(async () => ({ MediaContainer: { Metadata: [{ Image: images || [{ type: 'clearLogo', url: '/sel' }, { type: 'coverPoster', url: '/p' }, { type: 'background', url: '/b' }] }] } })),
    getClearLogos: vi.fn(async () => ({ MediaContainer: { Metadata: alts.map(({ buf, ...a }) => a) } })),
    imageHead: vi.fn(async (k) => { if (!heads[k]) throw new Error('nope'); return heads[k]; }),
    selectClearLogo: vi.fn(async () => { if (putFails) throw new Error('boom'); return 200; }),
  };
}

describe('imageSize', () => {
  it('reads PNG and JPEG headers', () => {
    expect(imageSize(png(800, 310))).toMatchObject({ width: 800, height: 310 });
    expect(imageSize(jpeg(640, 480))).toMatchObject({ width: 640, height: 480 });
    expect(imageSize(Buffer.from('nope'))).toBeNull();
  });
});

describe('ContentFilterArt cascade', () => {
  it('keeps the selected logo when it is wide enough', async () => {
    const plex = fake({ selectedW: 800 }); const log = logger();
    const art = await new ContentFilterArt({ plex, logger: log }).execute({ ratingKey: '1' });
    expect(art).toMatchObject({ logo: '/api/v1/proxy/plex/library/metadata/1/clearLogo', source: 'selected', poster: '/api/v1/proxy/plex/library/metadata/1/thumb', background: '/api/v1/proxy/plex/library/metadata/1/art' });
    expect(plex.getClearLogos).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith('content-filter.art.logo', { rk: '1', source: 'selected', width: 800 });
  });

  it('a tiny selected logo falls to the best alternative (PNG, then widest) and selects it in Plex', async () => {
    const plex = fake({ selectedW: 54, alts: [
      { key: '/library/metadata/1/file?url=a', ratingKey: 'upload://a', buf: jpeg(2000, 800) },
      { key: 'https://metadata-static.plex.tv/b.png', ratingKey: 'metadata://b', buf: png(500) },
      { key: 'https://metadata-static.plex.tv/c.png', ratingKey: 'metadata://c', buf: png(900) },
      { key: 'https://metadata-static.plex.tv/d.png', ratingKey: 'metadata://d', buf: png(100) },
    ] });
    const art = await new ContentFilterArt({ plex, logger: logger() }).execute({ ratingKey: '1' });
    expect(art).toMatchObject({ logo: 'https://metadata-static.plex.tv/c.png', source: 'alternative' });
    await Promise.resolve();
    expect(plex.selectClearLogo).toHaveBeenCalledWith('1', 'metadata://c');
  });

  it('a relative alternative is served through the Plex proxy', async () => {
    const plex = fake({ selectedW: 54, alts: [{ key: '/library/metadata/1/file?url=a.png', buf: png(700) }] });
    const art = await new ContentFilterArt({ plex, logger: logger() }).execute({ ratingKey: '1' });
    expect(art.logo).toBe('/api/v1/proxy/plex/library/metadata/1/file?url=a.png');
  });

  it('no usable alternatives: no logo, poster kept', async () => {
    const plex = fake({ selectedW: 54, alts: [{ key: '/x', buf: png(100) }] });
    const art = await new ContentFilterArt({ plex, logger: logger() }).execute({ ratingKey: '1' });
    expect(art).toMatchObject({ logo: null, source: 'none' });
    expect(art.poster).toBeTruthy();
    expect(plex.selectClearLogo).not.toHaveBeenCalled();
  });

  it('no poster in Plex: poster is null', async () => {
    const plex = fake({ selectedW: 54, images: [{ type: 'clearLogo', url: '/sel' }] });
    expect((await new ContentFilterArt({ plex, logger: logger() }).execute({ ratingKey: '1' })).poster).toBeNull();
  });

  it('a failing Plex PUT warns and never throws; the alternative is still returned', async () => {
    const plex = fake({ selectedW: 54, alts: [{ key: 'https://x/a.png', buf: png(600) }], putFails: true }); const log = logger();
    const art = await new ContentFilterArt({ plex, logger: log }).execute({ ratingKey: '1' });
    expect(art.source).toBe('alternative');
    await new Promise((r) => setTimeout(r, 0));
    expect(log.warn).toHaveBeenCalledWith('content-filter.art.select-failed', expect.objectContaining({ rk: '1' }));
  });

  it('caches the decision per rating key', async () => {
    const plex = fake({ selectedW: 800 }); const uc = new ContentFilterArt({ plex, logger: logger() });
    await uc.execute({ ratingKey: '1' }); await uc.execute({ ratingKey: '1' });
    expect(plex.getMetadata).toHaveBeenCalledTimes(1);
  });
});

describe('ContentFilterArt real Plex shapes and transient failures', () => {
  const realAlts = [
    { key: '/library/metadata/662169/file?url=metadata%3A%2F%2FclearLogos%2Fx', ratingKey: 'metadata://clearLogos/x', selected: true, provider: 'tmdb' },
    { key: 'https://metadata-static.plex.tv/8/a.png', ratingKey: 'https://metadata-static.plex.tv/8/a.png', provider: 'tmdb' },
  ];
  const images = [{ type: 'clearLogo', url: 'metadata://clearLogos/x' }, { type: 'coverPoster', url: 'p' }, { type: 'background', url: 'b' }];

  it('selected logo with a metadata:// url (unfetchable) still reaches the absolute-URL alternative', async () => {
    const plex = fake({ images, alts: [{ ...realAlts[0], buf: png(54, 24) }, { ...realAlts[1], buf: png(2784, 1283) }] });
    const art = await new ContentFilterArt({ plex, logger: logger() }).execute({ ratingKey: '662169' });
    expect(art).toMatchObject({ logo: 'https://metadata-static.plex.tv/8/a.png', source: 'alternative' });
  });

  it('does not pin a failed measurement as a long-lived none, and logs why', async () => {
    let t = 0; let fail = true; const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const plex = fake({ images, alts: [{ ...realAlts[1], buf: png(2784, 1283) }] });
    const head = plex.imageHead;
    plex.imageHead = vi.fn(async (k) => { if (fail) throw new Error('timeout'); return head(k); });
    const uc = new ContentFilterArt({ plex, logger: log, now: () => t });
    expect((await uc.execute({ ratingKey: '2' })).source).toBe('none');
    expect(log.debug).toHaveBeenCalledWith('content-filter.art.width-failed', expect.objectContaining({ error: 'timeout' }));
    fail = false; t = 61_000;
    expect((await uc.execute({ ratingKey: '2' })).source).toBe('alternative');
  });
});
