import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveApprovedAsset, resolvePrefabLayers, resolveTerrainFrame, terrainNeighbourMask, validateAssetCatalog } from './assets.mjs';

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
      autotile: { topology: 'cardinal-4', positive: { fallback: 'water.center' }, negative: { fallback: 'sand.center' } },
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

  it('resolves terrain from deterministic cardinal neighbour masks', () => {
    const cells = new Set(['1,1', '1,0', '2,1']);
    assert.equal(terrainNeighbourMask(cells, [1, 1]), 'ne');
    assert.equal(terrainNeighbourMask(new Set(['3,3']), [3, 3]), 'isolated');
    assert.deepEqual(resolveTerrainFrame({ cells, at: [1, 1], frames: { positive: { ne: 'shore.outer.south-west' }, negative: { ne: 'sand.outer.south-west' } } }), {
      mask: 'ne', frame: 'shore.outer.south-west',
    });
    assert.equal(resolveTerrainFrame({ cells, at: [1, 1], frames: { positive: { ne: 'water' }, negative: { ne: 'sand' } }, polarity: 'negative' }).frame, 'sand');
    assert.equal(resolveTerrainFrame({ cells: new Set(['3,3']), at: [3, 3], frames: { positive: { isolated: 'rock' } } }).frame, 'rock');
    assert.throws(() => resolveTerrainFrame({ cells, at: [1, 1], frames: {} }), /no frame/);
  });

  it('resolves typed prefab defaults and finite variants', () => {
    assert.equal(resolvePrefabLayers(catalog, 'house.basic').layers[0].asset, 'terrain.shore#sand.center');
    assert.equal(resolvePrefabLayers(catalog, 'house.basic', { size: 'large' }).layers[0].asset, 'terrain.shore#water.center');
    assert.throws(() => resolvePrefabLayers(catalog, 'house.basic', { size: 'castle' }), /invalid prefab enum/);
  });
});
