import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCanvas, loadImage } from 'canvas';
import YAML from 'yaml';
import {
  buildInventory,
  auditAssetMetadataCoverage,
  auditAnimationMetadataCoverage,
  buildOrganizationPlan,
  applyOrganizationPlan,
  verifyOrganizationPlan,
  auditTerrainMetadataSweep,
  renderAnimation,
  renderAnimationQaSet,
  renderContactSheet,
  renderFrameGrid,
  measureFrameGrid,
  renderLayout,
  renderScene,
  renderLegacyScene,
  renderSceneQa,
  renderSceneQaSet,
  auditPresentationMaterialPixels,
  approveSceneQaBaseline,
  renderTerrainTopologyQa,
  renderTerrainTopologyQaSet,
  explainPrefab,
  renderPrefabPreview,
  validateManifest,
  deriveAtlas,
  deriveBlobAutotile,
  deriveBlobAutotileCatalog,
  deriveFenceConnectorCatalog,
  loadAssetCatalog,
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
  it('audits and renders anchored four-way control animation instead of accepting a first-frame sprite', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'gaming-animation-qa-'));
    const assetDir = path.join(root, 'assets', 'default', 'actors', 'player'); await mkdir(assetDir, { recursive: true });
    const canvas = createCanvas(32, 16); const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#44aaff'; ctx.fillRect(4, 4, 8, 10); ctx.fillStyle = '#88ddff'; ctx.fillRect(20, 4, 8, 10);
    const source = 'assets/default/actors/player/test-hero.png'; const png = canvas.toBuffer('image/png'); await writeFile(path.join(root, source), png);
    const frame = (column) => ({ cell: [column, 0], content_bounds: [4, 4, 8, 10], anchor: { point: [8, 14] } });
    const reference = (flip_x = false) => ({ clip: 'run.right', ...(flip_x ? { flip_x } : {}) });
    const catalog = {
      schema_version: 2, kind: 'presentation-catalog', pack: { id: 'animation-test', style_profile: 'pixel16.topdown', logical_cell: [16, 16] },
      style_profiles: { 'pixel16.topdown': { logical_cell: [16, 16], sampling: 'nearest', base_pixel: 1, scale_classes: { humanoid: { logical_height: [8, 16] } }, composition: { sector_grid: [1, 1], minimum_occupied_sectors: 1, visual_coverage: [0, 1], minimum_navigation_connectivity: 0, maximum_repeat_ratio: 1, minimum_role_diversity: 1, maximum_role_ratio: 1 } } },
      assets: { 'player.test': {
        source, source_sha256: crypto.createHash('sha256').update(png).digest('hex'), status: 'approved', license_scope: 'test-private-use', pixel_density: 1, style_profile: 'pixel16.topdown', edge_policy: 'isolated', kind: 'sprite-sheet', tags: ['actor', 'player', 'ground-contact'],
        geometry: { layout: 'grid', cell: [16, 16], grid: [2, 1] }, frames: { 'idle.right': frame(0), 'run.right.0': frame(0), 'run.right.1': frame(1) },
        clips: { 'idle.right': { frames: ['idle.right'], fps: 1 }, 'run.right': { frames: ['run.right.0', 'run.right.1'], fps: 8 } },
        animation: { mode: 'state-machine', default_state: 'idle', control: { scheme: 'four-way', idle_state: 'idle', move_state: 'run' }, states: {
          idle: { motion: 'stationary', facings: { north: 'idle.right', east: 'idle.right', south: 'idle.right', west: { clip: 'idle.right', flip_x: true } } },
          run: { motion: 'locomotion', facings: { north: reference(), east: reference(), south: reference(), west: reference(true) } },
        } },
        world: { footprint: { size: [8, 4] }, scale_class: 'humanoid', allowed_materials: ['*'], allowed_surfaces: ['solid'], allowed_planes: ['ground'], allowed_biomes: ['*'], boundary_policy: 'allow', render_layer: 'actor', collision: 'solid' },
      } },
      materials: { ground: { style_profile: 'pixel16.topdown', plane: 'ground', biome: 'test', surface: 'solid', fill: { color: '#225522' } } },
    };
    const catalogPath = path.join(root, 'catalog.yml'); await writeFile(catalogPath, YAML.stringify(catalog));
    const coverage = await auditAnimationMetadataCoverage({ root, catalogPath });
    assert.equal(coverage.valid, true); assert.equal(coverage.summary.runtime_controlled, 1); assert.equal(coverage.summary.canonical_deferred, 0);
    assert.equal(coverage.summary.runtime_sources_fully_mapped, 1); assert.equal(coverage.summary.runtime_sources_partial_or_unmeasured, 0);
    const outDir = path.join(root, 'qa'); const qa = await renderAnimationQaSet({ root, catalogPath, outDir, scale: 3 });
    assert.equal(qa.valid, true); assert.equal(qa.summary.clips, 8);
    assert.equal(qa.summary.controlled_assets, 1);
    assert.equal(qa.summary.temporally_animated_assets, 1);
    assert.equal(qa.artifacts.find((entry) => entry.state === 'run' && entry.facing === 'west').flip_x, true);
    assert.ok((await readFile(path.join(outDir, 'player.test', 'run-west.gif'))).length > 0);
    assert.ok((await readFile(path.join(outDir, 'player.test', 'control-simulation.gif'))).length > 0);
    const focusedQa = await renderAnimationQaSet({ root, catalogPath, outDir: path.join(root, 'qa-focused'), asset: 'player.', scale: 2 });
    assert.equal(focusedQa.asset_selector, 'player.');
    assert.equal(focusedQa.summary.animated_assets, 1);
    await assert.rejects(() => renderAnimationQaSet({ root, catalogPath, outDir: path.join(root, 'qa-missing'), asset: 'animal.missing' }), /no catalog assets match/);

    const fourWayAnimation = structuredClone(catalog.assets['player.test'].animation);
    catalog.assets['player.test'].animation.control.scheme = 'horizontal';
    for (const state of Object.values(catalog.assets['player.test'].animation.states)) {
      delete state.facings.north;
      delete state.facings.south;
    }
    await writeFile(catalogPath, YAML.stringify(catalog));
    const horizontalQa = await renderAnimationQaSet({ root, catalogPath, outDir: path.join(root, 'qa-horizontal'), scale: 3 });
    assert.equal(horizontalQa.valid, true);
    assert.deepEqual([...new Set(horizontalQa.control_simulations[0].trace.map((entry) => entry.facing))].sort(), ['east', 'west']);
    catalog.assets['player.test'].animation = fourWayAnimation;

    catalog.assets['player.test'].frames['run.right.1'].scale_reference = 'idle.right';
    catalog.assets['player.test'].frames['run.right.1'].ground_contact = { point: [8, 14], reason: 'effect envelope uses the reviewed actor foot point' };
    await writeFile(catalogPath, YAML.stringify(catalog));
    assert.equal((await validateManifest({ root, manifestPath: catalogPath })).valid, true);
    catalog.assets['player.test'].frames['run.right.1'].ground_contact.point = [8, 13];
    await writeFile(catalogPath, YAML.stringify(catalog));
    const badGroundContact = await validateManifest({ root, manifestPath: catalogPath });
    assert.equal(badGroundContact.valid, false);
    assert.ok(badGroundContact.errors.some((error) => error.includes('ground_contact point must equal its custom anchor')));
    catalog.assets['player.test'].frames['run.right.1'].ground_contact.point = [8, 14];
    catalog.assets['player.test'].frames['run.right.1'].edge_contact = { allowed: ['north'], reason: 'deliberate test overclaim' };
    await writeFile(catalogPath, YAML.stringify(catalog));
    const badEdgeClaim = await validateManifest({ root, manifestPath: catalogPath });
    assert.equal(badEdgeClaim.valid, false);
    assert.ok(badEdgeClaim.errors.some((error) => error.includes('declares absent source-edge contact: north')));
    delete catalog.assets['player.test'].frames['run.right.1'].edge_contact;
    await writeFile(catalogPath, YAML.stringify(catalog));

    const deferredDir = path.join(root, 'assets', 'default', 'actors', 'animals'); await mkdir(deferredDir, { recursive: true });
    await writeFile(path.join(deferredDir, 'owl.png'), png);
    const dispositionsPath = path.join(root, 'animation-source-dispositions.yml');
    await writeFile(dispositionsPath, YAML.stringify({ schema_version: 1, kind: 'animation-source-dispositions', rules: [{
      id: 'animals.backlog', match: 'assets/default/actors/animals/**', disposition: 'family-deferred',
      reason: 'requires reviewed animal state metadata', required_qa: ['geometry', 'movement-simulation'],
    }] }));
    const classified = await auditAnimationMetadataCoverage({ root, catalogPath, dispositionsPath });
    assert.equal(classified.valid, false); assert.equal(classified.runtime_valid, true); assert.equal(classified.disposition_valid, true); assert.equal(classified.library_complete, false);
    assert.equal(classified.summary.canonical_classified_deferred, 1); assert.equal(classified.summary.canonical_unclassified, 0);

    const effectDir = path.join(root, 'assets', 'default', 'environment', 'effects'); await mkdir(effectDir, { recursive: true });
    const tileSource = 'assets/default/environment/effects/reviewed-tile.png'; await writeFile(path.join(root, tileSource), png);
    catalog.assets['terrain.reviewed'] = {
      ...structuredClone(catalog.assets['player.test']), source: tileSource, kind: 'tile-sheet', tags: ['terrain'],
      frames: { left: frame(0), right: frame(1) }, clips: undefined, animation: undefined,
    };
    await writeFile(catalogPath, YAML.stringify(catalog));
    const tileExcluded = await auditAnimationMetadataCoverage({ root, catalogPath, dispositionsPath });
    assert.equal(tileExcluded.summary.canonical_sprite_candidates, 2);
    assert.equal(tileExcluded.summary.canonical_deferred, 1);
    delete catalog.assets['terrain.reviewed'];

    delete catalog.assets['player.test'].animation.states.run.facings.west;
    await writeFile(catalogPath, YAML.stringify(catalog));
    const incomplete = await auditAnimationMetadataCoverage({ root, catalogPath });
    assert.equal(incomplete.valid, false); assert.ok(incomplete.errors.some((error) => error.includes('lacks west facing')));

    catalog.assets['player.test'].animation.states.run.facings.west = reference(true);
    catalog.assets['player.test'].geometry = { layout: 'grid', cell: [16, 8], grid: [2, 2] };
    await writeFile(catalogPath, YAML.stringify(catalog));
    const splitFrames = await validateManifest({ root, manifestPath: catalogPath });
    assert.equal(splitFrames.valid, false);
    assert.ok(splitFrames.errors.some((error) => error.includes('continuous alpha across internal cell seams')));
    const splitQa = await renderAnimationQaSet({ root, catalogPath, outDir: path.join(root, 'split-qa'), scale: 2 });
    assert.equal(splitQa.valid, false);
    assert.ok(splitQa.errors.some((error) => error.includes('continuous alpha across internal cell seams')));
  });

  it('validates registered animation layers and renders synchronized composite QA', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'gaming-layered-animation-'));
    const assetDir = path.join(root, 'assets', 'default', 'actors', 'player'); await mkdir(assetDir, { recursive: true });
    const makePng = async (source, color, bounds, columns = [0, 1]) => {
      const canvas = createCanvas(32, 16); const context = canvas.getContext('2d'); context.fillStyle = color;
      for (const column of columns) context.fillRect(column * 16 + bounds[0], bounds[1], bounds[2], bounds[3]);
      const png = canvas.toBuffer('image/png'); await writeFile(path.join(root, source), png); return png;
    };
    const baseSource = 'assets/default/actors/player/layered-base.png'; const overlaySource = 'assets/default/actors/player/layered-hat.png';
    const basePng = await makePng(baseSource, '#44aaff', [4, 4, 8, 10]); const overlayPng = await makePng(overlaySource, '#ff5544', [4, 4, 8, 3], [0]);
    const facing = (clip) => ({ north: clip, east: clip, south: clip, west: { clip, flip_x: true } });
    const frames = (bounds) => ({
      'idle.0': { cell: [0, 0], content_bounds: bounds, anchor: { point: [8, 14] } },
      'run.0': { cell: [0, 0], content_bounds: bounds, anchor: { point: [8, 14] } },
      'run.1': { cell: [1, 0], content_bounds: bounds, anchor: { point: [8, 14] } },
    });
    const clips = { idle: { frames: ['idle.0'], fps: 1, loop: 'loop' }, run: { frames: ['run.0', 'run.1'], fps: 8, loop: 'loop' } };
    const states = { idle: { motion: 'stationary', facings: facing('idle') }, run: { motion: 'locomotion', facings: facing('run') } };
    const world = { footprint: { size: [8, 4] }, scale_class: 'humanoid', allowed_materials: ['*'], allowed_surfaces: ['solid'], allowed_planes: ['ground'], allowed_biomes: ['*'], boundary_policy: 'allow', render_layer: 'actor', collision: 'solid' };
    const common = { status: 'approved', license_scope: 'test-private-use', pixel_density: 1, style_profile: 'pixel16.topdown', edge_policy: 'isolated', kind: 'sprite-sheet', geometry: { layout: 'grid', cell: [16, 16], grid: [2, 1] }, world };
    const catalog = {
      schema_version: 2, kind: 'presentation-catalog', pack: { id: 'layered-animation-test', style_profile: 'pixel16.topdown', logical_cell: [16, 16] },
      style_profiles: { 'pixel16.topdown': { logical_cell: [16, 16], sampling: 'nearest', base_pixel: 1, scale_classes: { humanoid: { logical_height: [1, 16] } }, composition: { sector_grid: [1, 1], minimum_occupied_sectors: 1, visual_coverage: [0, 1], minimum_navigation_connectivity: 0, maximum_repeat_ratio: 1, minimum_role_diversity: 1, maximum_role_ratio: 1 } } },
      assets: {
        'player.layered': {
          ...common, source: baseSource, source_sha256: crypto.createHash('sha256').update(basePng).digest('hex'), tags: ['actor', 'player'], frames: frames([4, 4, 8, 10]), clips,
          animation: { mode: 'state-machine', default_state: 'idle', facing_scheme: 'four-way', control: { scheme: 'four-way', idle_state: 'idle', move_state: 'run' }, states, layers: [{ asset: 'layer.hat', role: 'headwear' }] },
        },
        'layer.hat': {
          ...common, source: overlaySource, source_sha256: crypto.createHash('sha256').update(overlayPng).digest('hex'), tags: ['animation-layer', 'animated'], frames: { ...frames([4, 4, 8, 3]), 'run.1': { cell: [1, 0], transparent: true, anchor: { point: [8, 14] } } }, clips: structuredClone(clips),
          animation: { mode: 'state-machine', default_state: 'idle', facing_scheme: 'four-way', states: structuredClone(states) },
        },
      },
      materials: { ground: { style_profile: 'pixel16.topdown', plane: 'ground', biome: 'test', surface: 'solid', fill: { color: '#225522' } } },
    };
    const catalogPath = path.join(root, 'catalog.yml'); await writeFile(catalogPath, YAML.stringify(catalog));
    assert.equal((await validateManifest({ root, manifestPath: catalogPath })).valid, true);
    const outDir = path.join(root, 'qa'); const qa = await renderAnimationQaSet({ root, catalogPath, outDir, scale: 3 });
    assert.equal(qa.valid, true); assert.equal(qa.summary.layered_assets, 1); assert.equal(qa.summary.composite_clips, 8);
    assert.equal(qa.summary.animated_actors, 1); assert.equal(qa.summary.animated_objects, 0); assert.equal(qa.summary.animation_layer_assets, 1);
    assert.equal(qa.summary.temporally_animated_actors, 1); assert.equal(qa.summary.temporally_animated_objects, 0); assert.equal(qa.summary.temporally_animated_layers, 1);
    assert.equal(qa.control_simulations[0].trace.every((entry) => entry.layers.length === 2), true);
    assert.ok((await readFile(path.join(outDir, 'player.layered', 'composite-run-west.gif'))).length > 0);
    assert.ok((await readFile(path.join(outDir, 'player.layered', 'composite-run-west-strip.png'))).length > 0);
    catalog.animation_rigs = { 'player.test': { base_slot: 'body', slots: { body: { order: 0, required: true }, head: { order: 10 } } } };
    catalog.assets['player.layered'].animation.rig = { profile: 'player.test', slot: 'body' };
    catalog.assets['layer.hat'].animation.rig = { profile: 'player.test', slot: 'head' };
    await writeFile(catalogPath, YAML.stringify(catalog));
    assert.equal((await validateManifest({ root, manifestPath: catalogPath })).valid, true);
    catalog.assets['layer.hat'].animation.rig.slot = 'missing'; await writeFile(catalogPath, YAML.stringify(catalog));
    assert.ok((await validateManifest({ root, manifestPath: catalogPath })).errors.some((error) => error.includes('unknown slot missing')));
    catalog.assets['layer.hat'].animation.rig.slot = 'head';
    catalog.assets['layer.hat'].clips.run.fps = 7; await writeFile(catalogPath, YAML.stringify(catalog));
    const mismatched = await validateManifest({ root, manifestPath: catalogPath });
    assert.equal(mismatched.valid, false); assert.ok(mismatched.errors.some((error) => error.includes('clip timing and phase count must match')));
  });

  it('composes relative catalog imports and rejects duplicate IDs', async () => {
    const { root, source } = await fixture();
    const base = path.join(root, 'base.yml'); const bundle = path.join(root, 'bundle.yml');
    const descriptor = { source, status: 'candidate', license_scope: 'core-commercial' };
    await writeFile(base, YAML.stringify({ schema_version: 1, pack: { id: 'base' }, assets: { 'asset.base': descriptor } }));
    await writeFile(bundle, YAML.stringify({ schema_version: 1, pack: { id: 'bundle' }, imports: ['base.yml'], assets: { 'asset.local': descriptor } }));
    assert.deepEqual(Object.keys((await loadAssetCatalog(bundle)).assets).sort(), ['asset.base', 'asset.local']);
    await writeFile(bundle, YAML.stringify({ schema_version: 1, pack: { id: 'bundle' }, imports: ['base.yml'], assets: { 'asset.base': descriptor } }));
    await assert.rejects(loadAssetCatalog(bundle), /duplicate imported assets id asset.base/);
  });

  it('audits measured terrain families and fails closed on uncovered tile sheets', async () => {
    const { root } = await fixture();
    const tileDirectory = path.join(root, 'assets', 'test', 'tiles');
    await mkdir(tileDirectory, { recursive: true });
    const canvas = createCanvas(48, 80);
    await writeFile(path.join(tileDirectory, 'shore.png'), canvas.toBuffer('image/png'));
    const sweepPath = path.join(root, 'terrain-sweep.yml');
    const sweep = {
      schema_version: 1,
      kind: 'terrain-metadata-sweep',
      native_cell: [16, 16],
      coverage: { include: ['assets/**/tiles/**/*.png'], exclude: [] },
      families: {
        'test.shore': {
          readiness: 'metadata-only',
          topology: 'cardinal-4+diagonal-corners',
          corner_support: { outer: 'raw', inner: 'raw' },
          required_metadata: ['frame-map', 'topology-qa'],
          sources: [{ source: 'assets/test/tiles/shore.png', dimensions: [48, 80], grid: [3, 5] }],
        },
      },
    };
    await writeFile(sweepPath, YAML.stringify(sweep));
    const valid = await auditTerrainMetadataSweep({ root, manifestPath: sweepPath });
    assert.equal(valid.valid, true);
    assert.equal(valid.summary.coverage_pngs, 1);
    assert.equal(valid.summary.unreviewed_sources, 0);

    await writeFile(path.join(tileDirectory, 'unknown.png'), createCanvas(16, 16).toBuffer('image/png'));
    const uncovered = await auditTerrainMetadataSweep({ root, manifestPath: sweepPath });
    assert.equal(uncovered.valid, false);
    assert.deepEqual(uncovered.unreviewed, ['assets/test/tiles/unknown.png']);

    sweep.families['test.shore'].sources[0].dimensions = [16, 16];
    await writeFile(sweepPath, YAML.stringify(sweep));
    const staleDimensions = await auditTerrainMetadataSweep({ root, manifestPath: sweepPath });
    assert.ok(staleDimensions.errors.some((error) => error.includes('dimensions do not match 48x80')));
  });

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

  it('records a current, explicit disposition for every canonical PNG without inflating semantic readiness', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'gaming-metadata-coverage-'));
    const assetDir = path.join(root, 'assets', 'default'); await mkdir(assetDir, { recursive: true });
    const source = path.join(assetDir, 'runtime.png'); const deferred = path.join(assetDir, 'deferred.png');
    await writeFile(source, createCanvas(16, 16).toBuffer('image/png'));
    await writeFile(deferred, createCanvas(32, 16).toBuffer('image/png'));
    const inventory = await buildInventory({ root, sourceDir: 'assets' });
    const inventoryPath = path.join(root, 'inventory.yml'); await writeFile(inventoryPath, YAML.stringify(inventory));
    const sourceRecord = inventory.assets.find((record) => record.source === 'assets/default/runtime.png');
    const world = { footprint: { size: [16, 16] }, scale_class: 'terrain', allowed_materials: ['*'], allowed_surfaces: ['solid'], allowed_planes: ['ground'], allowed_biomes: ['*'], boundary_policy: 'allow', render_layer: 'ground', collision: 'passable' };
    const catalog = {
      schema_version: 2, kind: 'presentation-catalog', pack: { id: 'coverage-test', style_profile: 'pixel16.topdown', logical_cell: [16, 16] },
      style_profiles: { 'pixel16.topdown': { logical_cell: [16, 16], sampling: 'nearest', base_pixel: 1, scale_classes: { terrain: { logical_height: [1, 32] } }, composition: { sector_grid: [1, 1], minimum_occupied_sectors: 1, visual_coverage: [0, 1], minimum_navigation_connectivity: 0, maximum_repeat_ratio: 1, minimum_role_diversity: 1, maximum_role_ratio: 1 } } },
      assets: { 'terrain.runtime': { source: sourceRecord.source, source_sha256: sourceRecord.sha256, status: 'approved', pixel_density: 1, style_profile: 'pixel16.topdown', edge_policy: 'seamless', geometry: { layout: 'grid', cell: [16, 16], grid: [1, 1] }, frames: { default: { cell: [0, 0] } }, world } },
      materials: { ground: { style_profile: 'pixel16.topdown', plane: 'ground', biome: 'test', surface: 'solid', fill: { asset: 'terrain.runtime', frame: 'default' } } },
      terrain_interfaces: {}, connector_profiles: {}, height_interfaces: {}, component_profiles: {}, prefabs: {},
    };
    const catalogPath = path.join(root, 'catalog.yml'); await writeFile(catalogPath, YAML.stringify(catalog));
    const report = await auditAssetMetadataCoverage({ root, inventoryPath, catalogPath });
    assert.equal(report.valid, true);
    assert.deepEqual(report.dispositions, { runtime_reviewed: 1, derivation_provenance: 0, deferred_measured: 1 });
    assert.equal(report.semantic_source_coverage, 0.5);
    assert.equal(report.sources.length, 2);
    assert.deepEqual(report.sources.map(({ source: id, disposition }) => [id, disposition]), [
      ['assets/default/deferred.png', 'deferred_measured'],
      ['assets/default/runtime.png', 'runtime_reviewed'],
    ]);
  });

  it('rejects a raw-sprites inventory before emitting misleading coverage noise', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'gaming-metadata-wrong-source-'));
    const sprites = path.join(root, 'sprites'); await mkdir(sprites, { recursive: true });
    await writeFile(path.join(sprites, 'raw.png'), createCanvas(16, 16).toBuffer('image/png'));
    const inventory = await buildInventory({ root, sourceDir: 'sprites' });
    const inventoryPath = path.join(root, 'inventory.yml'); await writeFile(inventoryPath, YAML.stringify(inventory));
    const report = await auditAssetMetadataCoverage({ root, inventoryPath, catalogPath: path.join(root, 'missing-catalog.yml') });
    assert.equal(report.valid, false);
    assert.deepEqual(report.errors, ['inventory must be a v1 gaming-assets inventory generated with --source assets']);
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
          autotile: { topology: 'cardinal-4', supported_polarities: ['positive'], positive: { isolated: 'ground' } },
        },
      },
    };
    const manifestPath = path.join(root, 'pack.yml');
    await writeFile(manifestPath, YAML.stringify(manifest));
    assert.equal((await validateManifest({ root, manifestPath })).valid, true);
    manifest.assets['npc.hero'].frames['walk.0'].subject_bounds = [2, 2, 12, 12];
    await writeFile(manifestPath, YAML.stringify(manifest));
    assert.equal((await validateManifest({ root, manifestPath })).valid, true);
    manifest.assets['npc.hero'].frames['walk.0'].subject_bounds = [8, 8, 12, 12];
    await writeFile(manifestPath, YAML.stringify(manifest));
    assert.match((await validateManifest({ root, manifestPath })).errors.join('\n'), /subject_bounds exceeds frame/);
    delete manifest.assets['npc.hero'].frames['walk.0'].subject_bounds;
    manifest.schema_version = 2;
    await writeFile(manifestPath, YAML.stringify(manifest));
    const incompleteV2 = await validateManifest({ root, manifestPath });
    assert.equal(incompleteV2.valid, false, 'schema-v2 catalogs must satisfy the presentation contract in addition to decoded asset auditing');
    assert.ok(incompleteV2.errors.includes('kind must be presentation-catalog'));
    assert.ok(incompleteV2.errors.includes('style_profiles must be a map'));
    manifest.schema_version = 1;
    manifest.assets['npc.hero'].tags.push('ground-contact');
    await writeFile(manifestPath, YAML.stringify(manifest));
    const badGroundContact = await validateManifest({ root, manifestPath });
    assert.equal(badGroundContact.valid, false);
    assert.ok(badGroundContact.errors.some((error) => error.includes('needs content_bounds and a custom anchor point')));
    for (const frame of Object.values(manifest.assets['npc.hero'].frames)) frame.anchor = { point: [8, 16] };
    await writeFile(manifestPath, YAML.stringify(manifest));
    const unpaddedGroundContact = await validateManifest({ root, manifestPath });
    assert.equal(unpaddedGroundContact.valid, false);
    assert.ok(unpaddedGroundContact.errors.some((error) => error.includes('visible alpha must be enclosed by transparent frame padding')));
    for (const frame of Object.values(manifest.assets['npc.hero'].frames)) delete frame.anchor;
    manifest.assets['npc.hero'].tags.pop();
    manifest.assets['terrain.single'].frames.ground.ports = { east: [17, 8] };
    await writeFile(manifestPath, YAML.stringify(manifest));
    const badPort = await validateManifest({ root, manifestPath });
    assert.equal(badPort.valid, false);
    assert.ok(badPort.errors.some((error) => error.includes('port east must be a named point inside or on the frame boundary')));
    delete manifest.assets['terrain.single'].frames.ground.ports;
    manifest.assets['terrain.single'].tags.push('overlay');
    await writeFile(manifestPath, YAML.stringify(manifest));
    const opaqueOverlay = await validateManifest({ root, manifestPath });
    assert.equal(opaqueOverlay.valid, false);
    assert.ok(opaqueOverlay.errors.some((error) => error.includes('overlay frame ground must contain transparency')));
    manifest.assets['terrain.single'].tags.pop();
    manifest.assets['terrain.single'].forbidden_colors = ['#ff0000'];
    await writeFile(manifestPath, YAML.stringify(manifest));
    const forbiddenColor = await validateManifest({ root, manifestPath });
    assert.equal(forbiddenColor.valid, false);
    assert.ok(forbiddenColor.errors.some((error) => error.includes('frame ground contains forbidden color #ff0000')));
    manifest.assets['terrain.single'].frames.ground.forbidden_color_exceptions = {
      allowed: ['#ff0000'],
      reason: 'reviewed authored accent rather than an accidental baked background',
    };
    await writeFile(manifestPath, YAML.stringify(manifest));
    const reviewedForbiddenColor = await validateManifest({ root, manifestPath });
    assert.equal(reviewedForbiddenColor.valid, true);
    manifest.assets['terrain.single'].frames.ground.forbidden_color_exceptions.allowed = ['#00ff00'];
    await writeFile(manifestPath, YAML.stringify(manifest));
    const invalidForbiddenColorException = await validateManifest({ root, manifestPath });
    assert.equal(invalidForbiddenColorException.valid, false);
    assert.ok(invalidForbiddenColorException.errors.some((error) => error.includes('must be a subset of asset forbidden_colors')));
    delete manifest.assets['terrain.single'].frames.ground.forbidden_color_exceptions;
    delete manifest.assets['terrain.single'].forbidden_colors;
    const blank = createCanvas(16, 16);
    await writeFile(path.join(root, 'blank.png'), blank.toBuffer('image/png'));
    manifest.assets['overlay.empty'] = {
      source: 'blank.png', status: 'approved', license_scope: 'core-commercial', kind: 'effect-sheet', tags: ['overlay'],
      geometry: { layout: 'grid', cell: [16, 16], grid: [1, 1] }, frames: { empty: { cell: [0, 0] } },
    };
    await writeFile(manifestPath, YAML.stringify(manifest));
    const emptyOverlay = await validateManifest({ root, manifestPath });
    assert.equal(emptyOverlay.valid, false);
    assert.ok(emptyOverlay.errors.some((error) => error.includes('overlay frame empty is empty')));
    delete manifest.assets['overlay.empty'];
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

  it('derives fence corners from an explicitly declared top source row', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'gaming-fence-'));
    const sourcePath = path.join(root, 'assets', 'source.png');
    await mkdir(path.dirname(sourcePath), { recursive: true });
    const source = createCanvas(64, 64); const context = source.getContext('2d');
    for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) {
      context.fillStyle = `rgb(${x * 50}, ${y * 60}, 20)`;
      context.fillRect(x * 16, y * 16, 16, 16);
    }
    await writeFile(sourcePath, source.toBuffer('image/png'));
    const manifestPath = path.join(root, 'fences.yml'); const catalogOut = path.join(root, 'catalog.yml');
    await writeFile(manifestPath, YAML.stringify({
      schema_version: 1,
      kind: 'fence-connector-derivation-set',
      catalog: { pack: { id: 'fences' } },
      jobs: {
        wall: {
          source: 'assets/source.png', out: 'assets/derived.png', base: [0, 0],
          top_corner_row_offset: 1, top_extension_rows: 0, end_extension_rows: 0,
          license_scope: 'test',
        },
      },
    }));
    const report = await deriveFenceConnectorCatalog({ root, manifestPath, catalogOut });
    assert.equal(report.valid, true);
    const derived = await loadImage(path.join(root, 'assets', 'derived.png'));
    const sample = createCanvas(64, 48); const sampleContext = sample.getContext('2d'); sampleContext.drawImage(derived, 0, 0);
    assert.deepEqual([...sampleContext.getImageData(8, 8, 1, 1).data], [50, 60, 20, 255]);
    assert.deepEqual([...sampleContext.getImageData(24, 8, 1, 1).data], [150, 60, 20, 255]);
    const invalid = YAML.parse(await readFile(manifestPath, 'utf8')); invalid.jobs.wall.top_corner_row_offset = 4; await writeFile(manifestPath, YAML.stringify(invalid));
    await assert.rejects(deriveFenceConnectorCatalog({ root, manifestPath, catalogOut }), /top_corner_row_offset is invalid/);
  });

  it('derives spaced blob source blocks and applies explicit palette normalization', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'gaming-blob-stride-'));
    const sourcePath = path.join(root, 'assets', 'source.png'); await mkdir(path.dirname(sourcePath), { recursive: true });
    const source = createCanvas(80, 48); const context = source.getContext('2d');
    context.fillStyle = '#ff0000'; context.fillRect(0, 0, 16, 16);
    context.fillStyle = '#00ff00'; context.fillRect(32, 0, 16, 16);
    context.fillStyle = '#0000ff'; context.fillRect(64, 0, 16, 16);
    context.fillStyle = '#8844cc'; context.fillRect(0, 32, 16, 16);
    await writeFile(sourcePath, source.toBuffer('image/png'));
    const recipePath = path.join(root, 'blob.yml'); const out = path.join(root, 'derived.png');
    await writeFile(recipePath, YAML.stringify({
      source: 'assets/source.png', cell: [16, 16], outer_origin: [0, 0], outer_stride: [2, 1],
      outer_corner_mode: 'native', outer_corner_style: 'rounded', outer_edge_mode: 'native',
      inner: { layout: 'inverse-outer' }, negative: false, color_map: { '#ff0000': '#112233' },
    }));
    await deriveBlobAutotile({ root, recipePath, out });
    const derived = await loadImage(out); const sample = createCanvas(64, 80); const sampleContext = sample.getContext('2d'); sampleContext.drawImage(derived, 0, 0);
    assert.deepEqual([...sampleContext.getImageData(0, 0, 1, 1).data], [17, 34, 51, 255]);
    assert.deepEqual([...sampleContext.getImageData(24, 24, 1, 1).data], [136, 68, 204, 255]);
    const nativeMetadata = await deriveBlobAutotile({ root, recipePath, out });
    assert.equal(nativeMetadata.autotile.outer_corner_mode, 'native');
    assert.equal(nativeMetadata.autotile.outer_corner_style, 'rounded');
    assert.equal(nativeMetadata.autotile.outer_edge_mode, 'native');
    assert.deepEqual([...sampleContext.getImageData(40, 56, 1, 1).data], [0, 255, 0, 255], 'native cardinal edge preserves the full top-middle source cell');
    const invalid = YAML.parse(await readFile(recipePath, 'utf8')); invalid.outer_stride = [0, 1]; await writeFile(recipePath, YAML.stringify(invalid));
    await assert.rejects(deriveBlobAutotile({ root, recipePath, out }), /outer_stride must be positive cell steps/);
  });

  it('audits solid fills, sparse overlays, and visible transition bands from decoded pixels', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'gaming-material-pixels-')); await mkdir(path.join(root, 'assets'), { recursive: true });
    const canvas = createCanvas(128, 16); const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#a04030'; ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = '#55aa55'; ctx.fillRect(16, 0, 8, 16);
    ctx.fillStyle = '#55aa55'; ctx.fillRect(32, 0, 16, 16);
    ctx.fillStyle = '#2277cc'; ctx.fillRect(48, 0, 16, 16);
    for (const [index, [left, top]] of [[4, [8, 0]], [5, [8, 8]], [6, [0, 8]], [7, [0, 0]]]) {
      ctx.fillStyle = '#55aa55'; ctx.fillRect(index * 16, 0, 16, 16);
      ctx.fillStyle = '#2277cc'; ctx.fillRect(index * 16 + left + 3, top + 3, 5, 5);
    }
    const png = canvas.toBuffer('image/png'); await writeFile(path.join(root, 'assets', 'terrain.png'), png); const sha = crypto.createHash('sha256').update(png).digest('hex');
    const world = { footprint: { size: [16, 16] }, scale_class: 'terrain', allowed_materials: ['*'], allowed_surfaces: ['solid'], allowed_planes: ['ground'], allowed_biomes: ['*'], boundary_policy: 'allow', render_layer: 'ground', collision: 'passable' };
    const masks = Object.fromEntries(['isolated', 'n', 'e', 's', 'w', 'ne', 'ns', 'nw', 'es', 'ew', 'sw', 'nes', 'new', 'nsw', 'esw', 'nesw'].map((mask) => [mask, 'edge']));
    Object.assign(masks, { ne: 'turn.ne', es: 'turn.es', sw: 'turn.sw', nw: 'turn.nw' });
    const catalog = {
      pack: { logical_cell: [16, 16] }, assets: { terrain: { source: 'assets/terrain.png', source_sha256: sha, pixel_density: 1, geometry: { layout: 'grid', cell: [16, 16], grid: [8, 1] }, frames: { fill: { cell: [0, 0] }, overlay: { cell: [1, 0] }, outside: { cell: [2, 0] }, edge: { cell: [3, 0] }, 'turn.ne': { cell: [4, 0] }, 'turn.es': { cell: [5, 0] }, 'turn.sw': { cell: [6, 0] }, 'turn.nw': { cell: [7, 0] } }, autotile: { outer_corner_style: 'rounded', positive: masks }, world } },
      materials: {
        solid: { fill_mode: 'solid', fill: { asset: 'terrain', frame: 'fill' } },
        overlay: { fill_mode: 'overlay', fill: { asset: 'terrain', frame: 'overlay' } },
        outside: { fill_mode: 'solid', fill: { asset: 'terrain', frame: 'outside' } },
      },
      terrain_interfaces: { shore: { inside: 'solid', outside: 'outside', asset: 'terrain', polarity: 'positive', transition_band: { minimum_changed_ratio: 0.5 }, corner_profile: { style: 'rounded', minimum_cutback_ratio: 0.5 } } },
    };
    const valid = await auditPresentationMaterialPixels({ root, catalog }); assert.equal(valid.valid, true); assert.equal(valid.overlays, 1); assert.equal(valid.transition_bands.shore.north, 1); assert.ok(valid.corner_profiles.shore.ne >= 0.5);
    catalog.materials.overlay.fill_mode = 'solid'; const invalidFill = await auditPresentationMaterialPixels({ root, catalog }); assert.ok(invalidFill.errors.some((error) => error.includes('solid fill has')));
    catalog.materials.overlay.fill_mode = 'overlay'; catalog.assets.terrain.autotile.positive = Object.fromEntries(Object.keys(masks).map((mask) => [mask, 'outside']));
    const invisible = await auditPresentationMaterialPixels({ root, catalog }); assert.ok(invisible.errors.some((error) => error.includes('transition band changes only')));
    assert.ok(invisible.errors.some((error) => error.includes('convex turn cuts back only')));
    delete catalog.terrain_interfaces.shore.transition_band;
    const mandatoryBand = await auditPresentationMaterialPixels({ root, catalog }); assert.ok(mandatoryBand.errors.some((error) => error.includes('transition band changes only') && error.includes('requires 0.1')));
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
    const qaOut = path.join(root, 'out', 'qa');
    const qaSetOut = path.join(root, 'out', 'qa-set');
    const qaSetManifest = path.join(root, 'scene-qa-set.yml');
    const topologyQaOut = path.join(root, 'out', 'topology-qa.png');
    const topologyQaSetOut = path.join(root, 'out', 'topology-qa-set');
    const derivedRecipe = path.join(root, 'derived.yml');
    const derivedOut = path.join(root, 'out', 'derived.png');
    const textureRecipe = path.join(root, 'texture-derived.yml');
    const textureOut = path.join(root, 'out', 'texture-derived.png');
    const textureSource = path.join(root, 'assets', 'texture.png');
    const blobSource = path.join(root, 'blob-source.png');
    const blobRecipe = path.join(root, 'blob.yml');
    const blobOut = path.join(root, 'out', 'blob.png');
    const blobSetRecipe = path.join(root, 'blob-set.yml');
    const blobCatalog = path.join(root, 'blob-catalog.yml');
    await renderContactSheet({ root, out: sheet, columns: 1, scale: 1 });
    await renderAnimation({ root, source, cell: [16, 16], frames: [[0, 0], [1, 0]], out: gif, scale: 2 });
    await renderFrameGrid({ root, source, cell: [16, 16], out: frames, scale: 2 });
    const measurements = await measureFrameGrid({ root, source, cell: [16, 16] });
    const textureCanvas = createCanvas(2, 2); const textureContext = textureCanvas.getContext('2d'); textureContext.fillStyle = '#22aacc'; textureContext.fillRect(0, 0, 2, 2); textureContext.fillStyle = '#cc44aa'; textureContext.fillRect(1, 0, 1, 1); await mkdir(path.dirname(textureSource), { recursive: true }); await writeFile(textureSource, textureCanvas.toBuffer('image/png'));
    await writeFile(derivedRecipe, YAML.stringify({ canvas: [32, 16], transparent_colors: ['#ff0000'], color_map: { '#00ff00': '#112233' }, layers: [{ source, rect: [0, 0, 32, 16], at: [0, 0] }, { source, rect: [16, 0, 16, 16], at: [4, 4], size: [8, 8] }] }));
    const derived = await deriveAtlas({ root, recipePath: derivedRecipe, out: derivedOut });
    await writeFile(textureRecipe, YAML.stringify({ canvas: [32, 16], color_map: { '#00ff00': '#112233' }, texture_fills: [{ source: 'assets/texture.png', rect: [0, 0, 2, 2], colors: ['#112233'] }], layers: [{ source, rect: [0, 0, 32, 16], at: [0, 0] }] }));
    const textured = await deriveAtlas({ root, recipePath: textureRecipe, out: textureOut });
    const paletteImage = await loadImage(textureOut); const paletteSample = createCanvas(32, 16); const paletteContext = paletteSample.getContext('2d'); paletteContext.drawImage(paletteImage, 0, 0);
    assert.deepEqual([...paletteContext.getImageData(20, 0, 1, 1).data], [34, 170, 204, 255]);
    assert.deepEqual([...paletteContext.getImageData(21, 0, 1, 1).data], [204, 68, 170, 255]);
    assert.equal(textured.texture_fills, 1);
    const blobCanvas = createCanvas(48, 80); const blobContext = blobCanvas.getContext('2d');
    blobContext.fillStyle = '#315b36'; blobContext.fillRect(0, 0, 48, 80);
    blobContext.fillStyle = '#d9a066'; blobContext.fillRect(16, 16, 16, 16);
    await writeFile(blobSource, blobCanvas.toBuffer('image/png'));
    await writeFile(blobRecipe, YAML.stringify({ source: 'blob-source.png', cell: [16, 16], outer_origin: [0, 0], inner: { layout: 'two-by-two', origin: [0, 3] } }));
    const blob = await deriveBlobAutotile({ root, recipePath: blobRecipe, out: blobOut });
    await writeFile(blobSetRecipe, YAML.stringify({
      schema_version: 1,
      kind: 'blob-autotile-derivation-set',
      catalog: { pack: { id: 'test-autotiles' }, license_scopes: { test: 'core-commercial' } },
      jobs: { 'test.blob': { source: 'blob-source.png', out: 'assets/test/terrain/autotile/blob.png', cell: [16, 16], outer_origin: [0, 0], inner: { layout: 'two-by-two', origin: [0, 3] } } },
    }));
    const blobCatalogReport = await deriveBlobAutotileCatalog({ root, manifestPath: blobSetRecipe, catalogOut: blobCatalog });
    await writeFile(layout, YAML.stringify({
      viewport: [64, 32], background: '#000000',
      sprites: [{ source, cell: [16, 16], frame: [1, 0], at: [16, 0], scale: 2 }],
    }));
    await writeFile(scene, YAML.stringify({
      viewport: [96, 64], background: '#000',
      review_regions: [{ id: 'join', rect: [16, 0, 32, 16], scale: 2 }],
      connections: [{ from: ['join.left', 'east'], to: ['join.right', 'west'] }],
      terrain: { grid: { cell: [16, 16], scale: 2 }, regions: [{ terrain: 'water', asset: 'terrain.test', polarity: 'positive', origin: [0, 0], rects: [[0, 0, 3, 1]], continues: ['west', 'east'] }, { terrain: 'sand', asset: 'terrain.test', polarity: 'negative', origin: [0, 0], cells: [[0, 0]] }] },
      connectors: [{ id: 'semantic-join', asset: 'terrain.test', origin: [64, 0], rects: [[0, 0, 2, 1]], scale: 1 }],
      heights: [{ id: 'semantic-height', asset: 'terrain.test', direction: 'north', origin: [64, 16], width: 2, scale: 1 }],
      components: [{ id: 'semantic-outline', asset: 'terrain.test', component: 'outline', origin: [32, 32], rects: [[0, 0, 3, 2]], scale: 1 }],
      placements: [{ prefab: 'marker', at: [32, 0] }, { id: 'join.left', asset: 'terrain.test#ground', at: [0, 16], scale: 1 }, { id: 'join.right', asset: 'terrain.test#through', at: [16, 16], scale: 1 }],
    }));
    const catalog = path.join(root, 'catalog.yml');
    await writeFile(catalog, YAML.stringify({ schema_version: 1, pack: { id: 'test' }, assets: { 'terrain.test': { pixel_density: 1, status: 'approved', source, source_sha256: crypto.createHash('sha256').update(await readFile(path.join(root, source))).digest('hex'), license_scope: 'core-commercial', kind: 'tile-sheet', tags: ['terrain'], requires_all_ports: true, geometry: { layout: 'grid', cell: [16, 16], grid: [2, 1] }, defaults: { anchor: 'top-left' }, frames: { ground: { cell: [0, 0], ports: { east: [16, 8] } }, through: { cell: [1, 0], ports: { west: [0, 8] } } }, autotile: { topology: 'cardinal-4', positive: { ew: 'through', fallback: 'ground' }, negative: { fallback: 'ground' } }, connector: { topology: 'connector-graph', pieces: { e: 'ground', w: 'through' } }, height: { topology: 'cliff-height', rise_cells: 1, bands: { lip: ['ground', 'ground', 'ground'] }, transitions: { north: ['lip'] } }, components: { outline: { role: 'border', frames: ['ground', 'through'], outline: { nw: 'ground', n: 'ground', ne: 'ground', w: 'through', e: 'ground', sw: 'ground', s: 'ground', se: 'ground' } } } } }, prefabs: { marker: { layers: [{ asset: 'terrain.test#ground', offset: [0, 0], scale: 1 }] } } }));
    await renderLayout({ root, manifestPath: layout, out: rendered });
    const semanticScene = await renderLegacyScene({ root, catalogPath: catalog, manifestPath: scene, out: sceneOut });
    await assert.rejects(renderScene({ root, catalogPath: catalog, manifestPath: scene, out: path.join(root, 'out', 'production-rejects-v1.png') }), /rejects legacy v1 scenes/);
    const qa = await renderSceneQa({ root, catalogPath: catalog, manifestPath: scene, outDir: qaOut, allowLegacy: true });
    const qaSuite = {
      schema_version: 1, kind: 'scene-qa-set', catalog: 'catalog.yml',
      requirements: { minimum_scenes: 1, required_themes: ['test'], require_review_regions: true, require_no_clipping: true, required_systems: ['terrain', 'connector', 'height', 'component'] },
      scenes: [{ id: 'test-scene', theme: 'test', manifest: 'scene.yml' }],
    };
    await writeFile(qaSetManifest, YAML.stringify(qaSuite));
    await mkdir(path.join(qaSetOut, 'orphan-scene'), { recursive: true });
    await writeFile(path.join(qaSetOut, 'orphan-scene', 'scene.png'), 'stale');
    const qaSet = await renderSceneQaSet({ root, manifestPath: qaSetManifest, outDir: qaSetOut });
    assert.equal((await readdir(qaSetOut)).includes('orphan-scene'), false, 'regeneration removes stale scene directories');
    qaSuite.baseline = 'approved-artifacts.yml'; qaSuite.requirements.require_approved_artifacts = true; await writeFile(qaSetManifest, YAML.stringify(qaSuite));
    const approval = await approveSceneQaBaseline({ manifestPath: qaSetManifest, reportPath: path.join(qaSetOut, 'report.yml'), artifactsDir: path.join(root, 'approved-artifacts') });
    const approvedQa = await renderSceneQaSet({ root, manifestPath: qaSetManifest, outDir: path.join(root, 'out', 'qa-set-approved') });
    const changedScene = YAML.parse(await readFile(scene, 'utf8')); changedScene.background = '#123456'; await writeFile(scene, YAML.stringify(changedScene));
    const changedQaOut = path.join(root, 'out', 'qa-set-changed');
    await assert.rejects(renderSceneQaSet({ root, manifestPath: qaSetManifest, outDir: changedQaOut }), /visual regression failed/);
    assert.ok((await readFile(path.join(changedQaOut, 'diffs', 'test-scene', 'scene.png'))).length > 0);
    const candidateQaOut = path.join(root, 'out', 'qa-set-candidate');
    const candidateQa = await renderSceneQaSet({ root, manifestPath: qaSetManifest, outDir: candidateQaOut, candidate: true });
    assert.equal(candidateQa.valid, true);
    assert.equal(candidateQa.approval_candidate, true);
    assert.equal(candidateQa.visual_regression.candidate, true);
    await approveSceneQaBaseline({ manifestPath: qaSetManifest, reportPath: path.join(candidateQaOut, 'report.yml'), artifactsDir: path.join(root, 'approved-artifacts') });
    assert.equal((await renderSceneQaSet({ root, manifestPath: qaSetManifest, outDir: path.join(root, 'out', 'qa-set-candidate-approved') })).visual_regression.valid, true);
    const topologyQa = await renderTerrainTopologyQa({ root, catalogPath: catalog, assetId: 'terrain.test', out: topologyQaOut, scale: 2 });
    const topologyQaSet = await renderTerrainTopologyQaSet({ root, catalogPath: catalog, outDir: topologyQaSetOut, scale: 2 });
    const renderedScene = await loadImage(sceneOut); const renderedCanvas = createCanvas(96, 64); const renderedContext = renderedCanvas.getContext('2d');
    renderedContext.drawImage(renderedScene, 0, 0);
    assert.deepEqual([...renderedContext.getImageData(48, 8, 1, 1).data], [0, 255, 0, 255], 'continued route uses the through frame at the viewport edge');
    assert.equal(semanticScene.connector_audit[0].cells, 2);
    assert.equal(semanticScene.height_audit[0].draws, 2);
    assert.equal(semanticScene.component_audit[0].draws, 6);
    assert.equal(semanticScene.resolution_audit.assets['terrain.test'].pixel_density, 1);
    await assert.rejects(
      renderLegacyScene({ root, catalogPath: catalog, sceneData: { viewport: [64, 64], world_scale: 2, enforce_uniform_pixel_scale: true, placements: [{ asset: 'terrain.test#ground', at: [0, 0], scale: 1 }] }, out: path.join(root, 'out', 'mixed-pixel-scale.png') }),
      /pixel scale must match world_scale/,
    );
    const densityCatalogPath = path.join(root, 'density-catalog.yml');
    const densityCatalog = YAML.parse(await readFile(catalog, 'utf8'));
    densityCatalog.assets['terrain.test'].pixel_density = 2;
    densityCatalog.assets['terrain.test'].requires_all_ports = false;
    const densityReportPath = path.join(root, 'out', 'normalized-density.png');
    await writeFile(densityCatalogPath, YAML.stringify(densityCatalog));
    const densityReport = await renderLegacyScene({
      root, catalogPath: densityCatalogPath,
      sceneData: { viewport: [32, 32], world_scale: 2, require_explicit_pixel_density: true, enforce_uniform_pixel_scale: true, trace: true, placements: [{ asset: 'terrain.test#ground', at: [0, 0] }] },
      out: densityReportPath,
    });
    assert.deepEqual(densityReport.trace[0].logical_size, [8, 8]);
    assert.equal(densityReport.resolution_audit.normalized_draws, 1);
    await assert.rejects(
      renderLegacyScene({ root, catalogPath: catalog, sceneData: { viewport: [64, 32], placements: [{ asset: 'terrain.test#ground', at: [60, 0], scale: 1 }] }, out: path.join(root, 'out', 'clipped.png') }),
      /visibly clipped draws/,
    );
    await assert.rejects(
      renderLegacyScene({ root, catalogPath: catalog, sceneData: { viewport: [64, 32], connections: [{ from: ['left', 'east'], to: ['right', 'west'] }], placements: [{ id: 'left', asset: 'terrain.test#ground', at: [0, 0] }, { id: 'right', asset: 'terrain.test#through', at: [17, 0] }] }, out: path.join(root, 'out', 'bad-join.png') }),
      /scene connection 0 is misaligned/,
    );
    await assert.rejects(
      renderLegacyScene({ root, catalogPath: catalog, sceneData: { viewport: [64, 32], placements: [{ id: 'unconnected', asset: 'terrain.test#ground', at: [0, 0] }] }, out: path.join(root, 'out', 'unconnected.png') }),
      /required port unconnected.east must be connected exactly once; found 0/,
    );
    await assert.rejects(
      renderLegacyScene({ root, catalogPath: catalog, sceneData: { viewport: [64, 32], forbid_direct_autotile_frames: true, placements: [{ asset: 'terrain.test#ground', at: [0, 0] }] }, out: path.join(root, 'out', 'raw-autotile.png') }),
      /must author autotile frame through a terrain region/,
    );
    const edgeCatalog = YAML.parse(await readFile(catalog, 'utf8'));
    edgeCatalog.assets['terrain.test'].kind = 'sprite-sheet';
    delete edgeCatalog.assets['terrain.test'].requires_all_ports;
    await writeFile(catalog, YAML.stringify(edgeCatalog));
    await assert.rejects(
      renderLegacyScene({ root, catalogPath: catalog, sceneData: { viewport: [64, 32], fail_on_frame_edge_contact: true, placements: [{ asset: 'terrain.test#ground', at: [0, 0] }] }, out: path.join(root, 'out', 'source-edge.png') }),
      /non-structural frames touching source edges/,
    );
    assert.equal((await explainPrefab({ catalogPath: catalog, id: 'marker' })).layers[0].asset, 'terrain.test#ground');
    await renderPrefabPreview({ root, catalogPath: catalog, id: 'marker', out: prefabOut, viewport: [64, 64], scale: 1 });
    assert.deepEqual((await readFile(sheet)).subarray(1, 4).toString(), 'PNG');
    assert.deepEqual((await readFile(gif)).subarray(0, 3).toString(), 'GIF');
    assert.deepEqual((await readFile(frames)).subarray(1, 4).toString(), 'PNG');
    assert.deepEqual(measurements.frames[0], { cell: [0, 0], content_bounds: [0, 0, 16, 16], edge_contact: ['west', 'north', 'east', 'south'] });
    assert.deepEqual((await readFile(rendered)).subarray(1, 4).toString(), 'PNG');
    assert.deepEqual((await readFile(sceneOut)).subarray(1, 4).toString(), 'PNG');
    assert.deepEqual((await readFile(prefabOut)).subarray(1, 4).toString(), 'PNG');
    assert.equal(blob.autotile.inner_corner_mode, 'composite');
    assert.equal(Object.keys(blob.autotile.positive).length, 16);
    assert.equal(Object.keys(blob.autotile.negative).length, 16);
    assert.deepEqual(blob.grid, [4, 10]);
    assert.deepEqual(Object.keys(blob.autotile.inner_corners.negative), ['nw', 'ne', 'se', 'sw']);
    const blobImage = await loadImage(blobOut); const blobSample = createCanvas(64, 80); const blobSampleContext = blobSample.getContext('2d');
    blobSampleContext.drawImage(blobImage, 0, 0);
    assert.equal(blobSampleContext.getImageData(15, 79, 1, 1).data[3], 0, 'inner overlay leaves unrelated quadrants transparent');
    assert.deepEqual(Object.keys(qa.outputs).sort(), ['full', 'quadrant-ne', 'quadrant-nw', 'quadrant-se', 'quadrant-sw', 'review-join', 'thumbnail']);
    assert.equal(qaSet.scenes, 1);
    assert.equal(qaSet.review_regions, 1);
    assert.equal(approval.artifacts, qaSet.artifact_count);
    assert.equal(approvedQa.visual_regression.valid, true);
    assert.equal(qaSet.artifact_count, 9);
    assert.match(qaSet.artifact_sha256['montage.png'], /^[a-f0-9]{64}$/);
    assert.equal(qaSet.systems.terrain, 2);
    assert.equal(qaSet.systems.connector, 1);
    assert.equal(qaSet.systems.height, 1);
    assert.equal(qaSet.systems.component, 1);
    assert.deepEqual((await readFile(qaSet.montage)).subarray(1, 4).toString(), 'PNG');
    assert.deepEqual((await readFile(qaSet.review_montage)).subarray(1, 4).toString(), 'PNG');
    assert.equal(topologyQa.cases, 1);
    assert.equal(topologyQaSet.assets, 1);
    assert.equal(blobCatalogReport.assets, 1);
    assert.equal((await validateManifest({ root, manifestPath: blobCatalog })).valid, true);
    assert.deepEqual((await readFile(topologyQaOut)).subarray(1, 4).toString(), 'PNG');
    for (const file of Object.values(qa.outputs)) assert.deepEqual((await readFile(file)).subarray(1, 4).toString(), 'PNG');
    const derivedImage = await loadImage(derivedOut); const derivedCanvas = createCanvas(32, 16); const derivedContext = derivedCanvas.getContext('2d');
    derivedContext.drawImage(derivedImage, 0, 0);
    assert.equal(derivedContext.getImageData(2, 8, 1, 1).data[3], 0, 'configured source color becomes transparent');
    assert.equal(derivedContext.getImageData(24, 8, 1, 1).data[3], 255, 'other source colors remain opaque');
    assert.deepEqual([...derivedContext.getImageData(6, 6, 1, 1).data], [17, 34, 51, 255], 'optional layer size uses nearest-neighbour pixel scaling before palette mapping');
  });
});
