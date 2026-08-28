/**
 * gateAsk — turns a `gateRepertoire` level into the requirement the
 * assessment engine judges by, and turns a material spec (plus, for an
 * exercise, its resolved instance) into the one sentence a child reads.
 *
 * D9: a tier 0-2 level (grading `null`/absent) MUST resolve to a
 * completeness-only rubric. The engine (`assessmentAttempt.js:497-498`)
 * fails any criterion present in `requirement.rubric.criteria` — adding
 * `cleanliness` there would let a stray wrong key fail a level that is
 * supposed to be unfailable. `passScore` stays `null` everywhere: pass is
 * verdict-driven (`verdict.passed`), never a second `score >= passScore`
 * gate living alongside it.
 *
 * Pure: no imports, no React, no fetching, no logging, no throwing.
 */

const CUED_CLEANLINESS_DEFAULT = 0.8;

export function requirementForLevel(level) {
  const grading = level?.grading ?? null;
  const cued = level?.tier === 3 || grading !== null;
  if (!cued) {
    return {
      mode: 'free',
      rubric: { criteria: { completeness: 1 } },
      passScore: null,
    };
  }
  return {
    mode: 'cued',
    rubric: { criteria: { completeness: 1, cleanliness: grading?.cleanliness ?? CUED_CLEANLINESS_DEFAULT } },
    passScore: null,
  };
}

/** `ionian`/`aeolian` read as the words a child knows; anything else is its own name, capitalized. */
function modeLabel(mode) {
  if (mode === 'ionian') return 'major';
  if (mode === 'aeolian') return 'minor';
  const name = String(mode);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Every hand value across every note of every event, deduped. */
function handsInInstance(instance) {
  const hands = new Set();
  for (const event of instance?.events ?? []) {
    for (const note of event?.notes ?? []) {
      if (note?.hand) hands.add(note.hand);
    }
  }
  return hands;
}

function askForExercise(instance) {
  const axes = instance?.axes ?? {};
  if (!axes.root || !axes.mode) return instance?.title || 'Play the exercise.';
  const hands = handsInInstance(instance);
  const handClause = hands.size === 1 ? `, ${[...hands][0]} hand` : '';
  return `${axes.root} ${modeLabel(axes.mode)} scale${handClause}.`;
}

export function askForMaterial(spec, instance) {
  if (spec?.kind === 'keys') {
    if (spec.notes === 1) return 'Press the lit key.';
    return spec.arrangement === 'sequence' ? 'Play the lit keys in order.' : 'Play these notes together.';
  }
  if (spec?.kind === 'exercise') {
    return instance ? askForExercise(instance) : 'Play the exercise.';
  }
  if (spec?.kind === 'score') return 'Play this passage as written.';
  return 'Play this.';
}

export function framingFor(context) {
  if (context?.kind === 'gate') return `Play this to start ${context.gameLabel}`;
  if (context?.kind === 'program') return `Pass this to finish ${context.stepLabel}`;
  return null;
}
