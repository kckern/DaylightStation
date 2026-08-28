/**
 * askSchema — the nine ask axes, their vocabulary, and the executable
 * constraint table, as one single source of truth.
 *
 * "The Ask — what is played, how it is shown, how it is judged"
 * (`docs/superpowers/specs/2026-08-28-ask-platform-roadmap-design.md`) maps
 * directly onto the three fields `expandAsk` returns:
 *   - **what is played** → `texture`, `hands`, `source` → carried in `material`
 *     (this module passes material through untouched; resolving it is a
 *     later layer's job).
 *   - **how it is shown** → `prompt`, `secondary`, `notationStyle`, `timing`,
 *     `hints` → `presentation`.
 *   - **how it is judged** → `judging` (plus rubric detail such as
 *     `cleanliness`) → `grading`.
 *
 * Pure module: no imports, no React, no fetching, no logging, no `console.*`.
 * Every error string is shaped `'<axis-or-rule>: <detail>'` — greppable and
 * stable, never a thrown exception.
 */

/** The nine axes and their vocabularies (the roadmap's MECE table, as data). */
export const AXES = Object.freeze({
  texture: Object.freeze(['unison', 'chord', 'line', 'polyphony']),
  hands: Object.freeze(['right', 'left', 'both', 'either']),
  // Parameters nest only under the source value that owns them — a `bank`
  // ask's `octaves` means nothing on a `synthesized` one.
  source: Object.freeze({
    synthesized: Object.freeze({ params: Object.freeze(['count', 'register']) }),
    bank: Object.freeze({
      params: Object.freeze(['family', 'root', 'mode', 'quality', 'direction', 'octaves', 'inversion']),
    }),
    score: Object.freeze({ params: Object.freeze(['sourceId', 'measureStart', 'measureEnd']) }),
  }),
  prompt: Object.freeze(['follow', 'recall', 'read']),
  secondary: Object.freeze(['none', 'staff', 'keyboard-strip']),
  notationStyle: Object.freeze(['sequence', 'engraved', 'score']),
  timing: Object.freeze(['free', 'pulsed', 'cued']),
  // Ordered, cumulative: `clean` implies `completion`'s bar was cleared too;
  // `placed` implies `clean`'s. The ordering itself isn't enforced here — it
  // describes the rubric a downstream grader builds, not a schema rule.
  judging: Object.freeze(['completion', 'clean', 'placed']),
  hints: Object.freeze(['none', 'after-stall', 'always']),
});

/** Axes that resolve into `presentation` — "how it is shown". */
const PRESENTATION_AXES = Object.freeze(['prompt', 'secondary', 'notationStyle', 'timing', 'hints']);

/** Simple (flat-vocabulary) axes `validateAsk` checks by list membership. `source` is handled separately — its vocabulary is keyed by kind, not a flat array. */
const SIMPLE_AXES = Object.freeze(['texture', 'hands', 'prompt', 'secondary', 'notationStyle', 'timing', 'judging', 'hints']);

/**
 * Today's tiers, re-expressed as named presets. Reproduces current behaviour
 * exactly — this is the compat contract later tasks lean on to serve live
 * YAML unchanged.
 */
export const PRESETS = Object.freeze({
  'tier-0': Object.freeze({ prompt: 'follow', secondary: 'none', timing: 'free', judging: 'completion' }),
  'tier-1': Object.freeze({ prompt: 'follow', secondary: 'staff', timing: 'free', judging: 'completion' }),
  'tier-2': Object.freeze({
    prompt: 'read',
    secondary: 'keyboard-strip',
    notationStyle: 'sequence',
    timing: 'free',
    judging: 'completion',
  }),
  'tier-3': Object.freeze({
    prompt: 'read',
    secondary: 'keyboard-strip',
    notationStyle: 'engraved',
    timing: 'cued',
    judging: 'placed',
  }),
});

/** The `presentation`-shaped subset of a preset (or override) bundle. */
function pickPresentation(bundle) {
  const out = {};
  for (const key of PRESENTATION_AXES) {
    if (bundle[key] !== undefined) out[key] = bundle[key];
  }
  return out;
}

/**
 * Expands a level into its full ask tuple.
 *
 * Accepts BOTH shapes:
 *  - legacy repertoire level: `{ tier, material, grading }` — `tier` selects
 *    the preset; `grading`'s non-`judging` keys (e.g. `cleanliness`) pass
 *    through untouched.
 *  - explicit form: `{ material, presentation, grading }` — starts from the
 *    same tier-derived (or floor, `tier-0`) preset, then each explicit key
 *    overrides the preset's value one axis at a time.
 *
 * Never throws. Problems (an unknown tier, an out-of-vocabulary explicit
 * value, an unimplemented prompt/hint) are collected into `errors` instead —
 * this function's job is to always produce a usable, inspectable tuple.
 *
 * @param {object} levelLike
 * @returns {{ material: unknown, presentation: object, grading: object, errors: string[] }}
 */
export function expandAsk(levelLike) {
  const errors = [];
  const level = levelLike ?? {};

  let base = PRESETS['tier-0'];
  if (level.tier !== undefined && level.tier !== null) {
    const preset = PRESETS[`tier-${level.tier}`];
    if (!preset) {
      errors.push(`tier: unknown preset tier-${level.tier}`);
    } else {
      base = preset;
    }
  }

  const presentation = pickPresentation(base);
  const explicitPresentation = level.presentation ?? {};
  for (const [key, value] of Object.entries(explicitPresentation)) {
    if (!PRESENTATION_AXES.includes(key)) {
      errors.push(`presentation: unknown axis ${key}`);
      continue;
    }
    presentation[key] = value;
  }
  for (const key of PRESENTATION_AXES) {
    const value = presentation[key];
    if (value !== undefined && !AXES[key].includes(value)) {
      errors.push(`${key}: unknown value ${value}`);
    }
  }

  const explicitGrading = level.grading ?? {};
  const judging = explicitGrading.judging ?? base.judging;
  const grading = { ...explicitGrading, judging };
  if (judging !== undefined && !AXES.judging.includes(judging)) {
    errors.push(`judging: unknown value ${judging}`);
  }

  if (presentation.prompt === 'recall') errors.push('not-yet-implemented: recall');
  if (presentation.hints !== undefined && presentation.hints !== 'none') {
    errors.push('not-yet-implemented: hints');
  }

  return { material: level.material ?? null, presentation, grading, errors };
}

/**
 * Validates one flat ask tuple against the grammar (every axis value must be
 * in `AXES`) and the executable constraint table:
 *
 *  - `placed` judging ⇒ `cued` timing.
 *  - `cued` timing ⇒ a source that can carry note values (`bank`/`score`,
 *    never `synthesized`).
 *  - `score` source ⇒ `score` notation style.
 *  - `recall` prompt ⇒ source is not `score`.
 *  - `sequence` notation style ⇒ a single hand (not `both`) at ≤ 2 octaves.
 *  - `polyphony` texture ⇒ `engraved` or `score` notation style.
 *  - `recall` prompt, or any `hints` other than `none`, is grammar-valid but
 *    not yet implemented (SP2) — reported as a distinct
 *    `'not-yet-implemented: <name>'` error, never a silent drop.
 *
 * A tuple's `notationStyle` and `hints` may be omitted (they apply only when
 * a staff renders / a hint policy is set); every other axis is expected.
 *
 * @param {object} tuple `{ texture, hands, source:{kind,...params}, prompt, secondary, notationStyle?, timing, judging, hints? }`
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateAsk(tuple) {
  const errors = [];
  const t = tuple ?? {};

  for (const axis of SIMPLE_AXES) {
    const value = t[axis];
    if (value === undefined) continue;
    if (!AXES[axis].includes(value)) errors.push(`${axis}: unknown value ${value}`);
  }

  const sourceKind = t.source?.kind;
  if (t.source !== undefined && !Object.keys(AXES.source).includes(sourceKind)) {
    errors.push(`source: unknown value ${sourceKind}`);
  }

  // placed ⇒ cued
  if (t.judging === 'placed' && t.timing !== 'cued') {
    errors.push('placed: requires timing cued');
  }

  // cued ⇒ material that can carry note values (bank/score, not synthesized)
  if (t.timing === 'cued' && sourceKind === 'synthesized') {
    errors.push('cued: requires source bank or score, not synthesized');
  }

  // score source ⇒ style score
  if (sourceKind === 'score' && t.notationStyle !== 'score') {
    errors.push('source: score requires notationStyle score');
  }

  // recall ⇒ source != score
  if (t.prompt === 'recall' && sourceKind === 'score') {
    errors.push('recall: source cannot be score');
  }

  // sequence style ⇒ single hand, <= 2 octaves
  if (t.notationStyle === 'sequence') {
    if (t.hands === 'both') errors.push('sequence: hands cannot be both');
    const octaves = t.source?.octaves;
    if (typeof octaves === 'number' && octaves > 2) errors.push('sequence: source octaves must be <= 2');
  }

  // polyphony ⇒ engraved or score
  if (t.texture === 'polyphony' && !['engraved', 'score'].includes(t.notationStyle)) {
    errors.push('polyphony: requires notationStyle engraved or score');
  }

  // not-yet-implemented gate (SP2)
  if (t.prompt === 'recall') errors.push('not-yet-implemented: recall');
  if (t.hints !== undefined && t.hints !== 'none') errors.push('not-yet-implemented: hints');

  return { ok: errors.length === 0, errors };
}
