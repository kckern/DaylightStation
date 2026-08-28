/**
 * gateRepertoire — the pure data structure behind the piano game challenge's
 * config-driven level ladder.
 *
 * A "level" is `{ id, tier, presentation?, grading, material }`. `tier` is a coarse
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

/**
 * Structurally valid AND uniquely identified, in config order. An id that
 * repeats one already accepted — or that collides with the built-in floor's
 * own id — is dropped rather than kept: `levelById`/the index walk resolve
 * only the first match for a given id, so a duplicate would silently make
 * navigation land on the wrong level. First occurrence in `raw` wins.
 */
function collectValidLevels(raw) {
  const seenIds = new Set([BUILT_IN_FLOOR.id]);
  const collected = [];
  for (const level of Array.isArray(raw) ? raw : []) {
    if (!isValidLevel(level)) continue;
    if (seenIds.has(level.id)) continue;
    seenIds.add(level.id);
    collected.push(level);
  }
  return collected;
}

export function resolveRepertoire(raw) {
  const validRaw = collectValidLevels(raw);
  const source = validRaw.length ? validRaw : [FALLBACK_LEVEL];
  // Result is ordered easiest-first by tier. Array.prototype.sort is stable,
  // so two levels sharing a tier keep their config-authored relative order —
  // only cross-tier order is corrected, never within-tier authoring intent.
  const ordered = [...source].sort((a, b) => a.tier - b.tier);
  const levels = ordered.map((level) => ({
    id: level.id,
    tier: level.tier,
    // The explicit ask grammar is not an alternate side channel. Preserve its
    // presentation axes exactly so `AskSession` can expand them; dropping
    // this object here used to make a YAML `prompt: recall` silently revert to
    // the tier preset before the child saw it.
    ...(level.presentation ? { presentation: level.presentation } : {}),
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

// An id that isn't found (stale save, renamed level) defaults to index 0 —
// chosen, not accidental: index 0 is always the unfailable floor (D9), so
// an unresolvable id fails safe toward "can't fail the child" rather than
// toward whatever level happens to sit at some other index.
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
    // Roots are a set, not a sequence — ['C','G'] and ['G','C'] name the same
    // material, so sort before joining rather than trusting authoring order.
    const roots = Array.isArray(spec.roots) ? [...spec.roots].sort().join(',') : '';
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
 * level, and — across a run of calls whose `pickIndex` advances by one
 * each time, the way a caller naturally drives it (serve, remember its
 * key, increment) — every candidate gets reached, not just a 2-cycle.
 *
 * Index into the FULL candidate list first (`pickIndex % n`); only if
 * THAT candidate is the one just served do we step forward one more,
 * wrapping. Dropping the last-served candidate before taking the modulo
 * (the earlier approach) shrinks the list to n-1 and re-partitions it
 * identically every call, which at n=3 starves the middle candidate
 * forever (A,C,A,C,... — B never served). Indexing the full list first
 * keeps every position reachable as `pickIndex` advances; the single
 * extra step only ever fires to avoid an immediate repeat.
 */
export function pickMaterial(level, lastMaterialId, pickIndex) {
  const candidates = level.material;
  const n = candidates.length;
  let index = pickIndex % n;
  if (n > 1 && materialKey(candidates[index]) === lastMaterialId) {
    index = (index + 1) % n;
  }
  return candidates[index];
}
