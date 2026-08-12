import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import {
  compileTopDownScene,
  createPresentationAdapterRegistry,
  presentationAction,
  validatePresentationCatalog,
  validateTopDownScene,
} from './index.mjs';

const gamingRoot = process.env.DAYLIGHT_GAMING_ROOT
  ?? (process.env.DAYLIGHT_BASE_PATH
    ? path.join(process.env.DAYLIGHT_BASE_PATH, 'media', 'games', '_common')
    : null);
const showcaseRoot = gamingRoot ? path.join(gamingRoot, 'catalog', 'showcase-v2') : null;
const hasMountedShowcase = Boolean(showcaseRoot && fs.existsSync(path.join(showcaseRoot, 'catalog.yml')));
const mountedSkip = hasMountedShowcase
  ? false
  : 'set DAYLIGHT_BASE_PATH or DAYLIGHT_GAMING_ROOT to run mounted showcase integration tests';

function loadMountedCatalog() {
  return YAML.parse(fs.readFileSync(path.join(showcaseRoot, 'catalog.yml'), 'utf8'));
}

function topologyCatalog() {
  const world = { footprint: { size: [16, 16] }, scale_class: 'terrain', allowed_materials: ['*'], allowed_planes: ['ground'], allowed_biomes: ['*'], boundary_policy: 'allow', render_layer: 'ground', collision: 'passable' };
  const asset = (overrides) => ({ status: 'approved', source: 'assets/test.png', source_sha256: '0'.repeat(64), pixel_density: 1, style_profile: 'pixel16.topdown', edge_policy: 'seamless', geometry: { layout: 'grid', cell: [16, 16], grid: [4, 4] }, world, ...overrides });
  return {
    schema_version: 2, kind: 'presentation-catalog', pack: { id: 'topology-test', style_profile: 'pixel16.topdown', logical_cell: [16, 16] },
    style_profiles: { 'pixel16.topdown': { logical_cell: [16, 16], sampling: 'nearest', base_pixel: 1, scale_classes: { terrain: { logical_height: [1, 32] } }, composition: { sector_grid: [3, 3], minimum_occupied_sectors: 1, visual_coverage: [0, 1], minimum_navigation_connectivity: 0, maximum_repeat_ratio: 1, minimum_role_diversity: 1, maximum_role_ratio: 1 } } },
    assets: {
      'terrain.grass': asset({ frames: { fill: { cell: [0, 0] } } }),
      'terrain.water': asset({
        frames: { base: { cell: [0, 0] }, 'inner.nw': { cell: [1, 0] } },
        autotile: { topology: 'cardinal-4+diagonal-corners', positive: { fallback: 'base', nesw: 'base' }, inner_corner_mode: 'composite', inner_corners: { positive: { nw: 'inner.nw' } } },
      }),
      'connector.fence': asset({
        frames: { start: { cell: [0, 0] }, middle: { cell: [1, 0] }, end: { cell: [2, 0] } },
        connector: { topology: 'connector-graph', pieces: { e: 'start', ew: 'middle', w: 'end' } },
      }),
      'prop.tree': asset({ frames: { a: { cell: [0, 0], anchor: 'bottom-center' }, b: { cell: [1, 0], anchor: 'bottom-center' } }, world: { ...world, allowed_materials: ['grass'], collision: 'solid' }, tags: ['prop', 'tree'] }),
    },
    materials: {
      grass: { style_profile: 'pixel16.topdown', plane: 'ground', biome: 'test', surface: 'solid', fill: { asset: 'terrain.grass', frame: 'fill' } },
      water: { style_profile: 'pixel16.topdown', plane: 'ground', biome: 'test', surface: 'liquid', fill: { asset: 'terrain.water', frame: 'base' } },
    },
    terrain_interfaces: { shore: { inside: 'water', outside: 'grass', asset: 'terrain.water', polarity: 'positive' } },
    connector_profiles: { fence: { asset: 'connector.fence', render_layer: 'ground' } },
    prefabs: {
      'grove.single': { world: { footprint: { size: [16, 16] }, allowed_materials: ['grass'], allowed_planes: ['ground'], allowed_biomes: ['test'], boundary_policy: 'allow', collision: 'passable', slots: [] }, layers: [{ asset: 'prop.tree', frame: 'a', at: [0, 0] }] },
    },
  };
}

test('strict v2 catalog and all mounted showcase scenes compile deterministically', { skip: mountedSkip }, () => {
  const catalog = loadMountedCatalog();
  assert.deepEqual(validatePresentationCatalog(catalog), { valid: true, errors: [] });
  const files = fs.readdirSync(path.join(showcaseRoot, 'scenes')).filter((file) => file.endsWith('.yml')).sort();
  assert.equal(files.length, 11);
  for (const file of files) {
    const scene = YAML.parse(fs.readFileSync(path.join(showcaseRoot, 'scenes', file), 'utf8'));
    assert.deepEqual(validateTopDownScene(scene, catalog), { valid: true, errors: [] });
    const first = compileTopDownScene(catalog, scene); const second = compileTopDownScene(catalog, scene);
    assert.equal(first.hash, second.hash, file);
    assert.ok(Object.isFrozen(first)); assert.ok(Object.isFrozen(first.commands));
    assert.equal(first.material_grid.length, first.grid.rows);
    assert.equal(first.elevation_grid.length, first.grid.rows);
    assert.equal(first.commands.some((command) => 'source' in command || 'image_url' in command), false);
    assert.equal(first.diagnostics.overlaps.length, 0);
  }
  const semantic = YAML.parse(fs.readFileSync(path.join(showcaseRoot, 'scenes/11-semantic-adventure.yml'), 'utf8'));
  const semanticPlan = compileTopDownScene(catalog, semantic);
  assert.ok(semanticPlan.diagnostics.generated_groups.length >= 5);
  assert.ok(semanticPlan.diagnostics.inside_corners_resolved >= 10);
});

test('v2 scenes reject per-placement scale, z, depth, and shadow escape hatches', { skip: mountedSkip }, () => {
  const catalog = loadMountedCatalog();
  const scene = YAML.parse(fs.readFileSync(path.join(showcaseRoot, 'scenes/08-free-coastal-farm.yml'), 'utf8'));
  for (const [field, value] of [['scale', 2], ['z', 99], ['depth_sort', true], ['shadow', { size: [2, 2] }]]) {
    const invalid = structuredClone(scene); invalid.placements[0][field] = value;
    const result = validateTopDownScene(invalid, catalog);
    assert.equal(result.valid, false); assert.ok(result.errors.some((error) => error.includes(`unsupported field ${field}`)));
  }
});

test('top-down is implemented while future scene modes fail explicitly', () => {
  const registry = createPresentationAdapterRegistry({ 'top-down-scene': { compile: compileTopDownScene } });
  assert.deepEqual(registry.kinds(), ['top-down-scene']);
  assert.throws(() => registry.compile({}, { kind: 'side-scroller-scene' }), /declared but not implemented/);
  assert.deepEqual(presentationAction('move.north', { source: 'gamepad', timestamp: 12 }), { action: 'move.north', phase: 'press', value: 1, source: 'gamepad', timestamp: 12 });
});

test('compiler resolves diagonal-only inner corners and counts connector joins', () => {
  const catalog = topologyCatalog();
  const scene = {
    schema_version: 2, kind: 'top-down-scene', id: 'corner-test', catalog: 'topology-test', style_profile: 'pixel16.topdown', logical_size: [48, 48], pixel_scale: 2,
    grid: { cell: [16, 16] }, terrain: { base: 'grass', regions: [{ id: 'lake', material: 'water', cells: [[1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]] }] },
    connectors: [{ id: 'fence-line', profile: 'fence', cells: [[0, 0], [1, 0], [2, 0]], origin: [0, 0] }], placements: [],
  };
  const plan = compileTopDownScene(catalog, scene);
  assert.equal(plan.diagnostics.inside_corners_resolved, 1);
  assert.equal(plan.diagnostics.connections, 2);
  assert.equal(plan.diagnostics.composition.walkable_cells, 1);
  assert.equal(plan.diagnostics.composition.navigation_connectivity, 1);
  assert.equal(plan.commands.some((command) => command.asset === 'terrain.water' && command.frame === 'inner.nw'), true);
});

test('semantic terrain shapes and placement groups compile deterministically without overlap', () => {
  const catalog = topologyCatalog();
  const scene = {
    schema_version: 2, kind: 'top-down-scene', id: 'semantic-layout', catalog: 'topology-test', style_profile: 'pixel16.topdown', logical_size: [96, 96], pixel_scale: 2,
    grid: { cell: [16, 16] },
    terrain: { base: 'grass', regions: [{ id: 'stream', material: 'water', shapes: [{ kind: 'route', points: [[0, 0], { placement: 'reserved' }], width: 1 }, { kind: 'rounded-rect', rect: [4, 1, 2, 4], radius: 1 }] }] },
    placements: [{ id: 'reserved', asset: 'terrain.grass', frame: 'fill', role: 'focal', at: [24, 48] }],
    composition: {
      seed: 42,
      zones: { grove: { shapes: [{ kind: 'blob', center: [2, 3], radius: [2, 2], roughness: 0.25, seed: 7 }] } },
      groups: [{ id: 'trees', role: 'detail', zone: 'grove', layout: 'scatter', count: 3, minimum_distance: 1.5, candidates: [{ asset: 'prop.tree', frames: ['a', 'b'] }] }],
    },
  };
  assert.deepEqual(validateTopDownScene(scene, catalog), { valid: true, errors: [] });
  const first = compileTopDownScene(catalog, scene); const second = compileTopDownScene(catalog, scene);
  assert.equal(first.hash, second.hash);
  assert.equal(first.diagnostics.generated_groups[0].count, 3);
  assert.equal(first.diagnostics.semantic_roles.focal, 1);
  assert.equal(first.diagnostics.semantic_roles.detail, 3);
  assert.equal(first.diagnostics.footprints.length, 4);
  assert.ok(first.material_grid.flat().filter((material) => material === 'water').length >= 8);
  assert.equal(new Set(first.diagnostics.footprints.map((footprint) => footprint.bounds.slice(0, 2).join(','))).size, 4);
  assert.deepEqual(new Set(first.commands.filter((command) => command.provenance?.startsWith('placement:trees.')).map((command) => command.frame)), new Set(['a', 'b']));
});

test('semantic placement groups fail closed when their constraints cannot be fulfilled', () => {
  const catalog = topologyCatalog();
  const scene = {
    schema_version: 2, kind: 'top-down-scene', id: 'impossible-layout', catalog: 'topology-test', style_profile: 'pixel16.topdown', logical_size: [32, 32], pixel_scale: 2,
    grid: { cell: [16, 16] }, terrain: { base: 'grass', regions: [] }, placements: [],
    composition: { seed: 1, zones: { tiny: { cells: [[0, 0]] } }, groups: [{ id: 'forest', role: 'detail', zone: 'tiny', layout: 'scatter', count: 2, candidates: [{ asset: 'prop.tree', frame: 'a' }] }] },
  };
  assert.throws(() => compileTopDownScene(catalog, scene), /placed 1 of 2 requested/);
});

test('semantic placement groups preflight and expand reusable prefab candidates', () => {
  const catalog = topologyCatalog();
  const scene = {
    schema_version: 2, kind: 'top-down-scene', id: 'prefab-layout', catalog: 'topology-test', style_profile: 'pixel16.topdown', logical_size: [64, 64], pixel_scale: 2,
    grid: { cell: [16, 16] }, terrain: { base: 'grass', regions: [] }, placements: [],
    composition: { seed: 8, zones: { grove: { rects: [[1, 1, 2, 2]], materials: ['grass'] } }, groups: [{ id: 'prefab-tree', role: 'detail', zone: 'grove', layout: 'center', count: 1, candidates: [{ prefab: 'grove.single' }] }] },
  };
  const plan = compileTopDownScene(catalog, scene);
  assert.equal(plan.diagnostics.generated_groups[0].count, 1);
  assert.equal(plan.commands.filter((command) => command.provenance === 'placement:prefab-tree.1').length, 1);
});

test('placement metadata enforces material plane and biome rather than merely storing them', () => {
  const catalog = topologyCatalog();
  catalog.assets['prop.tree'].world = { ...catalog.assets['prop.tree'].world, allowed_biomes: ['other'] };
  const scene = {
    schema_version: 2, kind: 'top-down-scene', id: 'wrong-biome', catalog: 'topology-test', style_profile: 'pixel16.topdown', logical_size: [32, 32], pixel_scale: 2,
    grid: { cell: [16, 16] }, terrain: { base: 'grass', regions: [] }, placements: [{ asset: 'prop.tree', frame: 'a', at: [8, 16] }],
  };
  assert.throws(() => compileTopDownScene(catalog, scene), /forbidden biome test/);
});

test('catalog requires complete style-level composition contracts', () => {
  const catalog = topologyCatalog();
  delete catalog.style_profiles['pixel16.topdown'].composition.visual_coverage;
  const result = validatePresentationCatalog(catalog);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('composition.visual_coverage')));
});

test('catalog rejects visual-scale multipliers that change pixel grain', () => {
  const catalog = topologyCatalog();
  catalog.assets['terrain.grass'].world.visual_scale = 2;
  const result = validatePresentationCatalog(catalog);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('visual_scale is forbidden')));
});
