const CARDINAL_FACINGS = Object.freeze(['north', 'east', 'south', 'west']);
const HORIZONTAL_FACINGS = Object.freeze(['east', 'west']);
const MOTION_KINDS = new Set(['stationary', 'in-place', 'locomotion', 'kinematic', 'airborne']);
const CONTROL_SCHEMES = Object.freeze({
  'four-way': CARDINAL_FACINGS,
  horizontal: HORIZONTAL_FACINGS,
});
const CLIP_QA_PROFILES = new Set(['tight', 'expressive', 'transform', 'mechanism']);
const STATEFUL_OBJECT_TAGS = new Set(['interactable', 'destructible', 'stateful']);
const ASSET_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

function clipFrameIds(clip) {
  return (clip?.frames ?? []).map((entry) => typeof entry === 'string' ? entry : entry?.frame);
}

function validateClip(asset, clipId, clip, prefix, errors) {
  if (!clip || typeof clip !== 'object' || Array.isArray(clip) || !Array.isArray(clip.frames) || !clip.frames.length) {
    errors.push(`${prefix}: clip ${clipId} needs a non-empty frames array`);
    return;
  }
  const timed = clip.frames.some((entry) => typeof entry === 'object');
  if (timed && clip.frames.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.frame !== 'string' || !Number.isInteger(entry.duration_ms) || entry.duration_ms < 1)) errors.push(`${prefix}: clip ${clipId} has invalid timed frames`);
  if (timed && clip.fps !== undefined) errors.push(`${prefix}: clip ${clipId} cannot mix fps with duration_ms`);
  if (!timed && (!Number.isFinite(clip.fps) || clip.fps <= 0)) errors.push(`${prefix}: clip ${clipId} needs positive fps`);
  if (clip.loop !== undefined && !['loop', 'once', 'ping-pong'].includes(clip.loop)) errors.push(`${prefix}: clip ${clipId} has invalid loop mode`);
  if (clip.qa_profile !== undefined && !CLIP_QA_PROFILES.has(clip.qa_profile)) errors.push(`${prefix}: clip ${clipId} qa_profile must be tight, expressive, transform, or mechanism`);
  for (const field of Object.keys(clip)) if (!['frames', 'fps', 'loop', 'qa_profile'].includes(field)) errors.push(`${prefix}: clip ${clipId}.${field} is unknown`);
  for (const frameId of clipFrameIds(clip)) if (!asset.frames?.[frameId]) errors.push(`${prefix}: clip ${clipId} references unknown frame ${frameId}`);
}

function validateClipReference(asset, reference, prefix, errors) {
  const descriptor = typeof reference === 'string' ? { clip: reference } : reference;
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor) || typeof descriptor.clip !== 'string') {
    errors.push(`${prefix} must name a clip`);
    return;
  }
  if (!asset.clips?.[descriptor.clip]) errors.push(`${prefix} references unknown clip ${descriptor.clip}`);
  if (descriptor.flip_x !== undefined && typeof descriptor.flip_x !== 'boolean') errors.push(`${prefix}.flip_x must be boolean`);
  for (const field of Object.keys(descriptor)) if (!['clip', 'flip_x'].includes(field)) errors.push(`${prefix}.${field} is unknown`);
}

function referencedClip(reference) {
  return typeof reference === 'string' ? reference : reference?.clip;
}

function referenceClipIds(entry) {
  if (entry?.clip !== undefined) return [referencedClip(entry.clip)];
  return Object.values(entry?.facings ?? {}).map(referencedClip);
}

function clipEndpoint(asset, clipId, end) {
  const entries = asset.clips?.[clipId]?.frames ?? [];
  const entry = end === 'first' ? entries[0] : entries.at(-1);
  return typeof entry === 'string' ? entry : entry?.frame;
}

/**
 * Validate the renderer-neutral animation contract for one asset.
 *
 * Actors and every asset that declares clips must explicitly say whether it is
 * static, deferred for curation, or driven by a reviewed state machine. This
 * prevents a sheet with dozens of cells from being called animation-ready
 * merely because its first frame can be placed in a scene.
 */
export function validateAssetAnimation(asset, prefix = 'asset') {
  const errors = [];
  for (const [clipId, clip] of Object.entries(asset.clips ?? {})) validateClip(asset, clipId, clip, prefix, errors);

  const requiresDisposition = asset.tags?.includes('actor') || asset.tags?.includes('animated') || Object.keys(asset.clips ?? {}).length > 0;
  const animation = asset.animation;
  if (!animation) {
    if (requiresDisposition) errors.push(`${prefix}: actor/animated assets and assets with clips need explicit animation metadata`);
    return errors;
  }
  if (typeof animation !== 'object' || Array.isArray(animation) || !['static', 'deferred', 'state-machine'].includes(animation.mode)) {
    errors.push(`${prefix}: animation.mode must be static, deferred, or state-machine`);
    return errors;
  }

  if (animation.mode === 'static') {
    if (!asset.frames?.[animation.default_frame]) errors.push(`${prefix}: static animation.default_frame must name a frame`);
    if (Object.keys(asset.clips ?? {}).length) errors.push(`${prefix}: static animation cannot leave clips unreachable`);
    if (animation.facing !== undefined && !CARDINAL_FACINGS.includes(animation.facing)) errors.push(`${prefix}: static animation.facing is invalid`);
    for (const field of Object.keys(animation)) if (!['mode', 'default_frame', 'facing'].includes(field)) errors.push(`${prefix}: animation.${field} is unknown for static mode`);
    return errors;
  }

  if (animation.mode === 'deferred') {
    if (typeof animation.reason !== 'string' || !animation.reason.trim()) errors.push(`${prefix}: deferred animation needs a reason`);
    if (!asset.frames?.[animation.preview_frame]) errors.push(`${prefix}: deferred animation.preview_frame must name a reviewed frame`);
    for (const field of Object.keys(animation)) if (!['mode', 'reason', 'preview_frame'].includes(field)) errors.push(`${prefix}: animation.${field} is unknown for deferred mode`);
    return errors;
  }

  const states = animation.states;
  if (!states || typeof states !== 'object' || Array.isArray(states) || !Object.keys(states).length) {
    errors.push(`${prefix}: state-machine animation needs states`);
    return errors;
  }
  if (!states[animation.default_state]) errors.push(`${prefix}: animation.default_state is unknown`);
  if (animation.layers !== undefined) {
    if (!Array.isArray(animation.layers) || !animation.layers.length) errors.push(`${prefix}: animation.layers must be a non-empty array`);
    const layerIds = new Set();
    for (const [index, layer] of (animation.layers ?? []).entries()) {
      const layerPrefix = `${prefix}: animation layer ${index}`;
      if (!layer || typeof layer !== 'object' || Array.isArray(layer) || !ASSET_ID.test(String(layer.asset ?? ''))) {
        errors.push(`${layerPrefix}.asset must be a catalog asset id`);
        continue;
      }
      if (layerIds.has(layer.asset)) errors.push(`${layerPrefix}.asset is duplicated`);
      layerIds.add(layer.asset);
      if (layer.role !== undefined && !ASSET_ID.test(String(layer.role))) errors.push(`${layerPrefix}.role must be an id`);
      if (layer.states !== undefined && (!Array.isArray(layer.states) || !layer.states.length || new Set(layer.states).size !== layer.states.length || layer.states.some((state) => !ASSET_ID.test(String(state))))) errors.push(`${layerPrefix}.states must contain unique state ids`);
      for (const field of Object.keys(layer)) if (!['asset', 'role', 'states'].includes(field)) errors.push(`${layerPrefix}.${field} is unknown`);
    }
  }
  if (animation.rig !== undefined) {
    const rig = animation.rig;
    if (!rig || typeof rig !== 'object' || Array.isArray(rig) || !ASSET_ID.test(String(rig.profile ?? '')) || !ASSET_ID.test(String(rig.slot ?? ''))) errors.push(`${prefix}: animation.rig needs profile and slot ids`);
    else {
      if (rig.states !== undefined && (!Array.isArray(rig.states) || !rig.states.length || new Set(rig.states).size !== rig.states.length || rig.states.some((state) => !ASSET_ID.test(String(state))))) errors.push(`${prefix}: animation.rig.states must contain unique state ids`);
      for (const field of Object.keys(rig)) if (!['profile', 'slot', 'states'].includes(field)) errors.push(`${prefix}: animation.rig.${field} is unknown`);
    }
  }
  const reachableClips = new Set();
  const facingScheme = animation.facing_scheme ?? animation.control?.scheme;
  if (animation.facing_scheme !== undefined && !CONTROL_SCHEMES[animation.facing_scheme]) errors.push(`${prefix}: animation.facing_scheme must be four-way or horizontal`);
  if (animation.control?.scheme && animation.facing_scheme && animation.control.scheme !== animation.facing_scheme) errors.push(`${prefix}: animation.facing_scheme must match animation.control.scheme`);
  const authoredFacings = animation.authored_facings;
  if (authoredFacings !== undefined && (!Array.isArray(authoredFacings) || !authoredFacings.length || new Set(authoredFacings).size !== authoredFacings.length || authoredFacings.some((facing) => !CARDINAL_FACINGS.includes(facing)))) errors.push(`${prefix}: animation.authored_facings must contain unique cardinal facings`);
  for (const [stateId, state] of Object.entries(states)) {
    const statePrefix = `${prefix}: animation state ${stateId}`;
    if (!state || typeof state !== 'object' || Array.isArray(state) || !MOTION_KINDS.has(state.motion)) {
      errors.push(`${statePrefix} needs motion stationary, in-place, locomotion, kinematic, or airborne`);
      continue;
    }
    const hasClip = state.clip !== undefined;
    const hasFacings = state.facings !== undefined;
    if (hasClip === hasFacings) errors.push(`${statePrefix} needs exactly one of clip or facings`);
    if (hasClip) {
      validateClipReference(asset, state.clip, `${statePrefix}.clip`, errors);
      reachableClips.add(referencedClip(state.clip));
    }
    if (hasFacings) {
      if (!state.facings || typeof state.facings !== 'object' || Array.isArray(state.facings) || !Object.keys(state.facings).length) errors.push(`${statePrefix}.facings must be a non-empty map`);
      for (const [facing, reference] of Object.entries(state.facings ?? {})) {
        if (!CARDINAL_FACINGS.includes(facing)) errors.push(`${statePrefix}: invalid facing ${facing}`);
        validateClipReference(asset, reference, `${statePrefix}.facings.${facing}`, errors);
        reachableClips.add(referencedClip(reference));
      }
    }
    if (state.motion === 'locomotion' && !hasFacings) errors.push(`${statePrefix}: locomotion must be directionally mapped`);
    const stateFacingScheme = state.facing_scheme ?? facingScheme;
    const stateAuthoredFacings = state.authored_facings ?? authoredFacings;
    if (state.facing_scheme !== undefined && !CONTROL_SCHEMES[state.facing_scheme]) errors.push(`${statePrefix}.facing_scheme must be four-way or horizontal`);
    if (state.authored_facings !== undefined && (!Array.isArray(state.authored_facings) || !state.authored_facings.length || new Set(state.authored_facings).size !== state.authored_facings.length || state.authored_facings.some((facing) => !CARDINAL_FACINGS.includes(facing)))) errors.push(`${statePrefix}.authored_facings must contain unique cardinal facings`);
    if (hasFacings && asset.tags?.includes('actor') && !stateFacingScheme) errors.push(`${statePrefix}: directional actor states must declare a state or animation facing_scheme, or animation.control.scheme`);
    if (hasFacings && CONTROL_SCHEMES[stateFacingScheme]) for (const facing of CONTROL_SCHEMES[stateFacingScheme]) if (!state.facings?.[facing]) errors.push(`${statePrefix}: declared ${stateFacingScheme} scheme lacks ${facing} facing`);
    if (hasFacings && Array.isArray(stateAuthoredFacings)) {
      const authoredClips = new Set();
      for (const facing of stateAuthoredFacings) {
        const reference = state.facings?.[facing];
        if (!reference) { errors.push(`${statePrefix}: declared authored facing ${facing} is missing`); continue; }
        if (typeof reference === 'object' && reference?.flip_x === true) errors.push(`${statePrefix}: authored facing ${facing} cannot be synthesized with flip_x`);
        const clipId = referencedClip(reference);
        if (authoredClips.has(clipId)) errors.push(`${statePrefix}: authored facings must reference distinct source clips`);
        authoredClips.add(clipId);
      }
    }
    for (const reference of hasFacings ? Object.values(state.facings ?? {}) : hasClip ? [state.clip] : []) {
      const clipId = referencedClip(reference); const frameCount = asset.clips?.[clipId]?.frames?.length ?? 0;
      if (['locomotion', 'in-place'].includes(state.motion) && frameCount < 2) errors.push(`${statePrefix}: ${state.motion} clip ${clipId} needs at least two frames`);
    }
    const oneShot = referenceClipIds(state).some((clipId) => asset.clips?.[clipId]?.loop === 'once');
    if (oneShot) {
      const hasReturn = state.return_to !== undefined; const terminal = state.terminal === true;
      if (hasReturn === terminal) errors.push(`${statePrefix}: one-shot state needs exactly one of return_to or terminal: true`);
      if (hasReturn && !states[state.return_to] && !animation.rig?.states) errors.push(`${statePrefix}.return_to is unknown`);
    }
    if (state.return_to !== undefined && typeof state.return_to !== 'string') errors.push(`${statePrefix}.return_to must name a state`);
    if (state.terminal !== undefined && typeof state.terminal !== 'boolean') errors.push(`${statePrefix}.terminal must be boolean`);
    for (const field of Object.keys(state)) if (!['motion', 'clip', 'facings', 'facing_scheme', 'authored_facings', 'return_to', 'terminal'].includes(field)) errors.push(`${statePrefix}.${field} is unknown`);
  }

  if (animation.control !== undefined) {
    const control = animation.control;
    const requiredFacings = CONTROL_SCHEMES[control?.scheme];
    if (!requiredFacings) errors.push(`${prefix}: animation.control.scheme must be four-way or horizontal`);
    if (!states[control?.idle_state]) errors.push(`${prefix}: animation.control.idle_state is unknown`);
    if (!states[control?.move_state]) errors.push(`${prefix}: animation.control.move_state is unknown`);
    if (states[control?.idle_state]?.motion === 'locomotion') errors.push(`${prefix}: animation.control.idle_state cannot use locomotion motion`);
    if (states[control?.move_state]?.motion !== 'locomotion') errors.push(`${prefix}: animation.control.move_state must use locomotion motion`);
    for (const stateId of [control?.idle_state, control?.move_state]) for (const facing of requiredFacings ?? []) if (!states[stateId]?.facings?.[facing]) errors.push(`${prefix}: controlled state ${stateId} lacks ${facing} facing`);
    for (const field of Object.keys(control ?? {})) if (!['scheme', 'idle_state', 'move_state'].includes(field)) errors.push(`${prefix}: animation.control.${field} is unknown`);
  }
  const transitions = animation.transitions ?? {};
  if (animation.transitions !== undefined && (!transitions || typeof transitions !== 'object' || Array.isArray(transitions) || !Object.keys(transitions).length)) errors.push(`${prefix}: animation.transitions must be a non-empty map`);
  for (const [transitionId, transition] of Object.entries(transitions)) {
    const transitionPrefix = `${prefix}: animation transition ${transitionId}`;
    if (!transition || typeof transition !== 'object' || Array.isArray(transition)) { errors.push(`${transitionPrefix} must be a map`); continue; }
    if (!states[transition.from]) errors.push(`${transitionPrefix}.from is unknown`);
    if (!states[transition.to]) errors.push(`${transitionPrefix}.to is unknown`);
    const hasClip = transition.clip !== undefined; const hasFacings = transition.facings !== undefined;
    if (hasClip === hasFacings) errors.push(`${transitionPrefix} needs exactly one of clip or facings`);
    if (hasClip) validateClipReference(asset, transition.clip, `${transitionPrefix}.clip`, errors);
    if (hasFacings) {
      if (!transition.facings || typeof transition.facings !== 'object' || Array.isArray(transition.facings) || !Object.keys(transition.facings).length) errors.push(`${transitionPrefix}.facings must be a non-empty map`);
      for (const [facing, reference] of Object.entries(transition.facings ?? {})) {
        if (!CARDINAL_FACINGS.includes(facing)) errors.push(`${transitionPrefix}: invalid facing ${facing}`);
        validateClipReference(asset, reference, `${transitionPrefix}.facings.${facing}`, errors);
      }
      if (facingScheme) for (const facing of CONTROL_SCHEMES[facingScheme]) if (!transition.facings?.[facing]) errors.push(`${transitionPrefix}: declared ${facingScheme} scheme lacks ${facing} facing`);
    }
    if (hasClip && (states[transition.from]?.facings || states[transition.to]?.facings)) errors.push(`${transitionPrefix}: directional endpoint states require transition facings`);
    const transitionReferences = hasClip ? [[null, transition.clip]] : Object.entries(transition.facings ?? {});
    for (const [facing, reference] of transitionReferences) {
      const clipId = referencedClip(reference);
      reachableClips.add(clipId);
      const clip = asset.clips?.[clipId];
      if (clip?.loop !== 'once') errors.push(`${transitionPrefix}: transition clip ${clipId} must use loop: once`);
      const fromReference = facing ? states[transition.from]?.facings?.[facing] : states[transition.from]?.clip;
      const toReference = facing ? states[transition.to]?.facings?.[facing] : states[transition.to]?.clip;
      const fromClip = referencedClip(fromReference); const toClip = referencedClip(toReference);
      if (clip && fromClip && clipEndpoint(asset, clipId, 'first') !== clipEndpoint(asset, fromClip, 'first')) errors.push(`${transitionPrefix}: clip ${clipId} must begin on state ${transition.from}${facing ? ` facing ${facing}` : ''}`);
      if (clip && toClip && clipEndpoint(asset, clipId, 'last') !== clipEndpoint(asset, toClip, 'first')) errors.push(`${transitionPrefix}: clip ${clipId} must end on state ${transition.to}${facing ? ` facing ${facing}` : ''}`);
    }
    for (const field of Object.keys(transition)) if (!['from', 'to', 'clip', 'facings'].includes(field)) errors.push(`${transitionPrefix}.${field} is unknown`);
  }
  if (asset.tags?.some((tag) => STATEFUL_OBJECT_TAGS.has(tag))) {
    if (Object.keys(states).length < 2) errors.push(`${prefix}: stateful/interactable assets need at least two stable states`);
    if (!Object.keys(transitions).length) errors.push(`${prefix}: stateful/interactable assets need explicit animation.transitions`);
  }
  for (const clipId of Object.keys(asset.clips ?? {})) if (!reachableClips.has(clipId)) errors.push(`${prefix}: clip ${clipId} is unreachable from animation states or transitions`);
  for (const field of Object.keys(animation)) if (!['mode', 'default_state', 'states', 'control', 'facing_scheme', 'authored_facings', 'transitions', 'layers', 'rig'].includes(field)) errors.push(`${prefix}: animation.${field} is unknown for state-machine mode`);
  return errors;
}

function resolveReference(reference) {
  return typeof reference === 'string' ? { clip: reference, flip_x: false } : { clip: reference.clip, flip_x: reference.flip_x ?? false };
}

/** Resolve host state + logical cardinal facing to a reviewed visual clip. */
export function resolveAssetAnimation(asset, { state, facing = 'south', moving } = {}) {
  const errors = validateAssetAnimation(asset);
  if (errors.length) throw new Error(errors.join('; '));
  const animation = asset.animation;
  if (animation.mode === 'deferred') throw new Error(`animation is deferred: ${animation.reason}`);
  if (animation.mode === 'static') return Object.freeze({ mode: 'frame', frame: animation.default_frame, facing: animation.facing ?? facing, flip_x: false });
  let stateId = state;
  if (!stateId && animation.control && moving !== undefined) stateId = moving ? animation.control.move_state : animation.control.idle_state;
  stateId ??= animation.default_state;
  const visualState = animation.states[stateId];
  if (!visualState) throw new Error(`unknown animation state: ${stateId}`);
  const reference = visualState.facings?.[facing] ?? visualState.clip;
  if (!reference) throw new Error(`animation state ${stateId} has no ${facing} facing`);
  return Object.freeze({ mode: 'clip', state: stateId, facing, motion: visualState.motion, ...resolveReference(reference) });
}

/** Resolve a reviewed state transition such as opening, breaking, or activating. */
export function resolveAssetAnimationTransition(asset, transitionId, { facing = 'south', from } = {}) {
  const errors = validateAssetAnimation(asset);
  if (errors.length) throw new Error(errors.join('; '));
  if (asset.animation.mode !== 'state-machine') throw new Error('animation transitions require state-machine mode');
  const transition = asset.animation.transitions?.[transitionId];
  if (!transition) throw new Error(`unknown animation transition: ${transitionId}`);
  if (from !== undefined && transition.from !== from) throw new Error(`transition ${transitionId} requires state ${transition.from}, not ${from}`);
  const reference = transition.facings?.[facing] ?? transition.clip;
  if (!reference) throw new Error(`animation transition ${transitionId} has no ${facing} facing`);
  return Object.freeze({ mode: 'transition', transition: transitionId, from: transition.from, to: transition.to, facing, ...resolveReference(reference) });
}

/** Resolve a base actor and every catalog-owned visual layer active for its state. */
export function resolveLayeredAssetAnimation(catalog, assetId, options = {}) {
  const asset = catalog?.assets?.[assetId];
  if (!asset) throw new Error(`unknown layered animation asset: ${assetId}`);
  const base = resolveAssetAnimation(asset, options);
  const layers = [{ asset: assetId, role: 'base', ...base }];
  for (const descriptor of asset.animation?.layers ?? []) {
    if (descriptor.states && !descriptor.states.includes(base.state)) continue;
    const layerAsset = catalog.assets?.[descriptor.asset];
    if (!layerAsset) throw new Error(`unknown animation layer asset: ${descriptor.asset}`);
    layers.push({ asset: descriptor.asset, role: descriptor.role ?? 'overlay', ...resolveAssetAnimation(layerAsset, { ...options, state: base.state }) });
  }
  return Object.freeze({ ...base, layers: Object.freeze(layers.map((layer) => Object.freeze(layer))) });
}

/** Resolve a base actor plus a runtime-selected set of catalog-compatible rig slots. */
export function resolveRiggedAssetAnimation(catalog, assetId, { equipment = {}, ...options } = {}) {
  const asset = catalog?.assets?.[assetId]; const rig = asset?.animation?.rig; const profile = catalog?.animation_rigs?.[rig?.profile];
  if (!asset) throw new Error(`unknown rigged animation asset: ${assetId}`);
  if (!rig || !profile || rig.slot !== profile.base_slot) throw new Error(`${assetId} is not a base asset for a known animation rig`);
  const base = resolveAssetAnimation(asset, options); const layers = [{ asset: assetId, role: profile.base_slot, order: profile.slots[profile.base_slot].order, ...base }];
  for (const [slot, selection] of Object.entries(equipment)) {
    const layerId = typeof selection === 'string' ? selection : selection?.states?.[base.state] ?? selection?.default;
    if (!layerId) continue;
    const slotProfile = profile.slots?.[slot]; const layer = catalog.assets?.[layerId];
    if (!slotProfile) throw new Error(`animation rig ${rig.profile} has no slot ${slot}`);
    if (slot === profile.base_slot) throw new Error(`animation rig base slot ${slot} cannot be replaced as equipment`);
    if (!layer || layer.animation?.rig?.profile !== rig.profile || layer.animation?.rig?.slot !== slot) throw new Error(`${layerId} is incompatible with animation rig ${rig.profile} slot ${slot}`);
    if (layer.animation.rig.states && !layer.animation.rig.states.includes(base.state)) continue;
    layers.push({ asset: layerId, role: slot, order: slotProfile.order, ...resolveAssetAnimation(layer, { ...options, state: base.state, facing: base.facing }) });
  }
  for (const [slot, slotProfile] of Object.entries(profile.slots ?? {})) if (slot !== profile.base_slot && slotProfile.required && !equipment[slot]) throw new Error(`animation rig ${rig.profile} requires slot ${slot}`);
  layers.sort((left, right) => left.order - right.order || left.role.localeCompare(right.role));
  return Object.freeze({ ...base, rig: rig.profile, layers: Object.freeze(layers.map(({ order, ...layer }) => Object.freeze(layer))) });
}

/** Resolve a logical rig state when its base art is split across action sheets. */
export function resolveRiggedAnimationState(catalog, profileId, { state, ...options } = {}) {
  const profile = catalog?.animation_rigs?.[profileId];
  if (!profile) throw new Error(`unknown animation rig: ${profileId}`);
  let stateId = state;
  if (!stateId && profile.control && options.moving !== undefined) stateId = options.moving ? profile.control.move_state : profile.control.idle_state;
  const baseId = profile.state_bases?.[stateId];
  if (!baseId) throw new Error(`animation rig ${profileId} has no base registered for state ${stateId}`);
  return resolveRiggedAssetAnimation(catalog, baseId, { ...options, state: stateId });
}

export const ANIMATION_FACINGS = CARDINAL_FACINGS;
