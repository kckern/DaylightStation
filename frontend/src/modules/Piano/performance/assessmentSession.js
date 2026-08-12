import { createDrillRun, applyDrillPress, drillProgress } from './drillRun.js';
import {
  gradeChordPerformance,
  gradeOrderedPerformance,
  gradeBand,
  timingQuality,
  timingQualityFromDrift,
} from './grading.js';
import { matchHeldSet } from './heldSet.js';
import {
  advancePerformanceRun,
  applyPerformancePress,
  closePerformanceMeasure,
  createPerformanceRun,
} from './performanceJudge.js';
import { tallyGrades, worstSpan } from './spans.js';

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

const numericEntries = (object = {}) => Object.fromEntries(
  Object.entries(object).filter(([, value]) => Number.isFinite(value)),
);

/**
 * One configured, pure assessment state machine.
 *
 * A surface owns the returned value and replaces it with the value returned by
 * the transition functions below. Presentation (combo points, wet ink, colored
 * measures) stays outside this module; matching, observations, criteria, gates,
 * and verdicts stay here.
 */
export function createAssessmentSession({ matcher, expectation = {}, policy = {}, grading = {}, requirement = null } = {}) {
  if (!['timed', 'cursor', 'held'].includes(matcher)) {
    throw new Error(`Unsupported assessment matcher: ${matcher}`);
  }

  let run;
  if (matcher === 'timed') run = createPerformanceRun(expectation.targets || []);
  else if (matcher === 'cursor') run = createDrillRun(expectation.spans || [], policy);
  else run = { status: 'idle', wrongNotes: 0, correct: false, onsetSpanMs: 0 };

  return { matcher, expectation, policy, grading, requirement, run };
}

/** Replace score-derived targets while retaining resolutions by stable id. */
export function replaceAssessmentTargets(session, targets = []) {
  if (session?.matcher !== 'timed') return session;
  const old = new Map(session.run.targets.map((target) => [target.id, target]));
  const fresh = createPerformanceRun(targets);
  return {
    ...session,
    expectation: { ...session.expectation, targets },
    run: {
      ...session.run,
      targets: fresh.targets.map((target) => {
        const previous = old.get(target.id);
        return previous ? {
          ...target,
          state: previous.state,
          hitPitches: previous.hitPitches,
          drifts: previous.drifts,
          resolvedAt: previous.resolvedAt,
          result: previous.result,
        } : target;
      }),
    },
  };
}

export function applyAssessmentPress(session, pitch, atMs = 0, context = {}) {
  if (session.matcher === 'timed') {
    const result = applyPerformancePress(session.run, pitch, atMs, session.policy, context);
    return { session: { ...session, run: result.run }, event: result.event };
  }
  if (session.matcher === 'cursor') {
    const result = applyDrillPress(session.run, pitch);
    return { session: { ...session, run: result.run }, event: result.event };
  }
  throw new Error('Held assessment sessions consume a held-note snapshot, not a note press');
}

export function advanceAssessment(session, atMs) {
  if (session.matcher !== 'timed') return { session, events: [] };
  const result = advancePerformanceRun(session.run, atMs, session.policy);
  return { session: { ...session, run: result.run }, events: result.events };
}

export function closeAssessmentSpan(session, span, atMs) {
  if (session.matcher !== 'timed') return { session, events: [] };
  const result = closePerformanceMeasure(session.run, span, atMs);
  return { session: { ...session, run: result.run }, events: result.events };
}

export function assessmentProgress(session) {
  if (session.matcher === 'cursor') return drillProgress(session.run);
  if (session.matcher === 'timed') {
    const pending = session.run.targets.findIndex((target) => target.state === 'pending');
    return pending < 0 ? session.run.targets.length : pending;
  }
  return session.run.correct ? 1 : 0;
}

/**
 * Judge one attack at a wait-for-correct cursor step. Notes within a chord may
 * arrive in any order; advancement happens only after the complete expected set
 * has been accumulated. Far-away notes are treated as unrelated piano activity.
 */
export function classifyCursorStep(expectedInput, struckInput, pitch, { plausibilityWindow = 24 } = {}) {
  const expected = expectedInput instanceof Set ? expectedInput : new Set(expectedInput || []);
  const struck = new Set(struckInput || []);
  if (expected.has(pitch)) {
    struck.add(pitch);
    const complete = [...expected].every((note) => struck.has(note));
    return { status: complete ? 'complete' : 'hit', struck, complete };
  }
  const plausible = [...expected].some((note) => Math.abs(pitch - note) <= plausibilityWindow);
  return { status: plausible ? 'wrong' : 'ignored', struck, complete: false };
}

/** Ordered cursor transition used by game challenges as well as exercise runs. */
export function advanceOrderedCursor(expectedMidi = [], progress = 0, pitch, { restartOnWrong = false } = {}) {
  if (!Array.isArray(expectedMidi) || expectedMidi.length === 0) {
    return { progress: 0, wrong: true, complete: false };
  }
  if (pitch === expectedMidi[progress]) {
    const next = progress + 1;
    return { progress: next, wrong: false, complete: next === expectedMidi.length };
  }
  const next = restartOnWrong && pitch === expectedMidi[0] ? 1 : (restartOnWrong ? 0 : progress);
  return { progress: next, wrong: true, complete: false };
}

/** Shared dimensional projections for surfaces that own their observation loop. */
export function gradeAssessmentObservation({
  matcher,
  expectedCount,
  wrongNotes = 0,
  missedNotes = 0,
  timingQualities = [],
  paced = false,
  weights = null,
  onsetSpanMs = 0,
} = {}) {
  if (matcher === 'held') {
    return gradeChordPerformance({ targetNotes: expectedCount, wrongAttempts: wrongNotes, onsetSpanMs });
  }
  return gradeOrderedPerformance({ expectedCount, wrongNotes, missedNotes, timingQualities, paced, weights });
}

export function timingQualityForBeat(actualAt, targetAt, beatMs) {
  return timingQuality(actualAt, targetAt, beatMs);
}

/**
 * Shared held-note classifier.
 *
 * `equivalence: 'midi'` requires authored octaves. `pitch-class` accepts any
 * octave and can require the root in the bass. `allowExtras` preserves the note
 * flashcard/control behavior where the target may be held inside a larger set.
 */
export function classifyHeldNotes(activeNotes, expectation = {}, policy = {}) {
  if (!expectation) return 'idle';
  if (policy.equivalence === 'pitch-class' || expectation.pitchClasses) {
    return matchHeldSet(activeNotes, {
      root: expectation.root,
      pitchClasses: expectation.pitchClasses instanceof Set
        ? expectation.pitchClasses
        : new Set(expectation.pitchClasses || []),
    }, { bassMustBeRoot: policy.bassMustBeRoot !== false });
  }

  const pitches = expectation.pitches || [];
  if (!activeNotes?.size || !pitches.length) return 'idle';
  const target = new Set(pitches);
  let matched = 0;
  let extras = 0;
  for (const [note] of activeNotes) {
    if (target.has(note)) matched += 1;
    else extras += 1;
  }
  if (matched === target.size && (policy.allowExtras || extras === 0)) return 'correct';
  if (extras > 0) return 'wrong';
  return matched > 0 ? 'partial' : 'idle';
}

/** Observe a held snapshot and count at most one wrong attempt per key gesture. */
export function applyAssessmentHeld(session, activeNotes, atMs = 0) {
  if (session.matcher !== 'held') throw new Error('Only held assessment sessions consume held snapshots');
  const status = classifyHeldNotes(activeNotes, session.expectation, session.policy);
  const timestamps = [...(activeNotes?.values?.() || [])]
    .map((entry) => entry?.timestamp)
    .filter(Number.isFinite);
  const onsetSpanMs = timestamps.length > 1 ? Math.max(...timestamps) - Math.min(...timestamps) : 0;
  const wasWrong = session.run.status === 'wrong';
  const wrongNotes = session.run.wrongNotes + (status === 'wrong' && !wasWrong ? 1 : 0);
  return {
    session: {
      ...session,
      run: {
        status,
        wrongNotes,
        correct: session.run.correct || status === 'correct',
        onsetSpanMs: Math.max(session.run.onsetSpanMs, onsetSpanMs),
        observedAt: atMs,
      },
    },
    event: { type: status, status },
  };
}

function timedObservations(run, { targetFilter = null, timing = {} } = {}) {
  const targets = targetFilter ? run.targets.filter(targetFilter) : run.targets;
  const ids = new Set(targets.map((target) => target.id));
  const unmatched = (run.unmatched || []).filter((event) => !targetFilter || targetFilter({
    id: null,
    measureIndex: event.measureIndex,
  }));
  const expected = targets.reduce((sum, target) => sum + target.pitches.length, 0);
  const matched = targets.reduce((sum, target) => (
    sum + (target.hitPitches?.length ?? target.drifts?.length ?? 0)
  ), 0);
  const wrong = unmatched.length;
  const drifts = targets.filter((target) => ids.has(target.id)).flatMap((target) => target.drifts || []);
  const timingQualities = drifts
    .map((drift) => timingQualityFromDrift(drift, {
      toleranceMs: timing.toleranceMs ?? 80,
      windowMs: timing.windowMs ?? 320,
    }))
    .filter(Number.isFinite);
  return { expected, matched, wrong, drifts, timingQualities };
}

function observationsFor(session, options = {}) {
  if (session.matcher === 'timed') return timedObservations(session.run, {
    targetFilter: options.targetFilter,
    timing: options.timing || session.grading.timing,
  });
  if (session.matcher === 'cursor') {
    return session.run.spans.reduce((result, span) => ({
      expected: result.expected + span.expectedMidi.length,
      matched: result.matched + span.progress,
      wrong: result.wrong + span.wrongNotes,
      drifts: result.drifts,
      timingQualities: result.timingQualities,
    }), { expected: 0, matched: 0, wrong: 0, drifts: [], timingQualities: [] });
  }
  const expected = session.expectation.pitches?.length
    ?? session.expectation.pitchClasses?.size
    ?? session.expectation.pitchClasses?.length
    ?? 1;
  return {
    expected,
    matched: session.run.correct ? expected : 0,
    wrong: session.run.wrongNotes,
    drifts: [],
    timingQualities: [],
  };
}

export function criteriaForAssessment(session, options = {}) {
  const observation = observationsFor(session, options);
  const completeness = observation.expected > 0 ? observation.matched / observation.expected : 0;
  const cleanliness = observation.matched + observation.wrong > 0
    ? observation.matched / (observation.matched + observation.wrong)
    : 0;
  const criteria = { completeness: clamp01(completeness), cleanliness: clamp01(cleanliness) };
  if (session.matcher === 'timed') {
    criteria.placement = observation.timingQualities.length
      ? observation.timingQualities.reduce((sum, value) => sum + value, 0) / observation.timingQualities.length
      : 0;
  }
  return { criteria, observation };
}

function scoreCriteria(criteria, names, weights = null) {
  let total = 0;
  let used = 0;
  for (const name of names) {
    if (!Number.isFinite(criteria[name])) continue;
    const weight = Number.isFinite(weights?.[name]) ? Math.max(0, weights[name]) : 1;
    total += criteria[name] * weight;
    used += weight;
  }
  return used > 0 ? clamp01(total / used) : 0;
}

/** Apply the portable rubric/gate contract to measured criteria. */
export function evaluateAssessment({
  criteria,
  requirement = null,
  weights = null,
  score: projectedScore = null,
  achievedBpm = null,
  diagnostics = {},
  rubric = null,
  defaultPassThreshold = 0.6,
} = {}) {
  const thresholds = requirement?.rubric?.criteria || {};
  const names = Object.keys(thresholds).length ? Object.keys(thresholds) : Object.keys(criteria || {});
  const score = Number.isFinite(projectedScore)
    ? clamp01(projectedScore)
    : scoreCriteria(criteria || {}, names, weights);
  const criteriaPassed = Object.keys(thresholds).length
    ? Object.entries(thresholds).every(([name, threshold]) => (
      Number.isFinite(criteria?.[name]) && criteria[name] >= threshold
    ))
    : score >= defaultPassThreshold;
  const target = Number(requirement?.gates?.pace?.target_bpm);
  const gates = Number.isFinite(target) ? {
    pace: { passed: Number.isFinite(achievedBpm) && achievedBpm >= target, actual: achievedBpm, target },
  } : undefined;
  const passed = criteriaPassed && (!gates || Object.values(gates).every((gate) => gate.passed));
  return {
    score,
    criteria,
    ...(gates ? { gates } : {}),
    diagnostics: numericEntries({
      ...diagnostics,
      ...(Number.isFinite(achievedBpm) ? { achieved_bpm: achievedBpm } : {}),
    }),
    rubric: {
      id: requirement?.rubric?.id ?? rubric?.id ?? 'piano-assessment-v1',
      version: String(requirement?.rubric?.version ?? rubric?.version ?? '1'),
    },
    verdict: { score, passed },
  };
}

export function finalizeAssessment(session, options = {}) {
  const { criteria, observation } = criteriaForAssessment(session, options);
  return evaluateAssessment({
    criteria,
    requirement: options.requirement ?? session.requirement,
    weights: options.weights ?? session.grading.weights,
    achievedBpm: options.achievedBpm,
    diagnostics: {
      missed_notes: Math.max(0, observation.expected - observation.matched),
      wrong_notes: observation.wrong,
      ...(session.matcher === 'held' ? { onset_spread_ms: session.run.onsetSpanMs } : {}),
      ...options.diagnostics,
    },
    rubric: options.rubric ?? session.grading.rubric,
    defaultPassThreshold: options.defaultPassThreshold,
  });
}

/** Polish-compatible projection for one timed span, produced by the same session. */
export function gradeAssessmentSpan(session, span, cfg = {}) {
  if (session.matcher !== 'timed') throw new Error('Only timed sessions have timed spans');
  const filter = (target) => target.measureIndex === span;
  const { criteria, observation } = criteriaForAssessment(session, {
    targetFilter: filter,
    timing: { toleranceMs: cfg.timingToleranceMs ?? 80, windowMs: cfg.timingWindowMs ?? 320 },
  });
  const rest = observation.expected === 0;
  if (rest) {
    const clean = observation.wrong === 0;
    return {
      criteria: { completeness: 1, cleanliness: clean ? 1 : 0, placement: 1 },
      noteScore: clean ? 1 : 0,
      timingScore: clean ? 1 : 0,
      combined: clean ? 1 : 0,
      grade: gradeBand(clean ? 1 : 0, cfg.thresholds),
      silent: false,
      rest: true,
      expectedCount: 0,
      matchedCount: 0,
      wrongCount: observation.wrong,
    };
  }
  const graded = gradeOrderedPerformance({
    expectedCount: observation.expected,
    wrongNotes: observation.wrong,
    missedNotes: Math.max(0, observation.expected - observation.matched),
    timingQualities: observation.timingQualities,
    paced: true,
    weights: cfg.weights,
  });
  return {
    criteria,
    noteScore: graded.pitchAccuracy,
    timingScore: graded.timingAccuracy ?? 0,
    combined: graded.score,
    grade: gradeBand(graded.score, cfg.thresholds),
    silent: observation.matched === 0 && observation.wrong === 0,
    rest: false,
    expectedCount: observation.expected,
    matchedCount: observation.matched,
    wrongCount: observation.wrong,
    continuity: graded.continuity,
  };
}

/** Shared aggregation projections for surfaces that render span-level grades. */
export function tallyAssessmentGrades(grades) {
  return tallyGrades(grades);
}

export function findWorstAssessmentSpan(grades) {
  return worstSpan(grades);
}

export default {
  createAssessmentSession,
  replaceAssessmentTargets,
  applyAssessmentPress,
  advanceAssessment,
  closeAssessmentSpan,
  assessmentProgress,
  classifyCursorStep,
  advanceOrderedCursor,
  gradeAssessmentObservation,
  timingQualityForBeat,
  classifyHeldNotes,
  applyAssessmentHeld,
  criteriaForAssessment,
  evaluateAssessment,
  finalizeAssessment,
  gradeAssessmentSpan,
  tallyAssessmentGrades,
  findWorstAssessmentSpan,
};
