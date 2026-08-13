import {
  resolveConnectorFrame,
  resolveHeightTransition,
  resolvePrefabLayers,
  resolveTerrainFrame,
  terrainInnerCornerKeys,
} from '../gaming/assets.mjs';
import {
  PRESENTATION_ID,
  assetReference,
  isPair,
  materializePresentationCatalog,
  resolveCatalogFrame,
  validatePresentationCatalog,
} from './catalog.mjs';

const SCENE_FIELDS = new Set(['schema_version', 'kind', 'id', 'catalog', 'style_profile', 'logical_size', 'pixel_scale', 'grid', 'background', 'terrain', 'connectors', 'heights', 'components', 'placements', 'composition', 'review_regions']);
const PLACEMENT_FIELDS = new Set(['id', 'asset', 'frame', 'prefab', 'params', 'at', 'state', 'flip_x', 'rotation', 'opacity', 'role']);
const COMPOSITION_ROLES = new Set(['focal', 'support', 'detail', 'actor', 'reward', 'hazard']);
const SIDES = ['north', 'east', 'south', 'west'];
const PASS = Object.freeze({ terrain: 0, below: 10, shadow: 20, ground: 30, actor: 40, structure: 40, overhead: 60, air: 70, ui: 80 });

function unknownFields(value, fields, prefix, errors) {
  for (const field of Object.keys(value ?? {})) if (!fields.has(field)) errors.push(`${prefix}: unsupported field ${field}`);
}

function deterministicUnit(seed, ...parts) {
  const source = [seed, ...parts].join('|'); let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) { hash ^= source.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x85ebca6b); hash ^= hash >>> 13; hash = Math.imul(hash, 0xc2b2ae35); hash ^= hash >>> 16;
  return (hash >>> 0) / 0x100000000;
}

function lineCells(from, to) {
  let [x, y] = from; const [targetX, targetY] = to; const dx = Math.abs(targetX - x); const sx = x < targetX ? 1 : -1; const dy = -Math.abs(targetY - y); const sy = y < targetY ? 1 : -1; let error = dx + dy; const cells = [];
  while (true) {
    cells.push([x, y]); if (x === targetX && y === targetY) break;
    const twice = 2 * error; if (twice >= dy) { error += dy; x += sx; } if (twice <= dx) { error += dx; y += sy; }
  }
  return cells;
}

function expandShape(shape, prefix, anchors = {}) {
  if (!shape || typeof shape !== 'object' || Array.isArray(shape)) throw new Error(`${prefix}: shape must be a map`);
  const kind = shape.kind; const cells = [];
  if (kind === 'rounded-rect') {
    const unknown = Object.keys(shape).filter((field) => !['kind', 'rect', 'radius'].includes(field)); if (unknown.length) throw new Error(`${prefix}: unsupported fields ${unknown.join(', ')}`);
    const rect = shape.rect; const radius = shape.radius ?? 1;
    if (!Array.isArray(rect) || rect.length !== 4 || rect.some((value) => !Number.isInteger(value) || value < 0) || rect[2] < 1 || rect[3] < 1 || !Number.isInteger(radius) || radius < 0 || radius * 2 > Math.min(rect[2], rect[3])) throw new Error(`${prefix}: rounded-rect needs rect [x, y, width, height] and a fitting non-negative radius`);
    const [left, top, width, height] = rect; const right = left + width - 1; const bottom = top + height - 1;
    for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) {
      const dx = Math.max(left + radius - x, 0, x - (right - radius)); const dy = Math.max(top + radius - y, 0, y - (bottom - radius));
      if (!radius || dx * dx + dy * dy <= radius * radius) cells.push([x, y]);
    }
  } else if (kind === 'ellipse' || kind === 'blob') {
    const allowed = kind === 'blob' ? new Set(['kind', 'center', 'radius', 'roughness', 'seed', 'edge_step']) : new Set(['kind', 'center', 'radius']);
    const unknown = Object.keys(shape).filter((field) => !allowed.has(field)); if (unknown.length) throw new Error(`${prefix}: unsupported fields ${unknown.join(', ')}`);
    if (!isPair(shape.center) || !isPair(shape.radius, { positive: true })) throw new Error(`${prefix}: ${kind} needs non-negative integer center and positive integer radius`);
    const [centerX, centerY] = shape.center; const [radiusX, radiusY] = shape.radius; const roughness = shape.roughness ?? 0.35; const seed = shape.seed ?? 0;
    if (kind === 'blob' && (!Number.isFinite(roughness) || roughness < 0 || roughness > 1 || !Number.isInteger(seed))) throw new Error(`${prefix}: blob roughness must be 0..1 and seed must be an integer`);
    const edgeStep = shape.edge_step;
    if (kind === 'blob' && edgeStep !== undefined && (!Number.isInteger(edgeStep) || edgeStep < 1 || edgeStep > 4)) throw new Error(`${prefix}: blob edge_step must be an integer from 1 to 4`);
    const extents = [];
    for (let y = Math.max(0, centerY - radiusY); y <= centerY + radiusY; y += 1) {
      const vertical = (y - centerY) / radiusY; const baseHalfWidth = radiusX * Math.sqrt(Math.max(0, 1 - vertical * vertical));
      const leftNoise = kind === 'blob' ? (deterministicUnit(seed, 'left', y) - 0.5) * roughness * radiusX : 0; const rightNoise = kind === 'blob' ? (deterministicUnit(seed, 'right', y) - 0.5) * roughness * radiusX : 0;
      const left = Math.max(0, Math.ceil(centerX - Math.max(0, baseHalfWidth + leftNoise))); const right = Math.floor(centerX + Math.max(0, baseHalfWidth + rightNoise));
      extents.push({ y, left, right: Math.max(left, right) });
    }
    if (edgeStep !== undefined) {
      const clampEdge = (value, neighbour) => Math.max(neighbour - edgeStep, Math.min(neighbour + edgeStep, value));
      for (let index = 1; index < extents.length; index += 1) {
        extents[index].left = clampEdge(extents[index].left, extents[index - 1].left);
        extents[index].right = clampEdge(extents[index].right, extents[index - 1].right);
      }
      for (let index = extents.length - 2; index >= 0; index -= 1) {
        extents[index].left = clampEdge(extents[index].left, extents[index + 1].left);
        extents[index].right = clampEdge(extents[index].right, extents[index + 1].right);
      }
    }
    for (const { y, left, right } of extents) for (let x = left; x <= Math.max(left, right); x += 1) cells.push([x, y]);
  } else if (kind === 'route') {
    const unknown = Object.keys(shape).filter((field) => !['kind', 'points', 'width'].includes(field)); if (unknown.length) throw new Error(`${prefix}: unsupported fields ${unknown.join(', ')}`);
    if (!Array.isArray(shape.points) || shape.points.length < 2) throw new Error(`${prefix}: route needs at least two points`);
    const points = shape.points.map((point, index) => {
      if (isPair(point)) return point;
      if (!point || typeof point !== 'object' || Array.isArray(point) || !PRESENTATION_ID.test(String(point.placement ?? '')) || point.offset !== undefined && (!Array.isArray(point.offset) || point.offset.length !== 2 || point.offset.some((value) => !Number.isInteger(value)))) throw new Error(`${prefix}: route point ${index} must be a grid pair or placement reference`);
      const anchor = anchors[point.placement]; if (!anchor) throw new Error(`${prefix}: route point ${index} references unknown placement ${point.placement}`);
      return [anchor[0] + (point.offset?.[0] ?? 0), anchor[1] + (point.offset?.[1] ?? 0)];
    });
    const width = shape.width ?? 1; if (!Number.isInteger(width) || width < 1 || width > 16) throw new Error(`${prefix}: route width must be an integer from 1 to 16`);
    const before = Math.floor((width - 1) / 2); const after = width - before - 1;
    for (let index = 1; index < points.length; index += 1) for (const [x, y] of lineCells(points[index - 1], points[index])) {
      for (let offsetY = -before; offsetY <= after; offsetY += 1) for (let offsetX = -before; offsetX <= after; offsetX += 1) if (x + offsetX >= 0 && y + offsetY >= 0) cells.push([x + offsetX, y + offsetY]);
    }
  } else throw new Error(`${prefix}: unsupported shape kind ${kind}`);
  return cells;
}

function expandCells(region, prefix, anchors = {}) {
  const cells = [];
  for (const at of region.cells ?? []) {
    if (!isPair(at)) throw new Error(`${prefix}: cells must contain non-negative integer pairs`);
    cells.push(at);
  }
  for (const rect of region.rects ?? []) {
    if (!Array.isArray(rect) || rect.length !== 4 || rect.some((value) => !Number.isInteger(value) || value < 0) || rect[2] < 1 || rect[3] < 1) throw new Error(`${prefix}: rects must contain [x, y, width, height]`);
    for (let y = rect[1]; y < rect[1] + rect[3]; y += 1) for (let x = rect[0]; x < rect[0] + rect[2]; x += 1) cells.push([x, y]);
  }
  for (const [index, shape] of (region.shapes ?? []).entries()) cells.push(...expandShape(shape, `${prefix} shape ${index}`, anchors));
  const unique = new Map(cells.map((at) => [at.join(','), at]));
  if (region.exclude !== undefined) {
    if (!region.exclude || typeof region.exclude !== 'object' || Array.isArray(region.exclude) || Object.keys(region.exclude).some((field) => !['cells', 'rects', 'shapes'].includes(field))) throw new Error(`${prefix}: exclude must contain only cells, rects, or shapes`);
    const excluded = new Set(expandCells(region.exclude, `${prefix} exclude`, anchors).map((at) => at.join(',')));
    for (const key of excluded) unique.delete(key);
  }
  if (!unique.size) throw new Error(`${prefix}: needs cells, rects, or shapes`);
  return [...unique.values()];
}

function routeAnchorsFor(scene, catalog = null) {
  const cell = scene?.grid?.cell;
  if (!isPair(cell, { positive: true })) return {};
  return Object.fromEntries((scene?.placements ?? [])
    .filter((placement) => placement.id && isPair(placement.at, { numeric: true }))
    .map((placement) => {
      const world = placement.asset
        ? catalog?.assets?.[placement.asset]?.world
        : catalog?.prefabs?.[placement.prefab]?.world;
      const offset = world?.route_anchor ?? [0, 0];
      return [placement.id, placement.at.map((value, index) => Math.floor((value + offset[index]) / cell[index]))];
    }));
}

function enforceMinimumThickness(cells, minimum, columns, rows, prohibited = new Set()) {
  if (!minimum || minimum <= 1) return cells;
  const set = new Set(cells.map((at) => at.join(',')));
  const center = cells.reduce((sum, [x, y]) => [sum[0] + x / cells.length, sum[1] + y / cells.length], [0, 0]);
  const runs = (axis) => {
    const groups = new Map();
    for (const key of set) {
      const [x, y] = key.split(',').map(Number); const fixed = axis === 'x' ? y : x; const value = axis === 'x' ? x : y;
      if (!groups.has(fixed)) groups.set(fixed, []); groups.get(fixed).push(value);
    }
    const result = [];
    for (const [fixed, values] of groups) {
      values.sort((left, right) => left - right); let start = values[0]; let end = start;
      for (const value of values.slice(1)) {
        if (value === end + 1) end = value;
        else { result.push({ axis, fixed, start, end }); start = value; end = value; }
      }
      result.push({ axis, fixed, start, end });
    }
    return result;
  };
  const candidateFor = (run, side) => {
    const value = side === 'before' ? run.start - 1 : run.end + 1;
    const [x, y] = run.axis === 'x' ? [value, run.fixed] : [run.fixed, value];
    if (x < 0 || y < 0 || x >= columns || y >= rows || prohibited.has(`${x},${y}`)) return null;
    const neighbours = [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]].filter(([nx, ny]) => set.has(`${nx},${ny}`)).length;
    const distance = Math.abs(x - center[0]) + Math.abs(y - center[1]);
    return { x, y, neighbours, distance };
  };
  for (let pass = 0; pass < minimum * 4; pass += 1) {
    let changed = false;
    for (const axis of ['x', 'y']) for (const run of runs(axis)) {
      for (let length = run.end - run.start + 1; length < minimum; length += 1) {
        const candidates = [candidateFor(run, 'before'), candidateFor(run, 'after')].filter((entry) => entry && !set.has(`${entry.x},${entry.y}`));
        if (!candidates.length) throw new Error(`terrain minimum_thickness ${minimum} cannot be satisfied at ${run.axis}:${run.fixed}:${run.start}-${run.end}`);
        candidates.sort((left, right) => right.neighbours - left.neighbours || left.distance - right.distance || left.y - right.y || left.x - right.x);
        const selected = candidates[0]; set.add(`${selected.x},${selected.y}`); changed = true;
        if (run.axis === 'x') { run.start = Math.min(run.start, selected.x); run.end = Math.max(run.end, selected.x); }
        else { run.start = Math.min(run.start, selected.y); run.end = Math.max(run.end, selected.y); }
      }
    }
    if (!changed) break;
  }
  return [...set].map((key) => key.split(',').map(Number));
}

export function validateTopDownScene(scene, catalog = null) {
  const errors = [];
  const routeAnchors = routeAnchorsFor(scene, catalog);
  if (scene?.schema_version !== 2) errors.push('schema_version must be 2');
  if (scene?.kind !== 'top-down-scene') errors.push('kind must be top-down-scene');
  if (!PRESENTATION_ID.test(String(scene?.id ?? ''))) errors.push('id is invalid');
  if (!PRESENTATION_ID.test(String(scene?.catalog ?? ''))) errors.push('catalog is invalid');
  if (!PRESENTATION_ID.test(String(scene?.style_profile ?? ''))) errors.push('style_profile is invalid');
  if (!isPair(scene?.logical_size, { positive: true })) errors.push('logical_size must be a positive pair');
  if (!Number.isInteger(scene?.pixel_scale) || scene.pixel_scale < 1 || scene.pixel_scale > 8) errors.push('pixel_scale must be an integer from 1 to 8');
  if (!isPair(scene?.grid?.cell, { positive: true })) errors.push('grid.cell must be a positive pair');
  unknownFields(scene, SCENE_FIELDS, 'scene', errors);
  if (!PRESENTATION_ID.test(String(scene?.terrain?.base ?? ''))) errors.push('terrain.base material is required');
  for (const [index, region] of (scene?.terrain?.regions ?? []).entries()) {
    unknownFields(region, new Set(['id', 'material', 'cells', 'rects', 'shapes', 'exclude', 'continues', 'minimum_thickness']), `terrain region ${index}`, errors);
    if (!PRESENTATION_ID.test(String(region?.id ?? '')) || !PRESENTATION_ID.test(String(region?.material ?? ''))) errors.push(`terrain region ${index}: id and material are required`);
    if (region.continues !== undefined && (!Array.isArray(region.continues) || region.continues.some((side) => !SIDES.includes(side)))) errors.push(`terrain region ${index}: continues contains an invalid side`);
    if (region.minimum_thickness !== undefined && (!Number.isInteger(region.minimum_thickness) || region.minimum_thickness < 1 || region.minimum_thickness > 4)) errors.push(`terrain region ${index}: minimum_thickness must be an integer from 1 to 4`);
    try { expandCells(region, `terrain region ${region.id ?? index}`, routeAnchors); } catch (error) { errors.push(error.message); }
  }
  for (const [index, placement] of (scene?.placements ?? []).entries()) {
    unknownFields(placement, PLACEMENT_FIELDS, `placement ${index}`, errors);
    if (Boolean(placement?.asset) === Boolean(placement?.prefab)) errors.push(`placement ${index}: needs exactly one asset or prefab`);
    if (!isPair(placement?.at, { numeric: true })) errors.push(`placement ${index}: at must be a non-negative logical pair`);
    if (placement?.rotation !== undefined && ![0, 90, 180, 270].includes(placement.rotation)) errors.push(`placement ${index}: rotation is invalid`);
    if (placement?.opacity !== undefined && (!Number.isFinite(placement.opacity) || placement.opacity < 0 || placement.opacity > 1)) errors.push(`placement ${index}: opacity must be between 0 and 1`);
    if (placement?.role !== undefined && !COMPOSITION_ROLES.has(placement.role)) errors.push(`placement ${index}: role is invalid`);
  }
  if (scene?.composition !== undefined) {
    const composition = scene.composition;
    if (!composition || typeof composition !== 'object' || Array.isArray(composition)) errors.push('composition must be a map');
    else {
      unknownFields(composition, new Set(['seed', 'zones', 'groups']), 'composition', errors);
      if (!Number.isInteger(composition.seed)) errors.push('composition.seed must be an integer');
      if (!composition.zones || typeof composition.zones !== 'object' || Array.isArray(composition.zones) || !Object.keys(composition.zones).length) errors.push('composition.zones must be a non-empty map');
      for (const [zoneId, zone] of Object.entries(composition.zones ?? {})) {
        if (!PRESENTATION_ID.test(zoneId)) errors.push(`composition zone ${zoneId}: invalid id`);
        unknownFields(zone, new Set(['cells', 'rects', 'shapes', 'exclude', 'materials', 'surfaces', 'planes', 'biomes', 'boundary', 'adjacent_materials']), `composition zone ${zoneId}`, errors);
        if (zone.materials !== undefined && (!Array.isArray(zone.materials) || !zone.materials.length || zone.materials.some((entry) => entry !== '*' && !PRESENTATION_ID.test(String(entry))))) errors.push(`composition zone ${zoneId}: materials must contain material ids or *`);
        if (zone.surfaces !== undefined && (!Array.isArray(zone.surfaces) || !zone.surfaces.length || zone.surfaces.some((entry) => !['solid', 'liquid', 'void'].includes(entry)))) errors.push(`composition zone ${zoneId}: surfaces are invalid`);
        if (zone.planes !== undefined && (!Array.isArray(zone.planes) || !zone.planes.length || zone.planes.some((entry) => !PRESENTATION_ID.test(String(entry))))) errors.push(`composition zone ${zoneId}: planes must contain plane ids`);
        if (zone.biomes !== undefined && (!Array.isArray(zone.biomes) || !zone.biomes.length || zone.biomes.some((entry) => entry !== '*' && !PRESENTATION_ID.test(String(entry))))) errors.push(`composition zone ${zoneId}: biomes must contain biome ids or *`);
        if (zone.boundary !== undefined && typeof zone.boundary !== 'boolean') errors.push(`composition zone ${zoneId}: boundary must be boolean`);
        if (zone.adjacent_materials !== undefined && (!Array.isArray(zone.adjacent_materials) || !zone.adjacent_materials.length || zone.adjacent_materials.some((entry) => !PRESENTATION_ID.test(String(entry))))) errors.push(`composition zone ${zoneId}: adjacent_materials must contain material ids`);
        try { expandCells(zone, `composition zone ${zoneId}`); } catch (error) { errors.push(error.message); }
      }
      if (!Array.isArray(composition.groups) || !composition.groups.length) errors.push('composition.groups must be a non-empty array');
      const groupIds = new Set();
      for (const [index, group] of (composition.groups ?? []).entries()) {
        const prefix = `composition group ${index}`; unknownFields(group, new Set(['id', 'role', 'zone', 'layout', 'count', 'minimum_distance', 'anchor', 'overlap', 'visual_fit', 'candidates']), prefix, errors);
        if (!PRESENTATION_ID.test(String(group?.id ?? '')) || groupIds.has(group?.id)) errors.push(`${prefix}: id must be unique and valid`); else groupIds.add(group.id);
        if (!COMPOSITION_ROLES.has(group?.role)) errors.push(`${prefix}: role is invalid`);
        if (!PRESENTATION_ID.test(String(group?.zone ?? '')) || !composition.zones?.[group.zone]) errors.push(`${prefix}: zone is unknown`);
        if (!['center', 'cluster', 'scatter', 'grid'].includes(group?.layout)) errors.push(`${prefix}: layout must be center, cluster, scatter, or grid`);
        if (!Number.isInteger(group?.count) || group.count < 1 || group.count > 256) errors.push(`${prefix}: count must be an integer from 1 to 256`);
        if (group.minimum_distance !== undefined && (!Number.isFinite(group.minimum_distance) || group.minimum_distance < 0)) errors.push(`${prefix}: minimum_distance must be non-negative`);
        if (group.anchor !== undefined && !isPair(group.anchor)) errors.push(`${prefix}: anchor must be a non-negative grid-cell pair`);
        if (group.overlap !== undefined && !['forbid', 'allow'].includes(group.overlap)) errors.push(`${prefix}: overlap must be forbid or allow`);
        if (group.visual_fit !== undefined && !['zone', 'anchor'].includes(group.visual_fit)) errors.push(`${prefix}: visual_fit must be zone or anchor`);
        if (!Array.isArray(group.candidates) || !group.candidates.length) errors.push(`${prefix}: candidates must be a non-empty array`);
        for (const [candidateIndex, candidate] of (group.candidates ?? []).entries()) {
          const candidatePrefix = `${prefix} candidate ${candidateIndex}`; unknownFields(candidate, new Set(['asset', 'frame', 'frames', 'prefab', 'params', 'flip_x', 'rotation', 'opacity', 'weight']), candidatePrefix, errors);
          if (Boolean(candidate?.asset) === Boolean(candidate?.prefab)) errors.push(`${candidatePrefix}: needs exactly one asset or prefab`);
          if (candidate.frame !== undefined && candidate.frames !== undefined) errors.push(`${candidatePrefix}: frame and frames are mutually exclusive`);
          if (candidate.frames !== undefined && (!Array.isArray(candidate.frames) || !candidate.frames.length || candidate.frames.some((frame) => !PRESENTATION_ID.test(String(frame)))) ) errors.push(`${candidatePrefix}: frames must be a non-empty array of frame ids`);
          if (candidate.weight !== undefined && (!Number.isInteger(candidate.weight) || candidate.weight < 1 || candidate.weight > 100)) errors.push(`${candidatePrefix}: weight must be an integer from 1 to 100`);
          if (candidate.rotation !== undefined && ![0, 90, 180, 270].includes(candidate.rotation)) errors.push(`${candidatePrefix}: rotation is invalid`);
          if (candidate.opacity !== undefined && (!Number.isFinite(candidate.opacity) || candidate.opacity < 0 || candidate.opacity > 1)) errors.push(`${candidatePrefix}: opacity must be between 0 and 1`);
        }
      }
    }
  }
  if (catalog) {
    const catalogResult = validatePresentationCatalog(catalog);
    errors.push(...catalogResult.errors.map((error) => `catalog: ${error}`));
    if (scene?.catalog !== catalog?.pack?.id) errors.push(`scene catalog ${scene?.catalog} does not match ${catalog?.pack?.id}`);
    if (!catalog?.style_profiles?.[scene?.style_profile]) errors.push(`scene style_profile is unknown: ${scene?.style_profile}`);
    if (!catalog?.materials?.[scene?.terrain?.base]) errors.push(`scene base material is unknown: ${scene?.terrain?.base}`);
    else if (catalog.materials[scene.terrain.base].fill_mode === 'overlay') errors.push(`scene base material cannot use overlay fill_mode: ${scene.terrain.base}`);
    for (const region of scene?.terrain?.regions ?? []) if (catalog.materials?.[region.material]?.fill_mode === 'overlay') errors.push(`terrain region ${region.id}: material cannot use overlay fill_mode: ${region.material}`);
  }
  return { valid: errors.length === 0, errors };
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function hashDrawPlan(plan) {
  const source = stable({ ...plan, hash: undefined });
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function frameMetrics(asset, frame) {
  const density = asset.pixel_density;
  const size = frame.rect ? frame.rect.slice(2) : asset.geometry.cell;
  return { source_size: size, logical_size: size.map((value) => value / density) };
}

function logicalVisibleBounds(asset, frame, at, { rotation = 0, flip_x: flipX = false } = {}) {
  const density = asset.pixel_density; const metrics = frameMetrics(asset, frame); const [frameWidth, frameHeight] = metrics.logical_size;
  const anchor = frame.anchor ?? asset.defaults?.anchor ?? 'top-left';
  const named = { 'top-left': [0, 0], 'top-center': [frameWidth / 2, 0], 'top-right': [frameWidth, 0], 'center-left': [0, frameHeight / 2], center: [frameWidth / 2, frameHeight / 2], 'center-right': [frameWidth, frameHeight / 2], 'bottom-left': [0, frameHeight], 'bottom-center': [frameWidth / 2, frameHeight], 'bottom-right': [frameWidth, frameHeight] };
  const [anchorX, anchorY] = Array.isArray(anchor?.point) ? anchor.point.map((value) => value / density) : named[anchor];
  const content = frame.content_bounds ?? [0, 0, metrics.source_size[0], metrics.source_size[1]]; const left = content[0] / density - anchorX; const top = content[1] / density - anchorY; const right = left + content[2] / density; const bottom = top + content[3] / density;
  const radians = rotation * Math.PI / 180; const cosine = Math.cos(radians); const sine = Math.sin(radians);
  const corners = [[left, top], [right, top], [right, bottom], [left, bottom]].map(([x, y]) => {
    const flippedX = flipX ? -x : x; return [at[0] + flippedX * cosine - y * sine, at[1] + flippedX * sine + y * cosine];
  });
  const xs = corners.map(([x]) => x); const ys = corners.map(([, y]) => y); const minX = Math.min(...xs); const minY = Math.min(...ys); const maxX = Math.max(...xs); const maxY = Math.max(...ys);
  return [minX, minY, maxX - minX, maxY - minY];
}

function inferredCompositionRole(asset) {
  const tags = new Set(asset?.tags ?? []); const scaleClass = asset?.world?.scale_class;
  if (tags.has('hazard') || tags.has('enemy') || tags.has('obstacle')) return 'hazard';
  if (tags.has('reward') || scaleClass === 'item') return 'reward';
  if (tags.has('actor') || ['humanoid', 'creature'].includes(scaleClass)) return 'actor';
  if (tags.has('landmark') || ['building', 'building-small'].includes(scaleClass)) return 'focal';
  if (['foliage', 'prop'].includes(scaleClass)) return 'detail';
  return 'support';
}

function interfaceFor(catalog, inside, outside) {
  const matches = Object.entries(catalog.terrain_interfaces ?? {}).filter(([, entry]) => entry.inside === inside && entry.outside === outside);
  if (matches.length !== 1) throw new Error(`material boundary ${inside} -> ${outside} needs exactly one terrain interface; found ${matches.length}`);
  return { id: matches[0][0], ...matches[0][1] };
}

function variantRoot(catalog, assetId) {
  const visited = new Set(); let current = assetId;
  while (catalog.assets[current]?.variant_of) {
    if (visited.has(current)) throw new Error(`materialized asset variant cycle at ${current}`);
    visited.add(current); current = catalog.assets[current].variant_of;
  }
  return current;
}

function compatibleInterfaces(catalog, inside, outsideMaterials) {
  const profiles = [...outsideMaterials].map((outside) => interfaceFor(catalog, inside, outside));
  const signatures = new Set(profiles.map((profile) => `${profile.asset}|${profile.polarity}`));
  if (signatures.size === 1) return profiles;
  const polarities = new Set(profiles.map((profile) => profile.polarity));
  const assetIds = profiles.map((profile) => assetReference(profile.asset).asset);
  const roots = new Set(assetIds.map((assetId) => variantRoot(catalog, assetId)));
  const topology = assetIds.map((assetId) => {
    const asset = catalog.assets[assetId];
    return JSON.stringify({ pixel_density: asset.pixel_density, geometry: asset.geometry, frames: asset.frames, autotile: asset.autotile });
  });
  if (polarities.size !== 1 || roots.size !== 1 || new Set(topology).size !== 1) throw new Error(`material boundary ${inside} has incompatible interface assets at a multi-material join: ${profiles.map((profile) => profile.id).join(', ')}`);
  return profiles;
}

function interfaceClip(contact, [width, height]) {
  const center = [width / 2, height / 2];
  const clips = {
    north: [[0, 0], [width, 0], center],
    east: [[width, 0], [width, height], center],
    south: [[width, height], [0, height], center],
    west: [[0, height], [0, 0], center],
    nw: [[0, 0], [width / 2, 0], center, [0, height / 2]],
    ne: [[width / 2, 0], [width, 0], [width, height / 2], center],
    se: [center, [width, height / 2], [width, height], [width / 2, height]],
    sw: [[0, height / 2], center, [width / 2, height], [0, height]],
  };
  return clips[contact];
}

function commandForFrame(catalog, reference, at, extra = {}) {
  const resolved = resolveCatalogFrame(catalog, reference, extra.frame);
  const metrics = frameMetrics(resolved.asset, resolved.frame);
  return {
    type: 'sprite',
    asset: resolved.assetId,
    frame: resolved.frameId,
    at,
    source_cell_offset: extra.source_cell_offset ?? [0, 0],
    flip_x: extra.flip_x ?? false,
    rotation: extra.rotation ?? 0,
    opacity: extra.opacity ?? 1,
    render_layer: extra.render_layer ?? 'ground',
    sort_y: extra.sort_y ?? at[1],
    source_size: metrics.source_size,
    logical_size: metrics.logical_size,
    provenance: extra.provenance,
    semantic_role: extra.semantic_role,
    clip_polygon: extra.clip_polygon,
  };
}

function commandForColor(color, at, size, provenance) {
  return { type: 'fill', color, at, size, opacity: 1, render_layer: 'terrain', sort_y: -1, provenance };
}

function footprintCells(world, at, cell, columns, rows) {
  const offset = world.footprint.offset ?? [-world.footprint.size[0] / 2, -world.footprint.size[1]];
  const left = at[0] + offset[0]; const top = at[1] + offset[1];
  const right = left + world.footprint.size[0]; const bottom = top + world.footprint.size[1];
  const cells = [];
  for (let y = Math.floor(top / cell[1]); y <= Math.floor((bottom - 0.0001) / cell[1]); y += 1) for (let x = Math.floor(left / cell[0]); x <= Math.floor((right - 0.0001) / cell[0]); x += 1) {
    if (x >= 0 && y >= 0 && x < columns && y < rows) cells.push([x, y]);
  }
  return { bounds: [left, top, right - left, bottom - top], cells };
}

/** Compile declarative top-down YAML into the renderer-neutral immutable plan. */
export function compileTopDownScene(authoredCatalog, scene) {
  const catalog = materializePresentationCatalog(authoredCatalog);
  const validation = validateTopDownScene(scene, catalog);
  if (!validation.valid) throw new Error(`presentation scene is invalid:\n- ${validation.errors.join('\n- ')}`);
  const [width, height] = scene.logical_size; const cell = scene.grid.cell;
  if (width % cell[0] || height % cell[1]) throw new Error('logical_size must be divisible by grid.cell');
  const columns = width / cell[0]; const rows = height / cell[1];
  const materialGrid = Array.from({ length: rows }, () => Array(columns).fill(scene.terrain.base));
  const routeAnchors = routeAnchorsFor(scene, catalog);
  const regionByCell = new Map();
  const cellsByRegion = new Map();
  for (const region of scene.terrain.regions ?? []) {
    if (!catalog.materials[region.material]) throw new Error(`terrain region ${region.id}: unknown material ${region.material}`);
    const expanded = expandCells(region, `terrain region ${region.id}`, routeAnchors);
    let cells = expanded.filter(([x, y]) => {
      const allowedOverflow = (x < columns || region.continues?.includes('east')) && (y < rows || region.continues?.includes('south'));
      if ((x >= columns || y >= rows) && !allowedOverflow) throw new Error(`terrain region ${region.id}: cell ${x},${y} exceeds viewport`);
      return x < columns && y < rows;
    });
    if (region.minimum_thickness > 1) {
      const prohibited = new Set(region.exclude ? expandCells(region.exclude, `terrain region ${region.id} exclude`, routeAnchors).map((at) => at.join(',')) : []);
      cells = enforceMinimumThickness(cells, region.minimum_thickness, columns, rows, prohibited);
    }
    if (!cells.length) throw new Error(`terrain region ${region.id}: has no cells inside viewport`);
    cellsByRegion.set(region.id, cells);
    for (const [x, y] of cells) {
      if (regionByCell.has(`${x},${y}`)) throw new Error(`terrain regions overlap at ${x},${y}: ${regionByCell.get(`${x},${y}`).id} and ${region.id}`);
      materialGrid[y][x] = region.material; regionByCell.set(`${x},${y}`, region);
    }
  }

  const commands = []; const diagnostics = { boundaries: {}, terrain_frames: {}, footprints: [], shadows: 0, overlaps: [], warnings: [], inside_corners_resolved: 0, connections: 0 };
  const base = catalog.materials[scene.terrain.base];
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < columns; x += 1) {
    if (base.fill.asset) commands.push(commandForFrame(catalog, `${base.fill.asset}#${base.fill.frame ?? 'default'}`, [x * cell[0], y * cell[1]], { render_layer: 'terrain', sort_y: -1, provenance: `material:${scene.terrain.base}` }));
    else commands.push(commandForColor(base.fill.color, [x * cell[0], y * cell[1]], cell, `material:${scene.terrain.base}`));
  }
  for (const region of scene.terrain.regions ?? []) {
    const cells = cellsByRegion.get(region.id); const cellSet = new Set(cells.map((at) => at.join(',')));
    const continued = new Set(cellSet); const touched = new Set();
    for (const [x, y] of cells) {
      if (region.continues?.includes('north') && y === 0) { continued.add(`${x},-1`); touched.add('north'); }
      if (region.continues?.includes('east') && x === columns - 1) { continued.add(`${columns},${y}`); touched.add('east'); }
      if (region.continues?.includes('south') && y === rows - 1) { continued.add(`${x},${rows}`); touched.add('south'); }
      if (region.continues?.includes('west') && x === 0) { continued.add(`-1,${y}`); touched.add('west'); }
    }
    if (region.continues?.includes('north') && region.continues.includes('west') && cellSet.has('0,0')) continued.add('-1,-1');
    if (region.continues?.includes('north') && region.continues.includes('east') && cellSet.has(`${columns - 1},0`)) continued.add(`${columns},-1`);
    if (region.continues?.includes('south') && region.continues.includes('west') && cellSet.has(`0,${rows - 1}`)) continued.add(`-1,${rows}`);
    if (region.continues?.includes('south') && region.continues.includes('east') && cellSet.has(`${columns - 1},${rows - 1}`)) continued.add(`${columns},${rows}`);
    const missed = (region.continues ?? []).filter((side) => !touched.has(side));
    if (missed.length) throw new Error(`terrain region ${region.id}: continues declares untouched edges ${missed.join(', ')}`);
    for (const [x, y] of cells) {
      const contacts = [];
      for (const [direction, nx, ny] of [['north', x, y - 1], ['east', x + 1, y], ['south', x, y + 1], ['west', x - 1, y]]) {
        if (nx >= 0 && ny >= 0 && nx < columns && ny < rows && materialGrid[ny][nx] !== region.material) contacts.push({ material: materialGrid[ny][nx], contact: direction });
      }
      const innerCornerDiagonals = { nw: [-1, -1], ne: [1, -1], se: [1, 1], sw: [-1, 1] };
      for (const corner of terrainInnerCornerKeys(continued, [x, y])) {
        const [offsetX, offsetY] = innerCornerDiagonals[corner]; const [nx, ny] = [x + offsetX, y + offsetY];
        if (nx >= 0 && ny >= 0 && nx < columns && ny < rows && materialGrid[ny][nx] !== region.material) contacts.push({ material: materialGrid[ny][nx], contact: corner });
      }
      const outsideMaterials = new Set(contacts.map(({ material }) => material));
      if (!outsideMaterials.size) {
        const material = catalog.materials[region.material];
        if (material.fill.asset) commands.push(commandForFrame(catalog, `${material.fill.asset}#${material.fill.frame ?? 'default'}`, [x * cell[0], y * cell[1]], { render_layer: 'terrain', sort_y: -1, provenance: `material:${region.material}` }));
        else commands.push(commandForColor(material.fill.color, [x * cell[0], y * cell[1]], cell, `material:${region.material}`));
        continue;
      }
      const profiles = compatibleInterfaces(catalog, region.material, outsideMaterials); const profile = profiles[0];
      const asset = catalog.assets[assetReference(profile.asset).asset];
      const resolved = resolveTerrainFrame({ cells: continued, at: [x, y], frames: asset.autotile, polarity: profile.polarity });
      diagnostics.inside_corners_resolved += resolved.inner_corners.length;
      for (const matched of profiles) diagnostics.boundaries[matched.id] = (diagnostics.boundaries[matched.id] ?? 0) + 1;
      for (const [profileIndex, matched] of profiles.entries()) {
        const clips = profileIndex === 0 ? [undefined] : contacts.filter(({ material }) => material === matched.outside).map(({ contact }) => interfaceClip(contact, cell));
        for (const clipPolygon of clips) for (const frame of resolved.layers) {
          const assetId = assetReference(matched.asset).asset;
          diagnostics.terrain_frames[`${assetId}#${frame}`] = (diagnostics.terrain_frames[`${assetId}#${frame}`] ?? 0) + 1;
          commands.push(commandForFrame(catalog, matched.asset, [x * cell[0], y * cell[1]], { frame, source_cell_offset: resolved.frame_offset, clip_polygon: clipPolygon, render_layer: 'terrain', sort_y: -1, provenance: `interface:${matched.id}` }));
        }
      }
    }
  }

  for (const [materialId, material] of Object.entries(catalog.materials)) for (const [detailIndex, detail] of (material.details ?? []).entries()) {
    const profile = catalog.component_profiles[detail.profile]; const asset = catalog.assets[assetReference(profile.asset).asset]; const component = asset.components[profile.component];
    for (let y = 0; y < rows; y += 1) for (let x = 0; x < columns; x += 1) {
      if (materialGrid[y][x] !== materialId || deterministicUnit(detail.seed ?? 0, materialId, detailIndex, x, y) >= detail.density) continue;
      if (detail.interior_only && [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]].some(([nx, ny]) => nx < 0 || ny < 0 || nx >= columns || ny >= rows || materialGrid[ny][nx] !== materialId)) continue;
      const frame = [...component.frames].sort((left, right) => deterministicUnit(detail.seed ?? 0, materialId, detailIndex, x, y, left) - deterministicUnit(detail.seed ?? 0, materialId, detailIndex, x, y, right) || left.localeCompare(right))[0];
      commands.push(commandForFrame(catalog, profile.asset, [x * cell[0], y * cell[1]], { frame, opacity: profile.opacity, render_layer: profile.render_layer ?? 'ground', provenance: `material-detail:${materialId}:${detailIndex}` }));
    }
  }

  const connectorOccupiedBounds = [];
  for (const region of scene.connectors ?? []) {
    const profile = catalog.connector_profiles?.[region.profile]; const assetId = assetReference(profile?.asset).asset; const asset = catalog.assets?.[assetId];
    if (!profile || !asset?.connector) throw new Error(`connector ${region.id}: unknown profile ${region.profile}`);
    const cells = expandCells(region, `connector ${region.id}`); const set = new Set(cells.map((at) => at.join(','))); const origin = region.origin ?? [0, 0];
    for (const [x, y] of cells) connectorOccupiedBounds.push({ id: region.id, bounds: [origin[0] + x * cell[0], origin[1] + y * cell[1], cell[0], cell[1]] });
    diagnostics.connections += cells.reduce((count, [x, y]) => count + Number(set.has(`${x + 1},${y}`)) + Number(set.has(`${x},${y + 1}`)), 0);
    for (const [x, y] of cells) {
      const directions = [['n', x, y - 1], ['e', x + 1, y], ['s', x, y + 1], ['w', x - 1, y]].filter(([, nx, ny]) => set.has(`${nx},${ny}`)).map(([side]) => side);
      const resolved = resolveConnectorFrame(asset, directions);
      commands.push(commandForFrame(catalog, profile.asset, [origin[0] + x * cell[0], origin[1] + y * cell[1]], { frame: resolved.frame, rotation: resolved.rotation, render_layer: profile.render_layer ?? 'ground', provenance: `connector:${region.id}` }));
    }
  }

  const elevationGrid = Array.from({ length: rows }, () => Array(columns).fill(0));
  for (const region of scene.heights ?? []) {
    const profile = catalog.height_interfaces?.[region.profile]; const assetId = assetReference(profile?.asset).asset; const asset = catalog.assets?.[assetId];
    if (!profile || !asset?.height) throw new Error(`height ${region.id}: unknown profile ${region.profile}`);
    const transition = resolveHeightTransition(asset, region.direction ?? 'north'); const origin = region.origin ?? [0, 0];
    const fromElevation = region.from_elevation ?? 0; const toElevation = region.to_elevation ?? 1;
    if (![fromElevation, toElevation].every(Number.isInteger) || fromElevation === toElevation) throw new Error(`height ${region.id}: from_elevation and to_elevation must be distinct integers`);
    const originCell = origin.map((value, index) => Math.floor(value / cell[index]));
    for (let y = 0; y < rows; y += 1) for (let x = 0; x < columns; x += 1) {
      const inSpan = region.direction === 'east' || region.direction === 'west' ? y >= originCell[1] && y < originCell[1] + region.width : x >= originCell[0] && x < originCell[0] + region.width;
      const elevated = region.direction === 'north' ? y < originCell[1] : region.direction === 'south' ? y >= originCell[1] : region.direction === 'west' ? x < originCell[0] : x >= originCell[0];
      if (inSpan && elevated) elevationGrid[y][x] = toElevation;
    }
    for (const [bandIndex, band] of transition.bands.entries()) for (let column = 0; column < region.width; column += 1) {
      commands.push(commandForFrame(catalog, profile.asset, [origin[0] + column * cell[0], origin[1] + bandIndex * cell[1]], { frame: band.frames[column === 0 ? 0 : column === region.width - 1 ? 2 : 1], render_layer: profile.render_layer ?? 'ground', provenance: `height:${region.id}` }));
    }
  }

  const providedSurfaces = new Map();
  for (const region of scene.components ?? []) {
    const profile = catalog.component_profiles?.[region.profile]; const assetId = assetReference(profile?.asset).asset; const asset = catalog.assets?.[assetId]; const component = asset?.components?.[profile?.component];
    if (!profile || !component) throw new Error(`component ${region.id}: unknown profile ${region.profile}`);
    const cells = expandCells(region, `component ${region.id}`).sort((left, right) => left[1] - right[1] || left[0] - right[0]); const set = new Set(cells.map((at) => at.join(','))); const origin = region.origin ?? [0, 0]; const selectedFrames = new Map();
    for (const [x, y] of cells) {
      const worldX = Math.floor(origin[0] / cell[0]) + x; const worldY = Math.floor(origin[1] / cell[1]) + y;
      if (worldX < 0 || worldY < 0 || worldX >= columns || worldY >= rows) throw new Error(`component ${region.id}: cell ${x},${y} leaves viewport`);
      const surface = catalog.materials[materialGrid[worldY][worldX]].surface;
      if (!profile.allowed_surfaces.includes(surface)) throw new Error(`component ${region.id}: ${profile.component} is forbidden on ${surface} surface at ${worldX},${worldY}`);
      if (profile.interior_only) {
        const material = materialGrid[worldY][worldX];
        const touchesBoundary = [[worldX, worldY - 1], [worldX + 1, worldY], [worldX, worldY + 1], [worldX - 1, worldY]].some(([nx, ny]) => nx < 0 || ny < 0 || nx >= columns || ny >= rows || materialGrid[ny][nx] !== material);
        if (touchesBoundary) throw new Error(`component ${region.id}: ${profile.component} requires an interior ${material} cell at ${worldX},${worldY}`);
      }
      if (profile.provides_surface) providedSurfaces.set(`${worldX},${worldY}`, profile.provides_surface);
      let frame;
      if (component.outline) {
        const missing = { n: !set.has(`${x},${y - 1}`), e: !set.has(`${x + 1},${y}`), s: !set.has(`${x},${y + 1}`), w: !set.has(`${x - 1},${y}`) };
        const key = missing.n && missing.w ? 'nw' : missing.n && missing.e ? 'ne' : missing.s && missing.w ? 'sw' : missing.s && missing.e ? 'se' : missing.n ? 'n' : missing.s ? 's' : missing.w ? 'w' : missing.e ? 'e' : null;
        if (!key && !component.interior) continue; frame = key ? component.outline[key] : component.interior;
      } else {
        const neighbours = [[x - 1, y], [x, y - 1]].map((at) => selectedFrames.get(at.join(','))).filter(Boolean);
        frame = [...component.frames].sort((left, right) => {
          const adjacency = neighbours.filter((candidate) => candidate === left).length - neighbours.filter((candidate) => candidate === right).length;
          return adjacency || deterministicUnit(region.id, x, y, left) - deterministicUnit(region.id, x, y, right) || left.localeCompare(right);
        })[0];
      }
      selectedFrames.set(`${x},${y}`, frame);
      commands.push(commandForFrame(catalog, profile.asset, [origin[0] + x * cell[0], origin[1] + y * cell[1]], { frame, opacity: profile.opacity, render_layer: profile.render_layer ?? 'ground', provenance: `component:${region.id}` }));
    }
  }

  const collisionBounds = []; const blockedCells = new Set(); const occupiedPlacementCells = new Set(); const placementVisualBounds = [];
  const structuralVisualBounds = commands.filter((command) => /^(connector|height|component):/.test(command.provenance ?? '')).map((command) => {
    const asset = catalog.assets[command.asset]; return logicalVisibleBounds(asset, asset.frames[command.frame], command.at, command);
  });
  const boundsOverlap = (left, right) => left[0] < right[0] + right[2] && left[0] + left[2] > right[0] && left[1] < right[1] + right[3] && left[1] + left[3] > right[1];
  const validateFootprint = ({ id, world, at, collisionGroup }) => {
    const footprint = footprintCells(world, at, cell, columns, rows);
    if (!footprint.cells.length || footprint.bounds[0] < 0 || footprint.bounds[1] < 0 || footprint.bounds[0] + footprint.bounds[2] > width || footprint.bounds[1] + footprint.bounds[3] > height) throw new Error(`placement ${id}: footprint leaves viewport`);
    const occupiedMaterials = new Set(footprint.cells.map(([x, y]) => materialGrid[y][x])); const allowed = world.allowed_materials ?? ['*'];
    const connector = connectorOccupiedBounds.find((entry) => boundsOverlap(footprint.bounds, entry.bounds));
    if (connector) throw new Error(`placement ${id}: footprint intersects connector ${connector.id}`);
    if (!allowed.includes('*') && [...occupiedMaterials].some((material) => !allowed.includes(material))) throw new Error(`placement ${id}: footprint uses forbidden material ${[...occupiedMaterials].join(', ')}`);
    const occupiedSurfaces = new Set(footprint.cells.map(([x, y]) => providedSurfaces.get(`${x},${y}`) ?? catalog.materials[materialGrid[y][x]].surface)); const occupiedPlanes = new Set([...occupiedMaterials].map((material) => catalog.materials[material].plane)); const occupiedBiomes = new Set([...occupiedMaterials].map((material) => catalog.materials[material].biome));
    if ([...occupiedSurfaces].some((surface) => !world.allowed_surfaces?.includes(surface))) throw new Error(`placement ${id}: footprint uses forbidden surface ${[...occupiedSurfaces].join(', ')}`);
    if ([...occupiedPlanes].some((plane) => !world.allowed_planes?.includes(plane))) throw new Error(`placement ${id}: footprint uses forbidden plane ${[...occupiedPlanes].join(', ')}`);
    if (!world.allowed_biomes?.includes('*') && [...occupiedBiomes].some((biome) => !world.allowed_biomes?.includes(biome))) throw new Error(`placement ${id}: footprint uses forbidden biome ${[...occupiedBiomes].join(', ')}`);
    const touchedBoundary = footprint.cells.some(([x, y]) => [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]].some(([nx, ny]) => nx >= 0 && ny >= 0 && nx < columns && ny < rows && materialGrid[ny][nx] !== materialGrid[y][x]));
    if (world.boundary_policy === 'forbid' && touchedBoundary) throw new Error(`placement ${id}: footprint crosses a material boundary`);
    if (world.boundary_policy === 'require' && !touchedBoundary) throw new Error(`placement ${id}: requires a material boundary`);
    if (world.collision === 'solid') for (const existing of collisionBounds) {
      const overlaps = footprint.bounds[0] < existing.bounds[0] + existing.bounds[2] && footprint.bounds[0] + footprint.bounds[2] > existing.bounds[0] && footprint.bounds[1] < existing.bounds[1] + existing.bounds[3] && footprint.bounds[1] + footprint.bounds[3] > existing.bounds[1];
      if (overlaps && existing.group !== collisionGroup) throw new Error(`solid placement overlap: ${id} and ${existing.id}`);
    }
    if (world.collision === 'solid') {
      collisionBounds.push({ id, bounds: footprint.bounds, group: collisionGroup });
      for (const [x, y] of footprint.cells) blockedCells.add(`${x},${y}`);
    }
    for (const [x, y] of footprint.cells) occupiedPlacementCells.add(`${x},${y}`);
    if (world.provides_surface) for (const [x, y] of footprint.cells) providedSurfaces.set(`${x},${y}`, world.provides_surface);
    diagnostics.footprints.push({ placement: id, bounds: footprint.bounds, materials: [...occupiedMaterials].sort(), surfaces: [...occupiedSurfaces].sort(), boundary: touchedBoundary });
    return footprint;
  };
  const expandPlacement = (placement, parentAt = [0, 0], stack = [], collisionGroup = null, inheritedRole = null, inheritedProvenance = null) => {
    const at = [parentAt[0] + placement.at[0], parentAt[1] + placement.at[1]];
    if (placement.prefab) {
      if (stack.includes(placement.prefab)) throw new Error(`prefab cycle: ${[...stack, placement.prefab].join(' -> ')}`);
      const { prefab, layers } = resolvePrefabLayers(catalog, placement.prefab, placement.params ?? {}); const group = collisionGroup ?? `prefab:${placement.id ?? placement.prefab}@${at.join(',')}`; const role = placement.role ?? inheritedRole ?? 'support'; const provenance = inheritedProvenance ?? placement.id ?? placement.prefab;
      validateFootprint({ id: placement.id ?? placement.prefab, world: prefab.world, at, collisionGroup: group });
      for (const layer of layers) expandPlacement({ ...layer, at: layer.at ?? layer.offset ?? [0, 0] }, at, [...stack, placement.prefab], group, role, provenance);
      return;
    }
    const reference = placement.frame ? `${placement.asset}#${placement.frame}` : placement.asset; const { assetId, asset, frameId } = resolveCatalogFrame(catalog, reference);
    if (!asset.world) throw new Error(`placement ${placement.id ?? assetId}: asset lacks world metadata`);
    const role = placement.role ?? inheritedRole ?? inferredCompositionRole(asset); const provenance = inheritedProvenance ?? placement.id ?? assetId;
    const visible = logicalVisibleBounds(asset, asset.frames[frameId], at, placement);
    if (visible[0] < -0.0001 || visible[1] < -0.0001 || visible[0] + visible[2] > width + 0.0001 || visible[1] + visible[3] > height + 0.0001) throw new Error(`placement ${placement.id ?? assetId}: visible content leaves viewport`);
    validateFootprint({ id: placement.id ?? `${assetId}#${frameId}`, world: asset.world, at, collisionGroup });
    placementVisualBounds.push(visible);
    if (asset.world.shadow_profile) {
      const shadow = catalog.shadow_profiles[asset.world.shadow_profile]; diagnostics.shadows += 1;
      commands.push({ type: 'shadow', at: [at[0] + (shadow.offset?.[0] ?? 0), at[1] + (shadow.offset?.[1] ?? 0)], size: shadow.size, color: shadow.color ?? '#000000', opacity: shadow.opacity ?? 0.25, render_layer: 'shadow', sort_y: at[1] - 0.01, provenance: `shadow:${provenance}`, semantic_role: role });
    }
    commands.push(commandForFrame(catalog, reference, at, { flip_x: placement.flip_x, rotation: placement.rotation, opacity: placement.opacity, render_layer: asset.world.render_layer, sort_y: at[1] + (asset.world.sort_offset ?? 0), provenance: `placement:${provenance}`, semantic_role: role }));
  };
  for (const [index, placement] of (scene.placements ?? []).entries()) expandPlacement({ ...placement, id: placement.id ?? `authored.${index + 1}` });

  diagnostics.generated_groups = [];
  if (scene.composition) {
    const candidateParts = (candidate, at, stack = []) => {
      if (candidate.asset) {
        const reference = candidate.frame ? `${candidate.asset}#${candidate.frame}` : candidate.asset; const { asset, frame } = resolveCatalogFrame(catalog, reference);
        return [{ world: asset.world, visible: logicalVisibleBounds(asset, frame, at, candidate), at }];
      }
      if (stack.includes(candidate.prefab)) throw new Error(`prefab cycle: ${[...stack, candidate.prefab].join(' -> ')}`);
      const prefab = catalog.prefabs[candidate.prefab]; if (!prefab) throw new Error(`composition candidate references unknown prefab ${candidate.prefab}`);
      const { layers } = resolvePrefabLayers(catalog, candidate.prefab, candidate.params ?? {}); const parts = [{ world: prefab.world, visible: null, at }];
      for (const layer of layers) {
        const offset = layer.at ?? layer.offset ?? [0, 0]; const layerAt = [at[0] + offset[0], at[1] + offset[1]];
        parts.push(...candidateParts({ ...layer, at: undefined, offset: undefined }, layerAt, [...stack, candidate.prefab]));
      }
      return parts;
    };
    const canPlace = (candidate, at, overlapPolicy, visualFit, zoneCellKeys) => {
      const parts = candidateParts(candidate, at);
      for (const { world, visible, at: partAt } of parts) {
        const footprint = footprintCells(world, partAt, cell, columns, rows);
        if (!footprint.cells.length || footprint.bounds[0] < 0 || footprint.bounds[1] < 0 || footprint.bounds[0] + footprint.bounds[2] > width || footprint.bounds[1] + footprint.bounds[3] > height) return false;
        if (footprint.cells.some(([x, y]) => occupiedPlacementCells.has(`${x},${y}`))) return false;
        if (connectorOccupiedBounds.some((entry) => boundsOverlap(footprint.bounds, entry.bounds))) return false;
        const materials = new Set(footprint.cells.map(([x, y]) => materialGrid[y][x]));
        if (!world.allowed_materials.includes('*') && [...materials].some((material) => !world.allowed_materials.includes(material))) return false;
        const surfaces = new Set(footprint.cells.map(([x, y]) => providedSurfaces.get(`${x},${y}`) ?? catalog.materials[materialGrid[y][x]].surface));
        if ([...surfaces].some((surface) => !world.allowed_surfaces.includes(surface))) return false;
        if ([...materials].some((material) => !world.allowed_planes.includes(catalog.materials[material].plane))) return false;
        if (!world.allowed_biomes.includes('*') && [...materials].some((material) => !world.allowed_biomes.includes(catalog.materials[material].biome))) return false;
        const boundary = footprint.cells.some(([x, y]) => [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]].some(([nx, ny]) => nx >= 0 && ny >= 0 && nx < columns && ny < rows && materialGrid[ny][nx] !== materialGrid[y][x]));
        if (world.boundary_policy === 'forbid' && boundary || world.boundary_policy === 'require' && !boundary) return false;
        if (!visible) continue;
        if (visible[0] < -0.0001 || visible[1] < -0.0001 || visible[0] + visible[2] > width + 0.0001 || visible[1] + visible[3] > height + 0.0001) return false;
        if (overlapPolicy !== 'allow' && [...structuralVisualBounds, ...placementVisualBounds].some((bounds) => boundsOverlap(visible, bounds))) return false;
        if (visualFit === 'zone') {
          const left = Math.max(0, Math.floor(visible[0] / cell[0])); const top = Math.max(0, Math.floor(visible[1] / cell[1])); const right = Math.min(columns - 1, Math.floor((visible[0] + visible[2] - 0.0001) / cell[0])); const bottom = Math.min(rows - 1, Math.floor((visible[1] + visible[3] - 0.0001) / cell[1]));
          for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) if (!zoneCellKeys.has(`${x},${y}`)) return false;
        }
      }
      return true;
    };
    for (const group of scene.composition.groups) {
      const zone = scene.composition.zones[group.zone];
      const zoneCells = expandCells(zone, `composition zone ${group.zone}`).filter(([x, y]) => {
        if (x >= columns || y >= rows) return false;
        const materialId = materialGrid[y][x]; const material = catalog.materials[materialId];
        if (zone.materials && !zone.materials.includes('*') && !zone.materials.includes(materialId)) return false;
        if (zone.surfaces && !zone.surfaces.includes(material.surface)) return false;
        if (zone.planes && !zone.planes.includes(material.plane)) return false;
        if (zone.biomes && !zone.biomes.includes('*') && !zone.biomes.includes(material.biome)) return false;
        const adjacentMaterials = new Set([[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]].filter(([nextX, nextY]) => nextX >= 0 && nextY >= 0 && nextX < columns && nextY < rows).map(([nextX, nextY]) => materialGrid[nextY][nextX]).filter((adjacent) => adjacent !== materialId));
        if (zone.boundary === true && !adjacentMaterials.size || zone.boundary === false && adjacentMaterials.size) return false;
        if (zone.adjacent_materials && !zone.adjacent_materials.some((adjacent) => adjacentMaterials.has(adjacent))) return false;
        return true;
      }); const zoneCellKeys = new Set(zoneCells.map((at) => at.join(','))); const selected = [];
      const anchor = group.anchor ?? (() => { const xs = zoneCells.map(([x]) => x); const ys = zoneCells.map(([, y]) => y); return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]; })();
      const score = ([x, y]) => {
        const distance = Math.hypot(x - anchor[0], y - anchor[1]); const noise = deterministicUnit(scene.composition.seed, group.id, x, y);
        if (group.layout === 'center') return distance + noise * 0.001;
        if (group.layout === 'cluster') return distance * (0.75 + noise * 0.5);
        if (group.layout === 'grid') return y * columns + x + noise * 0.001;
        return noise;
      };
      zoneCells.sort((left, right) => score(left) - score(right) || left[1] - right[1] || left[0] - right[0]);
      const variants = group.candidates.flatMap((candidate) => (candidate.frames ?? [candidate.frame]).map((frame, index) => {
        let visualArea = 0;
        if (candidate.asset) { const { asset, frame: resolvedFrame } = resolveCatalogFrame(catalog, frame ? `${candidate.asset}#${frame}` : candidate.asset); const bounds = resolvedFrame.content_bounds ?? [0, 0, ...frameMetrics(asset, resolvedFrame).source_size]; visualArea = bounds[2] * bounds[3] / (asset.pixel_density ** 2); }
        return { ...candidate, frames: undefined, frame, weight: candidate.weight ?? 1, variant_key: `${candidate.asset ?? candidate.prefab}#${frame ?? index}`, visual_area: visualArea };
      }));
      const variantUses = new Map(variants.map((variant) => [variant.variant_key, 0]));
      for (const [x, y] of zoneCells) {
        if (selected.length >= group.count) break;
        const minimumDistance = group.minimum_distance ?? (group.layout === 'scatter' ? 2 : 1);
        if (selected.some(([selectedX, selectedY]) => Math.hypot(x - selectedX, y - selectedY) < minimumDistance)) continue;
        const rankedVariants = [...variants].sort((left, right) => {
          const useDifference = variantUses.get(left.variant_key) / left.weight - variantUses.get(right.variant_key) / right.weight;
          return useDifference || right.visual_area - left.visual_area || deterministicUnit(scene.composition.seed, group.id, 'candidate', x, y, left.variant_key) - deterministicUnit(scene.composition.seed, group.id, 'candidate', x, y, right.variant_key);
        }); let accepted = null;
        for (const candidate of rankedVariants) {
          const at = [x * cell[0] + cell[0] / 2, (y + 1) * cell[1]];
          if (canPlace(candidate, at, group.overlap ?? 'forbid', group.visual_fit ?? 'zone', zoneCellKeys)) { accepted = { ...candidate, weight: undefined, variant_key: undefined, visual_area: undefined, id: `${group.id}.${selected.length + 1}`, role: group.role, at }; variantUses.set(candidate.variant_key, variantUses.get(candidate.variant_key) + 1); break; }
        }
        if (!accepted) continue;
        expandPlacement(accepted); selected.push([x, y]);
      }
      if (selected.length !== group.count) throw new Error(`composition group ${group.id}: placed ${selected.length} of ${group.count} requested candidates in zone ${group.zone}`);
      diagnostics.generated_groups.push({ id: group.id, role: group.role, layout: group.layout, zone: group.zone, count: selected.length, cells: selected });
    }
  }

  const walkableCells = new Set();
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < columns; x += 1) {
    if ((providedSurfaces.get(`${x},${y}`) ?? catalog.materials[materialGrid[y][x]].surface) === 'solid' && !blockedCells.has(`${x},${y}`)) walkableCells.add(`${x},${y}`);
  }
  let largestWalkableComponent = 0; const visitedWalkable = new Set();
  for (const start of walkableCells) {
    if (visitedWalkable.has(start)) continue;
    let componentSize = 0; const queue = [start]; visitedWalkable.add(start);
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index]; componentSize += 1; const [x, y] = current.split(',').map(Number);
      for (const [nextX, nextY] of [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]]) {
        const key = `${nextX},${nextY}`;
        if (walkableCells.has(key) && !visitedWalkable.has(key)) { visitedWalkable.add(key); queue.push(key); }
      }
    }
    largestWalkableComponent = Math.max(largestWalkableComponent, componentSize);
  }
  diagnostics.composition = {
    walkable_cells: walkableCells.size,
    blocked_cells: blockedCells.size,
    largest_walkable_component: largestWalkableComponent,
    navigation_connectivity: walkableCells.size ? largestWalkableComponent / walkableCells.size : 0,
  };

  const ordered = commands.map((command, order) => ({ ...command, order })).sort((left, right) => (PASS[left.render_layer] ?? 999) - (PASS[right.render_layer] ?? 999) || left.sort_y - right.sort_y || left.order - right.order).map(({ order, ...command }, index) => ({ ...command, order: index }));
  diagnostics.systems = {
    terrain: ordered.filter((command) => command.provenance?.startsWith('interface:')).length,
    connector: ordered.filter((command) => command.provenance?.startsWith('connector:')).length,
    height: ordered.filter((command) => command.provenance?.startsWith('height:')).length,
    component: ordered.filter((command) => /^(component|material-detail):/.test(command.provenance ?? '')).length,
    shadow: diagnostics.shadows,
  };
  diagnostics.structural_occupancy = { connector_cells: connectorOccupiedBounds.length };
  const roleByPlacement = new Map();
  for (const command of ordered) if (command.provenance?.startsWith('placement:') && command.semantic_role) roleByPlacement.set(command.provenance, command.semantic_role);
  diagnostics.semantic_roles = {};
  for (const role of roleByPlacement.values()) diagnostics.semantic_roles[role] = (diagnostics.semantic_roles[role] ?? 0) + 1;
  const plan = { schema_version: 2, kind: 'presentation-draw-plan', scene: scene.id, catalog: scene.catalog, style_profile: scene.style_profile, logical_size: scene.logical_size, pixel_scale: scene.pixel_scale, background: scene.background ?? base.fill.color ?? '#000000', grid: { cell, columns, rows }, material_grid: materialGrid, elevation_grid: elevationGrid, commands: ordered, diagnostics };
  plan.hash = hashDrawPlan(plan);
  return deepFreeze(plan);
}
