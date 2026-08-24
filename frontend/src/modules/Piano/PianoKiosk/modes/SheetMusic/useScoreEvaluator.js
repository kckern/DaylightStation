import { useEffect, useRef, useCallback } from 'react';
import {
  closeAssessmentAttemptSpan,
  createAssessmentAttempt,
  finalizeAssessmentAttempt,
  observeAssessment,
  startAssessmentAttempt,
} from '../../../performance/assessmentAttempt.js';
export const POLICY_VERSION = 'polish-canonical-span-v2';

const gradeName = (score, thresholds = {}) => (
  score >= (thresholds.green ?? 0.9) ? 'green' : score >= (thresholds.yellow ?? 0.6) ? 'yellow' : 'red'
);

function polishGrade(measure, span, cfg = {}) {
  if (!span) return null;
  const criteria = span.criteria || {};
  const expected = span.diagnostics?.expected_notes || 0;
  const matched = span.diagnostics?.matched_notes || 0;
  const wrong = span.diagnostics?.wrong_notes || 0;
  const missed = Math.max(0, expected - matched);
  const noteScore = expected ? matched / (expected + wrong) : (wrong ? 0 : 1);
  const continuity = expected ? Math.max(0, 1 - (wrong + missed) / expected) : (wrong ? 0 : 1);
  const timingScore = Number.isFinite(criteria.placement) ? criteria.placement : 0;
  // Preserve Polish's established tier/best score projection while the canonical
  // criteria remain available as portable evidence. This is intentionally a
  // surface projection, not a second assessment lifecycle.
  const weights = { pitch: 0.55, timing: 0.30, continuity: 0.15, ...(cfg.weights || {}) };
  const score = Math.max(0, Math.min(1,
    weights.pitch * noteScore + weights.timing * timingScore + weights.continuity * continuity,
  ));
  return {
    measure,
    grade: gradeName(score, cfg.thresholds),
    score,
    combined: score,
    rest: expected === 0,
    noteScore,
    timingScore,
    continuity,
    expectedCount: expected,
    matchedCount: matched,
    wrongCount: wrong,
    silent: matched === 0 && wrong === 0,
    criteria,
    parts: span.parts || {},
    diagnostics: span.diagnostics || {},
    policyVersion: POLICY_VERSION,
  };
}

/** Canonical timed-attempt adapter for Sheet Music Polish presentation. */
export function useScoreEvaluator({
  enabled,
  cfg,
  subscribe,
  currentMeasure,
  boundary = 0,
  expectation,
  positionForNote,
  onMeasureGrade,
  onSilentStop,
}) {
  const attemptRef = useRef(null);
  const expectationRef = useRef(expectation);
  const currentMeasureRef = useRef(currentMeasure);
  const positionRef = useRef(positionForNote);
  const gradeRef = useRef(onMeasureGrade);
  const silentStopRef = useRef(onSilentStop);
  const cfgRef = useRef(cfg);
  const gradedRef = useRef(new Set());
  const previousMeasureRef = useRef(null);
  const previousBoundaryRef = useRef(boundary);
  const silentRunRef = useRef(0);
  const stoppedRef = useRef(false);
  const playedRef = useRef(false);
  const advancedRef = useRef(false);

  currentMeasureRef.current = currentMeasure;
  positionRef.current = positionForNote;
  gradeRef.current = onMeasureGrade;
  silentStopRef.current = onSilentStop;
  cfgRef.current = cfg;
  const boundaryRef = useRef(boundary);
  boundaryRef.current = boundary;
  expectationRef.current = expectation;
  const expectationKey = expectation ? JSON.stringify({
    source: expectation.source,
    tempoMap: expectation.tempoMap,
    events: expectation.events.map((event) => [event.id, event.onsetQuarter, event.spanId, event.notes.map((note) => note.id)]),
  }) : '';

  const createRun = useCallback(() => {
    const currentExpectation = expectationRef.current;
    if (!currentExpectation?.tempoMap?.length) return null;
    return startAssessmentAttempt(createAssessmentAttempt({
      expectation: currentExpectation,
      matcher: 'timed',
      mode: 'cued',
      purpose: 'practice',
      clock: 'score-polish',
      policy: {
        matchWindowMs: (cfgRef.current?.timingToleranceMs ?? 80) * 5,
        missWindowMs: (cfgRef.current?.timingToleranceMs ?? 80) * 5,
        timingToleranceMs: cfgRef.current?.timingToleranceMs ?? 80,
        timingWindowMs: cfgRef.current?.timingWindowMs ?? 320,
      },
    }), { time: 0, clock: 'score-polish' });
  }, [expectationKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const gradeOne = useCallback((measure, atMs) => {
    if (!attemptRef.current || gradedRef.current.has(measure)) return null;
    const closed = closeAssessmentAttemptSpan(attemptRef.current, `measure:${measure}`, atMs);
    attemptRef.current = closed.attempt;
    const span = closed.events.find((event) => event.type === 'span_complete')?.result;
    const grade = polishGrade(measure, span, cfgRef.current);
    if (!grade || (!grade.expectedCount && !grade.wrongCount)) return null;
    gradedRef.current.add(measure);
    gradeRef.current?.(grade);
    return grade;
  }, []);

  const reset = useCallback(() => {
    attemptRef.current = createRun();
    gradedRef.current.clear();
    previousMeasureRef.current = null;
    previousBoundaryRef.current = boundaryRef.current;
    silentRunRef.current = 0;
    stoppedRef.current = false;
    playedRef.current = false;
    advancedRef.current = false;
  }, [createRun]);

  useEffect(() => {
    if (enabled) reset();
    else attemptRef.current = null;
  }, [enabled, reset]);

  useEffect(() => {
    if (!enabled || !subscribe) return undefined;
    return subscribe((event) => {
      if (!event || event.type !== 'note_on' || !event.velocity || !attemptRef.current) return;
      playedRef.current = true;
      const judged = observeAssessment(attemptRef.current, {
        midi: event.note,
        time: positionRef.current?.() ?? 0,
        clock: 'score-polish',
      });
      attemptRef.current = judged.attempt;
    });
  }, [enabled, subscribe]);

  useEffect(() => {
    if (!enabled || !attemptRef.current) return;
    const previous = previousMeasureRef.current;
    const wrapped = boundary !== previousBoundaryRef.current;
    previousBoundaryRef.current = boundary;
    const ending = previous != null && currentMeasure !== previous ? previous : (wrapped ? currentMeasure : null);
    if (ending != null) {
      advancedRef.current = true;
      const grade = gradeOne(ending, positionRef.current?.() ?? 0);
      if (grade?.silent) {
        silentRunRef.current += 1;
        const limit = cfgRef.current?.silentMeasuresToStop;
        if (Number.isFinite(limit) && silentRunRef.current >= limit && !stoppedRef.current) {
          stoppedRef.current = true;
          silentStopRef.current?.(grade);
        }
      } else if (grade) silentRunRef.current = 0;
      if (wrapped) {
        attemptRef.current = createRun();
        gradedRef.current.clear();
      }
    }
    previousMeasureRef.current = currentMeasure;
  }, [boundary, createRun, currentMeasure, enabled, gradeOne]);

  const finalize = useCallback((endMeasure) => {
    if (!enabled || !attemptRef.current || (!advancedRef.current && !playedRef.current)) return [];
    const current = currentMeasureRef.current;
    const measures = Number.isFinite(endMeasure) && endMeasure !== current ? [current, endMeasure] : [current];
    const atMs = positionRef.current?.() ?? 0;
    const grades = measures.map((measure) => gradeOne(measure, atMs)).filter(Boolean);
    attemptRef.current = finalizeAssessmentAttempt(attemptRef.current, { status: 'completed' });
    return grades;
  }, [enabled, gradeOne]);

  useEffect(() => () => { attemptRef.current = null; }, []);
  return { finalize };
}

export default useScoreEvaluator;
