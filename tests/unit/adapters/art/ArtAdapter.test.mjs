import fs from 'fs';
import os from 'os';
import path from 'path';
import { createArtAdapter } from '../../../../backend/src/1_adapters/content/art/ArtAdapter.mjs';
import { Jimp } from 'jimp';

const noopLogger = { warn: () => {}, error: () => {}, debug: () => {}, info: () => {} };

let tmp;
let imgBasePath;

const metaYaml = (w, h, { artist = 'A', credit = 'C', title = 'T' } = {}) =>
  `title: ${title}\nartist: ${artist}\ndate: '1900'\norigin: O\nmedium: M\ncredit: ${credit}\nwidth: ${w}\nheight: ${h}\n`;

const writeArt = async (folder, [r, g, b], yamlStr) => {
  const dir = path.join(imgBasePath, 'art', 'classic', folder);
  fs.mkdirSync(dir, { recursive: true });
  const color = ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0;
  await new Jimp({ width: 16, height: 12, color }).write(path.join(dir, 'art.png'));
  fs.writeFileSync(path.join(dir, 'metadata.yaml'), yamlStr);
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'art-'));
  imgBasePath = path.join(tmp, 'img');
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('ArtAdapter', () => {
  it('landscape primary → single, one panel', async () => {
    await writeArt('Land', [117, 135, 156], metaYaml(1600, 1000));
    const adapter = createArtAdapter({ imgBasePath, logger: noopLogger });
    const r = await adapter.selectFeatured({ pick: (a) => a[0] });
    expect(r.mode).toBe('single');
    expect(r.panels).toHaveLength(1);
    expect(r.panels[0].image).toContain('Land');
    expect(r.panels[0].meta.width).toBe(1600);
    expect(r.panels[0].color.average).toMatch(/^#[0-9a-f]{6}$/);
    expect(r.matte.branch).toBe('match');
  });

  it('panoramic is excluded; portrait/square are eligible', async () => {
    await writeArt('Pano', [10, 10, 10], metaYaml(3000, 1000));
    await writeArt('Land', [10, 10, 10], metaYaml(1600, 1000));
    await writeArt('Square', [10, 10, 10], metaYaml(1000, 1000));
    await writeArt('Tall', [10, 10, 10], metaYaml(800, 1200));
    const adapter = createArtAdapter({ imgBasePath, logger: noopLogger });
    let pool;
    await adapter.selectFeatured({ pick: (a) => { pool = a; return a.find((e) => e.kind === 'landscape'); } });
    expect(pool.map((e) => e.folder).sort()).toEqual(['Land', 'Square', 'Tall']);
    expect(pool.find((e) => e.folder === 'Square').kind).toBe('portrait');
    expect(pool.find((e) => e.folder === 'Land').kind).toBe('landscape');
  });

  it('portrait primary → diptych with a companion + shared matte', async () => {
    await writeArt('P1', [200, 40, 40], metaYaml(800, 1200, { artist: 'X' }));
    await writeArt('P2', [40, 40, 200], metaYaml(800, 1200, { artist: 'X' }));
    const adapter = createArtAdapter({ imgBasePath, logger: noopLogger });
    const r = await adapter.selectFeatured({ pick: (a) => a[0] });
    expect(r.mode).toBe('diptych');
    expect(r.panels).toHaveLength(2);
    expect(r.panels[0].image).toContain('P1');
    expect(r.panels[1].image).toContain('P2');
    expect(r.matte.base).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('companion prefers same artist+credit, then artist, then credit, then any', async () => {
    await writeArt('Primary', [10, 10, 10], metaYaml(800, 1200, { artist: 'Monet', credit: 'KimballColl' }));
    await writeArt('SameArtistCredit', [10, 10, 10], metaYaml(800, 1200, { artist: 'Monet', credit: 'KimballColl' }));
    await writeArt('SameArtist', [10, 10, 10], metaYaml(800, 1200, { artist: 'Monet', credit: 'Other' }));
    await writeArt('SameCredit', [10, 10, 10], metaYaml(800, 1200, { artist: 'Renoir', credit: 'KimballColl' }));
    await writeArt('Unrelated', [10, 10, 10], metaYaml(800, 1200, { artist: 'Degas', credit: 'Misc' }));
    const adapter = createArtAdapter({ imgBasePath, logger: noopLogger });
    const r = await adapter.selectFeatured({
      pick: (a) => a.find((e) => e.folder === 'Primary') ?? a[0],
    });
    expect(r.mode).toBe('diptych');
    expect(r.panels[1].image).toContain('SameArtistCredit');
  });

  it('portrait with no companion falls back to single', async () => {
    await writeArt('Lonely', [10, 10, 10], metaYaml(800, 1200));
    const adapter = createArtAdapter({ imgBasePath, logger: noopLogger });
    const r = await adapter.selectFeatured({ pick: (a) => a[0] });
    expect(r.mode).toBe('single');
    expect(r.panels).toHaveLength(1);
  });

  it('skips macOS AppleDouble (._) sidecars', async () => {
    const dir = path.join(imgBasePath, 'art', 'classic', 'Land');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '._art.png'), 'fork');
    const color = ((10 << 24) | (10 << 16) | (10 << 8) | 0xff) >>> 0;
    await new Jimp({ width: 16, height: 10, color }).write(path.join(dir, 'real.png'));
    fs.writeFileSync(path.join(dir, 'metadata.yaml'), metaYaml(1600, 1000));
    const adapter = createArtAdapter({ imgBasePath, logger: noopLogger });
    const r = await adapter.selectFeatured({ pick: (a) => a[0] });
    expect(r.panels[0].image).toContain('real.png');
  });

  it('throws when the art directory is empty', async () => {
    fs.mkdirSync(path.join(imgBasePath, 'art', 'classic'), { recursive: true });
    const adapter = createArtAdapter({ imgBasePath, logger: noopLogger });
    await expect(adapter.selectFeatured({ pick: (a) => a[0] })).rejects.toThrow('No artwork available');
  });
});
