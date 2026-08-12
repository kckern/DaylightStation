import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
  auditTerrainMetadataSweep,
  renderAnimation,
  renderContactSheet,
  renderFrameGrid,
  measureFrameGrid,
  renderLayout,
  renderScene,
  renderLegacyScene,
  renderSceneQa,
  renderSceneQaSet,
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
    const blobSource = path.join(root, 'blob-source.png');
    const blobRecipe = path.join(root, 'blob.yml');
    const blobOut = path.join(root, 'out', 'blob.png');
    const blobSetRecipe = path.join(root, 'blob-set.yml');
    const blobCatalog = path.join(root, 'blob-catalog.yml');
    await renderContactSheet({ root, out: sheet, columns: 1, scale: 1 });
    await renderAnimation({ root, source, cell: [16, 16], frames: [[0, 0], [1, 0]], out: gif, scale: 2 });
    await renderFrameGrid({ root, source, cell: [16, 16], out: frames, scale: 2 });
    const measurements = await measureFrameGrid({ root, source, cell: [16, 16] });
    await writeFile(derivedRecipe, YAML.stringify({ canvas: [32, 16], transparent_colors: ['#ff0000'], layers: [{ source, rect: [0, 0, 32, 16], at: [0, 0] }, { source, rect: [16, 0, 16, 16], at: [4, 4], size: [8, 8] }] }));
    await deriveAtlas({ root, recipePath: derivedRecipe, out: derivedOut });
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
    const qaSet = await renderSceneQaSet({ root, manifestPath: qaSetManifest, outDir: qaSetOut });
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
    assert.deepEqual([...derivedContext.getImageData(6, 6, 1, 1).data], [0, 255, 0, 255], 'optional layer size uses nearest-neighbour pixel scaling');
  });
});
