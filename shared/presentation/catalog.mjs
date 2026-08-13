import { materializeAssetCatalog } from '../gaming/assets.mjs';
import { validateAssetAnimation } from './animation.mjs';

export const PRESENTATION_CATALOG_MAP_FIELDS = Object.freeze([
  'license_scopes',
  'style_profiles',
  'shadow_profiles',
  'asset_templates',
  'assets',
  'materials',
  'terrain_interfaces',
  'connector_profiles',
  'height_interfaces',
  'component_profiles',
  'prefabs',
]);

export const PRESENTATION_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const ANCHORS = new Set(['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right']);
const LAYERS = new Set(['terrain', 'below', 'ground', 'actor', 'structure', 'overhead', 'air', 'ui']);
const BOUNDARY_POLICIES = new Set(['forbid', 'allow', 'require']);
const COMPOSITION_ROLE_COUNT = 6;
const SURFACES = new Set(['solid', 'liquid', 'void']);

export function isPair(value, { positive = false, numeric = false } = {}) {
  return Array.isArray(value) && value.length === 2 && value.every((part) =>
    (numeric ? Number.isFinite(part) : Number.isInteger(part)) && (positive ? part > 0 : part >= 0));
}

export function assetReference(reference) {
  const [asset, frame = 'default'] = String(reference ?? '').split('#');
  return { asset, frame };
}

export function materializePresentationCatalog(catalog) {
  return materializeAssetCatalog(catalog);
}

function checkReference(catalog, reference, prefix, errors) {
  const { asset: assetId, frame: frameId } = assetReference(reference);
  const asset = catalog.assets?.[assetId];
  if (asset?.status !== 'approved') errors.push(`${prefix}: unavailable asset ${assetId}`);
  else if (String(reference).includes('#') && !asset.frames?.[frameId]) errors.push(`${prefix}: unknown frame ${assetId}#${frameId}`);
}

function validateWorldMetadata(asset, prefix, errors) {
  const world = asset.world;
  if (!world || typeof world !== 'object' || Array.isArray(world)) {
    errors.push(`${prefix}: placed asset needs world metadata`);
    return;
  }
  if (!isPair(world.footprint?.size, { positive: true, numeric: true })) errors.push(`${prefix}: world.footprint.size must be a positive logical pair`);
  if (world.footprint?.offset !== undefined && (!Array.isArray(world.footprint.offset) || world.footprint.offset.length !== 2 || world.footprint.offset.some((value) => !Number.isFinite(value)))) errors.push(`${prefix}: world.footprint.offset must be a logical pair`);
  if (!Array.isArray(world.allowed_materials) || !world.allowed_materials.length || world.allowed_materials.some((id) => id !== '*' && !PRESENTATION_ID.test(String(id)))) errors.push(`${prefix}: world.allowed_materials must contain material ids or *`);
  if (!Array.isArray(world.allowed_surfaces) || !world.allowed_surfaces.length || world.allowed_surfaces.some((surface) => !SURFACES.has(surface))) errors.push(`${prefix}: world.allowed_surfaces must contain solid, liquid, or void`);
  if (!Array.isArray(world.allowed_planes) || !world.allowed_planes.length || world.allowed_planes.some((id) => !PRESENTATION_ID.test(String(id)))) errors.push(`${prefix}: world.allowed_planes must contain plane ids`);
  if (!Array.isArray(world.allowed_biomes) || !world.allowed_biomes.length || world.allowed_biomes.some((id) => id !== '*' && !PRESENTATION_ID.test(String(id)))) errors.push(`${prefix}: world.allowed_biomes must contain biome ids or *`);
  if (!BOUNDARY_POLICIES.has(world.boundary_policy)) errors.push(`${prefix}: world.boundary_policy must be forbid, allow, or require`);
  if (!LAYERS.has(world.render_layer)) errors.push(`${prefix}: world.render_layer is invalid`);
  if (world.sort_offset !== undefined && !Number.isFinite(world.sort_offset)) errors.push(`${prefix}: world.sort_offset must be numeric`);
  if (world.route_anchor !== undefined && (!Array.isArray(world.route_anchor) || world.route_anchor.length !== 2 || world.route_anchor.some((value) => !Number.isFinite(value)))) errors.push(`${prefix}: world.route_anchor must be a logical offset pair`);
  if (world.visual_scale !== undefined) errors.push(`${prefix}: world.visual_scale is forbidden; normalize source geometry and pixel_density instead`);
  if (!['solid', 'passable'].includes(world.collision)) errors.push(`${prefix}: world.collision must be solid or passable`);
  if (world.provides_surface !== undefined && !SURFACES.has(world.provides_surface)) errors.push(`${prefix}: world.provides_surface must be solid, liquid, or void`);
  if (!PRESENTATION_ID.test(String(world.scale_class ?? ''))) errors.push(`${prefix}: world.scale_class is required`);
  if (world.shadow_profile !== undefined && !PRESENTATION_ID.test(String(world.shadow_profile))) errors.push(`${prefix}: world.shadow_profile is invalid`);
  if (world.attachment !== undefined) {
    const attachment = world.attachment;
    if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment) || attachment.system !== 'height') errors.push(`${prefix}: world.attachment.system must be height`);
    else if (!Number.isFinite(attachment.minimum_overlap_ratio) || attachment.minimum_overlap_ratio <= 0 || attachment.minimum_overlap_ratio > 1) errors.push(`${prefix}: world.attachment.minimum_overlap_ratio must be greater than 0 and at most 1`);
  }
  validateLandings(world.landings, `${prefix}: world.landings`, errors);
  validateCrossings(world.crossings, world.landings, `${prefix}: world.crossings`, errors);
}

function validateLandings(landings, prefix, errors) {
  if (landings === undefined) return;
  if (!Array.isArray(landings) || !landings.length) { errors.push(`${prefix} must be a non-empty array`); return; }
  for (const [index, landing] of landings.entries()) {
    if (!landing || typeof landing !== 'object' || Array.isArray(landing) || !isPair(landing.offset, { numeric: true }) || !SURFACES.has(landing.surface)) errors.push(`${prefix} ${index} needs logical offset and solid, liquid, or void surface`);
    if (landing?.material_group !== undefined && !PRESENTATION_ID.test(String(landing.material_group))) errors.push(`${prefix} ${index} material_group is invalid`);
  }
}

function validateCrossings(crossings, landings, prefix, errors) {
  if (crossings === undefined) return;
  if (!Array.isArray(crossings) || !crossings.length) { errors.push(`${prefix} must be a non-empty array`); return; }
  const groups = new Set((landings ?? []).map((landing) => landing?.material_group).filter(Boolean));
  for (const [index, crossing] of crossings.entries()) {
    if (!crossing || typeof crossing !== 'object' || Array.isArray(crossing) || !isPair(crossing.offset, { numeric: true })) errors.push(`${prefix} ${index} needs a logical offset`);
    if (!PRESENTATION_ID.test(String(crossing?.different_from_group ?? '')) || !groups.has(crossing?.different_from_group)) errors.push(`${prefix} ${index} different_from_group must reference a landing material_group`);
  }
}

/** Strict runtime validation for presentation catalog v2. */
export function validatePresentationCatalog(catalog) {
  const errors = [];
  try { catalog = materializePresentationCatalog(catalog); } catch (error) { return { valid: false, errors: [error.message] }; }
  if (catalog?.schema_version !== 2) errors.push('schema_version must be 2');
  if (catalog?.kind !== 'presentation-catalog') errors.push('kind must be presentation-catalog');
  if (!PRESENTATION_ID.test(String(catalog?.pack?.id ?? ''))) errors.push('pack.id is invalid');
  if (!PRESENTATION_ID.test(String(catalog?.pack?.style_profile ?? ''))) errors.push('pack.style_profile is required');
  if (!isPair(catalog?.pack?.logical_cell, { positive: true })) errors.push('pack.logical_cell must be a positive pair');

  const styleProfiles = catalog?.style_profiles;
  if (!styleProfiles || typeof styleProfiles !== 'object' || Array.isArray(styleProfiles)) errors.push('style_profiles must be a map');
  for (const [id, profile] of Object.entries(styleProfiles ?? {})) {
    if (!PRESENTATION_ID.test(id)) errors.push(`style profile ${id}: invalid id`);
    if (!isPair(profile?.logical_cell, { positive: true })) errors.push(`style profile ${id}: logical_cell must be positive`);
    if (profile?.sampling !== 'nearest') errors.push(`style profile ${id}: sampling must be nearest`);
    if (!Number.isInteger(profile?.base_pixel) || profile.base_pixel < 1) errors.push(`style profile ${id}: base_pixel must be a positive integer`);
    if (!profile?.scale_classes || typeof profile.scale_classes !== 'object' || Array.isArray(profile.scale_classes)) errors.push(`style profile ${id}: scale_classes must be a map`);
    for (const [classId, scaleClass] of Object.entries(profile?.scale_classes ?? {})) {
      if (!PRESENTATION_ID.test(classId)) errors.push(`style profile ${id}: invalid scale class ${classId}`);
      const range = scaleClass?.logical_height;
      if (!Array.isArray(range) || range.length !== 2 || range.some((value) => !Number.isFinite(value) || value <= 0) || range[0] > range[1]) errors.push(`style profile ${id}: scale class ${classId} needs logical_height [min, max]`);
    }
    const composition = profile?.composition;
    if (!composition || typeof composition !== 'object' || Array.isArray(composition)) errors.push(`style profile ${id}: composition contract is required`);
    else {
      if (!isPair(composition.sector_grid, { positive: true })) errors.push(`style profile ${id}: composition.sector_grid must be positive`);
      const sectorCount = isPair(composition.sector_grid, { positive: true }) ? composition.sector_grid[0] * composition.sector_grid[1] : 0;
      if (!Number.isInteger(composition.minimum_occupied_sectors) || composition.minimum_occupied_sectors < 1 || composition.minimum_occupied_sectors > sectorCount) errors.push(`style profile ${id}: composition.minimum_occupied_sectors is invalid`);
      if (!Array.isArray(composition.visual_coverage) || composition.visual_coverage.length !== 2 || composition.visual_coverage.some((value) => !Number.isFinite(value) || value < 0 || value > 1) || composition.visual_coverage[0] > composition.visual_coverage[1]) errors.push(`style profile ${id}: composition.visual_coverage needs [min, max]`);
      for (const field of ['minimum_navigation_connectivity', 'maximum_repeat_ratio']) if (!Number.isFinite(composition[field]) || composition[field] < 0 || composition[field] > 1) errors.push(`style profile ${id}: composition.${field} must be between 0 and 1`);
      if (!Number.isInteger(composition.minimum_role_diversity) || composition.minimum_role_diversity < 1 || composition.minimum_role_diversity > COMPOSITION_ROLE_COUNT) errors.push(`style profile ${id}: composition.minimum_role_diversity must be an integer from 1 to ${COMPOSITION_ROLE_COUNT}`);
      if (!Number.isFinite(composition.maximum_role_ratio) || composition.maximum_role_ratio < 0 || composition.maximum_role_ratio > 1) errors.push(`style profile ${id}: composition.maximum_role_ratio must be between 0 and 1`);
    }
  }
  if (catalog?.pack?.style_profile && !styleProfiles?.[catalog.pack.style_profile]) errors.push(`pack.style_profile is unknown: ${catalog.pack.style_profile}`);

  const shadows = catalog?.shadow_profiles ?? {};
  for (const [id, shadow] of Object.entries(shadows)) {
    if (!PRESENTATION_ID.test(id)) errors.push(`shadow profile ${id}: invalid id`);
    if (!isPair(shadow?.size, { positive: true, numeric: true })) errors.push(`shadow profile ${id}: size must be positive`);
    if (shadow?.offset !== undefined && (!Array.isArray(shadow.offset) || shadow.offset.length !== 2 || shadow.offset.some((value) => !Number.isFinite(value)))) errors.push(`shadow profile ${id}: offset must be a pair`);
    if (shadow?.opacity !== undefined && (!Number.isFinite(shadow.opacity) || shadow.opacity < 0 || shadow.opacity > 1)) errors.push(`shadow profile ${id}: opacity must be between 0 and 1`);
  }

  const assets = catalog?.assets;
  if (!assets || typeof assets !== 'object' || Array.isArray(assets)) return { valid: false, errors: [...errors, 'assets must be a map'] };
  for (const [id, asset] of Object.entries(assets)) {
    const prefix = `asset ${id}`;
    if (!PRESENTATION_ID.test(id)) errors.push(`${prefix}: invalid id`);
    if (asset?.status !== 'approved') continue;
    if (!Number.isInteger(asset.pixel_density) || asset.pixel_density < 1 || asset.pixel_density > 8) errors.push(`${prefix}: pixel_density must be an integer from 1 to 8`);
    if (!PRESENTATION_ID.test(String(asset.style_profile ?? '')) || !styleProfiles?.[asset.style_profile]) errors.push(`${prefix}: style_profile is missing or unknown`);
    if (!asset.source || String(asset.source).startsWith('/') || String(asset.source).includes('..')) errors.push(`${prefix}: source must be a canonical relative path`);
    if (!/^[a-f0-9]{64}$/.test(String(asset.source_sha256 ?? ''))) errors.push(`${prefix}: source_sha256 must be a sha256`);
    if (!['isolated', 'seamless'].includes(asset.edge_policy)) errors.push(`${prefix}: edge_policy must be isolated or seamless`);
    const geometry = asset.geometry;
    if (!['grid', 'freeform'].includes(geometry?.layout)) errors.push(`${prefix}: exact geometry is required`);
    if (geometry?.layout === 'grid' && (!isPair(geometry.cell, { positive: true }) || !isPair(geometry.grid, { positive: true }))) errors.push(`${prefix}: grid geometry needs cell and grid`);
    if (!asset.frames || typeof asset.frames !== 'object' || !Object.keys(asset.frames).length) errors.push(`${prefix}: frames are required`);
    for (const [frameId, frame] of Object.entries(asset.frames ?? {})) {
      if (!PRESENTATION_ID.test(frameId)) errors.push(`${prefix}: invalid frame ${frameId}`);
      if (Boolean(frame?.cell) === Boolean(frame?.rect)) errors.push(`${prefix}: frame ${frameId} needs exactly one source shape`);
      if (frame.cell && !isPair(frame.cell)) errors.push(`${prefix}: frame ${frameId} cell is invalid`);
      if (frame.rect && (!Array.isArray(frame.rect) || frame.rect.length !== 4 || frame.rect.some((value) => !Number.isInteger(value) || value < 0))) errors.push(`${prefix}: frame ${frameId} rect is invalid`);
      if (typeof frame.anchor === 'string' && !ANCHORS.has(frame.anchor)) errors.push(`${prefix}: frame ${frameId} anchor is invalid`);
      if (frame.allow_edge_contact !== undefined) errors.push(`${prefix}: frame ${frameId} uses legacy allow_edge_contact; use edge_contact metadata`);
      if (frame.edge_contact !== undefined) {
        if (!Array.isArray(frame.edge_contact?.allowed) || frame.edge_contact.allowed.some((side) => !['north', 'east', 'south', 'west'].includes(side)) || !String(frame.edge_contact?.reason ?? '').trim()) errors.push(`${prefix}: frame ${frameId} edge_contact needs allowed sides and reason`);
      }
      validateLandings(frame.landings, `${prefix}: frame ${frameId} landings`, errors);
      validateCrossings(frame.crossings, frame.landings ?? asset.world?.landings, `${prefix}: frame ${frameId} crossings`, errors);
    }
    errors.push(...validateAssetAnimation(asset, prefix));
    validateWorldMetadata(asset, prefix, errors);
    const scaleClass = styleProfiles?.[asset.style_profile]?.scale_classes?.[asset.world?.scale_class];
    if (asset.world?.scale_class && !scaleClass) errors.push(`${prefix}: unknown scale_class ${asset.world.scale_class}`);
    if (scaleClass) for (const [frameId, frame] of Object.entries(asset.frames ?? {})) if (frame.content_bounds) {
      const logicalHeight = frame.content_bounds[3] / asset.pixel_density;
      const [minimum, maximum] = scaleClass.logical_height;
      if (logicalHeight < minimum || logicalHeight > maximum) errors.push(`${prefix}: frame ${frameId} logical content height ${logicalHeight} is outside ${asset.world.scale_class} range ${minimum}-${maximum}`);
    }
    if (asset.world?.shadow_profile && !shadows[asset.world.shadow_profile]) errors.push(`${prefix}: unknown shadow_profile ${asset.world.shadow_profile}`);
  }

  const materials = catalog?.materials;
  if (!materials || typeof materials !== 'object' || Array.isArray(materials) || !Object.keys(materials).length) errors.push('materials must be a non-empty map');
  for (const [id, material] of Object.entries(materials ?? {})) {
    const prefix = `material ${id}`;
    if (!PRESENTATION_ID.test(id)) errors.push(`${prefix}: invalid id`);
    if (!PRESENTATION_ID.test(String(material?.style_profile ?? '')) || !styleProfiles?.[material.style_profile]) errors.push(`${prefix}: unknown style_profile`);
    if (!PRESENTATION_ID.test(String(material?.plane ?? ''))) errors.push(`${prefix}: plane is required`);
    if (!PRESENTATION_ID.test(String(material?.biome ?? ''))) errors.push(`${prefix}: biome is required`);
    if (!SURFACES.has(material?.surface)) errors.push(`${prefix}: surface must be solid, liquid, or void`);
    if (material?.fill_mode !== undefined && !['solid', 'overlay'].includes(material.fill_mode)) errors.push(`${prefix}: fill_mode must be solid or overlay`);
    if (material?.fill_mode === 'overlay' && !material?.fill?.asset) errors.push(`${prefix}: overlay fill_mode requires an asset frame`);
    if (material?.fill?.asset) checkReference(catalog, `${material.fill.asset}#${material.fill.frame ?? 'default'}`, prefix, errors);
    else if (!/^#[a-f0-9]{6}$/i.test(String(material?.fill?.color ?? ''))) errors.push(`${prefix}: fill needs an asset/frame or color`);
    if (material?.details !== undefined && (!Array.isArray(material.details) || !material.details.length)) errors.push(`${prefix}: details must be a non-empty array`);
    for (const [index, detail] of (material?.details ?? []).entries()) {
      const detailPrefix = `${prefix} detail ${index}`;
      const profile = catalog?.component_profiles?.[detail?.profile];
      if (!PRESENTATION_ID.test(String(detail?.profile ?? '')) || !profile) errors.push(`${detailPrefix}: profile is unknown`);
      if (!Number.isFinite(detail?.density) || detail.density <= 0 || detail.density > 1) errors.push(`${detailPrefix}: density must be greater than 0 and at most 1`);
      if (detail?.seed !== undefined && !Number.isInteger(detail.seed)) errors.push(`${detailPrefix}: seed must be an integer`);
      if (detail?.interior_only !== undefined && typeof detail.interior_only !== 'boolean') errors.push(`${detailPrefix}: interior_only must be boolean`);
      if (profile && !profile.allowed_surfaces?.includes(material?.surface)) errors.push(`${detailPrefix}: profile does not allow ${material?.surface} surfaces`);
      const asset = assets?.[assetReference(profile?.asset).asset];
      const component = asset?.components?.[profile?.component];
      if (component?.outline) errors.push(`${detailPrefix}: outline components cannot be material details`);
    }
  }

  for (const [id, entry] of Object.entries(catalog?.terrain_interfaces ?? {})) {
    const prefix = `terrain interface ${id}`;
    if (!PRESENTATION_ID.test(id)) errors.push(`${prefix}: invalid id`);
    if (!materials?.[entry?.inside] || !materials?.[entry?.outside] || entry.inside === entry.outside) errors.push(`${prefix}: inside/outside materials are invalid`);
    checkReference(catalog, entry?.asset, prefix, errors);
    const assetId = assetReference(entry?.asset).asset;
    if (!assets?.[assetId]?.autotile) errors.push(`${prefix}: asset needs reviewed autotile metadata`);
    if (!['positive', 'negative'].includes(entry?.polarity)) errors.push(`${prefix}: polarity must be positive or negative`);
    if (entry?.underlay !== undefined && entry.underlay !== 'inside-fill') errors.push(`${prefix}: underlay must be inside-fill`);
    if (entry?.transition_band !== undefined) {
      const band = entry.transition_band;
      if (!band || typeof band !== 'object' || Array.isArray(band)) errors.push(`${prefix}: transition_band must be a map`);
      else if (!Number.isFinite(band.minimum_changed_ratio) || band.minimum_changed_ratio <= 0 || band.minimum_changed_ratio > 1) errors.push(`${prefix}: transition_band.minimum_changed_ratio must be greater than 0 and at most 1`);
    }
    if (entry?.corner_profile !== undefined) {
      const corner = entry.corner_profile;
      if (!corner || typeof corner !== 'object' || Array.isArray(corner)) errors.push(`${prefix}: corner_profile must be a map`);
      else {
        if (corner.style !== 'rounded') errors.push(`${prefix}: corner_profile.style must be rounded`);
        if (!Number.isFinite(corner.minimum_cutback_ratio) || corner.minimum_cutback_ratio <= 0 || corner.minimum_cutback_ratio > 1) errors.push(`${prefix}: corner_profile.minimum_cutback_ratio must be greater than 0 and at most 1`);
        if (assets?.[assetId]?.autotile?.outer_corner_style !== corner.style) errors.push(`${prefix}: asset outer_corner_style must match ${corner.style}`);
      }
    }
  }

  for (const [field, capability] of [['connector_profiles', 'connector'], ['height_interfaces', 'height'], ['component_profiles', 'components']]) {
    for (const [id, entry] of Object.entries(catalog?.[field] ?? {})) {
      const prefix = `${field} ${id}`;
      if (!PRESENTATION_ID.test(id)) errors.push(`${prefix}: invalid id`);
      checkReference(catalog, entry?.asset, prefix, errors);
      if (!assets?.[assetReference(entry?.asset).asset]?.[capability]) errors.push(`${prefix}: asset lacks ${capability} metadata`);
      if (field === 'component_profiles' && (!Array.isArray(entry?.allowed_surfaces) || !entry.allowed_surfaces.length || entry.allowed_surfaces.some((surface) => !SURFACES.has(surface)))) errors.push(`${prefix}: allowed_surfaces must contain solid, liquid, or void`);
      if (field === 'component_profiles' && entry?.provides_surface !== undefined && !SURFACES.has(entry.provides_surface)) errors.push(`${prefix}: provides_surface must be solid, liquid, or void`);
      if (field === 'component_profiles' && entry?.opacity !== undefined && (!Number.isFinite(entry.opacity) || entry.opacity <= 0 || entry.opacity > 1)) errors.push(`${prefix}: opacity must be greater than 0 and at most 1`);
      if (field === 'component_profiles' && entry?.interior_only !== undefined && typeof entry.interior_only !== 'boolean') errors.push(`${prefix}: interior_only must be boolean`);
    }
  }

  for (const [id, prefab] of Object.entries(catalog?.prefabs ?? {})) {
    const prefix = `prefab ${id}`;
    if (!PRESENTATION_ID.test(id)) errors.push(`${prefix}: invalid id`);
    if (!isPair(prefab?.world?.footprint?.size, { positive: true, numeric: true })) errors.push(`${prefix}: world.footprint.size is required`);
    if (!Array.isArray(prefab?.world?.allowed_materials) || !prefab.world.allowed_materials.length || prefab.world.allowed_materials.some((entry) => entry !== '*' && !PRESENTATION_ID.test(String(entry)))) errors.push(`${prefix}: world.allowed_materials must contain material ids or *`);
    if (!Array.isArray(prefab?.world?.allowed_surfaces) || !prefab.world.allowed_surfaces.length || prefab.world.allowed_surfaces.some((surface) => !SURFACES.has(surface))) errors.push(`${prefix}: world.allowed_surfaces must contain solid, liquid, or void`);
    if (!Array.isArray(prefab?.world?.allowed_planes) || !prefab.world.allowed_planes.length || prefab.world.allowed_planes.some((entry) => !PRESENTATION_ID.test(String(entry)))) errors.push(`${prefix}: world.allowed_planes must contain plane ids`);
    if (!Array.isArray(prefab?.world?.allowed_biomes) || !prefab.world.allowed_biomes.length || prefab.world.allowed_biomes.some((entry) => entry !== '*' && !PRESENTATION_ID.test(String(entry)))) errors.push(`${prefix}: world.allowed_biomes must contain biome ids or *`);
    if (!BOUNDARY_POLICIES.has(prefab?.world?.boundary_policy)) errors.push(`${prefix}: world.boundary_policy is invalid`);
    if (!['solid', 'passable'].includes(prefab?.world?.collision)) errors.push(`${prefix}: world.collision must be solid or passable`);
    if (prefab?.world?.provides_surface !== undefined && !SURFACES.has(prefab.world.provides_surface)) errors.push(`${prefix}: world.provides_surface must be solid, liquid, or void`);
    if (prefab?.world?.route_anchor !== undefined && (!Array.isArray(prefab.world.route_anchor) || prefab.world.route_anchor.length !== 2 || prefab.world.route_anchor.some((value) => !Number.isFinite(value)))) errors.push(`${prefix}: world.route_anchor must be a logical offset pair`);
    validateLandings(prefab?.world?.landings, `${prefix}: world.landings`, errors);
    validateCrossings(prefab?.world?.crossings, prefab?.world?.landings, `${prefix}: world.crossings`, errors);
    if (!Array.isArray(prefab?.world?.slots)) errors.push(`${prefix}: world.slots must be an array`);
    if (!Array.isArray(prefab?.layers) || !prefab.layers.length) errors.push(`${prefix}: layers must be a non-empty array`);
    const inspect = (layer, layerPrefix) => {
      for (const forbidden of ['scale', 'z', 'depth_sort', 'shadow']) if (layer?.[forbidden] !== undefined) errors.push(`${layerPrefix}: ${forbidden} is forbidden in v2 prefabs`);
      if (layer?.select) for (const [variant, child] of Object.entries(layer.variants ?? {})) inspect(child, `${layerPrefix} variant ${variant}`);
    };
    for (const [index, layer] of (prefab?.layers ?? []).entries()) inspect(layer, `${prefix} layer ${index}`);
  }

  return { valid: errors.length === 0, errors };
}

export function resolveCatalogFrame(catalog, reference, frameName = undefined) {
  const parsed = assetReference(reference);
  const asset = catalog.assets?.[parsed.asset];
  const resolvedFrame = frameName ?? parsed.frame;
  if (asset?.status !== 'approved') throw new Error(`unavailable asset: ${parsed.asset}`);
  if (!asset.frames?.[resolvedFrame]) throw new Error(`asset ${parsed.asset} has no frame: ${resolvedFrame}`);
  return { assetId: parsed.asset, asset, frameId: resolvedFrame, frame: asset.frames[resolvedFrame] };
}
