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
  const world = { footprint: { size: [16, 16] }, scale_class: 'terrain', allowed_materials: ['*'], allowed_surfaces: ['solid'], allowed_planes: ['ground'], allowed_biomes: ['*'], boundary_policy: 'allow', render_layer: 'ground', collision: 'passable' };
  const asset = (overrides) => ({ status: 'approved', source: 'assets/test.png', source_sha256: '0'.repeat(64), pixel_density: 1, style_profile: 'pixel16.topdown', edge_policy: 'seamless', geometry: { layout: 'grid', cell: [16, 16], grid: [4, 4] }, world, ...overrides });
  return {
    schema_version: 2, kind: 'presentation-catalog', pack: { id: 'topology-test', style_profile: 'pixel16.topdown', logical_cell: [16, 16] },
    style_profiles: { 'pixel16.topdown': { logical_cell: [16, 16], sampling: 'nearest', base_pixel: 1, scale_classes: { terrain: { logical_height: [1, 32] } }, composition: { sector_grid: [3, 3], minimum_occupied_sectors: 1, visual_coverage: [0, 1], minimum_navigation_connectivity: 0, maximum_repeat_ratio: 1, minimum_role_diversity: 1, maximum_role_ratio: 1 } } },
    assets: {
      'terrain.grass': asset({ frames: { fill: { cell: [0, 0] } }, world: { ...world, allowed_surfaces: ['solid', 'liquid', 'void'] } }),
      'terrain.water': asset({
        frames: { base: { cell: [0, 0] }, 'inner.nw': { cell: [1, 0] }, 'inner.ne': { cell: [1, 0] }, 'inner.se': { cell: [1, 0] }, 'inner.sw': { cell: [1, 0] } },
        autotile: { topology: 'cardinal-4+diagonal-corners', positive: { fallback: 'base', nesw: 'base' }, inner_corner_mode: 'composite', inner_corners: { positive: { nw: 'inner.nw', ne: 'inner.ne', se: 'inner.se', sw: 'inner.sw' } } },
      }),
      'connector.fence': asset({
        frames: { start: { cell: [0, 0] }, middle: { cell: [1, 0] }, end: { cell: [2, 0] } },
        connector: { topology: 'connector-graph', pieces: { e: 'start', ew: 'middle', w: 'end' } },
      }),
      'height.cliff': asset({
        frames: { left: { cell: [0, 0] }, middle: { cell: [1, 0] }, right: { cell: [2, 0] } },
        height: { topology: 'cliff-height', rise_cells: 1, bands: { lip: ['left', 'middle', 'right'] }, transitions: { north: ['lip'] } },
      }),
      'component.floor': asset({
        frames: { a: { cell: [0, 0] }, b: { cell: [1, 0] }, c: { cell: [2, 0] } },
        components: { fill: { role: 'fill', frames: ['a', 'b', 'c'] } },
      }),
      'prop.tree': asset({ frames: { a: { cell: [0, 0], anchor: 'bottom-center' }, b: { cell: [1, 0], anchor: 'bottom-center' } }, world: { ...world, allowed_materials: ['grass'], collision: 'solid' }, tags: ['prop', 'tree'] }),
    },
    materials: {
      grass: { style_profile: 'pixel16.topdown', plane: 'ground', biome: 'test', surface: 'solid', fill: { asset: 'terrain.grass', frame: 'fill' } },
      water: { style_profile: 'pixel16.topdown', plane: 'ground', biome: 'test', surface: 'liquid', fill: { asset: 'terrain.water', frame: 'base' } },
    },
    terrain_interfaces: { shore: { inside: 'water', outside: 'grass', asset: 'terrain.water', polarity: 'positive' } },
    connector_profiles: { fence: { asset: 'connector.fence', render_layer: 'ground' } },
    height_interfaces: { cliff: { asset: 'height.cliff', render_layer: 'ground' } },
    component_profiles: {
      floor: { asset: 'component.floor', component: 'fill', allowed_surfaces: ['solid'], render_layer: 'ground' },
      hazard: { asset: 'component.floor', component: 'fill', allowed_surfaces: ['solid'], provides_surface: 'liquid', render_layer: 'ground' },
      'liquid-detail': { asset: 'component.floor', component: 'fill', allowed_surfaces: ['liquid'], render_layer: 'ground' },
    },
    prefabs: {
      'grove.single': { world: { footprint: { size: [16, 16] }, allowed_materials: ['grass'], allowed_surfaces: ['solid'], allowed_planes: ['ground'], allowed_biomes: ['test'], boundary_policy: 'allow', collision: 'passable', slots: [] }, layers: [{ asset: 'prop.tree', frame: 'a', at: [0, 0] }] },
      'platform.single': { world: { footprint: { size: [16, 16], offset: [0, -16] }, allowed_materials: ['*'], allowed_surfaces: ['liquid'], allowed_planes: ['ground'], allowed_biomes: ['test'], boundary_policy: 'allow', collision: 'passable', provides_surface: 'solid', slots: [] }, layers: [{ asset: 'terrain.grass', frame: 'fill', at: [0, 0] }] },
    },
  };
}

test('strict v2 catalog and all mounted showcase scenes compile deterministically', { skip: mountedSkip }, () => {
  const catalog = loadMountedCatalog();
  assert.deepEqual(validatePresentationCatalog(catalog), { valid: true, errors: [] });
  const files = fs.readdirSync(path.join(showcaseRoot, 'scenes')).filter((file) => file.endsWith('.yml')).sort();
  assert.equal(files.length, 19);
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
  assert.ok(semanticPlan.diagnostics.inside_corners_resolved >= 4, 'semantic scene retains compound concavity coverage after organic coastline generation');
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

test('height interfaces use seamless middle frames at declared viewport continuations', () => {
  const catalog = topologyCatalog();
  const scene = {
    schema_version: 2, kind: 'top-down-scene', id: 'continued-height', catalog: 'topology-test', style_profile: 'pixel16.topdown', logical_size: [48, 48], pixel_scale: 2,
    grid: { cell: [16, 16] }, terrain: { base: 'grass', regions: [] },
    heights: [{ id: 'ridge', profile: 'cliff', direction: 'north', origin: [0, 16], width: 3, continues: ['west', 'east'] }], placements: [],
  };
  const plan = compileTopDownScene(catalog, scene);
  assert.deepEqual(plan.commands.filter((command) => command.provenance === 'height:ridge').map((command) => command.frame), ['middle', 'middle', 'middle']);
  scene.heights[0].continues = ['north'];
  assert.ok(validateTopDownScene(scene, catalog).errors.some((error) => error.includes('continues must use only span sides west or east')));
});

test('overlay materials cannot masquerade as terrain fills', () => {
  const catalog = topologyCatalog();
  catalog.materials.overlay = { ...catalog.materials.grass, fill_mode: 'overlay' };
  const scene = {
    schema_version: 2, kind: 'top-down-scene', id: 'overlay-fill', catalog: 'topology-test', style_profile: 'pixel16.topdown', logical_size: [48, 48], pixel_scale: 2,
    grid: { cell: [16, 16] }, terrain: { base: 'overlay', regions: [] }, placements: [],
  };
  const result = validateTopDownScene(scene, catalog);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('base material cannot use overlay fill_mode')));
  scene.terrain.base = 'grass'; scene.terrain.regions = [{ id: 'sparse', material: 'overlay', cells: [[1, 1]] }];
  const regionResult = validateTopDownScene(scene, catalog);
  assert.equal(regionResult.valid, false);
  assert.ok(regionResult.errors.some((error) => error.includes('material cannot use overlay fill_mode')));
});

test('catalog materials can seed deterministic surface-aware detail layers', () => {
  const catalog = topologyCatalog();
  catalog.component_profiles['liquid-detail'].opacity = 0.5;
  catalog.materials.water.details = [{ profile: 'liquid-detail', density: 1, interior_only: true, seed: 17 }];
  assert.deepEqual(validatePresentationCatalog(catalog), { valid: true, errors: [] });
  const scene = {
    schema_version: 2, kind: 'top-down-scene', id: 'material-details', catalog: 'topology-test', style_profile: 'pixel16.topdown', logical_size: [48, 48], pixel_scale: 2,
    grid: { cell: [16, 16] }, terrain: { base: 'water', regions: [] }, placements: [],
  };
  const first = compileTopDownScene(catalog, scene); const second = compileTopDownScene(catalog, scene);
  const details = first.commands.filter((command) => command.provenance === 'material-detail:water:0');
  assert.equal(details.length, 1);
  assert.equal(details[0].opacity, 0.5);
  assert.deepEqual(details, second.commands.filter((command) => command.provenance === 'material-detail:water:0'));

  catalog.materials.water.details[0].density = 0;
  assert.ok(validatePresentationCatalog(catalog).errors.some((error) => error.includes('density must be greater than 0')));
  catalog.materials.water.details[0].density = 1;
  catalog.component_profiles['liquid-detail'].opacity = 2;
  assert.ok(validatePresentationCatalog(catalog).errors.some((error) => error.includes('opacity must be greater than 0')));
});

test('authored component profiles can require material-interior cells', () => {
  const catalog = topologyCatalog();
  catalog.component_profiles['liquid-detail'].interior_only = true;
  assert.deepEqual(validatePresentationCatalog(catalog), { valid: true, errors: [] });
  const scene = {
    schema_version: 2, kind: 'top-down-scene', id: 'interior-component', catalog: 'topology-test', style_profile: 'pixel16.topdown', logical_size: [48, 48], pixel_scale: 2,
    grid: { cell: [16, 16] }, terrain: { base: 'water', regions: [] }, components: [{ id: 'ripple', profile: 'liquid-detail', cells: [[1, 1]] }], placements: [],
  };
  assert.doesNotThrow(() => compileTopDownScene(catalog, scene));
  scene.components[0].cells = [[0, 0]];
  assert.throws(() => compileTopDownScene(catalog, scene), /requires an interior water cell/);
  catalog.component_profiles['liquid-detail'].interior_only = 'yes';
  assert.ok(validatePresentationCatalog(catalog).errors.some((error) => error.includes('interior_only must be boolean')));
});

test('rounded terrain interfaces require matching reviewed outer-corner semantics', () => {
  const catalog = topologyCatalog();
  catalog.assets['terrain.water'].autotile.outer_corner_mode = 'native';
  catalog.assets['terrain.water'].autotile.outer_corner_style = 'rounded';
  catalog.terrain_interfaces.shore.corner_profile = { style: 'rounded', minimum_cutback_ratio: 0.25 };
  assert.deepEqual(validatePresentationCatalog(catalog), { valid: true, errors: [] });
  catalog.assets['terrain.water'].autotile.outer_corner_style = 'square';
  assert.ok(validatePresentationCatalog(catalog).errors.some((error) => error.includes('asset outer_corner_style must match rounded')));
});

test('multi-material joins compose topology-compatible target-palette variants by contact wedge', () => {
  const catalog = topologyCatalog();
  catalog.assets['terrain.water.field-palette'] = {
    extends: 'terrain.water',
    tags: ['terrain', 'palette-normalized'],
    source: 'assets/water-field-palette.png',
    source_sha256: '1'.repeat(64),
  };
  catalog.materials.path = { ...catalog.materials.grass, fill: { asset: 'terrain.grass', frame: 'fill' } };
  catalog.assets['terrain.grass'].autotile = { topology: 'cardinal-4', positive: { fallback: 'fill' } };
  catalog.terrain_interfaces['grass-to-path'] = { inside: 'grass', outside: 'path', asset: 'terrain.grass', polarity: 'positive' };
  catalog.terrain_interfaces['grass-to-water'] = { inside: 'grass', outside: 'water', asset: 'terrain.grass', polarity: 'positive' };
  catalog.terrain_interfaces['water-to-path'] = { inside: 'water', outside: 'path', asset: 'terrain.water', polarity: 'positive' };
  catalog.terrain_interfaces.shore.asset = 'terrain.water.field-palette';
  const scene = {
    schema_version: 2, kind: 'top-down-scene', id: 'palette-junction', catalog: 'topology-test', style_profile: 'pixel16.topdown', logical_size: [48, 48], pixel_scale: 2,
    grid: { cell: [16, 16] }, terrain: { base: 'path', regions: [
      { id: 'field', material: 'grass', cells: [[0, 1]] },
      { id: 'pool', material: 'water', cells: [[1, 1]] },
    ] }, placements: [],
  };
  const plan = compileTopDownScene(catalog, scene);
  const fieldWedge = plan.commands.find((command) => command.provenance === 'interface:shore' && command.at[0] === 16 && command.at[1] === 16);
  assert.equal(fieldWedge.asset, 'terrain.water.field-palette');
  assert.deepEqual(fieldWedge.clip_polygon, [[0, 16], [0, 0], [8, 8]]);
  assert.ok(plan.commands.some((command) => command.provenance === 'interface:water-to-path' && command.at[0] === 16 && command.at[1] === 16 && command.clip_polygon === undefined));

  catalog.assets['terrain.water.field-palette'].autotile = { topology: 'cardinal-4', positive: { fallback: 'base' } };
  assert.throws(() => compileTopDownScene(catalog, scene), /incompatible interface assets at a multi-material join/);
});

test('connector cells are structural occupancy for authored placements', () => {
  const catalog = topologyCatalog();
  const scene = {
    schema_version: 2, kind: 'top-down-scene', id: 'connector-occupancy', catalog: 'topology-test', style_profile: 'pixel16.topdown', logical_size: [48, 48], pixel_scale: 2,
    grid: { cell: [16, 16] }, terrain: { base: 'grass', regions: [] },
    connectors: [{ id: 'wall', profile: 'fence', cells: [[0, 1], [1, 1], [2, 1]], origin: [0, 0] }],
    placements: [{ asset: 'prop.tree', frame: 'a', at: [24, 32] }],
  };
  assert.throws(() => compileTopDownScene(catalog, scene), /footprint intersects connector wall/);
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

test('semantic routes target catalog-declared placement entrances', () => {
  const catalog = topologyCatalog();
  catalog.assets['prop.tree'].world = { ...catalog.assets['prop.tree'].world, route_anchor: [16, -16] };
  const scene = {
    schema_version: 2, kind: 'top-down-scene', id: 'semantic-entrance', catalog: 'topology-test', style_profile: 'pixel16.topdown', logical_size: [64, 64], pixel_scale: 2,
    grid: { cell: [16, 16] },
    terrain: { base: 'grass', regions: [{ id: 'route', material: 'water', shapes: [{ kind: 'route', points: [[0, 0], { placement: 'destination' }], width: 1 }] }] },
    placements: [{ id: 'destination', asset: 'prop.tree', frame: 'a', at: [32, 48] }],
  };
  const plan = compileTopDownScene(catalog, scene);
  assert.equal(plan.material_grid[2][3], 'water');
  assert.equal(plan.material_grid[3][2], 'grass');
});

test('terrain shapes may continue beyond a declared viewport edge without authoring clipped cells', () => {
  const catalog = topologyCatalog();
  const scene = {
    schema_version: 2, kind: 'top-down-scene', id: 'continued-coast', catalog: 'topology-test', style_profile: 'pixel16.topdown', logical_size: [64, 64], pixel_scale: 2,
    grid: { cell: [16, 16] }, terrain: { base: 'grass', regions: [{ id: 'coast', material: 'water', shapes: [{ kind: 'blob', center: [3, 2], radius: [2, 1], roughness: 0.5, seed: 4 }], continues: ['east'] }] }, placements: [],
  };
  const plan = compileTopDownScene(catalog, scene);
  assert.equal(plan.material_grid.some((row) => row[3] === 'water'), true);
  assert.equal(plan.material_grid.every((row) => row.length === 4), true);
  const invalid = structuredClone(scene); delete invalid.terrain.regions[0].continues;
  assert.throws(() => compileTopDownScene(catalog, invalid), /exceeds viewport/);
});

test('semantic blobs can bound adjacent-row edge movement to prevent terrain tongues', () => {
  const catalog = topologyCatalog();
  const scene = {
    schema_version: 2, kind: 'top-down-scene', id: 'smooth-coast', catalog: 'topology-test', style_profile: 'pixel16.topdown', logical_size: [128, 128], pixel_scale: 2,
    grid: { cell: [16, 16] }, terrain: { base: 'grass', regions: [{ id: 'lake', material: 'water', shapes: [{ kind: 'blob', center: [8, 3], radius: [6, 4], roughness: 1, edge_step: 1, seed: 19 }], continues: ['east'] }] }, placements: [],
  };
  const plan = compileTopDownScene(catalog, scene);
  const leftEdges = plan.material_grid.map((row) => row.indexOf('water')).filter((left) => left >= 0);
  for (let index = 1; index < leftEdges.length; index += 1) assert.ok(Math.abs(leftEdges[index] - leftEdges[index - 1]) <= 1);
  const invalid = structuredClone(scene); invalid.terrain.regions[0].shapes[0].edge_step = 0;
  assert.ok(validateTopDownScene(invalid, catalog).errors.some((error) => error.includes('edge_step')));
});

test('terrain regions can eliminate one-cell fringe runs with a minimum thickness contract', () => {
  const catalog = topologyCatalog();
  const scene = {
    schema_version: 2, kind: 'top-down-scene', id: 'thick-fringe', catalog: 'topology-test', style_profile: 'pixel16.topdown', logical_size: [80, 80], pixel_scale: 2,
    grid: { cell: [16, 16] }, terrain: { base: 'grass', regions: [{ id: 'pool', material: 'water', cells: [[2, 2]], minimum_thickness: 2 }] }, placements: [],
  };
  const plan = compileTopDownScene(catalog, scene); const water = plan.material_grid.flat().filter((material) => material === 'water');
  assert.equal(water.length, 4);
  const invalid = structuredClone(scene); invalid.terrain.regions[0].minimum_thickness = 0;
  assert.ok(validateTopDownScene(invalid, catalog).errors.some((error) => error.includes('minimum_thickness')));
});

test('terrain and composition shapes support deterministic boolean exclusions', () => {
  const catalog = topologyCatalog();
  const scene = {
    schema_version: 2, kind: 'top-down-scene', id: 'excluded-lake', catalog: 'topology-test', style_profile: 'pixel16.topdown', logical_size: [80, 80], pixel_scale: 2,
    grid: { cell: [16, 16] }, terrain: { base: 'grass', regions: [{ id: 'lake', material: 'water', rects: [[0, 0, 5, 5]], exclude: { shapes: [{ kind: 'ellipse', center: [2, 2], radius: [1, 1] }] } }] }, placements: [],
  };
  const plan = compileTopDownScene(catalog, scene);
  assert.equal(plan.material_grid[2][2], 'grass');
  assert.equal(plan.material_grid[0][0], 'water');
  assert.equal(plan.material_grid.flat().filter((material) => material === 'grass').length, 5);
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

test('surface contracts reject actors on liquid and components on the wrong terrain class', () => {
  const catalog = topologyCatalog();
  catalog.assets['prop.tree'].world.allowed_materials = ['*'];
  const actorOnWater = {
    schema_version: 2, kind: 'top-down-scene', id: 'surface-actor', catalog: 'topology-test', style_profile: 'pixel16.topdown', logical_size: [32, 32], pixel_scale: 2,
    grid: { cell: [16, 16] }, terrain: { base: 'water', regions: [] }, placements: [{ asset: 'prop.tree', frame: 'a', at: [8, 16] }],
  };
  assert.throws(() => compileTopDownScene(catalog, actorOnWater), /forbidden surface liquid/);
  const componentOnWater = { ...actorOnWater, id: 'surface-component', placements: [], components: [{ id: 'floor', profile: 'floor', cells: [[0, 0]] }] };
  assert.throws(() => compileTopDownScene(catalog, componentOnWater), /forbidden on liquid surface/);
});

test('supporting prefabs provide a logical solid surface above liquid terrain', () => {
  const catalog = topologyCatalog(); catalog.assets['prop.tree'].world.allowed_materials = ['*'];
  const scene = {
    schema_version: 2, kind: 'top-down-scene', id: 'supported-actor', catalog: 'topology-test', style_profile: 'pixel16.topdown', logical_size: [32, 32], pixel_scale: 2,
    grid: { cell: [16, 16] }, terrain: { base: 'water', regions: [] },
    placements: [{ id: 'platform', prefab: 'platform.single', at: [8, 16] }, { id: 'actor', asset: 'prop.tree', frame: 'a', at: [8, 16] }],
  };
  const plan = compileTopDownScene(catalog, scene);
  assert.equal(plan.diagnostics.footprints.find((entry) => entry.placement === 'actor').surfaces[0], 'solid');
});

test('component fill variants avoid immediate wallpaper repetition deterministically', () => {
  const catalog = topologyCatalog();
  const scene = {
    schema_version: 2, kind: 'top-down-scene', id: 'component-variation', catalog: 'topology-test', style_profile: 'pixel16.topdown', logical_size: [64, 64], pixel_scale: 2,
    grid: { cell: [16, 16] }, terrain: { base: 'grass', regions: [] }, placements: [], components: [{ id: 'floor', profile: 'floor', rects: [[0, 0, 4, 4]] }],
  };
  const first = compileTopDownScene(catalog, scene); const second = compileTopDownScene(catalog, scene);
  assert.equal(first.hash, second.hash);
  const frames = new Map(first.commands.filter((command) => command.provenance === 'component:floor').map((command) => [command.at.join(','), command.frame]));
  for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) {
    const frame = frames.get(`${x * 16},${y * 16}`);
    if (x) assert.notEqual(frame, frames.get(`${(x - 1) * 16},${y * 16}`));
    if (y) assert.notEqual(frame, frames.get(`${x * 16},${(y - 1) * 16}`));
  }
});

test('component profiles can replace logical surface semantics for hazards', () => {
  const catalog = topologyCatalog();
  const scene = {
    schema_version: 2, kind: 'top-down-scene', id: 'component-hazard', catalog: 'topology-test', style_profile: 'pixel16.topdown', logical_size: [32, 32], pixel_scale: 2,
    grid: { cell: [16, 16] }, terrain: { base: 'grass', regions: [] }, placements: [], components: [{ id: 'pool', profile: 'hazard', cells: [[0, 0]] }],
  };
  const plan = compileTopDownScene(catalog, scene);
  assert.equal(plan.diagnostics.composition.walkable_cells, 3);
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
