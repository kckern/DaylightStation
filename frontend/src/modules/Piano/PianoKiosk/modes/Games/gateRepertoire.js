/**
 * gateRepertoire — the pure data structure behind the piano game challenge's
 * config-driven level ladder.
 *
 * A "level" is `{ id, tier, grading, material }`. `tier` is a coarse
 * difficulty band (0-3); `grading` is either a rubric-shaped object or
 * `null` (unfailable — used only by the floor). `material` is a non-empty
 * array of specs (see `materialKey` below); a level with more than one
 * spec rotates through them via `pickMaterial` so a child does not see the
 * same drill twice in a row.
 *
 * D9: the easiest level in ANY resolved repertoire must be unfailable. A
 * household's config is free to author its own tier-0/no-grading floor —
 * `resolveRepertoire` recognizes and keeps that as THE floor — but if it
 * doesn't, or if the config is empty/malformed, `BUILT_IN_FLOOR` is
 * prepended beneath index 0 regardless. There is no code path through this
 * module that produces a repertoire whose index 0 can fail a child.
 *
 * Pure: no imports, no React, no fetching, no logging, no throwing.
 */

export const BUILT_IN_FLOOR = Object.freeze({
  id: 'floor-key',
  tier: 0,
  grading: null,
  material: Object.freeze([Object.freeze({ kind: 'keys', notes: 1, arrangement: 'together' })]),
});

export const FALLBACK_LEVEL = Object.freeze({
  id: 'fallback-c-major',
  tier: 2,
  grading: null,
  material: Object.freeze([
    Object.freeze({ kind: 'exercise', instanceId: 'scales/modes@root=C,mode=ionian,direction=up,span_octaves=1' }),
  ]),
});

/** `raw`-level validity: the only shape resolveRepertoire will trust as authored. */
function isValidLevel(level) {
  if (!level || typeof level !== 'object') return false;
  if (typeof level.id !== 'string' || level.id.length === 0) return false;
  if (!Number.isInteger(level.tier) || level.tier < 0 || level.tier > 3) return false;
  if (!Array.isArray(level.material) || level.material.length === 0) return false;
  return level.material.every((m) => m && typeof m === 'object' && typeof m.kind === 'string');
}

/**
 * A tier-0 level with no grading block is already unfailable — the same
 * contract BUILT_IN_FLOOR exists to guarantee. Config authors who supply
 * one get to keep it as the floor rather than have it pushed to index 1.
 */
function isUnfailableFloor(level) {
  return level.tier === 0 && (level.grading === null || level.grading === undefined);
}

export function resolveRepertoire(raw) {
  const validRaw = Array.isArray(raw) ? raw.filter(isValidLevel) : [];
  const source = validRaw.length ? validRaw : [FALLBACK_LEVEL];
  const levels = source.map((level) => ({
    id: level.id,
    tier: level.tier,
    grading: level.grading ?? null,
    material: level.material,
  }));
  return isUnfailableFloor(levels[0]) ? levels : [BUILT_IN_FLOOR, ...levels];
}

export function levelById(levels, id) {
  return levels.find((level) => level.id === id) ?? null;
}

export function startLevelFor(levels, config) {
  const requested = config?.startLevel != null ? levelById(levels, config.startLevel) : null;
  return requested ?? levels[1] ?? levels[0];
}

function indexOfId(levels, id) {
  const i = levels.findIndex((level) => level.id === id);
  return i < 0 ? 0 : i;
}

export function degradeLevel(levels, id) {
  const i = indexOfId(levels, id);
  return levels[Math.max(0, i - 1)];
}

export function climbLevel(levels, id) {
  const i = indexOfId(levels, id);
  return levels[Math.min(levels.length - 1, i + 1)];
}

export function isFloorLevel(levels, id) {
  return indexOfId(levels, id) === 0;
}

/**
 * Stable identity for a material spec, distinguishing anything the config
 * distinguishes:
 *   - `exercise` with `instanceId`  -> the instance id is already unique.
 *   - `exercise` without one (a collection-shaped request, resolved later
 *     by the material provider) -> collection + roots + hands + cued.
 *   - `score`   -> source + measures.
 *   - anything else (e.g. `keys`)   -> kind + a sorted JSON of its own
 *     fields, so a new material kind never collides by accident.
 */
export function materialKey(spec) {
  if (!spec || typeof spec !== 'object') return 'unknown';
  const { kind } = spec;
  if (kind === 'exercise') {
    if (spec.instanceId) return `exercise:${spec.instanceId}`;
    const roots = Array.isArray(spec.roots) ? spec.roots.join(',') : '';
    return `exercise|${spec.collection ?? ''}|${roots}|${spec.hands ?? ''}|${spec.cued ? 'cued' : ''}`;
  }
  if (kind === 'score') {
    return `score|${spec.source ?? ''}|${spec.measures ?? ''}`;
  }
  const rest = Object.keys(spec).filter((k) => k !== 'kind').sort()
    .map((k) => `${k}=${JSON.stringify(spec[k])}`).join(',');
  return `${kind}|${rest}`;
}

/**
 * Deterministic rotation: never the same spec twice running within a
 * level. `candidates` starts as the level's full material list; if there
 * is more than one and the last-served key matches one of them, that one
 * is dropped before indexing, so index `pickIndex % candidates.length`
 * always lands on something else. A single-material level has nothing to
 * rotate to and always serves its one spec.
 */
export function pickMaterial(level, lastMaterialId, pickIndex) {
  let candidates = level.material;
  if (candidates.length > 1) {
    const filtered = candidates.filter((spec) => materialKey(spec) !== lastMaterialId);
    if (filtered.length) candidates = filtered;
  }
  return candidates[pickIndex % candidates.length];
}
