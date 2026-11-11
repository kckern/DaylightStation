import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCanvas, loadImage } from 'canvas';
import YAML from 'yaml';
import { validateManifest } from './lib.mjs';
import { exportSkin, packShelves, parseKey, renderSkinPreview, seamScore, sliceSheet, validateSkin, writeKeyedSheet } from './side-scroller.mjs';

async function png(file, width, height, draw) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  draw(ctx);
  await mkdir(path.dirname(file), { recursive: true });
  const buffer = canvas.toBuffer('image/png');
  await writeFile(file, buffer);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function root() { return mkdtemp(path.join(tmpdir(), 'side-scroller-')); }

/** 2x density stripes: tiles on x when the stripe period divides the width. */
const stripes = (width, period) => (ctx) => {
  for (let x = 0; x < width; x += 2) { ctx.fillStyle = Math.floor(x / period) % 2 ? '#3a7a3a' : '#88cc55'; ctx.fillRect(x, 0, 2, 64); }
};

async function catalogFixture(dir, { layerDistribution = 'private-only', hillsTile = true } = {}) {
  const ramp = (ctx) => { for (let x = 0; x < 64; x += 1) { ctx.fillStyle = `rgb(${x * 3},${120 + x},40)`; ctx.fillRect(x, 0, 1, 32); } };
  const hillsSha = await png(path.join(dir, 'assets/ss/hills.png'), 64, 32, hillsTile ? stripes(64, 16) : ramp);
  const groundSha = await png(path.join(dir, 'assets/ss/ground.png'), 32, 16, (ctx) => {
    ctx.fillStyle = '#704020'; ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = '#40a040'; ctx.fillRect(16, 0, 16, 4); ctx.fillStyle = '#704020'; ctx.fillRect(16, 4, 16, 12);
  });
  const heroSha = await png(path.join(dir, 'assets/ss/hero.png'), 32, 16, (ctx) => {
    ctx.fillStyle = '#ff0000'; ctx.fillRect(2, 4, 12, 8);
    ctx.fillStyle = '#ff0000'; ctx.fillRect(18, 2, 12, 10);
  });
  const catalog = {
    schema_version: 1,
    pack: { id: 'ss-test' },
    assets: {
      'backdrop.hills': {
        source: 'assets/ss/hills.png', source_sha256: hillsSha, status: 'approved', license_scope: 'private-use', distribution: layerDistribution,
        kind: 'image', tags: ['parallax-layer', 'side-scroller'], pixel_density: 2,
        geometry: { layout: 'freeform' }, scroll: { parallax: 0.3, band: [0.5, 0.5] },
        frames: { default: { rect: [0, 0, 64, 32], repeat: ['x'] } },
      },
      'terrain.dirt': {
        source: 'assets/ss/ground.png', source_sha256: groundSha, status: 'approved', license_scope: 'private-use', distribution: 'shippable',
        kind: 'tile-sheet', tags: ['terrain-strip', 'side-scroller'], pixel_density: 1,
        geometry: { layout: 'freeform' },
        frames: { fill: { rect: [0, 0, 16, 16], repeat: ['x', 'y'] }, edge: { rect: [16, 0, 16, 16], repeat: ['x'] } },
      },
      'actor.hero': {
        source: 'assets/ss/hero.png', source_sha256: heroSha, status: 'approved', license_scope: 'private-use', distribution: 'shippable',
        kind: 'sprite-sheet', tags: ['actor', 'side-scroller'], pixel_density: 1,
        geometry: { layout: 'freeform' },
        frames: { 'fly.0': { rect: [0, 0, 16, 16] }, 'fly.1': { rect: [16, 0, 16, 16] } },
        clips: { fly: { frames: ['fly.0', 'fly.1'], fps: 6 } },
      },
    },
  };
  const catalogPath = path.join(dir, 'catalog/ss.yml');
  await mkdir(path.dirname(catalogPath), { recursive: true });
  await writeFile(catalogPath, YAML.stringify(catalog));
  const contract = {
    schema: 'game-skin-contract/v1', game: 'flyer', units: { width: 1000, height: 600 },
    slots: {
      layers: { type: 'parallax-layers', max: 4 },
      'terrain.fill': { type: 'texture', repeat: ['x', 'y'], scale: 3 },
      'terrain.edge': { type: 'strip', repeat: ['x'] },
      craft: { type: 'sprite', animated: true, required: true },
      'entities.*': { type: 'sprite' },
    },
  };
  const contractPath = path.join(dir, 'contract.yml');
  await writeFile(contractPath, YAML.stringify(contract));
  return { catalogPath, contractPath };
}

async function writeSkin(dir, slots, extra = {}) {
  const skinPath = path.join(dir, `skin-${crypto.randomUUID()}.yml`);
  await writeFile(skinPath, YAML.stringify({ schema: 'game-skin/v1', id: 'test-skin', game: 'flyer', distribution: 'private-only', catalog: 'catalog/ss.yml', slots, ...extra }));
  return skinPath;
}

const goodSlots = {
  layers: [{ id: 'hills', asset: 'backdrop.hills' }],
  'terrain.fill': { asset: 'terrain.dirt', frame: 'fill' },
  'terrain.edge': { asset: 'terrain.dirt', frame: 'edge' },
  craft: { asset: 'actor.hero', clip: 'fly' },
  'entities.rock': { asset: 'actor.hero', frame: 'fly.0' },
};

describe('slice', () => {
  it('finds frames on a keyed sheet, ignores dividers, and honours extra key colours', async () => {
    const dir = await root();
    const file = path.join(dir, 'sheet.png');
    await png(file, 80, 40, (ctx) => {
      ctx.fillStyle = '#009e00'; ctx.fillRect(0, 0, 80, 40);
      ctx.fillStyle = '#000000'; ctx.fillRect(40, 0, 1, 40);               // divider
      ctx.fillStyle = '#ff00ff'; ctx.fillRect(4, 4, 20, 20);                // panel (second key)
      ctx.fillStyle = '#ffffff'; ctx.fillRect(8, 8, 6, 5);                  // sprite on the panel
      ctx.fillStyle = '#ffcc00'; ctx.fillRect(50, 10, 10, 12);              // sprite on the sheet
    });
    const plain = await sliceSheet({ file });
    assert.deepEqual(plain.key, { type: 'color', color: '#009e00' });
    assert.equal(plain.dividers, 1);
    assert.equal(plain.frames.length, 2);
    assert.deepEqual(plain.frames[0].content_bounds, [1, 1, 20, 20], 'panel counts as content without the extra key');
    const keyed = await sliceSheet({ file, key: '#009e00,#ff00ff' });
    assert.deepEqual(keyed.frames.map((f) => f.rect), [[7, 7, 8, 7], [49, 9, 12, 14]]);
    assert.deepEqual(keyed.frames[0].content_bounds, [1, 1, 6, 5]);
    assert.deepEqual(keyed.panels, [{ id: 'p-4-4', index: 0, rect: [4, 4, 20, 20], content_bounds: [4, 4, 6, 5] }], 'the panel is reported as a frame canvas');
    assert.deepEqual(keyed.frames.map((f) => f.id), ['f-8-8', 'f-50-10'], 'ids are positional, stable across key changes');
    const out = path.join(dir, 'keyed.png');
    await writeKeyedSheet({ file, key: parseKey('#009e00,#ff00ff'), out });
    const ctx = (() => { const c = createCanvas(80, 40); return c.getContext('2d'); })();
    ctx.drawImage(await loadImage(out), 0, 0);
    assert.equal(ctx.getImageData(5, 5, 1, 1).data[3], 0, 'panel colour keyed out');
    assert.equal(ctx.getImageData(9, 9, 1, 1).data[3], 255, 'sprite kept opaque');
  });
});

describe('side-scroller catalog conventions', () => {
  it('measures seams', () => {
    const width = 8; const height = 2;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) pixels.set([x * 30, 0, 0, 255], (y * width + x) * 4);
    assert.equal(seamScore({ pixels, width }, [0, 0, width, height]).pass, false, 'a ramp breaks at the wrap');
    for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) pixels.set([x % 2 ? 200 : 0, 0, 0, 255], (y * width + x) * 4);
    assert.equal(seamScore({ pixels, width }, [0, 0, width, height]).pass, true, 'an even checker wraps cleanly');
    const wide = 32; const band = new Uint8ClampedArray(wide * height * 4);
    for (let x = 0; x < wide; x += 1) for (let y = 0; y < height; y += 1) band.set([x < 16 ? 0 : 200, 0, 0, 255], (y * wide + x) * 4);
    const edge = seamScore({ pixels: band, width: wide }, [0, 0, wide, height]);
    assert.equal(edge.pass, true, 'a wrap onto an edge the image already has is clean');
    // A diagonal outline crossing the wrap: every column steps a little, the wrap no more than its neighbours.
    const dw = 40; const dh = 40; const diag = new Uint8ClampedArray(dw * dh * 4);
    for (let x = 0; x < dw; x += 1) for (let y = 0; y < dh; y += 1) diag.set(y > dh - 1 - x ? [40, 120, 40, 255] : [120, 180, 240, 255], (y * dw + x) * 4);
    const slope = seamScore({ pixels: diag, width: dw }, [0, 0, dw, dh]);
    assert.equal(slope.pass, false, 'a diagonal that jumps back to sky at the wrap is a break');
    const wrapped = new Uint8ClampedArray(dw * dh * 4);
    for (let x = 0; x < dw; x += 1) for (let y = 0; y < dh; y += 1) wrapped.set(y > 10 + Math.round(8 * Math.sin((x / dw) * 2 * Math.PI)) ? [40, 120, 40, 255] : [120, 180, 240, 255], (y * dw + x) * 4);
    assert.equal(seamScore({ pixels: wrapped, width: dw }, [0, 0, dw, dh]).pass, true, 'a periodic hill outline wraps cleanly');
  });

  it('accepts a tiling parallax layer and terrain strip', async () => {
    const dir = await root();
    const { catalogPath } = await catalogFixture(dir);
    const result = await validateManifest({ root: dir, manifestPath: catalogPath });
    assert.deepEqual(result.errors, []);
  });

  it('measures pixel density: rejects resampled art and under-declared density', async () => {
    const dir = await root();
    const { catalogPath } = await catalogFixture(dir);
    const catalog = YAML.parse(await readFile(catalogPath, 'utf8'));
    const smooth = await png(path.join(dir, 'assets/ss/smooth.png'), 32, 16, (ctx) => { for (let x = 0; x < 32; x += 1) { ctx.fillStyle = `rgb(${x * 7},0,0)`; ctx.fillRect(x, 0, 1, 16); } });
    catalog.assets['backdrop.smooth'] = { ...catalog.assets['backdrop.hills'], source: 'assets/ss/smooth.png', source_sha256: smooth, frames: { default: { rect: [0, 0, 32, 16] , repeat: ['x'] } } };
    catalog.assets['backdrop.hills'].pixel_density = 1;
    await writeFile(catalogPath, YAML.stringify(catalog));
    const result = await validateManifest({ root: dir, manifestPath: catalogPath });
    assert.ok(result.errors.some((e) => e.includes('backdrop.smooth') && e.includes('not true 2x pixel art')), result.errors.join('\n'));
    assert.ok(result.warnings.some((w) => w.includes('backdrop.hills') && w.includes('declare pixel_density 2')), result.warnings.join('\n'));
    assert.ok(!result.errors.some((e) => e.includes('backdrop.hills')), 'under-declared density is a warning, not an error');
  });

  it('rejects sprite frames whose backdrop was never keyed out', async () => {
    const dir = await root();
    const { catalogPath } = await catalogFixture(dir);
    const catalog = YAML.parse(await readFile(catalogPath, 'utf8'));
    const boxed = await png(path.join(dir, 'assets/ss/boxed.png'), 16, 16, (ctx) => { ctx.fillStyle = '#f800f8'; ctx.fillRect(0, 0, 16, 16); ctx.fillStyle = '#ffd000'; ctx.fillRect(4, 4, 8, 8); });
    catalog.assets['item.boxed'] = { ...catalog.assets['actor.hero'], source: 'assets/ss/boxed.png', source_sha256: boxed, frames: { default: { rect: [0, 0, 16, 16] } }, clips: undefined };
    delete catalog.assets['item.boxed'].clips;
    await writeFile(catalogPath, YAML.stringify(catalog));
    const result = await validateManifest({ root: dir, manifestPath: catalogPath });
    assert.ok(result.errors.some((e) => e.includes('item.boxed') && e.includes('opaque background') && e.includes('#f800f8')), result.errors.join('\n'));
    assert.ok(!result.errors.some((e) => e.includes('actor.hero')), 'keyed sprites pass');
  });

  it('enforces a declared palette: colour count and RGB555', async () => {
    const dir = await root();
    const { catalogPath } = await catalogFixture(dir);
    const catalog = YAML.parse(await readFile(catalogPath, 'utf8'));
    catalog.assets['actor.hero'].palette = { max_colors: 1, rgb555: true };
    catalog.assets['terrain.dirt'].palette = { max_colors: 1 };
    await writeFile(catalogPath, YAML.stringify(catalog));
    const result = await validateManifest({ root: dir, manifestPath: catalogPath });
    // #ff0000: 255 is not a multiple of 8, so it is off the SNES 15-bit grid.
    assert.ok(result.errors.some((e) => e.includes('actor.hero') && e.includes('frame fly.0') && e.includes('off the RGB555 grid')), result.errors.join('\n'));
    // the edge frame is grass + dirt: 2 colours against a 1-colour palette; the fill is 1 colour and passes.
    assert.ok(result.errors.some((e) => e.includes('terrain.dirt') && e.includes('frame edge uses 2 colours, palette allows 1')), result.errors.join('\n'));
    assert.ok(!result.errors.some((e) => e.includes('terrain.dirt') && e.includes('frame fill')));
  });

  it('requires every frame of a clip to share one canvas size', async () => {
    const dir = await root();
    const { catalogPath } = await catalogFixture(dir);
    const catalog = YAML.parse(await readFile(catalogPath, 'utf8'));
    catalog.assets['actor.hero'].frames['fly.1'].rect = [16, 0, 14, 16];
    await writeFile(catalogPath, YAML.stringify(catalog));
    const result = await validateManifest({ root: dir, manifestPath: catalogPath });
    assert.ok(result.errors.some((e) => e.includes('clip fly frames must share one canvas size (found 16x16, 14x16)')), result.errors.join('\n'));
  });

  it('rejects a layer that does not tile, a missing scroll block, and a bad distribution', async () => {
    const dir = await root();
    const { catalogPath } = await catalogFixture(dir, { hillsTile: false });
    const catalog = YAML.parse(await readFile(catalogPath, 'utf8'));
    catalog.assets['terrain.dirt'].distribution = 'public';
    await writeFile(catalogPath, YAML.stringify(catalog));
    let result = await validateManifest({ root: dir, manifestPath: catalogPath });
    assert.ok(result.errors.some((e) => e.includes('backdrop.hills') && e.includes('does not tile on x')), result.errors.join('\n'));
    assert.ok(result.errors.some((e) => e.includes('terrain.dirt') && e.includes('distribution')));
    delete catalog.assets['backdrop.hills'].scroll;
    await writeFile(catalogPath, YAML.stringify(catalog));
    result = await validateManifest({ root: dir, manifestPath: catalogPath });
    assert.ok(result.errors.some((e) => e.includes('needs a scroll block')));
  });
});

describe('skins', () => {
  it('validates a skin against the contract and catalog', async () => {
    const dir = await root();
    const { contractPath } = await catalogFixture(dir);
    const result = await validateSkin({ root: dir, contractPath, skinPath: await writeSkin(dir, goodSlots) });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.usedAssets, ['actor.hero', 'backdrop.hills', 'terrain.dirt']);
  });

  it('fails closed on unknown slots, missing clips, missing required slots and wrong roles', async () => {
    const dir = await root();
    const { contractPath } = await catalogFixture(dir);
    const result = await validateSkin({ root: dir, contractPath, skinPath: await writeSkin(dir, {
      layers: [{ id: 'hills', asset: 'actor.hero' }],
      'terrain.lava': { asset: 'terrain.dirt', frame: 'fill' },
      'entities.rock': { asset: 'actor.hero', frame: 'nope' },
    }) });
    assert.ok(result.errors.some((e) => e.includes('is not a parallax-layer')));
    assert.ok(result.errors.some((e) => e.includes('terrain.lava is not in the flyer contract')));
    assert.ok(result.errors.some((e) => e.includes('frame nope not in asset')));
    assert.ok(result.errors.some((e) => e.includes('required slot craft')));
    const animated = await validateSkin({ root: dir, contractPath, skinPath: await writeSkin(dir, { ...goodSlots, craft: { asset: 'actor.hero', frame: 'fly.0' } }) });
    assert.ok(animated.errors.some((e) => e.includes('animated slot needs a clip')));
  });

  it('keeps private-only art out of a shippable skin', async () => {
    const dir = await root();
    const { contractPath } = await catalogFixture(dir);
    const result = await validateSkin({ root: dir, contractPath, skinPath: await writeSkin(dir, goodSlots, { distribution: 'shippable' }) });
    assert.deepEqual(result.errors, ['slot layers.hills: asset backdrop.hills is private-only; a shippable skin may only use shippable assets']);
  });

  it('exports native-resolution images, a packed sheet and provenance, and previews it', async () => {
    const dir = await root();
    const { contractPath } = await catalogFixture(dir);
    const outDir = path.join(dir, 'out');
    const result = await exportSkin({ root: dir, contractPath, skinPath: await writeSkin(dir, goodSlots), outDir });
    assert.equal(result.ok, true, result.errors?.join('\n'));
    const { slots, provenance, distribution } = result.manifest;
    assert.equal(distribution, 'private-only');
    assert.deepEqual(slots.layers.layers[0], { id: 'hills', file: 'images/layers.hills.png', width: 32, height: 16, parallax: 0.3, band: [0.5, 0.5], front: false }, 'pixel_density 2 is undone');
    assert.deepEqual([slots['terrain.fill'].width, slots['terrain.fill'].height], [48, 48], 'contract scale 3 applied');
    assert.deepEqual(slots.craft, { frames: ['craft.fly.0', 'craft.fly.1'], fps: 6, loop: 'loop' });
    assert.deepEqual(slots['entities.rock'], { frames: ['entities.rock.fly.0'] });
    const sheet = JSON.parse(await readFile(path.join(outDir, 'sprites/sheet.json'), 'utf8'));
    assert.deepEqual(Object.keys(sheet.frames).sort(), ['craft.fly.0', 'craft.fly.1', 'entities.rock.fly.0']);
    assert.equal(provenance['backdrop.hills'].distribution, 'private-only');
    const layer = await loadImage(path.join(outDir, 'images/layers.hills.png'));
    assert.deepEqual([layer.width, layer.height], [32, 16]);
    const preview = path.join(dir, 'preview.png');
    await renderSkinPreview({ exportDir: outDir, contractPath, out: preview, width: 300, height: 180 });
    const image = await loadImage(preview);
    assert.deepEqual([image.width, image.height], [300, 180]);
  });

  it('refuses to export an invalid skin', async () => {
    const dir = await root();
    const { contractPath } = await catalogFixture(dir);
    const result = await exportSkin({ root: dir, contractPath, skinPath: await writeSkin(dir, goodSlots, { distribution: 'shippable' }), outDir: path.join(dir, 'out') });
    assert.equal(result.ok, false);
  });

  it('packs shelves deterministically', () => {
    const pack = packShelves([{ w: 10, h: 4 }, { w: 6, h: 8 }, { w: 10, h: 4 }], { maxWidth: 20 });
    assert.deepEqual(pack.placed.map(({ x, y }) => [x, y]), [[7, 0], [0, 0], [0, 9]]);
    assert.deepEqual([pack.width, pack.height], [17, 13]);
  });
});
