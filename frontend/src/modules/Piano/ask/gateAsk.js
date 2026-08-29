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
 * Pure: no React, no fetching, no logging, no throwing.
 */

import { expandAsk } from './askSchema.js';

const CUED_CLEANLINESS_DEFAULT = 0.8;

export function requirementForLevel(level) {
  const { presentation, grading } = expandAsk(level);
  const legacyGrading = level?.grading ?? null;
  // SP1's legacy levels made the presence of a grading block mean a cued
  // rung. Explicit grammar owns timing directly, which lets a free recall ask
  // carry a pitch-class policy without accidentally becoming a timed one.
  const cued = level?.presentation != null
    ? presentation.timing === 'cued'
    : level?.tier === 3 || legacyGrading !== null;
  const policy = grading.pitchClass === true
    ? {
      pitchClass: true,
      ...(grading.bassPitchClass !== undefined ? { bassPitchClass: grading.bassPitchClass } : {}),
    }
    : null;
  if (!cued) {
    const exactFree = level?.presentation != null && grading.judging === 'clean';
    return {
      mode: 'free',
      rubric: {
        criteria: exactFree
          ? { completeness: 1, cleanliness: grading.cleanliness ?? 1 }
          : { completeness: 1 },
      },
      passScore: null,
      ...(policy ? { policy } : {}),
    };
  }
  return {
    mode: 'cued',
    rubric: { criteria: { completeness: 1, cleanliness: grading.cleanliness ?? CUED_CLEANLINESS_DEFAULT } },
    passScore: null,
    ...(policy ? { policy } : {}),
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

export function askForMaterial(spec, instance, tuple = null) {
  if (spec?.kind === 'keys') {
    if (tuple?.prompt === 'recall' && typeof spec.root === 'string' && typeof spec.quality === 'string') {
      return `Play a ${spec.root} ${spec.quality} chord.`;
    }
    if (spec.notes === 1) return 'Press the lit key.';
    return spec.arrangement === 'sequence' ? 'Play the lit keys in order.' : 'Play these notes together.';
  }
  if (spec?.kind === 'exercise') {
    return instance ? askForExercise(instance) : 'Play the exercise.';
  }
  if (spec?.kind === 'score') return 'Play this passage as written.';
  return 'Play this.';
}

/**
 * Why this screen exists, in one line, from the host's own context.
 *
 * Four shapes, and a host names the one it IS rather than the sentence it
 * wants — the copy lives here and nowhere else, which is what keeps a URL
 * query or a config file from becoming a second place a child's words are
 * written.
 *
 * `program` and `lesson` say the same words today, deliberately kept apart: a
 * program step and a video lesson's checkpoint make a child the same promise
 * ("pass this and the thing you were doing is finished"), but the LABEL is a
 * different fact about a different host, and a change to one line must not
 * silently rewrite the other.
 *
 * `practice` answers `null` — a child who chose an exercise from the browser
 * has its detail page one tap behind them, so the exercise's own title stays
 * the headline. It is a real answer, not a missing one: a host that says
 * "practice" is refusing a framing line rather than forgetting to supply one.
 */
export function framingFor(context) {
  if (context?.kind === 'gate') return `Play this to start ${context.gameLabel}`;
  if (context?.kind === 'program') return `Pass this to finish ${context.stepLabel}`;
  if (context?.kind === 'lesson') return `Pass this to finish ${context.lessonLabel}`;
  return null;
}
