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
 * Pure module: no React, no fetching, no logging, no `console.*`. The one
 * import is `sequenceStaffCanDraw`, `deriveStage`'s own adapter onto the
 * one-staff renderer's geometry limits (task 2, ask-platform SP1).
 * Every error string is shaped `'<axis-or-rule>: <detail>'` — greppable and
 * stable, never a thrown exception.
 */

import { sequenceStaffCanDraw } from './stagecraft.js';

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
  //
  // `placed` NAMES THE VOCABULARY TARGET, not today's enforcement. Today's
  // cued gate (`gateAsk.js:requirementForLevel`) builds a rubric of
  // `{ completeness, cleanliness }` only — placement is computed and folded
  // into the score, but `assessmentAttempt.js`'s `failedCriteria` never
  // checks a placement criterion, so nothing hard-gates on it. Tier-3's
  // preset below says `judging: 'placed'` because that is the axis value
  // that *describes* tier 3 in this vocabulary, not because today's engine
  // enforces a placement threshold. Wiring `placed` to an actual hard gate
  // is a deliberate future decision (tightening current behaviour), never
  // an incidental consequence of reading this preset — a caller that wires
  // it as "require placement" without that decision being made explicitly
  // would make tier 3 stricter than it is today, breaking SP1's
  // reproduces-today contract.
  judging: Object.freeze(['completion', 'clean', 'placed']),
  hints: Object.freeze(['none', 'after-stall', 'always']),
});

/** Axes that resolve into `presentation` — "how it is shown". */
const PRESENTATION_AXES = Object.freeze(['prompt', 'secondary', 'notationStyle', 'timing', 'hints']);

/** Simple (flat-vocabulary) axes `validateAsk` checks by list membership. `source` is handled separately — its vocabulary is keyed by kind, not a flat array. */
const SIMPLE_AXES = Object.freeze(['texture', 'hands', 'prompt', 'secondary', 'notationStyle', 'timing', 'judging', 'hints']);

/**
 * The axes a JUDGED ask cannot be missing: what's played (`texture`,
 * `hands`, `source`), the primary channel (`prompt`), and how it's timed
 * and graded (`timing`, `judging`). `secondary`, `notationStyle`, and
 * `hints` stay optional even in complete mode — they are conditional
 * (a secondary surface / notation style only matters when a staff renders;
 * a hint policy only matters once hints exist) rather than always-required.
 * Used only by `validateAsk`'s `{ complete: true }` mode.
 */
const REQUIRED_COMPLETE_AXES = Object.freeze(['texture', 'hands', 'source', 'prompt', 'timing', 'judging']);

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
  // `judging: 'placed'` here names tier 3's vocabulary position, not a hard
  // placement gate — see the long comment on `AXES.judging` above. Today's
  // actual tier-3 enforcement is completeness + cleanliness; placement is
  // score-weighted only. This preset must keep reproducing exactly that
  // until a later task explicitly decides to tighten it.
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
 * value, or a malformed grading policy) are collected into `errors` instead —
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

  // SP2's held-matcher policy. This is deliberately grading metadata rather
  // than a second matcher name: the engine still selects `held` from the
  // material's unordered shape, then changes only how that matcher compares
  // the currently held set. `bassPitchClass` is meaningful only in that mode.
  if (explicitGrading.pitchClass !== undefined && typeof explicitGrading.pitchClass !== 'boolean') {
    errors.push('grading.pitchClass: must be boolean');
  }
  if (explicitGrading.bassPitchClass !== undefined) {
    if (!Number.isInteger(explicitGrading.bassPitchClass) || explicitGrading.bassPitchClass < 0 || explicitGrading.bassPitchClass > 11) {
      errors.push('grading.bassPitchClass: must be an integer from 0 to 11');
    }
    if (explicitGrading.pitchClass !== true) errors.push('grading.bassPitchClass: requires pitchClass');
  }

  return { material: level.material ?? null, presentation, grading, errors };
}

/**
 * Validates one flat ask tuple against the grammar (every axis value must be
 * in `AXES`) and the executable constraint table:
 *
 *  - `placed` judging ⇒ `cued` timing.
 *  - `cued` timing ⇒ a source that can carry note values — a POSITIVE check
 *    (`source.kind` must be `bank` or `score`), not a blocklist on
 *    `synthesized` alone. A `cued` tuple with no `source` at all is exactly
 *    as much a violation as one with `source.kind: 'synthesized'` — "cued
 *    needs a note-carrying source" fails equally whether the source is the
 *    wrong kind or simply absent. This check runs in BOTH partial and
 *    complete mode: asserting `timing: 'cued'` is itself an implicit claim
 *    about `source`, unlike axes that are merely not-yet-decided, so partial
 *    mode's general "absent axis = not yet specified, skip" leniency does
 *    not extend to this one cross-axis pairing.
 *  - `score` source ⇒ `score` notation style.
 *  - `recall` prompt ⇒ source is not `score`.
 *  - `sequence` notation style ⇒ a single hand (not `both`) at ≤ 2 octaves.
 *  - `polyphony` texture ⇒ `engraved` or `score` notation style.
 *  - `recall` and the named hint policies are grammar-valid presentation
 *    values. Their rendering lives below this pure schema in `ExerciseRun`.
 *
 * **Two modes.** Default (partial) mode treats an absent axis as "not yet
 * specified" and simply skips its vocabulary check — this is for a caller
 * validating a tuple that's still being assembled, or checking one
 * constraint in isolation. It intentionally does NOT require every axis, so
 * `validateAsk({})` reports `ok: true` — an empty tuple violates no
 * constraint because it makes no claim. That is by design for partial use,
 * but it is also the exact shape a careless caller hands in when they meant
 * to validate a REAL, finished ask (e.g. `expandAsk(level).presentation`,
 * which never carries `texture`/`hands`/`source`/`judging` at all) — pass
 * `{ complete: true }` for that: it additionally requires
 * `REQUIRED_COMPLETE_AXES` (`texture`, `hands`, `source`, `prompt`,
 * `timing`, `judging`) to be present, emitting `'missing-axis: <name>'` for
 * each one that's missing. A `null`/`{}` input is NEVER `ok: true` in
 * complete mode.
 *
 * @param {object} tuple `{ texture, hands, source:{kind,...params}, prompt, secondary, notationStyle?, timing, judging, hints? }`
 * @param {{ complete?: boolean }} [options] `complete: true` requires the judging-relevant axes to be present.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateAsk(tuple, options) {
  const errors = [];
  const t = tuple ?? {};
  const complete = options?.complete === true;

  if (complete) {
    for (const axis of REQUIRED_COMPLETE_AXES) {
      if (t[axis] === undefined) errors.push(`missing-axis: ${axis}`);
    }
  }

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

  // cued ⇒ material that can carry note values (bank/score) — positive
  // check, so an ABSENT source fails this exactly like a synthesized one.
  if (t.timing === 'cued' && !['bank', 'score'].includes(sourceKind)) {
    errors.push(`cued: requires source bank or score, not ${sourceKind ?? 'absent'}`);
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
  return { ok: errors.length === 0, errors };
}

/**
 * Which SCREEN a tuple's presentation axes mount, given the material instance
 * they are being asked of.
 *
 * A thin adapter from tuple-space onto the geometry `stagecraft.js` owns
 * (`sequenceStaffCanDraw`). Built in task 2 of ask-platform SP1 alongside a
 * tier-numbered twin, `stageForTier` (`PianoKiosk/modes/Exercises/
 * runPresentation.js`), which computed the identical routing from a `0|1|2|3`
 * tier rather than from the axis values a tuple actually carries. Task 5b
 * wired `ExerciseRun` to this function instead — it builds a tuple with
 * `askTupleFor({ tier: runTier }, null)` and calls `deriveStage(tuple,
 * instance)` — and deleted `stageForTier`, which had no other caller.
 * `askSchema.test.js`'s 16-cell table (`{4 presets} × {ordering any/strict} ×
 * {canDraw yes/no}`) is the proof the two agreed on every cell before the
 * switch, and stays as the pure-function regression check after it.
 *
 * @param {object} tuple A flat ask tuple, or a `presentation`-shaped subset of
 *   one (`expandAsk(level).presentation`, or a `PRESETS['tier-N']` entry
 *   directly) — only `notationStyle` and `prompt` are read.
 * @param {object} instance The bank instance the ask is drawn against.
 *   `instance.ordering === 'any'` and `sequenceStaffCanDraw(instance)` are
 *   both read from it.
 * @returns {'keys'|'sequence'|'notation'|'score'}
 *
 * Precedence, most-specific first:
 *
 *  1. **`notationStyle: 'score'`** → `'score'`. A tuple only carries this
 *     value for score-sourced material (`validateAsk`'s `score source ⇒
 *     notationStyle score` constraint) — the one case with an actual
 *     engraved document behind it, which `ExerciseRun` short-circuits to
 *     before this function is even called (`stage = score ? 'score' :
 *     deriveStage(...)`). Checked first because it is the hardest fact of
 *     the three: an ask with a document behind it has exactly one honest
 *     stage, independent of ordering or prompt.
 *  2. **`instance.ordering === 'any'`** → `'keys'`. There is no ordered
 *     notation for an unordered ask (a chord, an interval) — true at every
 *     tier, including one a host named explicitly.
 *  3. **`prompt: 'follow'`** (tiers 0-1) → `'keys'`. Whether a reinforcement
 *     staff is offered alongside it is `secondary`'s question, not this
 *     function's — `ExerciseRun` computes that from `staffFitsAsk`, unmoved
 *     by task 5b.
 *  4. **`notationStyle: 'sequence'`** (tier 2) → `'sequence'` when
 *     `sequenceStaffCanDraw(instance)` allows it, else `'notation'` — the
 *     one-staff renderer's own limits (a declared grand staff, genuinely
 *     two-hand material, or a span past one staff's band) fall back to the
 *     engraved path rather than draw the material dishonestly.
 *  5. **Otherwise** → `'notation'` — tier 3's `engraved`/cued reading, and the
 *     fallback for anything else `read`-prompted.
 */
export function deriveStage(tuple, instance) {
  const t = tuple ?? {};
  if (t.notationStyle === 'score') return 'score';
  // Recall's target is named in language, not shown as answer lights. It must
  // win before unordered material's ordinary keys-stage fallback.
  if (t.prompt === 'recall') return 'recall';
  if (t.prompt === 'read' && instance?.events?.length === 1 && instance.events[0]?.notes?.length === 1) return 'single-note';
  if (instance?.ordering === 'any') return 'keys';
  if (t.prompt === 'follow') return 'keys';
  if (t.notationStyle === 'sequence') return sequenceStaffCanDraw(instance) ? 'sequence' : 'notation';
  return 'notation';
}

/**
 * Which `source` axis value a material spec's KIND names.
 *
 * The schema's source axis and the material vocabulary are two names for one
 * fact, and this is the only place they meet. Supplying it is what lets the
 * constraint table say anything at all about a legacy level: a `tier: 3` level
 * asserts `timing: cued`, and `cued ⇒ a source that can carry note values` can
 * only be checked once the material it was picked with is known.
 */
const SOURCE_KIND = Object.freeze({ keys: 'synthesized', exercise: 'bank', score: 'score' });

/**
 * The flat ask tuple a level plus its picked material actually expresses.
 *
 * Two facts come from the MATERIAL rather than from the level, because the
 * level never states them:
 *
 *  - `source`, above.
 *  - `notationStyle: 'score'` for score material, at every tier. That is not a
 *    liberty: it reproduces the short-circuit the run surface has always run
 *    (`stage = score ? 'score' : deriveStage(...)`) — a document has exactly
 *    one honest stage, and a tier-2 level naming a passage still engraves it.
 *
 * Errors from both halves are concatenated: `expandAsk`'s (an unknown tier, an
 * out-of-vocabulary axis, a not-yet-implemented one) and the constraint table's.
 *
 * **Moved here from `ask/AskSession.jsx` in task 5b of ask-platform SP1**, so
 * `ExerciseRun` — which builds a tuple from its own resolved `tier` and calls
 * `deriveStage` with it — can import this alongside `deriveStage` without
 * reaching into `AskSession.jsx`, which imports `ExerciseRun` back (a cycle).
 * `AskSession.jsx` re-exports this name unchanged for its own callers and
 * tests; nothing about its behaviour moved, only its address.
 *
 * @param {object} levelLike A repertoire level, legacy or explicit shaped.
 * @param {object|null} spec The material spec the host picked for it.
 * @returns {{ tuple: object, errors: string[] }}
 */
export function askTupleFor(levelLike, spec) {
  const { presentation, grading, errors } = expandAsk(levelLike);
  const sourceKind = SOURCE_KIND[spec?.kind];
  const tuple = {
    ...presentation,
    judging: grading.judging,
    ...(sourceKind ? { source: { kind: sourceKind } } : {}),
    ...(sourceKind === 'score' ? { notationStyle: 'score' } : {}),
  };
  return { tuple, errors: [...errors, ...validateAsk(tuple).errors] };
}
