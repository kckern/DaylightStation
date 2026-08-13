const CARDINAL_FACINGS = Object.freeze(['north', 'east', 'south', 'west']);
const HORIZONTAL_FACINGS = Object.freeze(['east', 'west']);
const MOTION_KINDS = new Set(['stationary', 'in-place', 'locomotion', 'airborne']);
const CONTROL_SCHEMES = Object.freeze({
  'four-way': CARDINAL_FACINGS,
  horizontal: HORIZONTAL_FACINGS,
});

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
  const reachableClips = new Set();
  for (const [stateId, state] of Object.entries(states)) {
    const statePrefix = `${prefix}: animation state ${stateId}`;
    if (!state || typeof state !== 'object' || Array.isArray(state) || !MOTION_KINDS.has(state.motion)) {
      errors.push(`${statePrefix} needs motion stationary, in-place, locomotion, or airborne`);
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
    for (const reference of hasFacings ? Object.values(state.facings ?? {}) : hasClip ? [state.clip] : []) {
      const clipId = referencedClip(reference); const frameCount = asset.clips?.[clipId]?.frames?.length ?? 0;
      if (['locomotion', 'in-place'].includes(state.motion) && frameCount < 2) errors.push(`${statePrefix}: ${state.motion} clip ${clipId} needs at least two frames`);
    }
    for (const field of Object.keys(state)) if (!['motion', 'clip', 'facings'].includes(field)) errors.push(`${statePrefix}.${field} is unknown`);
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
  for (const clipId of Object.keys(asset.clips ?? {})) if (!reachableClips.has(clipId)) errors.push(`${prefix}: clip ${clipId} is unreachable from animation states`);
  for (const field of Object.keys(animation)) if (!['mode', 'default_state', 'states', 'control'].includes(field)) errors.push(`${prefix}: animation.${field} is unknown for state-machine mode`);
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

export const ANIMATION_FACINGS = CARDINAL_FACINGS;
