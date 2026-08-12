const ASSET_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const FRAME_ANCHORS = new Set(['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right']);
const APPROVED_LICENSE_SCOPES = new Set(['core-commercial', 'characters-commercial', 'desert-commercial', 'dungeons-commercial', 'free-noncommercial', 'halloween-commercial', 'ui-commercial', 'volcano-commercial', 'legacy-private-use']);

function isPair(value, { positive = false } = {}) {
  return Array.isArray(value) && value.length === 2 && value.every((part) => Number.isInteger(part) && (positive ? part > 0 : part >= 0));
}

function isIntegerPair(value) {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isInteger);
}

function resolvePrefabParameters(prefab, supplied = {}) {
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) throw new Error('prefab params must be an object');
  const definitions = prefab.parameters ?? {};
  const unknown = Object.keys(supplied).filter((name) => !definitions[name]);
  if (unknown.length) throw new Error(`unknown prefab parameter: ${unknown.join(', ')}`);
  const values = {};
  for (const [name, definition] of Object.entries(definitions)) {
    const value = supplied[name] ?? definition.default;
    if (definition.type === 'enum' && (!Array.isArray(definition.values) || !definition.values.includes(value))) throw new Error(`invalid prefab enum parameter ${name}: ${value}`);
    if (definition.type === 'boolean' && typeof value !== 'boolean') throw new Error(`invalid prefab boolean parameter ${name}: ${value}`);
    values[name] = value;
  }
  return values;
}

/** Resolve one prefab's finite parameter/select/condition vocabulary to concrete layers. */
export function resolvePrefabLayers(catalog, prefabId, supplied = {}) {
  const prefab = catalog?.prefabs?.[prefabId];
  if (!prefab) throw new Error(`unknown prefab: ${prefabId}`);
  const params = resolvePrefabParameters(prefab, supplied);
  const layers = [];
  for (const authored of prefab.layers ?? []) {
    let layer = authored;
    if (authored.select) {
      const selected = authored.variants?.[params[authored.select]];
      if (!selected) throw new Error(`prefab ${prefabId} has no ${authored.select} variant: ${params[authored.select]}`);
      layer = selected;
    }
    if (layer.when_parameter) {
      const expected = layer.equals ?? true;
      if (params[layer.when_parameter] !== expected) continue;
    }
    const { select, variants, when_parameter: whenParameter, equals, ...concrete } = layer;
    void select; void variants; void whenParameter; void equals;
    layers.push(concrete);
  }
  return { prefab, params, layers };
}

/** Validate reusable prefab composition independently of filesystem access. */
export function validatePrefabCatalog(catalog) {
  const errors = [];
  const prefabs = catalog?.prefabs ?? {};
  if (!prefabs || typeof prefabs !== 'object' || Array.isArray(prefabs)) return ['prefabs must be an object'];
  for (const [id, prefab] of Object.entries(prefabs)) {
    const prefix = `prefab ${id}`;
    if (!ASSET_ID.test(id)) errors.push(`${prefix}: invalid id`);
    for (const [name, definition] of Object.entries(prefab?.parameters ?? {})) {
      if (!ASSET_ID.test(name)) errors.push(`${prefix}: invalid parameter id ${name}`);
      if (definition?.type === 'enum') {
        if (!Array.isArray(definition.values) || !definition.values.length || definition.values.some((value) => typeof value !== 'string') || !definition.values.includes(definition.default)) errors.push(`${prefix}: enum parameter ${name} needs values containing its default`);
      } else if (definition?.type === 'boolean') {
        if (typeof definition.default !== 'boolean') errors.push(`${prefix}: boolean parameter ${name} needs a boolean default`);
      } else errors.push(`${prefix}: parameter ${name} has unsupported type`);
    }
    if (!Array.isArray(prefab?.layers) || !prefab.layers.length) { errors.push(`${prefix}: layers must be a non-empty array`); continue; }
    const validateLayer = (layer, layerPrefix) => {
      if (layer?.select) {
        const definition = prefab.parameters?.[layer.select];
        if (definition?.type !== 'enum' || !layer.variants || typeof layer.variants !== 'object') errors.push(`${layerPrefix}: select needs an enum parameter and variants`);
        else {
          for (const value of definition.values) if (!layer.variants[value]) errors.push(`${layerPrefix}: missing variant ${value}`);
          for (const [value, variant] of Object.entries(layer.variants)) {
            if (!definition.values.includes(value)) errors.push(`${layerPrefix}: unknown variant ${value}`);
            validateLayer(variant, `${layerPrefix} variant ${value}`);
          }
        }
        return;
      }
      if (layer?.when_parameter && !prefab.parameters?.[layer.when_parameter]) errors.push(`${layerPrefix}: unknown condition parameter ${layer.when_parameter}`);
      if (Boolean(layer?.asset) === Boolean(layer?.prefab)) { errors.push(`${layerPrefix}: needs exactly one asset or prefab`); return; }
      if (layer.asset) {
        const [assetId, frameId] = String(layer.asset).split('#');
        const asset = catalog.assets?.[assetId];
        if (asset?.status !== 'approved') errors.push(`${layerPrefix}: references unavailable asset ${assetId}`);
        if (frameId && !asset?.frames?.[frameId]) errors.push(`${layerPrefix}: references unknown frame ${frameId}`);
      }
      if (layer.prefab && !prefabs[layer.prefab]) errors.push(`${layerPrefix}: references unknown prefab ${layer.prefab}`);
      if (layer.at !== undefined && !isIntegerPair(layer.at)) errors.push(`${layerPrefix}: at must be an integer pair`);
      if (layer.offset !== undefined && !isIntegerPair(layer.offset)) errors.push(`${layerPrefix}: offset must be an integer pair`);
      if (layer.z !== undefined && !Number.isFinite(layer.z)) errors.push(`${layerPrefix}: z must be numeric`);
      if (layer.scale !== undefined && (!Number.isFinite(layer.scale) || layer.scale <= 0)) errors.push(`${layerPrefix}: scale must be positive`);
    };
    for (const [index, layer] of prefab.layers.entries()) {
      validateLayer(layer, `${prefix} layer ${index}`);
    }
  }
  const visiting = new Set(); const visited = new Set();
  const visit = (id, trail = []) => {
    if (visiting.has(id)) { errors.push(`prefab cycle: ${[...trail, id].join(' -> ')}`); return; }
    if (visited.has(id) || !prefabs[id]) return;
    visiting.add(id);
    const nested = (layer) => layer?.select ? Object.values(layer.variants ?? {}).flatMap(nested) : (layer?.prefab ? [layer.prefab] : []);
    for (const layer of prefabs[id].layers ?? []) for (const child of nested(layer)) visit(child, [...trail, id]);
    visiting.delete(id); visited.add(id);
  };
  for (const id of Object.keys(prefabs)) visit(id);
  return errors;
}

/** Validates the runtime-safe subset of the YAML asset metadata standard. */
export function validateAssetCatalog(catalog) {
  const errors = [];
  if (catalog?.schema_version !== 1) errors.push('schema_version must be 1');
  if (!ASSET_ID.test(String(catalog?.pack?.id || ''))) errors.push('pack.id is invalid');
  const assets = catalog?.assets;
  if (!assets || typeof assets !== 'object' || Array.isArray(assets)) return { valid: false, errors: [...errors, 'assets must be an object'] };
  for (const [id, asset] of Object.entries(assets)) {
    const prefix = `asset ${id}`;
    if (!ASSET_ID.test(id)) errors.push(`${prefix}: invalid id`);
    if (asset?.status !== 'approved') continue;
    if (!APPROVED_LICENSE_SCOPES.has(asset?.license_scope)) errors.push(`${prefix}: approved license_scope is unknown or unsupported`);
    if (!Array.isArray(asset?.tags) || !asset.tags.length || asset.tags.some((tag) => !ASSET_ID.test(String(tag)))) errors.push(`${prefix}: approved asset needs valid tags`);
    if (!['image', 'sprite-sheet', 'tile-sheet', 'ui-sheet', 'effect-sheet'].includes(asset?.kind)) errors.push(`${prefix}: invalid kind`);
    if (!asset?.source || String(asset.source).startsWith('/') || String(asset.source).includes('..')) errors.push(`${prefix}: source must be a relative canonical path`);
    if (!/^[a-f0-9]{64}$/.test(String(asset?.source_sha256 || ''))) errors.push(`${prefix}: source_sha256 must be a sha256`);
    const geometry = asset?.geometry;
    if (!['grid', 'freeform'].includes(geometry?.layout)) { errors.push(`${prefix}: geometry.layout is required`); continue; }
    if (geometry.layout === 'grid' && (!isPair(geometry.cell, { positive: true }) || !isPair(geometry.grid, { positive: true }))) errors.push(`${prefix}: grid geometry needs cell and grid`);
    for (const [frameId, frame] of Object.entries(asset?.frames ?? {})) {
      if (!ASSET_ID.test(frameId)) errors.push(`${prefix}: invalid frame id ${frameId}`);
      if (Boolean(frame?.cell) === Boolean(frame?.rect)) errors.push(`${prefix}: frame ${frameId} needs exactly one source shape`);
      if (frame?.cell && (geometry.layout !== 'grid' || !isPair(frame.cell))) errors.push(`${prefix}: frame ${frameId} has invalid cell`);
      if (frame?.rect && (geometry.layout !== 'freeform' || !Array.isArray(frame.rect) || frame.rect.length !== 4 || frame.rect.some((part) => !Number.isInteger(part) || part < 0))) errors.push(`${prefix}: frame ${frameId} has invalid rect`);
      if (typeof frame?.anchor === 'string' && !FRAME_ANCHORS.has(frame.anchor)) errors.push(`${prefix}: frame ${frameId} has invalid anchor`);
    }
    if (asset?.autotile !== undefined) {
      if (asset.kind !== 'tile-sheet' || asset.autotile?.topology !== 'cardinal-4') errors.push(`${prefix}: autotile requires tile-sheet cardinal-4 topology`);
      for (const polarity of ['positive', 'negative']) {
        const mapping = asset.autotile?.[polarity];
        if (polarity === 'positive' && (!mapping || typeof mapping !== 'object')) errors.push(`${prefix}: autotile needs a positive mapping`);
        if (mapping && typeof mapping === 'object') {
          for (const [mask, frameId] of Object.entries(mapping)) {
            if (mask !== 'fallback' && !/^(?:n)?(?:e)?(?:s)?(?:w)?$/.test(mask)) errors.push(`${prefix}: autotile ${polarity} mask is invalid: ${mask}`);
            if (!ASSET_ID.test(String(frameId)) || !asset.frames?.[frameId]) errors.push(`${prefix}: autotile ${polarity} references unknown frame: ${frameId}`);
          }
        }
      }
    }
  }
  errors.push(...validatePrefabCatalog(catalog));
  return { valid: errors.length === 0, errors };
}

/** Returns an approved descriptor only; candidates and deferred assets never reach a renderer. */
export function resolveApprovedAsset(catalog, id) {
  if (!ASSET_ID.test(String(id || ''))) return null;
  const asset = catalog?.assets?.[id];
  return asset?.status === 'approved' ? { id, ...asset } : null;
}

/** Stable clockwise neighbour key for terrain auto-tiles: n/e/s/w. */
export function terrainNeighbourMask(cells, [x, y]) {
  const has = (atX, atY) => cells.has(`${atX},${atY}`);
  return `${has(x, y - 1) ? 'n' : ''}${has(x + 1, y) ? 'e' : ''}${has(x, y + 1) ? 's' : ''}${has(x - 1, y) ? 'w' : ''}` || 'isolated';
}

/** Resolve a reviewed terrain-frame mapping; missing masks must be explicit. */
export function resolveTerrainFrame({ cells, at, frames, polarity = 'positive' }) {
  if (!['positive', 'negative'].includes(polarity)) throw new Error(`terrain polarity must be positive or negative: ${polarity}`);
  const mask = terrainNeighbourMask(cells, at);
  // A flat map is retained for older curated packs. New packs provide a map for
  // each material polarity, so a lake and an island can share one source sheet.
  const mapping = frames?.[polarity] ?? frames;
  const frame = mapping?.[mask] ?? mapping?.fallback;
  if (!frame) throw new Error(`terrain mapping has no frame for neighbour mask: ${mask}`);
  return { mask, frame };
}
