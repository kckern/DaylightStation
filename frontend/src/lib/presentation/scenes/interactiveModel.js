import {
  resolveAssetAnimation,
  resolveAssetAnimationTransition,
  resolveRiggedAnimationState,
  resolveRiggedAssetAnimation,
} from '@shared-presentation/index.mjs';

export const DEMO_THEME_TAGS = Object.freeze([
  'default', 'desert', 'volcano', 'dungeon', 'shroom', 'halloween', 'cave', 'free', 'sewer', 'coastal', 'farm', 'animal', 'enemy', 'player',
]);

function referenceClip(reference) { return typeof reference === 'string' ? reference : reference?.clip; }

export function clipFrameAtTime(clip, elapsedMs, { reducedMotion = false } = {}) {
  if (!clip?.frames?.length) return null;
  const frameId = (entry) => typeof entry === 'string' ? entry : entry.frame;
  if (reducedMotion || clip.frames.length === 1) return frameId(clip.frames[0]);
  if (typeof clip.frames[0] === 'object') {
    const forward = clip.frames; const sequence = clip.loop === 'ping-pong' && forward.length > 1 ? [...forward, ...forward.slice(1, -1).reverse()] : forward;
    const duration = sequence.reduce((sum, entry) => sum + entry.duration_ms, 0); const position = clip.loop === 'once' ? Math.min(Math.max(0, elapsedMs), duration - 1) : Math.max(0, elapsedMs) % duration;
    let cursor = 0;
    for (const entry of sequence) { cursor += entry.duration_ms; if (position < cursor) return entry.frame; }
    return frameId(sequence.at(-1));
  }
  const phase = Math.max(0, Math.floor(elapsedMs * (clip.fps ?? 1) / 1000));
  if (clip.loop === 'once') return frameId(clip.frames[Math.min(phase, clip.frames.length - 1)]);
  if (clip.loop === 'ping-pong' && clip.frames.length > 1) {
    const cycle = clip.frames.length * 2 - 2; const index = phase % cycle;
    return frameId(clip.frames[index < clip.frames.length ? index : cycle - index]);
  }
  return frameId(clip.frames[phase % clip.frames.length]);
}

export function clipDurationMs(clip) {
  if (!clip?.frames?.length) return 0;
  if (typeof clip.frames[0] === 'object') return clip.frames.reduce((sum, entry) => sum + entry.duration_ms, 0);
  return clip.fps ? clip.frames.length / clip.fps * 1000 : 0;
}

function inferPlacedVisual(asset, initialFrame) {
  for (const [state, descriptor] of Object.entries(asset.animation?.states ?? {})) {
    if (descriptor.clip) {
      const clip = asset.clips?.[referenceClip(descriptor.clip)];
      if (clip?.frames.includes(initialFrame)) return { state, facing: null, clip: referenceClip(descriptor.clip), flip_x: false };
    }
    for (const [facing, reference] of Object.entries(descriptor.facings ?? {})) {
      const clipId = referenceClip(reference); if (asset.clips?.[clipId]?.frames.includes(initialFrame)) return { state, facing, clip: clipId, flip_x: typeof reference === 'object' && reference.flip_x === true };
    }
  }
  return null;
}

export function animateSceneCommands(catalog, plan, elapsedMs, { objectStates = {}, reducedMotion = false } = {}) {
  return plan.commands.map((command) => {
    if (command.type !== 'sprite') return command;
    const asset = catalog.assets?.[command.asset];
    if (asset?.animation?.mode !== 'state-machine') return command;
    const override = objectStates[command.provenance];
    if (override?.transition) {
      const resolved = resolveAssetAnimationTransition(asset, override.transition, { facing: override.facing ?? 'south', from: override.from });
      const clip = asset.clips[resolved.clip]; const frame = clipFrameAtTime(clip, elapsedMs - override.startedAt, { reducedMotion });
      return { ...command, frame, flip_x: Boolean(command.flip_x) !== Boolean(resolved.flip_x) };
    }
    const inferred = inferPlacedVisual(asset, command.frame); const state = override?.state ?? inferred?.state ?? asset.animation.default_state;
    try {
      const resolved = resolveAssetAnimation(asset, { state, facing: override?.facing ?? inferred?.facing ?? 'south' });
      const frame = clipFrameAtTime(asset.clips[resolved.clip], elapsedMs - (override?.startedAt ?? 0), { reducedMotion });
      return { ...command, frame, flip_x: Boolean(command.flip_x) !== Boolean(resolved.flip_x) };
    } catch {
      return command;
    }
  });
}

export function actorChoices(catalog) {
  const choices = [];
  for (const [profileId, profile] of Object.entries(catalog.animation_rigs ?? {})) {
    const states = Object.keys(profile.state_bases ?? {});
    const base = Object.entries(catalog.assets).find(([, asset]) => asset.animation?.rig?.profile === profileId && asset.animation.rig.slot === profile.base_slot)?.[0];
    choices.push({ id: `rig:${profileId}`, label: profileId.replaceAll('.', ' '), kind: 'rig', profile: profileId, base, states: states.length ? states : Object.keys(catalog.assets[base]?.animation?.states ?? {}), assemblies: profile.qa_assemblies ?? [] });
  }
  for (const [assetId, asset] of Object.entries(catalog.assets ?? {})) {
    if (!asset.tags?.includes('actor') || asset.tags.includes('animation-layer') || asset.animation?.mode !== 'state-machine' || asset.animation.rig) continue;
    choices.push({ id: `asset:${assetId}`, label: assetId.replaceAll('.', ' '), kind: 'asset', asset: assetId, states: Object.keys(asset.animation.states ?? {}), assemblies: [] });
  }
  return choices.sort((left, right) => {
    const priority = (choice) => choice.id === 'rig:player.default' ? 0 : choice.id.startsWith('rig:') ? 1 : 2;
    return priority(left) - priority(right) || left.label.localeCompare(right.label);
  });
}

export function equipmentForAssembly(choice, assemblyId) {
  return choice?.assemblies?.find((assembly) => assembly.id === assemblyId)?.equipment ?? {};
}

export function statesForAssembly(catalog, choice, assemblyId) {
  const assembly = choice?.assemblies?.find((entry) => entry.id === assemblyId);
  if (!assembly) return choice?.states ?? [];
  return Object.keys(catalog.assets[assembly.base]?.animation?.states ?? {});
}

function resolvedActorLayers(catalog, choice, { state, facing, moving, equipment }) {
  if (choice.kind === 'asset') return { ...resolveAssetAnimation(catalog.assets[choice.asset], { state, facing, moving }), layers: [{ asset: choice.asset, role: 'body', ...resolveAssetAnimation(catalog.assets[choice.asset], { state, facing, moving }) }] };
  const profile = catalog.animation_rigs[choice.profile];
  if (profile.state_bases) return resolveRiggedAnimationState(catalog, choice.profile, { state, facing, moving, equipment });
  return resolveRiggedAssetAnimation(catalog, choice.base, { state, facing, moving, equipment });
}

export function actorPlaybackInfo(catalog, choice, { state, facing = 'south', moving = false, equipment = {} } = {}) {
  if (!choice) return null;
  const resolved = resolvedActorLayers(catalog, choice, { state, facing, moving, equipment }); const base = resolved.layers[0]; const asset = catalog.assets[base.asset]; const clip = asset.clips[base.clip]; const descriptor = asset.animation?.states?.[state];
  return { asset: base.asset, clip: base.clip, durationMs: clipDurationMs(clip), once: clip?.loop === 'once', returnTo: descriptor?.return_to ?? null, terminal: descriptor?.terminal === true };
}

export function actorCommands(catalog, choice, { at, state, facing = 'south', moving = false, equipment = {}, elapsedMs = 0, reducedMotion = false } = {}) {
  if (!choice) return [];
  const resolved = resolvedActorLayers(catalog, choice, { state, facing, moving, equipment }); const commands = [];
  const baseAsset = catalog.assets[resolved.layers[0].asset]; const shadowId = baseAsset.world?.shadow_profile; const shadow = catalog.shadow_profiles?.[shadowId];
  if (shadow) commands.push({ type: 'shadow', at: [at[0] + (shadow.offset?.[0] ?? 0), at[1] + (shadow.offset?.[1] ?? 0)], size: shadow.size, color: shadow.color ?? '#000000', opacity: shadow.opacity ?? 0.25, render_layer: 'shadow', sort_y: at[1] - 0.01, provenance: 'runtime:player-shadow' });
  for (const layer of resolved.layers) {
    const asset = catalog.assets[layer.asset]; const clip = asset.clips[layer.clip];
    commands.push({ type: 'sprite', asset: layer.asset, frame: clipFrameAtTime(clip, elapsedMs, { reducedMotion }), at, source_cell_offset: [0, 0], flip_x: layer.flip_x, rotation: 0, opacity: 1, render_layer: asset.world?.render_layer ?? 'actor', sort_y: at[1], provenance: `runtime:player:${layer.role}`, semantic_role: 'actor' });
  }
  return commands;
}

export function findWalkableSpawn(plan) {
  const center = [Math.floor(plan.grid.columns / 2), Math.floor(plan.grid.rows / 2)];
  for (let radius = 0; radius < Math.max(plan.grid.columns, plan.grid.rows); radius += 1) {
    const candidates = [];
    for (let y = Math.max(0, center[1] - radius); y <= Math.min(plan.grid.rows - 1, center[1] + radius); y += 1) for (let x = Math.max(0, center[0] - radius); x <= Math.min(plan.grid.columns - 1, center[0] + radius); x += 1) if (Math.max(Math.abs(x - center[0]), Math.abs(y - center[1])) === radius) candidates.push([x, y]);
    const found = candidates.find(([x, y]) => plan.navigation_grid?.[y]?.[x]);
    if (found) return [(found[0] + 0.5) * plan.grid.cell[0], (found[1] + 1) * plan.grid.cell[1]];
  }
  return [plan.logical_size[0] / 2, plan.logical_size[1] / 2];
}

function walkableAt(plan, [x, y]) {
  const column = Math.floor(x / plan.grid.cell[0]); const row = Math.floor((y - 1) / plan.grid.cell[1]);
  return Boolean(plan.navigation_grid?.[row]?.[column]);
}

export function moveActor(plan, at, delta) {
  const clamped = [Math.max(1, Math.min(plan.logical_size[0] - 1, at[0] + delta[0])), Math.max(1, Math.min(plan.logical_size[1], at[1] + delta[1]))];
  if (walkableAt(plan, clamped)) return clamped;
  const horizontal = [clamped[0], at[1]]; if (walkableAt(plan, horizontal)) return horizontal;
  const vertical = [at[0], clamped[1]]; if (walkableAt(plan, vertical)) return vertical;
  return at;
}

export function interactivePlacements(catalog, plan) {
  const seen = new Set(); const result = [];
  for (const command of plan.commands) {
    if (command.type !== 'sprite' || !command.provenance?.startsWith('placement:') || seen.has(command.provenance)) continue;
    const asset = catalog.assets[command.asset]; const transitions = Object.keys(asset.animation?.transitions ?? {});
    if (!transitions.length && !asset.tags?.some((tag) => ['interactable', 'destructible', 'item'].includes(tag))) continue;
    seen.add(command.provenance); result.push({ key: command.provenance, command, asset: command.asset, transitions });
  }
  return result;
}

export function nearestInteractive(items, at, maximumDistance = 28) {
  return items.map((item) => ({ item, distance: Math.hypot(item.command.at[0] - at[0], item.command.at[1] - at[1]) })).filter(({ distance }) => distance <= maximumDistance).sort((a, b) => a.distance - b.distance)[0]?.item ?? null;
}

export function catalogCoverage(catalog) {
  const assets = Object.entries(catalog.assets ?? {}); const tags = Object.fromEntries(DEMO_THEME_TAGS.map((tag) => [tag, assets.filter(([id, asset]) => asset.tags?.includes(tag) || id.startsWith(`${tag}.`) || id.includes(`.${tag}.`)).length]));
  return {
    assets: assets.length,
    actors: assets.filter(([, asset]) => asset.tags?.includes('actor')).length,
    animated: assets.filter(([, asset]) => asset.animation?.mode === 'state-machine').length,
    objects: assets.filter(([, asset]) => asset.animation?.transitions && Object.keys(asset.animation.transitions).length).length,
    rigs: Object.keys(catalog.animation_rigs ?? {}).length,
    tags,
  };
}
