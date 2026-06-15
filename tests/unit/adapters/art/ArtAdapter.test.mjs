import fs from 'fs';
import os from 'os';
import path from 'path';
import { createArtAdapter } from '../../../../backend/src/1_adapters/content/art/ArtAdapter.mjs';
import { Jimp } from 'jimp';

// Write a real solid-color PNG so jimp's average matches the input color.
const writeSolidArt = async (folder, [r, g, b], metaYamlStr) => {
  const dir = path.join(imgBasePath, 'art', 'classic', folder);
  fs.mkdirSync(dir, { recursive: true });
  const color = ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0; // RGBA
  const img = new Jimp({ width: 16, height: 12, color });
  await img.write(path.join(dir, 'art.png'));
  fs.writeFileSync(path.join(dir, 'metadata.yaml'), metaYamlStr);
};

const noopLogger = { warn: () => {}, error: () => {}, debug: () => {}, info: () => {} };

let tmp;
let imgBasePath;

const writeArt = (folder, imageName, metaYaml) => {
  const dir = path.join(imgBasePath, 'art', 'classic', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, imageName), 'fake-image-bytes');
  if (metaYaml != null) fs.writeFileSync(path.join(dir, 'metadata.yaml'), metaYaml);
};

// Landscape metadata with explicit dimensions.
const metaYaml = (w, h, extra = '') =>
  `title: T\nartist: A\ndate: '1900'\norigin: O\nmedium: M\nwidth: ${w}\nheight: ${h}\n${extra}`;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'art-'));
  imgBasePath = path.join(tmp, 'img');
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('ArtAdapter', () => {
  it('returns image path + metadata (incl. dimensions) for a landscape work', async () => {
    writeArt(
      'Adriaen van Ostade - 1674 - Merrymakers in an Inn',
      'Merrymakers in an Inn.jpg',
      "title: Merrymakers in an Inn\nartist: Adriaen van Ostade\ndate: '1674'\norigin: Holland\nmedium: Oil on panel\nwidth: 3000\nheight: 2180\n"
    );
    const adapter = createArtAdapter({ imgBasePath });
    const result = await adapter.selectFeatured({ pick: (arr) => arr[0] });

    expect(result.image).toBe(
      '/media/img/art/classic/Adriaen%20van%20Ostade%20-%201674%20-%20Merrymakers%20in%20an%20Inn/Merrymakers%20in%20an%20Inn.jpg'
    );
    expect(result.meta).toEqual({
      title: 'Merrymakers in an Inn',
      artist: 'Adriaen van Ostade',
      date: '1674',
      origin: 'Holland',
      medium: 'Oil on panel',
      width: 3000,
      height: 2180,
    });
  });

  it('permits 4:3 through 16:9 and excludes narrower / wider works', async () => {
    writeArt('Square', 'a.jpg', metaYaml(1000, 1000));      // 1.00  < 4:3  → excluded
    writeArt('FourThree', 'b.jpg', metaYaml(1200, 900));    // 1.333 = 4:3  → included
    writeArt('Mid', 'c.jpg', metaYaml(1600, 1000));         // 1.60         → included
    writeArt('SixteenNine', 'd.jpg', metaYaml(1600, 900));  // 1.778 = 16:9 → included
    writeArt('Pano', 'e.jpg', metaYaml(3000, 1000));        // 3.00  > 16:9 → excluded

    const adapter = createArtAdapter({ imgBasePath, logger: noopLogger });
    let pool;
    await adapter.selectFeatured({ pick: (arr) => { pool = arr; return arr[0]; } });

    expect(pool.map((e) => e.folder).sort()).toEqual(['FourThree', 'Mid', 'SixteenNine']);
  });

  it('excludes works that are missing dimensions', async () => {
    writeArt('NoDims', 'a.jpg', "title: X\nartist: Y\n");    // no width/height → excluded
    writeArt('Good', 'b.jpg', metaYaml(1500, 1000));         // 1.5 → included

    const adapter = createArtAdapter({ imgBasePath, logger: noopLogger });
    let pool;
    const result = await adapter.selectFeatured({ pick: (arr) => { pool = arr; return arr[0]; } });

    expect(pool.map((e) => e.folder)).toEqual(['Good']);
    expect(result.image).toContain('Good');
  });

  it('excludes works with unparseable metadata', async () => {
    writeArt('Bad', 'a.jpg', ':\n  - unbalanced: [oops');    // throws in yaml.load → excluded
    writeArt('Good', 'b.jpg', metaYaml(1500, 1000));

    const adapter = createArtAdapter({ imgBasePath, logger: noopLogger });
    let pool;
    await adapter.selectFeatured({ pick: (arr) => { pool = arr; return arr[0]; } });

    expect(pool.map((e) => e.folder)).toEqual(['Good']);
  });

  it('ignores macOS AppleDouble (._) sidecar files when choosing the image', async () => {
    const dir = path.join(imgBasePath, 'art', 'classic', 'Land - 1900 - Wide');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '._Wide.jpg'), 'apple-resource-fork'); // sorts first
    fs.writeFileSync(path.join(dir, 'Wide.jpg'), 'real-image-bytes');
    fs.writeFileSync(path.join(dir, 'metadata.yaml'), metaYaml(1500, 1000));

    const adapter = createArtAdapter({ imgBasePath, logger: noopLogger });
    const result = await adapter.selectFeatured({ pick: (arr) => arr[0] });
    expect(result.image).toBe('/media/img/art/classic/Land%20-%201900%20-%20Wide/Wide.jpg');
  });

  it('throws when the art directory does not exist', async () => {
    const adapter = createArtAdapter({ imgBasePath });
    await expect(adapter.selectFeatured({ pick: (arr) => arr[0] })).rejects.toThrow('No artwork available');
  });

  it('throws when every work is filtered out by aspect ratio', async () => {
    writeArt('Tall', 'a.jpg', metaYaml(1000, 2000));         // portrait → excluded
    const adapter = createArtAdapter({ imgBasePath, logger: noopLogger });
    await expect(adapter.selectFeatured({ pick: (arr) => arr[0] })).rejects.toThrow('No artwork available');
  });

  it('returns color + matte for the selected painting (match branch)', async () => {
    await writeSolidArt('Cool - 1900 - Blue', [117, 135, 156], metaYaml(1500, 1000));
    const adapter = createArtAdapter({ imgBasePath, logger: noopLogger });
    const result = await adapter.selectFeatured({ pick: (arr) => arr[0] });

    expect(result.color.average).toMatch(/^#[0-9a-f]{6}$/);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(result.color.average.slice(i, i + 2), 16));
    expect(Math.abs(r - 117)).toBeLessThanOrEqual(6);
    expect(Math.abs(g - 135)).toBeLessThanOrEqual(6);
    expect(Math.abs(b - 156)).toBeLessThanOrEqual(6);
    expect(result.matte.branch).toBe('match');
    expect(result.matte.base).toMatch(/^#[0-9a-f]{6}$/);
    expect(result.matte.bevelTop).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('uses the warm-neutral branch for a near-greyscale painting', async () => {
    await writeSolidArt('Grey - 1900 - Stone', [180, 178, 176], metaYaml(1500, 1000));
    const adapter = createArtAdapter({ imgBasePath, logger: noopLogger });
    const result = await adapter.selectFeatured({ pick: (arr) => arr[0] });
    expect(result.matte.branch).toBe('neutral');
  });
});
