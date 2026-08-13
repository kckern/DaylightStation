import { materializeAssetCatalog } from '../gaming/assets.mjs';
import { assetReference } from './catalog.mjs';

const STYLE = 'pixel16.topdown';
const STYLE_SCALE_CLASSES = Object.freeze({
  terrain: { logical_height: [1, 64] },
  humanoid: { logical_height: [12, 36] },
  creature: { logical_height: [4, 32] },
  'building-small': { logical_height: [20, 64] },
  building: { logical_height: [32, 128] },
  foliage: { logical_height: [4, 80] },
  item: { logical_height: [2, 32] },
  prop: { logical_height: [1, 64] },
  structure: { logical_height: [8, 128] },
  effect: { logical_height: [1, 128] },
});

function slug(value) {
  return String(value).replace(/[^a-zA-Z0-9.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

function materialId(assetId) { return `material.${assetId}`; }
function backgroundMaterialId(sceneId) { return `material.scene.${sceneId}`; }

function frameSize(asset, frame) {
  return frame?.rect?.slice(2) ?? asset?.geometry?.cell ?? [16, 16];
}

function inferredDensity(id, asset) {
  const tags = new Set(asset.tags ?? []); const sizes = Object.values(asset.frames ?? {}).map((frame) => frameSize(asset, frame));
  const maximum = Math.max(0, ...sizes.flat());
  if (tags.has('house') && maximum >= 64) return 2;
  if (tags.has('structure') && maximum >= 96) return 2;
  if (id.startsWith('prop.free.') && tags.has('tree')) return 2;
  if (id.startsWith('creature.free.') && (tags.has('cow') || tags.has('chicken'))) return 2;
  return Number.isInteger(asset.pixel_density) ? asset.pixel_density : 1;
}

function inferredScaleClass(id, asset) {
  const tags = new Set(asset.tags ?? []);
  if (asset.kind === 'tile-sheet' || asset.autotile || asset.connector || asset.height || asset.components) return 'terrain';
  if (tags.has('player') || tags.has('npc') || tags.has('humanoid')) return 'humanoid';
  if (tags.has('creature') || tags.has('enemy') || tags.has('animal')) return 'creature';
  if (tags.has('house') || tags.has('building')) {
    const first = Object.values(asset.frames ?? {})[0]; const logicalHeight = (first?.content_bounds?.[3] ?? frameSize(asset, first)[1]) / inferredDensity(id, asset);
    return logicalHeight < 32 ? 'building-small' : 'building';
  }
  if (tags.has('tree') || tags.has('foliage')) return 'foliage';
  if (tags.has('item')) return 'item';
  if (tags.has('structure')) return 'structure';
  if (tags.has('effect')) return 'effect';
  return 'prop';
}

function inferredWorld(id, asset) {
  const tags = new Set(asset.tags ?? []); const density = inferredDensity(id, asset); const first = Object.values(asset.frames ?? {})[0]; const [sourceWidth, sourceHeight] = frameSize(asset, first);
  const width = sourceWidth / density; const height = sourceHeight / density;
  let renderLayer = 'ground'; let footprint = [Math.max(2, Math.min(12, width * 0.6)), Math.max(2, Math.min(8, height * 0.2))]; let shadowProfile;
  if (tags.has('player') || tags.has('npc') || tags.has('actor') || tags.has('creature') || tags.has('enemy')) { renderLayer = 'actor'; footprint = [Math.max(4, width * 0.35), Math.max(3, height * 0.12)]; shadowProfile = 'soft-small'; }
  if (tags.has('structure') || tags.has('house') || tags.has('tree')) { renderLayer = 'structure'; footprint = [Math.max(6, width * (tags.has('tree') ? 0.22 : 0.65)), Math.max(4, height * (tags.has('tree') ? 0.1 : 0.16))]; shadowProfile = tags.has('tree') ? 'soft-medium' : undefined; }
  if (tags.has('overlay') || tags.has('dock') || tags.has('bridge')) { renderLayer = 'ground'; footprint = [Math.max(4, width), Math.max(4, height)]; shadowProfile = undefined; }
  return { footprint: { size: footprint.map((value) => Math.round(value * 100) / 100) }, scale_class: inferredScaleClass(id, asset), allowed_materials: ['*'], allowed_surfaces: ['solid'], allowed_planes: ['ground'], allowed_biomes: ['*'], boundary_policy: 'allow', render_layer: renderLayer, collision: renderLayer === 'structure' || renderLayer === 'actor' ? 'solid' : 'passable', ...(shadowProfile ? { shadow_profile: shadowProfile } : {}) };
}

function convertPrefab(prefab) {
  const convertLayer = (layer) => {
    if (layer.select) return { ...layer, variants: Object.fromEntries(Object.entries(layer.variants ?? {}).map(([id, variant]) => [id, convertLayer(variant)])) };
    const { scale, z, depth_sort: depthSort, shadow, ...clean } = layer;
    void scale; void z; void depthSort; void shadow;
    return clean;
  };
  const world = { footprint: { size: [16, 16] }, allowed_materials: ['*'], allowed_surfaces: ['solid'], allowed_planes: ['ground'], allowed_biomes: ['*'], boundary_policy: 'allow', collision: 'passable', slots: [], ...(prefab.world ?? {}) };
  world.allowed_materials ??= ['*']; world.allowed_surfaces ??= ['solid']; world.allowed_planes ??= ['ground']; world.allowed_biomes ??= ['*']; world.collision ??= 'passable'; world.slots ??= [];
  return { ...prefab, layers: (prefab.layers ?? []).map(convertLayer), world };
}

function convertAsset(id, asset) {
  if (asset.status !== 'approved') return asset;
  const semanticEdges = Boolean(
    asset.kind === 'tile-sheet'
    || asset.autotile
    || asset.connector
    || asset.height
    || asset.components
  );
  const frames = Object.fromEntries(Object.entries(asset.frames ?? {}).map(([frameId, frame]) => {
    const { allow_edge_contact: allowEdgeContact, ...clean } = frame;
    if (!allowEdgeContact) return [frameId, clean];
    const size = frameSize(asset, frame); const bounds = frame.content_bounds; const allowed = bounds ? [
      ...(bounds[1] === 0 ? ['north'] : []),
      ...(bounds[0] + bounds[2] === size[0] ? ['east'] : []),
      ...(bounds[1] + bounds[3] === size[1] ? ['south'] : []),
      ...(bounds[0] === 0 ? ['west'] : []),
    ] : ['north', 'east', 'south', 'west'];
    return [frameId, { ...clean, edge_contact: { allowed, reason: 'reviewed intentional source-frame boundary contact' } }];
  }));
  const { world: authoredWorld, ...assetWithoutWorld } = asset;
  const world = authoredWorld ? { ...authoredWorld } : inferredWorld(id, asset);
  delete world.visual_scale;
  world.scale_class ??= inferredScaleClass(id, asset);
  const converted = { ...assetWithoutWorld, frames, pixel_density: inferredDensity(id, asset), style_profile: STYLE, edge_policy: semanticEdges ? 'seamless' : 'isolated', world };
  const topologyCases = ['positive', 'negative'].flatMap((polarity) => Object.keys(converted.autotile?.[polarity] ?? {}).filter((key) => key !== 'fallback'));
  // A legacy fallback-only declaration is a fill tile, not evidence of a
  // reviewed topology. Keeping it as an autotile would let QA report false
  // coverage while exercising no edge or corner case.
  if (converted.autotile && !topologyCases.length) delete converted.autotile;
  else if (converted.autotile) for (const polarity of ['positive', 'negative']) {
    const mapping = converted.autotile[polarity];
    if (mapping && !mapping.nesw && !mapping.fallback) delete converted.autotile[polarity];
  }
  return converted;
}

function rawTerrainCells(scene, scale, cell) {
  return (scene.terrain?.regions ?? []).map((region) => {
    const origin = region.origin ?? [0, 0]; const rawOffset = [origin[0] / scale / cell[0], origin[1] / scale / cell[1]];
    // Legacy scenes permitted arbitrary pixel origins. A v2 material is grid
    // topology, so migration intentionally snaps those old visual nudges to
    // the nearest logical cell instead of preserving a hidden scale offset.
    const offset = rawOffset.map(Math.round);
    const cells = [...(region.cells ?? [])];
    for (const [x, y, width, height] of region.rects ?? []) for (let row = y; row < y + height; row += 1) for (let column = x; column < x + width; column += 1) cells.push([column, row]);
    return { ...region, material: materialId(region.asset), cells: [...new Map(cells.map(([x, y]) => [[x + offset[0], y + offset[1]].join(','), [x + offset[0], y + offset[1]]])).values()] };
  });
}

function convertScene(scene, id, catalog, interfacePairs) {
  const scale = scene.world_scale ?? 1; const logicalSize = scene.viewport.map((value) => value / scale); const cell = scene.terrain?.grid?.cell ?? catalog.pack?.native_cell ?? [16, 16];
  if (logicalSize.some((value) => !Number.isInteger(value))) throw new Error(`scene ${id}: viewport is not divisible by world_scale`);
  const columns = logicalSize[0] / cell[0]; const rows = logicalSize[1] / cell[1];
  if (![columns, rows].every(Number.isInteger)) throw new Error(`scene ${id}: logical viewport is not divisible by grid cell`);
  const rawRegions = rawTerrainCells(scene, scale, cell);
  let base = scene.ground ? materialId(assetReference(scene.ground).asset) : backgroundMaterialId(id);
  if (!scene.ground && rawRegions[0]?.cells.length === columns * rows) base = rawRegions.shift().material;
  const grid = Array.from({ length: rows }, () => Array(columns).fill(base)); const continuation = new Map();
  for (const region of rawRegions) {
    continuation.set(region.material, new Set([...(continuation.get(region.material) ?? []), ...(region.continues ?? [])]));
    for (const [x, y] of region.cells) {
      if (x < 0 || y < 0 || x >= columns || y >= rows) throw new Error(`scene ${id}: terrain cell ${x},${y} is outside viewport`);
      grid[y][x] = region.material;
    }
  }
  const regions = [];
  for (const material of [...new Set(grid.flat())].filter((entry) => entry !== base).sort()) {
    const cells = []; for (let y = 0; y < rows; y += 1) for (let x = 0; x < columns; x += 1) if (grid[y][x] === material) cells.push([x, y]);
    const outside = new Set();
    for (const [x, y] of cells) for (const [nx, ny] of [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]]) if (nx >= 0 && ny >= 0 && nx < columns && ny < rows && grid[ny][nx] !== material) outside.add(grid[ny][nx]);
    for (const neighbour of outside) interfacePairs.add(`${material}|${neighbour}`);
    regions.push({ id: slug(material.replace(/^material\./, '')), material, cells, ...((continuation.get(material)?.size) ? { continues: [...continuation.get(material)].sort() } : {}) });
  }
  const logical = (pair) => pair.map((value) => value / scale);
  const converted = {
    schema_version: 2, kind: 'top-down-scene', id, catalog: 'showcase-v2', style_profile: STYLE,
    logical_size: logicalSize, pixel_scale: scale, grid: { cell }, background: scene.background,
    terrain: { base, ...(regions.length ? { regions } : {}) },
    placements: (scene.placements ?? []).map((placement) => {
      const { scale: localScale, z, depth_sort: depthSort, shadow, offset, ...clean } = placement;
      void localScale; void z; void depthSort; void shadow; void offset;
      const reference = clean.asset ? assetReference(clean.asset) : null;
      if (reference) { clean.asset = reference.asset; if (reference.frame !== 'default') clean.frame = reference.frame; }
      clean.at = logical(placement.at); return clean;
    }),
    ...(scene.review_regions ? { review_regions: scene.review_regions.map((region) => ({ ...region, rect: [region.rect[0] / scale, region.rect[1] / scale, region.rect[2] / scale, region.rect[3] / scale] })) } : {}),
  };
  if (scene.connectors?.length) converted.connectors = scene.connectors.map((region) => { const { asset, scale: localScale, z, ...clean } = region; void localScale; void z; return { ...clean, profile: asset, origin: logical(region.origin ?? [0, 0]) }; });
  if (scene.heights?.length) converted.heights = scene.heights.map((region) => { const { asset, scale: localScale, z, ...clean } = region; void localScale; void z; return { ...clean, profile: asset, origin: logical(region.origin ?? [0, 0]) }; });
  if (scene.components?.length) converted.components = scene.components.map((region) => { const { asset, component, scale: localScale, z, opacity, ...clean } = region; void localScale; void z; void opacity; return { ...clean, profile: `${asset}.${component}`, origin: logical(region.origin ?? [0, 0]) }; });
  return { scene: converted, base, grid };
}

/** Explicit, read-only v1 adapter used only to produce reviewed v2 candidates. */
export function migratePresentationV1(v1Catalog, namedScenes) {
  const source = materializeAssetCatalog(v1Catalog); const interfacePairs = new Set(); const convertedScenes = [];
  for (const { id, scene } of namedScenes) convertedScenes.push(convertScene(scene, id, source, interfacePairs));
  const usedMaterialAssets = new Set(); const backgroundMaterials = new Map();
  for (const converted of convertedScenes) {
    for (const material of new Set(converted.grid.flat())) {
      if (material.startsWith('material.scene.')) backgroundMaterials.set(material, namedScenes.find((entry) => entry.id === converted.scene.id)?.scene.background ?? '#000000');
      else usedMaterialAssets.add(material.replace(/^material\./, ''));
    }
  }
  const materials = {};
  for (const [id, color] of backgroundMaterials) materials[id] = { style_profile: STYLE, plane: 'ground', biome: id.replace('material.scene.', ''), surface: 'solid', fill: { color } };
  for (const assetId of usedMaterialAssets) {
    const asset = source.assets[assetId]; if (!asset) throw new Error(`material references missing asset ${assetId}`);
    const frame = asset.autotile?.positive?.nesw ?? asset.autotile?.positive?.fallback ?? asset.autotile?.frames?.nesw ?? Object.keys(asset.frames ?? {})[0];
    const liquid = asset.tags?.some((tag) => ['water', 'lava', 'sewer'].includes(tag));
    materials[materialId(assetId)] = { style_profile: STYLE, plane: 'ground', biome: asset.tags?.find((tag) => ['default', 'desert', 'dungeon', 'free', 'halloween', 'shroom', 'volcano'].includes(tag)) ?? 'default', surface: liquid ? 'liquid' : 'solid', fill: { asset: assetId, frame } };
  }
  const terrainInterfaces = {};
  for (const pair of [...interfacePairs].sort()) {
    const [inside, outside] = pair.split('|'); const assetId = inside.replace(/^material\./, ''); const asset = source.assets[assetId];
    if (!asset?.autotile) throw new Error(`material ${inside} needs autotile metadata to meet ${outside}`);
    const id = `interface.${slug(inside)}-to-${slug(outside)}`;
    terrainInterfaces[id] = { inside, outside, asset: assetId, polarity: 'positive' };
  }
  const assets = Object.fromEntries(Object.entries(source.assets ?? {}).map(([id, asset]) => [id, convertAsset(id, asset)]));
  const catalog = {
    schema_version: 2, kind: 'presentation-catalog', pack: { id: 'showcase-v2', style_profile: STYLE, logical_cell: [16, 16] },
    style_profiles: { [STYLE]: {
      logical_cell: [16, 16], sampling: 'nearest', base_pixel: 1, palette_family: 'default', scale_classes: STYLE_SCALE_CLASSES,
      composition: { sector_grid: [3, 3], minimum_occupied_sectors: 4, visual_coverage: [0.1, 0.5], minimum_navigation_connectivity: 0.75, maximum_repeat_ratio: 0.5, minimum_role_diversity: 3, maximum_role_ratio: 0.75 },
    } },
    shadow_profiles: { 'soft-small': { size: [8, 3], offset: [0, 1], color: '#000000', opacity: 0.22 }, 'soft-medium': { size: [14, 5], offset: [0, 1], color: '#000000', opacity: 0.2 } },
    license_scopes: source.license_scopes, assets, materials, terrain_interfaces: terrainInterfaces,
    connector_profiles: Object.fromEntries(Object.entries(assets).filter(([, asset]) => asset.connector).map(([id]) => [id, { asset: id, render_layer: 'ground' }])),
    height_interfaces: Object.fromEntries(Object.entries(assets).filter(([, asset]) => asset.height).map(([id]) => [id, { asset: id, render_layer: 'ground' }])),
    component_profiles: Object.fromEntries(Object.entries(assets).flatMap(([id, asset]) => Object.keys(asset.components ?? {}).map((component) => [`${id}.${component}`, { asset: id, component, allowed_surfaces: ['solid'], render_layer: 'ground' }]))),
    prefabs: Object.fromEntries(Object.entries(source.prefabs ?? {}).map(([id, prefab]) => [id, convertPrefab(prefab)])),
  };
  return { catalog, scenes: convertedScenes.map((entry) => entry.scene), report: { source_schema_version: v1Catalog.schema_version, assets: Object.keys(assets).length, materials: Object.keys(materials).length, interfaces: Object.keys(terrainInterfaces).length, scenes: convertedScenes.length, unresolved: [] } };
}
