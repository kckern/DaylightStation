import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCanvas, loadImage } from 'canvas';
import YAML from 'yaml';
import {
  buildInventory,
  buildOrganizationPlan,
  applyOrganizationPlan,
  verifyOrganizationPlan,
  renderAnimation,
  renderContactSheet,
  renderFrameGrid,
  renderLayout,
  renderScene,
  explainPrefab,
  renderPrefabPreview,
  validateManifest,
  deriveAtlas,
} from './gaming-assets/lib.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'gaming-assets-'));
  const source = path.join(root, 'sprites', 'Cute_Fantasy', 'NPCs');
  await mkdir(source, { recursive: true });
  const canvas = createCanvas(32, 16);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = '#00ff00'; ctx.fillRect(16, 0, 16, 16);
  const image = path.join(source, 'Hero.png');
  const png = canvas.toBuffer('image/png');
  await writeFile(image, png);
  await writeFile(path.join(source, 'Hero.data'), png);
  await writeFile(path.join(source, '.DS_Store'), 'hidden');
  await writeFile(path.join(root, 'sprites', 'Cute_Fantasy', 'read_me.txt'), 'license terms');
  return { root, image, source: 'sprites/Cute_Fantasy/NPCs/Hero.png' };
}

describe('gaming asset audit tooling', () => {
  it('inventories image facts and license scope from the raw source hierarchy', async () => {
    const { root, source } = await fixture();
    const inventory = await buildInventory({ root });
    assert.equal(inventory.summary.images, 2);
    assert.equal(inventory.summary.files, 3);
    assert.equal(inventory.summary.non_images, 1);
    assert.equal(inventory.assets.find((asset) => asset.source === source).source_readme, 'sprites/Cute_Fantasy/read_me.txt');
    assert.equal(inventory.assets.find((asset) => asset.source === source).image.mode, 'rgba');
    assert.equal(inventory.assets[0].license_scope, 'core-commercial');
    assert.deepEqual(inventory.assets[0].image.candidate_cells, [[8, 8], [16, 16]]);
    assert.ok(inventory.issues.some((issue) => issue.reason === 'unexpected_image_extension'));
    assert.ok(inventory.issues.some((issue) => issue.reason === 'hidden_path'));
    assert.equal(inventory.duplicates.length, 1);
  });

  it('validates approved catalog geometry, clips, and a pinned source hash', async () => {
    const { root, source } = await fixture();
    const inventory = await buildInventory({ root });
    const manifest = {
      schema_version: 1,
      pack: { id: 'default' },
      assets: {
        'npc.hero': {
          source,
          source_sha256: inventory.assets[0].sha256,
          status: 'approved',
        license_scope: 'core-commercial',
        kind: 'sprite-sheet',
        tags: ['actor', 'npc'],
        geometry: { layout: 'grid', cell: [16, 16], grid: [2, 1] },
        defaults: { anchor: 'bottom-center' },
        frames: { 'walk.0': { cell: [0, 0], content_bounds: [0, 0, 16, 16] }, 'walk.1': { cell: [1, 0], content_bounds: [0, 0, 16, 16] } },
        clips: { walk: { frames: ['walk.0', 'walk.1'], fps: 8 } },
        },
        'terrain.single': {
          source,
          source_sha256: inventory.assets[0].sha256,
          status: 'approved',
          license_scope: 'core-commercial',
          kind: 'tile-sheet',
          tags: ['terrain'],
          geometry: { layout: 'grid', cell: [16, 16], grid: [2, 1] },
          frames: { ground: { cell: [0, 0] } },
          autotile: { topology: 'cardinal-4', positive: { isolated: 'ground' } },
        },
      },
    };
    const manifestPath = path.join(root, 'pack.yml');
    await writeFile(manifestPath, YAML.stringify(manifest));
    assert.equal((await validateManifest({ root, manifestPath })).valid, true);
    manifest.assets['terrain.single'].tags.push('overlay');
    await writeFile(manifestPath, YAML.stringify(manifest));
    const opaqueOverlay = await validateManifest({ root, manifestPath });
    assert.equal(opaqueOverlay.valid, false);
    assert.ok(opaqueOverlay.errors.some((error) => error.includes('overlay frame ground must contain transparency')));
    manifest.assets['terrain.single'].tags.pop();
    manifest.assets['npc.hero'].frames['walk.1'].content_bounds = [1, 0, 15, 16];
    await writeFile(manifestPath, YAML.stringify(manifest));
    const badBounds = await validateManifest({ root, manifestPath });
    assert.equal(badBounds.valid, false);
    assert.ok(badBounds.errors.some((error) => error.includes('content_bounds does not match visible alpha')));
    manifest.assets['npc.hero'].frames['walk.1'].content_bounds = [0, 0, 16, 16];
    manifest.assets['npc.hero'].frames['walk.1'].cell = [2, 0];
    await writeFile(manifestPath, YAML.stringify(manifest));
    const invalid = await validateManifest({ root, manifestPath });
    assert.equal(invalid.valid, false);
    assert.ok(invalid.errors.some((error) => error.includes('invalid grid cell')));
  });

  it('plans and copies a kebab-case canonical asset tree without touching source', async () => {
    const { root, source } = await fixture();
    const plan = await buildOrganizationPlan({ root });
    assert.equal(plan.summary.files, 1);
    assert.equal(plan.files[0].source, source);
    assert.equal(plan.files[0].destination, 'assets/default/npcs/hero.png');
    assert.match(plan.files[0].source_sha256, /^[a-f0-9]{64}$/);
    const planPath = path.join(root, 'plan.yml');
    await writeFile(planPath, YAML.stringify(plan));
    const result = await applyOrganizationPlan({ root, planPath });
    assert.equal(result.copied, 1);
    assert.deepEqual(await readFile(path.join(root, 'assets/default/npcs/hero.png')), await readFile(path.join(root, source)));
    assert.deepEqual(await verifyOrganizationPlan({ root, planPath }), { valid: true, files: 1, matched: 1, errors: [] });
  });

  it('writes contact-sheet PNG, frame GIF, and assembly PNG from source data', async () => {
    const { root, source } = await fixture();
    const sheet = path.join(root, 'out', 'sheet.png');
    const gif = path.join(root, 'out', 'walk.gif');
    const layout = path.join(root, 'layout.yml');
    const rendered = path.join(root, 'out', 'layout.png');
    const frames = path.join(root, 'out', 'frames.png');
    const scene = path.join(root, 'scene.yml');
    const sceneOut = path.join(root, 'out', 'scene.png');
    const prefabOut = path.join(root, 'out', 'prefab.png');
    const derivedRecipe = path.join(root, 'derived.yml');
    const derivedOut = path.join(root, 'out', 'derived.png');
    await renderContactSheet({ root, out: sheet, columns: 1, scale: 1 });
    await renderAnimation({ root, source, cell: [16, 16], frames: [[0, 0], [1, 0]], out: gif, scale: 2 });
    await renderFrameGrid({ root, source, cell: [16, 16], out: frames, scale: 2 });
    await writeFile(derivedRecipe, YAML.stringify({ canvas: [32, 16], transparent_colors: ['#ff0000'], layers: [{ source, rect: [0, 0, 32, 16], at: [0, 0] }] }));
    await deriveAtlas({ root, recipePath: derivedRecipe, out: derivedOut });
    await writeFile(layout, YAML.stringify({
      viewport: [64, 32], background: '#000000',
      sprites: [{ source, cell: [16, 16], frame: [1, 0], at: [16, 0], scale: 2 }],
    }));
    await writeFile(scene, YAML.stringify({ viewport: [64, 32], background: '#000', terrain: { grid: { cell: [16, 16], scale: 2 }, regions: [{ terrain: 'water', asset: 'terrain.test', polarity: 'positive', origin: [0, 0], rects: [[0, 0, 2, 1]], continues: ['west', 'east'] }, { terrain: 'sand', asset: 'terrain.test', polarity: 'negative', origin: [0, 0], cells: [[0, 0]] }] }, placements: [{ prefab: 'marker', at: [32, 0] }] }));
    const catalog = path.join(root, 'catalog.yml');
    await writeFile(catalog, YAML.stringify({ schema_version: 1, pack: { id: 'test' }, assets: { 'terrain.test': { status: 'approved', source, tags: ['terrain'], geometry: { layout: 'grid', cell: [16, 16], grid: [2, 1] }, defaults: { anchor: 'top-left' }, frames: { ground: { cell: [0, 0] }, through: { cell: [1, 0] } }, autotile: { topology: 'cardinal-4', positive: { ew: 'through', fallback: 'ground' }, negative: { fallback: 'ground' } } } }, prefabs: { marker: { layers: [{ asset: 'terrain.test#ground', offset: [0, 0], scale: 1 }] } } }));
    await renderLayout({ root, manifestPath: layout, out: rendered });
    await renderScene({ root, catalogPath: catalog, manifestPath: scene, out: sceneOut });
    const renderedScene = await loadImage(sceneOut); const renderedCanvas = createCanvas(64, 32); const renderedContext = renderedCanvas.getContext('2d');
    renderedContext.drawImage(renderedScene, 0, 0);
    assert.deepEqual([...renderedContext.getImageData(48, 8, 1, 1).data], [0, 255, 0, 255], 'continued route uses the through frame at the viewport edge');
    await assert.rejects(
      renderScene({ root, catalogPath: catalog, sceneData: { viewport: [64, 32], placements: [{ asset: 'terrain.test#ground', at: [60, 0], scale: 1 }] }, out: path.join(root, 'out', 'clipped.png') }),
      /visibly clipped draws/,
    );
    assert.equal((await explainPrefab({ catalogPath: catalog, id: 'marker' })).layers[0].asset, 'terrain.test#ground');
    await renderPrefabPreview({ root, catalogPath: catalog, id: 'marker', out: prefabOut, viewport: [64, 64], scale: 1 });
    assert.deepEqual((await readFile(sheet)).subarray(1, 4).toString(), 'PNG');
    assert.deepEqual((await readFile(gif)).subarray(0, 3).toString(), 'GIF');
    assert.deepEqual((await readFile(frames)).subarray(1, 4).toString(), 'PNG');
    assert.deepEqual((await readFile(rendered)).subarray(1, 4).toString(), 'PNG');
    assert.deepEqual((await readFile(sceneOut)).subarray(1, 4).toString(), 'PNG');
    assert.deepEqual((await readFile(prefabOut)).subarray(1, 4).toString(), 'PNG');
    const derivedImage = await loadImage(derivedOut); const derivedCanvas = createCanvas(32, 16); const derivedContext = derivedCanvas.getContext('2d');
    derivedContext.drawImage(derivedImage, 0, 0);
    assert.equal(derivedContext.getImageData(8, 8, 1, 1).data[3], 0, 'configured source color becomes transparent');
    assert.equal(derivedContext.getImageData(24, 8, 1, 1).data[3], 255, 'other source colors remain opaque');
  });
});
