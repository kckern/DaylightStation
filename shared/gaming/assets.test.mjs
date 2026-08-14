import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { materializeAssetCatalog, resolveApprovedAsset, resolveConnectorFrame, resolveHeightTransition, resolvePrefabLayers, resolveTerrainFrame, terrainInnerCornerKeys, terrainNeighbourMask, validateAssetCatalog } from './assets.mjs';

const catalog = {
  schema_version: 1, pack: { id: 'default' }, assets: {
    'npc.farmer-bob': {
      status: 'approved', license_scope: 'core-commercial', kind: 'sprite-sheet',
      tags: ['actor', 'npc'],
      source: 'assets/default/actors/npcs/premade/farmer-bob.png', source_sha256: 'a'.repeat(64),
      geometry: { layout: 'grid', cell: [16, 16], grid: [24, 52] },
      frames: { 'idle.down.0': { cell: [1, 0], anchor: 'bottom-center' } },
    },
    'npc.unreviewed': { status: 'candidate' },
    'terrain.shore': {
      status: 'approved', license_scope: 'core-commercial', kind: 'tile-sheet',
      tags: ['terrain', 'shore'],
      source: 'assets/default/terrain/shore.png', source_sha256: 'b'.repeat(64),
      geometry: { layout: 'grid', cell: [16, 16], grid: [6, 3] },
      frames: { 'water.center': { cell: [4, 1] }, 'sand.center': { cell: [1, 1] } },
      autotile: { topology: 'cardinal-4', supported_polarities: ['positive', 'negative'], positive: { isolated: 'water.center', fallback: 'water.center' }, negative: { isolated: 'sand.center', fallback: 'sand.center' } },
    },
  },
  prefabs: {
    'house.basic': {
      parameters: { size: { type: 'enum', values: ['small', 'large'], default: 'small' } },
      layers: [{ select: 'size', variants: { small: { asset: 'terrain.shore#sand.center' }, large: { asset: 'terrain.shore#water.center' } } }],
    },
  },
};

describe('gaming asset catalog', () => {
  it('exposes only reviewed descriptors', () => {
    assert.equal(validateAssetCatalog(catalog).valid, true);
    assert.equal(resolveApprovedAsset(catalog, 'npc.farmer-bob').id, 'npc.farmer-bob');
    assert.equal(resolveApprovedAsset(catalog, 'npc.unreviewed'), null);
  });

  it('rejects invalid or geometrically incompatible source pixel densities', () => {
    const invalidDensity = structuredClone(catalog);
    invalidDensity.assets['npc.farmer-bob'].pixel_density = 3;
    assert.match(validateAssetCatalog(invalidDensity).errors.join('\n'), /grid cell must be divisible by pixel_density/);
    invalidDensity.assets['npc.farmer-bob'].pixel_density = 1.5;
    assert.match(validateAssetCatalog(invalidDensity).errors.join('\n'), /pixel_density must be an integer/);
  });

  it('materializes reusable asset templates without mutating authored YAML', () => {
    const templated = {
      schema_version: 1,
      pack: { id: 'test' },
      asset_templates: {
        blob: {
          kind: 'tile-sheet', geometry: { layout: 'grid', cell: [16, 16], grid: [1, 1] },
          frames: { center: { cell: [0, 0] } }, autotile: { topology: 'cardinal-4', supported_polarities: ['positive'], positive: { fallback: 'center' } },
        },
      },
      assets: {
        'terrain.green': {
          extends: 'blob', status: 'approved', license_scope: 'core-commercial', tags: ['terrain'],
          source: 'assets/green.png', source_sha256: 'c'.repeat(64),
        },
      },
    };
    const resolved = materializeAssetCatalog(templated);
    assert.equal(resolved.assets['terrain.green'].kind, 'tile-sheet');
    assert.deepEqual(resolved.assets['terrain.green'].frames.center.cell, [0, 0]);
    assert.equal(templated.assets['terrain.green'].kind, undefined);
    assert.equal(validateAssetCatalog(templated).valid, true);
    assert.equal(resolveApprovedAsset(templated, 'terrain.green').kind, 'tile-sheet');
  });

  it('materializes target-specific asset variants through finite inheritance', () => {
    const inherited = structuredClone(catalog);
    inherited.assets['terrain.shore.field-palette'] = {
      extends: 'terrain.shore',
      tags: ['terrain', 'shore', 'palette-normalized'],
      source: 'assets/default/terrain/shore-field-palette.png',
      source_sha256: 'd'.repeat(64),
      derived_from: 'assets/default/terrain/shore.png',
      derivation_job: 'shore-field-palette',
    };
    const resolved = materializeAssetCatalog(inherited);
    const base = resolved.assets['terrain.shore'];
    const variant = resolved.assets['terrain.shore.field-palette'];
    assert.deepEqual(variant.geometry, base.geometry);
    assert.deepEqual(variant.frames, base.frames);
    assert.deepEqual(variant.autotile, base.autotile);
    assert.equal(variant.variant_of, 'terrain.shore');
    assert.equal(variant.source, 'assets/default/terrain/shore-field-palette.png');
    assert.equal(base.source, 'assets/default/terrain/shore.png');
    assert.equal(inherited.assets['terrain.shore.field-palette'].geometry, undefined);
    assert.equal(validateAssetCatalog(inherited).valid, true);

    inherited.assets['terrain.shore'].extends = 'terrain.shore.field-palette';
    assert.match(validateAssetCatalog(inherited).errors.join('\n'), /asset inheritance cycle: terrain\.shore -> terrain\.shore\.field-palette -> terrain\.shore/);
  });

  it('resolves terrain from deterministic cardinal neighbour masks', () => {
    const cells = new Set(['1,1', '1,0', '2,1']);
    assert.equal(terrainNeighbourMask(cells, [1, 1]), 'ne');
    assert.equal(terrainNeighbourMask(new Set(['3,3']), [3, 3]), 'isolated');
    assert.deepEqual(resolveTerrainFrame({ cells, at: [1, 1], frames: { positive: { ne: 'shore.outer.south-west' }, negative: { ne: 'sand.outer.south-west' } } }), {
      mask: 'ne', frame: 'shore.outer.south-west', overlays: [], layers: ['shore.outer.south-west'], inner_corners: [], phase: 0, frame_offset: [0, 0],
    });
    assert.equal(resolveTerrainFrame({ cells, at: [1, 1], frames: { positive: { ne: 'water' }, negative: { ne: 'sand' } }, polarity: 'negative' }).frame, 'sand');
    assert.equal(resolveTerrainFrame({ cells: new Set(['3,3']), at: [3, 3], frames: { positive: { isolated: 'rock' } } }).frame, 'rock');
    assert.throws(() => resolveTerrainFrame({ cells, at: [1, 1], frames: {} }), /no frame/);
    const concave = new Set(['1,1', '1,0', '0,1', '2,1', '1,2', '2,0', '2,2', '0,2']);
    assert.deepEqual(terrainInnerCornerKeys(concave, [1, 1]), ['nw']);
    assert.equal(resolveTerrainFrame({ cells: concave, at: [1, 1], frames: { positive: { nesw: 'center' }, inner_corners: { nw: 'inner.nw' } } }).frame, 'inner.nw');
    assert.throws(() => resolveTerrainFrame({ cells: concave, at: [1, 1], frames: { positive: { nesw: 'center' } } }), /unsupported inside corner/);
    const compound = new Set(['1,1', '1,0', '2,1', '1,2', '0,1', '2,0', '0,2']);
    assert.deepEqual(resolveTerrainFrame({
      cells: compound,
      at: [1, 1],
      frames: {
        positive: { nesw: 'center' },
        inner_corner_mode: 'composite',
        inner_corners: { positive: { nw: 'overlay.nw', se: 'overlay.se' } },
      },
    }), {
      mask: 'nesw', frame: 'center', overlays: ['overlay.nw', 'overlay.se'],
      layers: ['center', 'overlay.nw', 'overlay.se'], inner_corners: ['nw', 'se'], phase: 0, frame_offset: [0, 0],
    });
    assert.deepEqual(resolveTerrainFrame({
      cells, at: [1, 1], phase: 10,
      frames: { positive: { ne: 'shore' }, animation: { frames: 8, phase_stride: [4, 0] } },
    }).frame_offset, [8, 0]);
    assert.throws(() => resolveTerrainFrame({
      cells: compound, at: [1, 1], frames: { positive: { nesw: 'center' }, inner_corners: { nw: 'inner.nw', se: 'inner.se' } },
    }), /inside-corner key: nw-se/);
  });

  it('requires autotile polarity support to be explicit and internally consistent', () => {
    const missing = structuredClone(catalog);
    delete missing.assets['terrain.shore'].autotile.supported_polarities;
    assert.match(validateAssetCatalog(missing).errors.join('\n'), /supported_polarities/);
    const overclaimed = structuredClone(catalog);
    overclaimed.assets['terrain.shore'].autotile.supported_polarities = ['positive'];
    assert.match(validateAssetCatalog(overclaimed).errors.join('\n'), /negative mapping is not declared/);
    const underimplemented = structuredClone(catalog);
    delete underimplemented.assets['terrain.shore'].autotile.negative;
    assert.match(validateAssetCatalog(underimplemented).errors.join('\n'), /declared negative polarity needs a mapping/);
  });

  it('resolves typed prefab defaults and finite variants', () => {
    assert.equal(resolvePrefabLayers(catalog, 'house.basic').layers[0].asset, 'terrain.shore#sand.center');
    assert.equal(resolvePrefabLayers(catalog, 'house.basic', { size: 'large' }).layers[0].asset, 'terrain.shore#water.center');
    assert.throws(() => resolvePrefabLayers(catalog, 'house.basic', { size: 'castle' }), /invalid prefab enum/);
  });

  it('resolves connector graphs from canonical branch masks', () => {
    const asset = { connector: { pieces: { ns: { frame: 'vertical' }, ew: { frame: 'horizontal' } } } };
    assert.deepEqual(resolveConnectorFrame(asset, ['s', 'n']), { mask: 'ns', frame: 'vertical' });
    assert.throws(() => resolveConnectorFrame(asset, ['n', 'e']), /no piece/);
  });

  it('resolves ordered height-transition bands', () => {
    const asset = { height: { rise_cells: 2, bands: { lip: ['a', 'b', 'c'], face: ['d', 'e', 'f'] }, transitions: { north: ['lip', 'face'] } } };
    assert.deepEqual(resolveHeightTransition(asset, 'north').bands[1], { id: 'face', frames: ['d', 'e', 'f'] });
    assert.throws(() => resolveHeightTransition(asset, 'south'), /no transition/);
  });
});
