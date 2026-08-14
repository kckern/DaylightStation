import { materializeAssetCatalog } from '../gaming/assets.mjs';
import { validateAssetAnimation } from './animation.mjs';

export const PRESENTATION_CATALOG_MAP_FIELDS = Object.freeze([
  'license_scopes',
  'style_profiles',
  'shadow_profiles',
  'animation_rigs',
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
const AUTOTILE_POLARITIES = ['positive', 'negative'];
const RIG_CONTROL_SCHEMES = new Set(['four-way', 'horizontal']);

function validateAutotileMetadata(asset, prefix, errors) {
  if (asset.autotile === undefined) return;
  const autotile = asset.autotile;
  if (asset.kind !== 'tile-sheet' || !['cardinal-4', 'cardinal-4+diagonal-corners'].includes(autotile?.topology)) errors.push(`${prefix}: autotile requires a supported tile-sheet topology`);
  const polarities = autotile?.supported_polarities;
  if (!Array.isArray(polarities) || !polarities.length || new Set(polarities).size !== polarities.length || polarities.some((polarity) => !AUTOTILE_POLARITIES.includes(polarity))) {
    errors.push(`${prefix}: autotile supported_polarities must explicitly contain positive and/or negative`);
  }
  for (const polarity of AUTOTILE_POLARITIES) {
    const mapping = autotile?.[polarity];
    const declared = polarities?.includes(polarity);
    if (declared && (!mapping || typeof mapping !== 'object' || Array.isArray(mapping))) errors.push(`${prefix}: declared ${polarity} polarity needs a mapping`);
    if (!declared && mapping !== undefined) errors.push(`${prefix}: autotile ${polarity} mapping is not declared in supported_polarities`);
    for (const [mask, frameId] of Object.entries(mapping ?? {})) {
      if (!['fallback', 'isolated'].includes(mask) && !/^(?:n)?(?:e)?(?:s)?(?:w)?$/.test(mask)) errors.push(`${prefix}: autotile ${polarity} mask is invalid: ${mask}`);
      if (!PRESENTATION_ID.test(String(frameId)) || !asset.frames?.[frameId]) errors.push(`${prefix}: autotile ${polarity} references unknown frame: ${frameId}`);
    }
  }
  if (autotile?.topology !== 'cardinal-4+diagonal-corners') return;
  const innerCorners = autotile.inner_corners;
  if (!innerCorners || typeof innerCorners !== 'object' || Array.isArray(innerCorners)) {
    errors.push(`${prefix}: diagonal-corner autotile needs inner_corners`);
    return;
  }
  const isPolarized = Boolean(innerCorners.positive || innerCorners.negative);
  for (const polarity of polarities ?? []) {
    const map = isPolarized ? innerCorners[polarity] : innerCorners;
    if (!map || typeof map !== 'object' || Array.isArray(map)) {
      errors.push(`${prefix}: declared ${polarity} polarity needs an inside-corner map`);
      continue;
    }
    for (const [corner, frameId] of Object.entries(map)) {
      if (!/^(?:nw|ne|se|sw)(?:-(?:nw|ne|se|sw))*$/.test(corner)) errors.push(`${prefix}: inside-corner key is invalid: ${corner}`);
      if (!PRESENTATION_ID.test(String(frameId)) || !asset.frames?.[frameId]) errors.push(`${prefix}: inside-corner key references unknown frame: ${frameId}`);
    }
  }
}

function validateComponentMetadata(asset, prefix, errors) {
  if (asset.components === undefined) return;
  if (!asset.components || typeof asset.components !== 'object' || Array.isArray(asset.components)) {
    errors.push(`${prefix}: components must be a map`);
    return;
  }
  for (const [componentId, component] of Object.entries(asset.components)) {
    if (!Array.isArray(component?.frames) || !component.frames.length || component.frames.some((frameId) => !asset.frames?.[frameId])) {
      errors.push(`${prefix}: component ${componentId} needs known frames`);
      continue;
    }
    if (component.transitions !== undefined) {
      if (!component.transitions || typeof component.transitions !== 'object' || Array.isArray(component.transitions)) errors.push(`${prefix}: component ${componentId} transitions must be a direction map`);
      else for (const [direction, sequence] of Object.entries(component.transitions)) if (!['north', 'east', 'south', 'west'].includes(direction) || !Array.isArray(sequence) || !sequence.length || sequence.some((frameId) => !component.frames.includes(frameId))) errors.push(`${prefix}: component ${componentId} transition ${direction} must use component frames`);
    }
    if (component.directional_frames !== undefined && (!component.directional_frames || typeof component.directional_frames !== 'object' || Array.isArray(component.directional_frames) || Object.entries(component.directional_frames).some(([direction, frameId]) => !['north', 'east', 'south', 'west'].includes(direction) || !component.frames.includes(frameId)))) errors.push(`${prefix}: component ${componentId} directional_frames must map directions to component frames`);
  }
}

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

function animationReferenceDescriptor(reference) {
  return typeof reference === 'string' ? { clip: reference, flip_x: false } : { clip: reference?.clip, flip_x: reference?.flip_x ?? false };
}

function stateReferenceMap(state) {
  return state?.clip !== undefined ? new Map([['default', state.clip]]) : new Map(Object.entries(state?.facings ?? {}));
}

function animationFrameId(entry) {
  return typeof entry === 'string' ? entry : entry?.frame;
}

function normalizedFrameRegistration(asset, frame) {
  const density = asset.pixel_density;
  const size = frame?.rect ? [frame.rect[2] / density, frame.rect[3] / density] : asset.geometry?.cell?.map((value) => value / density);
  const anchor = Array.isArray(frame?.anchor?.point)
    ? frame.anchor.point.map((value) => value / density)
    : frame?.anchor ?? asset.defaults?.anchor ?? 'top-left';
  return { size, anchor };
}

function validateAnimationLayers(catalog, assetId, asset, prefix, errors) {
  for (const [index, descriptor] of (asset.animation?.layers ?? []).entries()) {
    const layerPrefix = `${prefix}: animation layer ${index}`; const layer = catalog.assets?.[descriptor.asset];
    if (!layer || layer.status !== 'approved') { errors.push(`${layerPrefix} references unavailable asset ${descriptor.asset}`); continue; }
    if (descriptor.asset === assetId) errors.push(`${layerPrefix} cannot reference itself`);
    if (layer.animation?.mode !== 'state-machine') errors.push(`${layerPrefix} must reference a state-machine asset`);
    if (layer.animation?.layers?.length) errors.push(`${layerPrefix} cannot reference a nested layered asset`);
    if (!layer.tags?.includes('animation-layer')) errors.push(`${layerPrefix} asset must be tagged animation-layer`);
    if (layer.pixel_density !== asset.pixel_density) errors.push(`${layerPrefix} pixel_density must match the base asset`);
    if (layer.style_profile !== asset.style_profile) errors.push(`${layerPrefix} style_profile must match the base asset`);
    if (layer.world?.scale_class !== asset.world?.scale_class) errors.push(`${layerPrefix} scale_class must match the base asset`);
    const states = descriptor.states ?? Object.keys(asset.animation?.states ?? {});
    for (const stateId of states) {
      const baseState = asset.animation?.states?.[stateId]; const layerState = layer.animation?.states?.[stateId]; const statePrefix = `${layerPrefix} state ${stateId}`;
      if (!baseState) { errors.push(`${statePrefix} is absent from the base asset`); continue; }
      if (!layerState) { errors.push(`${statePrefix} is absent from ${descriptor.asset}`); continue; }
      if (layerState.motion !== baseState.motion) errors.push(`${statePrefix} motion must match the base asset`);
      if (layerState.return_to !== baseState.return_to || layerState.terminal !== baseState.terminal) errors.push(`${statePrefix} return/terminal semantics must match the base asset`);
      const baseReferences = stateReferenceMap(baseState); const layerReferences = stateReferenceMap(layerState);
      if ([...baseReferences.keys()].join(',') !== [...layerReferences.keys()].join(',')) { errors.push(`${statePrefix} facing registration must match the base asset`); continue; }
      for (const [facing, baseReference] of baseReferences) {
        const baseDescriptor = animationReferenceDescriptor(baseReference); const layerDescriptor = animationReferenceDescriptor(layerReferences.get(facing));
        if (baseDescriptor.flip_x !== layerDescriptor.flip_x) errors.push(`${statePrefix} ${facing} flip registration must match the base asset`);
        const baseClip = asset.clips?.[baseDescriptor.clip]; const layerClip = layer.clips?.[layerDescriptor.clip];
        if (!baseClip || !layerClip) continue;
        if (baseClip.loop !== layerClip.loop || baseClip.fps !== layerClip.fps || baseClip.frames.length !== layerClip.frames.length) errors.push(`${statePrefix} ${facing} clip timing and phase count must match the base asset`);
        const baseDurations = baseClip.frames.map((entry) => typeof entry === 'object' ? entry.duration_ms : null);
        const layerDurations = layerClip.frames.map((entry) => typeof entry === 'object' ? entry.duration_ms : null);
        if (JSON.stringify(baseDurations) !== JSON.stringify(layerDurations)) errors.push(`${statePrefix} ${facing} timed phases must match the base asset`);
        for (let phase = 0; phase < Math.min(baseClip.frames.length, layerClip.frames.length); phase += 1) {
          const baseFrame = asset.frames?.[animationFrameId(baseClip.frames[phase])]; const layerFrame = layer.frames?.[animationFrameId(layerClip.frames[phase])];
          if (!baseFrame || !layerFrame) continue;
          if (JSON.stringify(normalizedFrameRegistration(asset, baseFrame)) !== JSON.stringify(normalizedFrameRegistration(layer, layerFrame))) errors.push(`${statePrefix} ${facing} phase ${phase} frame geometry/anchor registration must match the base asset`);
        }
      }
    }
  }
}

function validateRigPair(baseId, base, layerId, layer, profileId, slotProfile, errors) {
  const prefix = `animation rig ${profileId}: ${layerId} against ${baseId}`;
  if (base.animation?.mode !== 'state-machine' || layer.animation?.mode !== 'state-machine') { errors.push(`${prefix}: base and layer must use state-machine animation`); return; }
  if (!layer.tags?.includes('animation-layer')) errors.push(`${prefix}: non-base slots must be tagged animation-layer`);
  if (base.pixel_density !== layer.pixel_density) errors.push(`${prefix}: pixel_density must match`);
  if (base.style_profile !== layer.style_profile) errors.push(`${prefix}: style_profile must match`);
  const baseStates = base.animation.rig?.states ?? Object.keys(base.animation.states ?? {}); const layerStates = Object.keys(layer.animation.states ?? {}); const registeredStates = layer.animation.rig?.states ?? Object.keys(base.animation.states ?? {});
  const overlap = registeredStates.filter((state) => baseStates.includes(state));
  if (!overlap.length) return;
  if (registeredStates.some((state) => !layer.animation.states?.[state]) || layerStates.some((state) => !registeredStates.includes(state))) { errors.push(`${prefix}: layer states must exactly match animation.rig.states (or the complete base state set)`); return; }
  for (const stateId of overlap) {
    const baseState = base.animation.states[stateId]; const layerState = layer.animation.states[stateId]; const statePrefix = `${prefix} state ${stateId}`;
    if (baseState.motion !== layerState.motion) errors.push(`${statePrefix}: motion must match`);
    if (baseState.return_to !== layerState.return_to || baseState.terminal !== layerState.terminal) errors.push(`${statePrefix}: return/terminal semantics must match`);
    const baseReferences = stateReferenceMap(baseState); const layerReferences = stateReferenceMap(layerState);
    if ([...baseReferences.keys()].join(',') !== [...layerReferences.keys()].join(',')) { errors.push(`${statePrefix}: facing registration must match`); continue; }
    for (const [facing, baseReference] of baseReferences) {
      const baseDescriptor = animationReferenceDescriptor(baseReference); const layerDescriptor = animationReferenceDescriptor(layerReferences.get(facing));
      if (baseDescriptor.flip_x !== layerDescriptor.flip_x) errors.push(`${statePrefix} ${facing}: flip registration must match`);
      const baseClip = base.clips?.[baseDescriptor.clip]; const layerClip = layer.clips?.[layerDescriptor.clip];
      if (!baseClip || !layerClip) continue;
      if (baseClip.loop !== layerClip.loop || baseClip.fps !== layerClip.fps || baseClip.frames.length !== layerClip.frames.length) errors.push(`${statePrefix} ${facing}: clip timing and phase count must match`);
      const baseDurations = baseClip.frames.map((entry) => typeof entry === 'object' ? entry.duration_ms : null); const layerDurations = layerClip.frames.map((entry) => typeof entry === 'object' ? entry.duration_ms : null);
      if (JSON.stringify(baseDurations) !== JSON.stringify(layerDurations)) errors.push(`${statePrefix} ${facing}: timed phases must match`);
      for (let phase = 0; phase < Math.min(baseClip.frames.length, layerClip.frames.length); phase += 1) {
        const baseFrame = base.frames?.[animationFrameId(baseClip.frames[phase])]; const layerFrame = layer.frames?.[animationFrameId(layerClip.frames[phase])];
        if (baseFrame && layerFrame) {
          const baseRegistration = normalizedFrameRegistration(base, baseFrame); const layerRegistration = normalizedFrameRegistration(layer, layerFrame);
          const matches = slotProfile?.registration === 'custom-anchor'
            ? Array.isArray(baseRegistration.anchor) && Array.isArray(layerRegistration.anchor)
            : JSON.stringify(baseRegistration) === JSON.stringify(layerRegistration);
          if (!matches) errors.push(`${statePrefix} ${facing} phase ${phase}: ${slotProfile?.registration === 'custom-anchor' ? 'both frames need reviewed custom anchors' : 'frame geometry/anchor registration must match'}`);
        }
      }
    }
  }
}

function validateAnimationRigProfiles(catalog, errors) {
  const rigs = catalog.animation_rigs ?? {}; const assets = catalog.assets ?? {};
  if (catalog.animation_rigs !== undefined && (!catalog.animation_rigs || typeof catalog.animation_rigs !== 'object' || Array.isArray(catalog.animation_rigs))) { errors.push('animation_rigs must be a map'); return; }
  for (const [profileId, profile] of Object.entries(rigs)) {
    const prefix = `animation rig ${profileId}`;
    if (!PRESENTATION_ID.test(profileId)) errors.push(`${prefix}: invalid id`);
    if (!profile || typeof profile !== 'object' || Array.isArray(profile) || !PRESENTATION_ID.test(String(profile.base_slot ?? '')) || !profile.slots || typeof profile.slots !== 'object' || Array.isArray(profile.slots) || !Object.keys(profile.slots).length) { errors.push(`${prefix}: needs base_slot and slots`); continue; }
    if (!profile.slots[profile.base_slot]) errors.push(`${prefix}: base_slot is absent from slots`);
    const orders = new Set();
    for (const [slotId, slot] of Object.entries(profile.slots)) {
      if (!PRESENTATION_ID.test(slotId)) errors.push(`${prefix}: invalid slot ${slotId}`);
      if (!slot || typeof slot !== 'object' || Array.isArray(slot) || !Number.isInteger(slot.order)) errors.push(`${prefix}: slot ${slotId} needs integer order`);
      else if (orders.has(slot.order)) errors.push(`${prefix}: slot order ${slot.order} is duplicated`); else orders.add(slot.order);
      if (slot?.required !== undefined && typeof slot.required !== 'boolean') errors.push(`${prefix}: slot ${slotId}.required must be boolean`);
      if (slot?.registration !== undefined && !['exact', 'custom-anchor'].includes(slot.registration)) errors.push(`${prefix}: slot ${slotId}.registration must be exact or custom-anchor`);
      for (const field of Object.keys(slot ?? {})) if (!['order', 'required', 'registration'].includes(field)) errors.push(`${prefix}: slot ${slotId}.${field} is unknown`);
    }
    if (profile.qa_assemblies !== undefined) {
      if (!Array.isArray(profile.qa_assemblies) || !profile.qa_assemblies.length) errors.push(`${prefix}.qa_assemblies must be a non-empty array`);
      const assemblyIds = new Set();
      for (const [index, assembly] of (profile.qa_assemblies ?? []).entries()) {
        const assemblyPrefix = `${prefix}: qa assembly ${index}`;
        if (!assembly || typeof assembly !== 'object' || Array.isArray(assembly) || !PRESENTATION_ID.test(String(assembly.id ?? ''))) { errors.push(`${assemblyPrefix} needs an id`); continue; }
        if (assemblyIds.has(assembly.id)) errors.push(`${assemblyPrefix}: id ${assembly.id} is duplicated`); else assemblyIds.add(assembly.id);
        if (!PRESENTATION_ID.test(String(assembly.base ?? ''))) errors.push(`${assemblyPrefix}.base must be an asset id`);
        if (!assembly.equipment || typeof assembly.equipment !== 'object' || Array.isArray(assembly.equipment)) errors.push(`${assemblyPrefix}.equipment must be a slot-to-asset map`);
        if (assembly.control !== undefined && typeof assembly.control !== 'boolean') errors.push(`${assemblyPrefix}.control must be boolean`);
        for (const field of Object.keys(assembly)) if (!['id', 'base', 'equipment', 'control'].includes(field)) errors.push(`${assemblyPrefix}.${field} is unknown`);
      }
    }
    if (profile.state_bases !== undefined) {
      if (!profile.state_bases || typeof profile.state_bases !== 'object' || Array.isArray(profile.state_bases) || !Object.keys(profile.state_bases).length) errors.push(`${prefix}.state_bases must be a non-empty state-to-asset map`);
      for (const [stateId, baseId] of Object.entries(profile.state_bases ?? {})) if (!PRESENTATION_ID.test(stateId) || !PRESENTATION_ID.test(String(baseId))) errors.push(`${prefix}.state_bases has invalid state or asset id`);
    }
    if (profile.control !== undefined) {
      if (!RIG_CONTROL_SCHEMES.has(profile.control?.scheme)) errors.push(`${prefix}.control.scheme must be four-way or horizontal`);
      if (!PRESENTATION_ID.test(String(profile.control?.idle_state ?? '')) || !PRESENTATION_ID.test(String(profile.control?.move_state ?? ''))) errors.push(`${prefix}.control needs idle_state and move_state ids`);
      for (const field of Object.keys(profile.control ?? {})) if (!['scheme', 'idle_state', 'move_state'].includes(field)) errors.push(`${prefix}.control.${field} is unknown`);
    }
    for (const field of Object.keys(profile)) if (!['base_slot', 'slots', 'qa_assemblies', 'state_bases', 'control'].includes(field)) errors.push(`${prefix}.${field} is unknown`);
  }
  for (const [assetId, asset] of Object.entries(assets)) {
    const rig = asset.animation?.rig; if (!rig) continue; const profile = rigs[rig.profile];
    if (!profile) { errors.push(`asset ${assetId}: animation.rig references unknown profile ${rig.profile}`); continue; }
    if (!profile.slots?.[rig.slot]) errors.push(`asset ${assetId}: animation.rig references unknown slot ${rig.slot}`);
    if (rig.slot === profile.base_slot) {
      if (!asset.tags?.includes('actor') || asset.tags?.includes('animation-layer')) errors.push(`asset ${assetId}: rig base slot must be an actor, not an animation-layer`);
    } else if (!asset.tags?.includes('animation-layer')) errors.push(`asset ${assetId}: non-base rig slot must be tagged animation-layer`);
  }
  for (const [profileId, profile] of Object.entries(rigs)) {
    const participants = Object.entries(assets).filter(([, asset]) => asset.animation?.rig?.profile === profileId);
    const bases = participants.filter(([, asset]) => asset.animation.rig.slot === profile.base_slot);
    if (!bases.length) { errors.push(`animation rig ${profileId}: no base asset is registered`); continue; }
    for (const [layerId, layer] of participants.filter(([, asset]) => asset.animation.rig.slot !== profile.base_slot)) for (const [baseId, base] of bases) validateRigPair(baseId, base, layerId, layer, profileId, profile.slots[layer.animation.rig.slot], errors);
    const basesByState = new Map();
    for (const [baseId, base] of bases) for (const state of base.animation.rig.states ?? Object.keys(base.animation.states ?? {})) {
      if (!base.animation.states?.[state]) errors.push(`animation rig ${profileId}: base ${baseId} registers absent state ${state}`);
      if (!basesByState.has(state)) basesByState.set(state, []); basesByState.get(state).push(baseId);
    }
    for (const [stateId, baseId] of Object.entries(profile.state_bases ?? {})) {
      if (!basesByState.get(stateId)?.includes(baseId)) errors.push(`animation rig ${profileId}: state_bases.${stateId} must name a base asset that implements that state`);
    }
    if (profile.control) {
      if (!profile.state_bases?.[profile.control.idle_state]) errors.push(`animation rig ${profileId}: control idle_state lacks state_bases registration`);
      if (!profile.state_bases?.[profile.control.move_state]) errors.push(`animation rig ${profileId}: control move_state lacks state_bases registration`);
    }
    for (const [layerId, layer] of participants.filter(([, asset]) => asset.animation.rig.slot !== profile.base_slot)) for (const state of layer.animation.rig.states ?? Object.keys(layer.animation.states ?? {})) if (!basesByState.has(state)) errors.push(`animation rig ${profileId}: layer ${layerId} state ${state} has no compatible base`);
    for (const assembly of profile.qa_assemblies ?? []) {
      const base = assets[assembly.base];
      if (!base || base.animation?.rig?.profile !== profileId || base.animation?.rig?.slot !== profile.base_slot) errors.push(`animation rig ${profileId}: qa assembly ${assembly.id} base is incompatible`);
      for (const [slot, selection] of Object.entries(assembly.equipment ?? {})) {
        if (!profile.slots?.[slot] || slot === profile.base_slot) errors.push(`animation rig ${profileId}: qa assembly ${assembly.id} has invalid equipment slot ${slot}`);
        const stateSelections = typeof selection === 'string' ? { '*': selection } : { ...(selection?.default ? { '*': selection.default } : {}), ...(selection?.states ?? {}) };
        if (!stateSelections || typeof stateSelections !== 'object' || Array.isArray(stateSelections) || !Object.keys(stateSelections).length) { errors.push(`animation rig ${profileId}: qa assembly ${assembly.id} slot ${slot} needs an asset id or states map`); continue; }
        for (const [stateId, layerId] of Object.entries(stateSelections)) {
          const layer = assets[layerId];
          if (stateId !== '*' && !base?.animation?.states?.[stateId] && !profile.state_bases?.[stateId]) errors.push(`animation rig ${profileId}: qa assembly ${assembly.id} slot ${slot} references unknown rig state ${stateId}`);
          if (!layer || layer.animation?.rig?.profile !== profileId || layer.animation?.rig?.slot !== slot || (stateId !== '*' && layer.animation.rig.states && !layer.animation.rig.states.includes(stateId))) errors.push(`animation rig ${profileId}: qa assembly ${assembly.id} asset ${layerId} is incompatible with slot ${slot}${stateId === '*' ? '' : ` state ${stateId}`}`);
        }
      }
    }
  }
}

/** Strict runtime validation for presentation catalog v2. */
export function validatePresentationCatalog(catalog) {
  const errors = [];
  try { catalog = materializePresentationCatalog(catalog); } catch (error) { return { valid: false, errors: [error.message] }; }
  const isRuntimeCatalog = catalog?.kind === 'presentation-runtime-catalog';
  if (catalog?.schema_version !== 2) errors.push('schema_version must be 2');
  if (!['presentation-catalog', 'presentation-runtime-catalog'].includes(catalog?.kind)) errors.push('kind must be presentation-catalog or presentation-runtime-catalog');
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
    if (isRuntimeCatalog) {
      if (asset.source !== undefined || asset.source_sha256 !== undefined || asset.provenance !== undefined || asset.distribution !== undefined) errors.push(`${prefix}: runtime catalogs must not expose private source metadata`);
      if (!String(asset.image_url ?? '').startsWith('/api/v1/presentation/catalogs/')) errors.push(`${prefix}: runtime catalog image_url must use the presentation asset API`);
    } else {
      if (!asset.source || String(asset.source).startsWith('/') || String(asset.source).includes('..')) errors.push(`${prefix}: source must be a canonical relative path`);
      if (!/^[a-f0-9]{64}$/.test(String(asset.source_sha256 ?? ''))) errors.push(`${prefix}: source_sha256 must be a sha256`);
    }
    if (!['isolated', 'seamless'].includes(asset.edge_policy)) errors.push(`${prefix}: edge_policy must be isolated or seamless`);
    const geometry = asset.geometry;
    if (!['grid', 'freeform'].includes(geometry?.layout)) errors.push(`${prefix}: exact geometry is required`);
    if (geometry?.layout === 'grid') {
      if (!isPair(geometry.cell, { positive: true }) || !isPair(geometry.grid, { positive: true })) errors.push(`${prefix}: grid geometry needs cell and grid`);
      if (geometry.cross_cell_alpha !== undefined && (!geometry.cross_cell_alpha || typeof geometry.cross_cell_alpha !== 'object' || Array.isArray(geometry.cross_cell_alpha) || !Array.isArray(geometry.cross_cell_alpha.allowed_axes) || !geometry.cross_cell_alpha.allowed_axes.length || geometry.cross_cell_alpha.allowed_axes.some((axis) => !['horizontal', 'vertical'].includes(axis)) || !String(geometry.cross_cell_alpha.reason ?? '').trim())) errors.push(`${prefix}: geometry.cross_cell_alpha needs allowed_axes and a review reason`);
    }
    if (!asset.frames || typeof asset.frames !== 'object' || !Object.keys(asset.frames).length) errors.push(`${prefix}: frames are required`);
    for (const [frameId, frame] of Object.entries(asset.frames ?? {})) {
      if (!PRESENTATION_ID.test(frameId)) errors.push(`${prefix}: invalid frame ${frameId}`);
      if (Boolean(frame?.cell) === Boolean(frame?.rect)) errors.push(`${prefix}: frame ${frameId} needs exactly one source shape`);
      if (frame.cell && !isPair(frame.cell)) errors.push(`${prefix}: frame ${frameId} cell is invalid`);
      if (frame.rect && (!Array.isArray(frame.rect) || frame.rect.length !== 4 || frame.rect.some((value) => !Number.isInteger(value) || value < 0))) errors.push(`${prefix}: frame ${frameId} rect is invalid`);
      if (frame.transparent !== undefined && typeof frame.transparent !== 'boolean') errors.push(`${prefix}: frame ${frameId} transparent must be boolean`);
      if (frame.transparent === true && frame.content_bounds !== undefined) errors.push(`${prefix}: transparent frame ${frameId} cannot declare content_bounds`);
      if (frame.subject_bounds !== undefined) {
        const bounds = frame.subject_bounds; const size = frame.rect?.slice(2) ?? geometry?.cell; const content = frame.content_bounds;
        if (!Array.isArray(bounds) || bounds.length !== 4 || bounds.some((value) => !Number.isInteger(value) || value < 0) || bounds[2] < 1 || bounds[3] < 1) errors.push(`${prefix}: frame ${frameId} subject_bounds is invalid`);
        else {
          if (!isPair(size, { positive: true }) || bounds[0] + bounds[2] > size[0] || bounds[1] + bounds[3] > size[1]) errors.push(`${prefix}: frame ${frameId} subject_bounds exceeds frame`);
          if (!Array.isArray(content) || content.length !== 4 || bounds[0] < content[0] || bounds[1] < content[1] || bounds[0] + bounds[2] > content[0] + content[2] || bounds[1] + bounds[3] > content[1] + content[3]) errors.push(`${prefix}: frame ${frameId} subject_bounds must be enclosed by content_bounds`);
        }
      }
      if (frame.scale_reference !== undefined && (!PRESENTATION_ID.test(String(frame.scale_reference)) || !asset.frames?.[frame.scale_reference] || frame.scale_reference === frameId)) errors.push(`${prefix}: frame ${frameId} scale_reference must name another frame`);
      if (typeof frame.anchor === 'string' && !ANCHORS.has(frame.anchor)) errors.push(`${prefix}: frame ${frameId} anchor is invalid`);
      if (frame.allow_edge_contact !== undefined) errors.push(`${prefix}: frame ${frameId} uses legacy allow_edge_contact; use edge_contact metadata`);
      if (frame.edge_contact !== undefined) {
        if (!Array.isArray(frame.edge_contact?.allowed) || frame.edge_contact.allowed.some((side) => !['north', 'east', 'south', 'west'].includes(side)) || !String(frame.edge_contact?.reason ?? '').trim()) errors.push(`${prefix}: frame ${frameId} edge_contact needs allowed sides and reason`);
      }
      if (frame.ground_contact !== undefined) {
        if (!isPair(frame.ground_contact?.point) || !String(frame.ground_contact?.reason ?? '').trim()) errors.push(`${prefix}: frame ${frameId} ground_contact needs a point and review reason`);
        if (!isPair(frame.anchor?.point) || frame.ground_contact?.point?.some((value, index) => value !== frame.anchor.point[index])) errors.push(`${prefix}: frame ${frameId} ground_contact point must equal its custom anchor`);
      }
      validateLandings(frame.landings, `${prefix}: frame ${frameId} landings`, errors);
      validateCrossings(frame.crossings, frame.landings ?? asset.world?.landings, `${prefix}: frame ${frameId} crossings`, errors);
    }
    validateAutotileMetadata(asset, prefix, errors);
    validateComponentMetadata(asset, prefix, errors);
    errors.push(...validateAssetAnimation(asset, prefix));
    validateWorldMetadata(asset, prefix, errors);
    validateAnimationLayers(catalog, id, asset, prefix, errors);
    const scaleClass = styleProfiles?.[asset.style_profile]?.scale_classes?.[asset.world?.scale_class];
    if (asset.world?.scale_class && !scaleClass) errors.push(`${prefix}: unknown scale_class ${asset.world.scale_class}`);
    if (scaleClass) for (const [frameId, frame] of Object.entries(asset.frames ?? {})) if (frame.content_bounds && !asset.tags?.includes('animation-layer')) {
      const scaleFrame = frame.scale_reference ? asset.frames?.[frame.scale_reference] : frame;
      const logicalHeight = (scaleFrame?.subject_bounds ?? scaleFrame?.content_bounds)?.[3] / asset.pixel_density;
      const [minimum, maximum] = scaleClass.logical_height;
      if (!Number.isFinite(logicalHeight)) errors.push(`${prefix}: frame ${frameId} scale reference needs subject_bounds or content_bounds`);
      else if (logicalHeight < minimum || logicalHeight > maximum) errors.push(`${prefix}: frame ${frameId} logical subject height ${logicalHeight} is outside ${asset.world.scale_class} range ${minimum}-${maximum}`);
    }
    if (asset.world?.shadow_profile && !shadows[asset.world.shadow_profile]) errors.push(`${prefix}: unknown shadow_profile ${asset.world.shadow_profile}`);
  }

  validateAnimationRigProfiles(catalog, errors);

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
    else if (!assets?.[assetId]?.autotile?.supported_polarities?.includes(entry.polarity)) errors.push(`${prefix}: asset does not support declared ${entry.polarity} polarity`);
    if (entry?.underlay !== undefined && !['inside-fill', 'outside-fill'].includes(entry.underlay)) errors.push(`${prefix}: underlay must be inside-fill or outside-fill`);
    if (entry?.transition_band !== undefined) {
      const band = entry.transition_band;
      if (!band || typeof band !== 'object' || Array.isArray(band)) errors.push(`${prefix}: transition_band must be a map`);
      else if (!Number.isFinite(band.minimum_changed_ratio) || band.minimum_changed_ratio <= 0 || band.minimum_changed_ratio > 1) errors.push(`${prefix}: transition_band.minimum_changed_ratio must be greater than 0 and at most 1`);
    }
    if (entry?.seam !== undefined) {
      const seam = entry.seam;
      if (!seam || typeof seam !== 'object' || Array.isArray(seam) || Object.keys(seam).some((field) => !['mode', 'maximum_mismatch_ratio'].includes(field))) errors.push(`${prefix}: seam supports only mode and maximum_mismatch_ratio`);
      else {
        if (seam.mode !== undefined && !['receiving-fill', 'outlined'].includes(seam.mode)) errors.push(`${prefix}: seam.mode must be receiving-fill or outlined`);
        if (seam.maximum_mismatch_ratio !== undefined && (!Number.isFinite(seam.maximum_mismatch_ratio) || seam.maximum_mismatch_ratio < 0 || seam.maximum_mismatch_ratio > 1)) errors.push(`${prefix}: seam.maximum_mismatch_ratio must be between 0 and 1`);
      }
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
    const reverse = Object.entries(catalog?.terrain_interfaces ?? {}).find(([reverseId, candidate]) => reverseId !== id && candidate?.inside === entry?.outside && candidate?.outside === entry?.inside);
    if (reverse && id < reverse[0]) errors.push(`${prefix}: material pair also declares reverse visual owner ${reverse[0]}`);
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
  const requestedFrame = frameName ?? parsed.frame;
  if (asset?.status !== 'approved') throw new Error(`unavailable asset: ${parsed.asset}`);
  const state = asset.animation?.states?.[requestedFrame];
  const stateReference = state?.clip ?? state?.facings?.south ?? Object.values(state?.facings ?? {})[0];
  const stateClip = typeof stateReference === 'string' ? stateReference : stateReference?.clip;
  const clipEntry = (asset.clips?.[requestedFrame] ?? asset.clips?.[stateClip])?.frames?.[0];
  const resolvedFrame = asset.frames?.[requestedFrame]
    ? requestedFrame
    : typeof clipEntry === 'string' ? clipEntry : clipEntry?.frame;
  if (!resolvedFrame || !asset.frames?.[resolvedFrame]) throw new Error(`asset ${parsed.asset} has no frame or clip: ${requestedFrame}`);
  return { assetId: parsed.asset, asset, frameId: resolvedFrame, frame: asset.frames[resolvedFrame] };
}
