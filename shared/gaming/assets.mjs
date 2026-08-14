const ASSET_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const FRAME_ANCHORS = new Set(['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right']);
const APPROVED_LICENSE_SCOPES = new Set(['core-commercial', 'characters-commercial', 'desert-commercial', 'dungeons-commercial', 'free-noncommercial', 'halloween-commercial', 'ui-commercial', 'volcano-commercial', 'legacy-private-use']);
const AUTOTILE_POLARITIES = ['positive', 'negative'];

function isPair(value, { positive = false } = {}) {
  return Array.isArray(value) && value.length === 2 && value.every((part) => Number.isInteger(part) && (positive ? part > 0 : part >= 0));
}

function isIntegerPair(value) {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isInteger);
}

function mergeTemplate(base, override) {
  if (!base || typeof base !== 'object' || Array.isArray(base)) return structuredClone(override);
  const merged = structuredClone(base);
  for (const [key, value] of Object.entries(override ?? {})) {
    if (key === 'extends') continue;
    merged[key] = value && typeof value === 'object' && !Array.isArray(value) && merged[key] && typeof merged[key] === 'object' && !Array.isArray(merged[key])
      ? mergeTemplate(merged[key], value)
      : structuredClone(value);
  }
  return merged;
}

/** Expand finite YAML asset templates and asset variants without mutating the authored catalog. */
export function materializeAssetCatalog(catalog) {
  const templates = catalog?.asset_templates ?? {};
  const authoredAssets = catalog?.assets ?? {};
  const assets = {};
  const resolving = [];

  const resolveAsset = (id) => {
    if (assets[id]) return assets[id];
    const asset = authoredAssets[id];
    if (!asset?.extends) return (assets[id] = structuredClone(asset));

    const cycleStart = resolving.indexOf(id);
    if (cycleStart >= 0) throw new Error(`asset inheritance cycle: ${[...resolving.slice(cycleStart), id].join(' -> ')}`);
    resolving.push(id);
    const extendsAsset = Object.hasOwn(authoredAssets, asset.extends);
    const base = templates[asset.extends]
      ?? (extendsAsset ? resolveAsset(asset.extends) : null);
    resolving.pop();
    if (!base) throw new Error(`asset ${id}: unknown template or asset ${asset.extends}`);
    const resolved = mergeTemplate(base, asset);
    if (extendsAsset) resolved.variant_of = asset.extends;
    return (assets[id] = resolved);
  };

  for (const id of Object.keys(authoredAssets)) resolveAsset(id);
  return { ...catalog, assets };
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
  catalog = materializeAssetCatalog(catalog);
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
  try { catalog = materializeAssetCatalog(catalog); } catch (error) { return [error.message]; }
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
  try { catalog = materializeAssetCatalog(catalog); } catch (error) { return { valid: false, errors: [error.message] }; }
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
    if (asset?.pixel_density !== undefined && (!Number.isInteger(asset.pixel_density) || asset.pixel_density < 1 || asset.pixel_density > 8)) errors.push(`${prefix}: pixel_density must be an integer from 1 to 8`);
    if (asset?.requires_all_ports !== undefined && typeof asset.requires_all_ports !== 'boolean') errors.push(`${prefix}: requires_all_ports must be boolean`);
    if (!asset?.source || String(asset.source).startsWith('/') || String(asset.source).includes('..')) errors.push(`${prefix}: source must be a relative canonical path`);
    if (!/^[a-f0-9]{64}$/.test(String(asset?.source_sha256 || ''))) errors.push(`${prefix}: source_sha256 must be a sha256`);
    const geometry = asset?.geometry;
    if (!['grid', 'freeform'].includes(geometry?.layout)) { errors.push(`${prefix}: geometry.layout is required`); continue; }
    if (geometry.layout === 'grid' && (!isPair(geometry.cell, { positive: true }) || !isPair(geometry.grid, { positive: true }))) errors.push(`${prefix}: grid geometry needs cell and grid`);
    if (geometry.layout === 'grid' && Number.isInteger(asset.pixel_density) && geometry.cell?.some((value) => value % asset.pixel_density !== 0)) errors.push(`${prefix}: grid cell must be divisible by pixel_density`);
    for (const [frameId, frame] of Object.entries(asset?.frames ?? {})) {
      if (!ASSET_ID.test(frameId)) errors.push(`${prefix}: invalid frame id ${frameId}`);
      if (Boolean(frame?.cell) === Boolean(frame?.rect)) errors.push(`${prefix}: frame ${frameId} needs exactly one source shape`);
      if (frame?.cell && (geometry.layout !== 'grid' || !isPair(frame.cell))) errors.push(`${prefix}: frame ${frameId} has invalid cell`);
      if (frame?.rect && (geometry.layout !== 'freeform' || !Array.isArray(frame.rect) || frame.rect.length !== 4 || frame.rect.some((part) => !Number.isInteger(part) || part < 0))) errors.push(`${prefix}: frame ${frameId} has invalid rect`);
      if (frame?.rect && Number.isInteger(asset.pixel_density) && frame.rect.slice(2).some((value) => value % asset.pixel_density !== 0)) errors.push(`${prefix}: frame ${frameId} size must be divisible by pixel_density`);
      if (typeof frame?.anchor === 'string' && !FRAME_ANCHORS.has(frame.anchor)) errors.push(`${prefix}: frame ${frameId} has invalid anchor`);
      if (frame?.allow_edge_contact !== undefined && typeof frame.allow_edge_contact !== 'boolean') errors.push(`${prefix}: frame ${frameId} allow_edge_contact must be boolean`);
    }
    if (asset?.autotile !== undefined) {
      if (asset.kind !== 'tile-sheet' || !['cardinal-4', 'cardinal-4+diagonal-corners'].includes(asset.autotile?.topology)) errors.push(`${prefix}: autotile requires a supported tile-sheet topology`);
      const supportedPolarities = asset.autotile?.supported_polarities;
      if (!Array.isArray(supportedPolarities) || !supportedPolarities.length || new Set(supportedPolarities).size !== supportedPolarities.length || supportedPolarities.some((polarity) => !AUTOTILE_POLARITIES.includes(polarity))) {
        errors.push(`${prefix}: autotile supported_polarities must explicitly contain positive and/or negative`);
      }
      if (asset.autotile?.outer_corner_mode !== undefined && !['quarter-composite', 'native'].includes(asset.autotile.outer_corner_mode)) errors.push(`${prefix}: autotile outer_corner_mode must be quarter-composite or native`);
      if (asset.autotile?.outer_edge_mode !== undefined && !['quarter-composite', 'native'].includes(asset.autotile.outer_edge_mode)) errors.push(`${prefix}: autotile outer_edge_mode must be quarter-composite or native`);
      if (asset.autotile?.outer_corner_style !== undefined && !['square', 'rounded'].includes(asset.autotile.outer_corner_style)) errors.push(`${prefix}: autotile outer_corner_style must be square or rounded`);
      for (const polarity of AUTOTILE_POLARITIES) {
        const mapping = asset.autotile?.[polarity];
        const declared = supportedPolarities?.includes(polarity);
        if (declared && (!mapping || typeof mapping !== 'object' || Array.isArray(mapping))) errors.push(`${prefix}: declared ${polarity} polarity needs a mapping`);
        if (!declared && mapping !== undefined) errors.push(`${prefix}: autotile ${polarity} mapping is not declared in supported_polarities`);
        if (mapping && typeof mapping === 'object') {
          for (const [mask, frameId] of Object.entries(mapping)) {
            if (!['fallback', 'isolated'].includes(mask) && !/^(?:n)?(?:e)?(?:s)?(?:w)?$/.test(mask)) errors.push(`${prefix}: autotile ${polarity} mask is invalid: ${mask}`);
            if (!ASSET_ID.test(String(frameId)) || !asset.frames?.[frameId]) errors.push(`${prefix}: autotile ${polarity} references unknown frame: ${frameId}`);
          }
        }
      }
      if (asset.autotile?.topology === 'cardinal-4+diagonal-corners') {
        const innerCorners = asset.autotile?.inner_corners;
        if (!innerCorners || typeof innerCorners !== 'object' || Array.isArray(innerCorners)) errors.push(`${prefix}: diagonal-corner autotile needs inner_corners`);
        const mode = asset.autotile?.inner_corner_mode ?? 'replace';
        if (!['replace', 'composite'].includes(mode)) errors.push(`${prefix}: inner_corner_mode must be replace or composite`);
        const maps = innerCorners && (innerCorners.positive || innerCorners.negative)
          ? Object.entries({ positive: innerCorners.positive, negative: innerCorners.negative }).filter(([, map]) => map !== undefined)
          : [['shared', innerCorners]];
        for (const [polarity, map] of maps) {
          if (!map || typeof map !== 'object' || Array.isArray(map)) { errors.push(`${prefix}: inside-corner ${polarity} map is invalid`); continue; }
          for (const [key, frameId] of Object.entries(map)) {
            if (!/^(?:nw|ne|se|sw)(?:-(?:nw|ne|se|sw))*$/.test(key)) errors.push(`${prefix}: inside-corner key is invalid: ${key}`);
            if (mode === 'composite' && key.includes('-')) errors.push(`${prefix}: composite inside-corner maps use single corner keys, not ${key}`);
            if (!ASSET_ID.test(String(frameId)) || !asset.frames?.[frameId]) errors.push(`${prefix}: inside-corner key references unknown frame: ${frameId}`);
          }
        }
        for (const polarity of supportedPolarities ?? []) {
          const map = innerCorners?.[polarity] ?? (innerCorners?.positive || innerCorners?.negative ? undefined : innerCorners);
          if (!map) errors.push(`${prefix}: declared ${polarity} polarity needs an inside-corner map`);
        }
      }
      if (asset.autotile?.animation !== undefined) {
        const animation = asset.autotile.animation;
        if (animation?.mode !== 'grid-offset') errors.push(`${prefix}: autotile animation mode must be grid-offset`);
        if (!Number.isInteger(animation?.frames) || animation.frames < 2) errors.push(`${prefix}: autotile animation frames must be at least 2`);
        if (!Number.isFinite(animation?.fps) || animation.fps <= 0) errors.push(`${prefix}: autotile animation fps must be positive`);
        if (!isIntegerPair(animation?.phase_stride) || animation.phase_stride.some((value) => value < 0) || animation.phase_stride.every((value) => value === 0)) errors.push(`${prefix}: autotile animation phase_stride must be a non-zero non-negative cell pair`);
        if (animation?.loop !== undefined && !['loop', 'once', 'ping-pong'].includes(animation.loop)) errors.push(`${prefix}: autotile animation loop is invalid`);
      }
    }
    if (asset?.connector !== undefined) {
      if (asset.connector?.topology !== 'connector-graph') errors.push(`${prefix}: connector topology must be connector-graph`);
      if (!asset.connector?.pieces || typeof asset.connector.pieces !== 'object' || Array.isArray(asset.connector.pieces)) errors.push(`${prefix}: connector needs a pieces map`);
      for (const [mask, descriptor] of Object.entries(asset.connector?.pieces ?? {})) {
        if (!/^(?:n)?(?:e)?(?:s)?(?:w)?$/.test(mask) && mask !== 'isolated') errors.push(`${prefix}: connector mask is invalid: ${mask}`);
        const frameId = typeof descriptor === 'string' ? descriptor : descriptor?.frame;
        if (!ASSET_ID.test(String(frameId)) || !asset.frames?.[frameId]) errors.push(`${prefix}: connector mask ${mask} references unknown frame`);
        if (descriptor?.rotation !== undefined && ![0, 90, 180, 270].includes(descriptor.rotation)) errors.push(`${prefix}: connector mask ${mask} rotation is invalid`);
        const requiredPorts = (mask === 'isolated' ? [] : mask.split(''));
        const portNames = { n: 'north', e: 'east', s: 'south', w: 'west' };
        for (const direction of requiredPorts) if (!asset.frames?.[frameId]?.ports?.[portNames[direction]]) errors.push(`${prefix}: connector mask ${mask} frame ${frameId} lacks ${portNames[direction]} port`);
      }
    }
    if (asset?.height !== undefined) {
      if (asset.height?.topology !== 'cliff-height') errors.push(`${prefix}: height topology must be cliff-height`);
      if (!Number.isInteger(asset.height?.rise_cells) || asset.height.rise_cells < 1) errors.push(`${prefix}: height rise_cells must be positive`);
      if (!asset.height?.bands || typeof asset.height.bands !== 'object' || Array.isArray(asset.height.bands)) errors.push(`${prefix}: height needs a bands map`);
      for (const [band, frameIds] of Object.entries(asset.height?.bands ?? {})) {
        if (!ASSET_ID.test(band) || !Array.isArray(frameIds) || frameIds.length !== 3) errors.push(`${prefix}: height band ${band} must contain left/middle/right frames`);
        else for (const frameId of frameIds) if (!ASSET_ID.test(String(frameId)) || !asset.frames?.[frameId]) errors.push(`${prefix}: height band ${band} references unknown frame ${frameId}`);
      }
      if (!asset.height?.transitions || typeof asset.height.transitions !== 'object' || Array.isArray(asset.height.transitions)) errors.push(`${prefix}: height needs transitions`);
      for (const [direction, bands] of Object.entries(asset.height?.transitions ?? {})) {
        if (!['north', 'east', 'south', 'west'].includes(direction) || !Array.isArray(bands) || !bands.length) errors.push(`${prefix}: height transition ${direction} is invalid`);
        else for (const band of bands) if (!asset.height.bands?.[band]) errors.push(`${prefix}: height transition ${direction} references unknown band ${band}`);
      }
    }
    if (asset?.components !== undefined) {
      if (!asset.components || typeof asset.components !== 'object' || Array.isArray(asset.components)) errors.push(`${prefix}: components must be a map`);
      for (const [componentId, component] of Object.entries(asset.components ?? {})) {
        if (!ASSET_ID.test(componentId) || !['fill', 'border', 'stair', 'doorway', 'hazard', 'transition', 'decoration'].includes(component?.role) || !Array.isArray(component?.frames) || !component.frames.length) errors.push(`${prefix}: component ${componentId} is invalid`);
        else {
          for (const frameId of component.frames) if (!ASSET_ID.test(String(frameId)) || !asset.frames?.[frameId]) errors.push(`${prefix}: component ${componentId} references unknown frame ${frameId}`);
          if (component.outline !== undefined) {
            const keys = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];
            if (!['border', 'hazard'].includes(component.role) || !component.outline || typeof component.outline !== 'object' || Array.isArray(component.outline) || keys.some((key) => !asset.frames?.[component.outline[key]])) errors.push(`${prefix}: component ${componentId} outline must map nw/n/ne/w/e/sw/s/se to frames for a border or hazard`);
            if (component.interior !== undefined && !asset.frames?.[component.interior]) errors.push(`${prefix}: component ${componentId} interior references unknown frame`);
          }
          if (component.transitions !== undefined) {
            if (!component.transitions || typeof component.transitions !== 'object' || Array.isArray(component.transitions)) errors.push(`${prefix}: component ${componentId} transitions must be a direction map`);
            else for (const [direction, sequence] of Object.entries(component.transitions)) {
              if (!['north', 'east', 'south', 'west'].includes(direction) || !Array.isArray(sequence) || !sequence.length || sequence.some((frameId) => !component.frames.includes(frameId))) errors.push(`${prefix}: component ${componentId} transition ${direction} must use component frames`);
            }
          }
          if (component.directional_frames !== undefined) {
            if (!component.directional_frames || typeof component.directional_frames !== 'object' || Array.isArray(component.directional_frames) || Object.entries(component.directional_frames).some(([direction, frameId]) => !['north', 'east', 'south', 'west'].includes(direction) || !component.frames.includes(frameId))) errors.push(`${prefix}: component ${componentId} directional_frames must map directions to component frames`);
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
  catalog = materializeAssetCatalog(catalog);
  if (!ASSET_ID.test(String(id || ''))) return null;
  const asset = catalog?.assets?.[id];
  return asset?.status === 'approved' ? { id, ...asset } : null;
}

/** Resolve one reviewed connector piece from canonical n/e/s/w branches. */
export function resolveConnectorFrame(asset, directions) {
  const ordered = ['n', 'e', 's', 'w'];
  if (!Array.isArray(directions) || directions.some((direction) => !ordered.includes(direction))) throw new Error('connector directions must contain n/e/s/w');
  const mask = ordered.filter((direction) => directions.includes(direction)).join('') || 'isolated';
  const descriptor = asset?.connector?.pieces?.[mask];
  if (!descriptor) throw new Error(`connector mapping has no piece for mask: ${mask}`);
  return { mask, ...(typeof descriptor === 'string' ? { frame: descriptor } : descriptor) };
}

export function resolveHeightTransition(asset, direction) {
  const bands = asset?.height?.transitions?.[direction];
  if (!bands) throw new Error(`height mapping has no transition for direction: ${direction}`);
  return { direction, rise_cells: asset.height.rise_cells, bands: bands.map((band) => ({ id: band, frames: asset.height.bands[band] })) };
}

/** Stable clockwise neighbour key for terrain auto-tiles: n/e/s/w. */
export function terrainNeighbourMask(cells, [x, y]) {
  const has = (atX, atY) => cells.has(`${atX},${atY}`);
  return `${has(x, y - 1) ? 'n' : ''}${has(x + 1, y) ? 'e' : ''}${has(x, y + 1) ? 's' : ''}${has(x - 1, y) ? 'w' : ''}` || 'isolated';
}

/** Missing diagonals that require an inside-corner tile.
 * A diagonal matters only when both adjoining cardinal cells are present. */
export function terrainInnerCornerKeys(cells, [x, y]) {
  const has = (offsetX, offsetY) => cells.has(`${x + offsetX},${y + offsetY}`);
  const cardinalCount = [[0, -1], [1, 0], [0, 1], [-1, 0]].filter(([offsetX, offsetY]) => has(offsetX, offsetY)).length;
  // With only two adjacent neighbours this cell is itself the convex outer
  // corner. Concave detail begins at a three-way or four-way material join.
  if (cardinalCount < 3) return [];
  return [
    ['nw', [0, -1], [-1, 0], [-1, -1]],
    ['ne', [0, -1], [1, 0], [1, -1]],
    ['se', [0, 1], [1, 0], [1, 1]],
    ['sw', [0, 1], [-1, 0], [-1, 1]],
  ].filter(([, first, second, diagonal]) => has(...first) && has(...second) && !has(...diagonal)).map(([key]) => key);
}

/** Resolve a reviewed terrain-frame mapping; missing masks must be explicit. */
export function resolveTerrainFrame({ cells, at, frames, polarity = 'positive', phase = 0 }) {
  if (!['positive', 'negative'].includes(polarity)) throw new Error(`terrain polarity must be positive or negative: ${polarity}`);
  const mask = terrainNeighbourMask(cells, at);
  // A flat map is retained for older curated packs. New packs provide a map for
  // each material polarity, so a lake and an island can share one source sheet.
  const mapping = frames?.[polarity] ?? frames;
  const frame = mapping?.[mask] ?? mapping?.fallback;
  if (!frame) throw new Error(`terrain mapping has no frame for neighbour mask: ${mask}`);
  const animation = frames?.animation;
  if (!Number.isInteger(phase) || phase < 0) throw new Error(`terrain animation phase must be a non-negative integer: ${phase}`);
  const normalizedPhase = animation ? phase % animation.frames : 0;
  const frameOffset = animation ? animation.phase_stride.map((value) => value * normalizedPhase) : [0, 0];
  const innerCorners = terrainInnerCornerKeys(cells, at);
  if (!innerCorners.length) return { mask, frame, overlays: [], layers: [frame], inner_corners: [], phase: normalizedPhase, frame_offset: frameOffset };
  if (!frames?.inner_corners) throw new Error(`terrain mapping creates unsupported inside corner: ${innerCorners.join('-')}`);
  const cornerMap = frames.inner_corners[polarity] ?? frames.inner_corners;
  if (!cornerMap || typeof cornerMap !== 'object') throw new Error(`terrain mapping has no ${polarity} inside-corner map`);
  if ((frames.inner_corner_mode ?? 'replace') === 'composite') {
    const overlays = innerCorners.map((corner) => {
      const overlay = cornerMap[corner];
      if (!overlay) throw new Error(`terrain mapping has no frame for inside-corner key: ${corner}`);
      return overlay;
    });
    return { mask, frame, overlays, layers: [frame, ...overlays], inner_corners: innerCorners, phase: normalizedPhase, frame_offset: frameOffset };
  }
  const innerKey = innerCorners.join('-');
  const innerFrame = cornerMap[innerKey];
  if (!innerFrame) throw new Error(`terrain mapping has no frame for inside-corner key: ${innerKey}`);
  return { mask, frame: innerFrame, overlays: [], layers: [innerFrame], inner_corners: innerCorners, phase: normalizedPhase, frame_offset: frameOffset };
}
