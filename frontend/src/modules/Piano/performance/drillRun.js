import { gradeOrderedPerformance, gradeBand } from './grading.js';
import { tallyGrades, worstSpan } from './spans.js';

/**
 * drillRun — the untimed ordered runner of the performance service.
 *
 * The timed judge (performanceJudge) matches attacks against millisecond
 * targets and needs a tempo map; drills have none, which is why the lesson
 * surface never adopted it. This runner advances span-by-span on exact
 * pitches: a wrong note within the plausibility window counts against the
 * current span (no restart — the lesson-drill policy), and anything farther
 * out is ignored as an unrelated key. Grading and aggregation are the shared
 * service modules, so a drill's verdict speaks the same language as polish.
 */
export function createDrillRun(spans, options = {}) {
  return {
    spans: spans.map((s) => ({
      id: s.id,
      expectedMidi: [...s.expectedMidi],
      progress: 0,
      wrongNotes: 0,
      done: false,
    })),
    spanIndex: 0,
    complete: false,
    wrongWindow: Number.isFinite(options.wrongWindow) ? options.wrongWindow : 24,
    weights: options.weights || null,
    thresholds: options.thresholds || undefined,
  };
}

/** Global step index — the position of the follow cursor over the flattened drill. */
export function drillProgress(run) {
  let total = 0;
  for (let i = 0; i < run.spanIndex; i++) total += run.spans[i].expectedMidi.length;
  return total + (run.spans[run.spanIndex]?.progress || 0);
}

export function applyDrillPress(run, note) {
  if (run.complete || !run.spans.length) return { run, event: { type: 'ignored' } };
  const span = run.spans[run.spanIndex];
  const target = span.expectedMidi[span.progress];

  if (note === target) {
    const spans = [...run.spans];
    const progress = span.progress + 1;
    const done = progress === span.expectedMidi.length;
    spans[run.spanIndex] = { ...span, progress, done };
    const spanIndex = done ? run.spanIndex + 1 : run.spanIndex;
    const complete = done && spanIndex === spans.length;
    const next = { ...run, spans, spanIndex, complete };
    if (complete) return { run: next, event: { type: 'complete', summary: finalizeDrillRun(next) } };
    if (done) return { run: next, event: { type: 'span_complete', spanIndex: run.spanIndex } };
    return { run: next, event: { type: 'advance', spanIndex: run.spanIndex, progress } };
  }

  if (Math.abs(note - target) > run.wrongWindow) return { run, event: { type: 'ignored' } };
  const spans = [...run.spans];
  spans[run.spanIndex] = { ...span, wrongNotes: span.wrongNotes + 1 };
  return { run: { ...run, spans }, event: { type: 'wrong', spanIndex: run.spanIndex } };
}

/** Grade completed spans; an abandoned run scores what was finished. */
export function finalizeDrillRun(run) {
  const grades = {};
  run.spans.forEach((span, i) => {
    if (!span.done) return;
    const dims = gradeOrderedPerformance({
      expectedCount: span.expectedMidi.length,
      wrongNotes: span.wrongNotes,
      paced: false,
      weights: run.weights,
    });
    grades[i] = { ...dims, grade: gradeBand(dims.score, run.thresholds) };
  });
  const graded = Object.values(grades);
  const score = graded.length
    ? Math.round((100 * graded.reduce((sum, g) => sum + g.score, 0)) / graded.length)
    : null;
  return { grades, tally: tallyGrades(grades), worst: worstSpan(grades), score };
}

export default { createDrillRun, applyDrillPress, drillProgress, finalizeDrillRun };
