import { useEffect, useRef, useCallback } from 'react';
import {
  applyAssessmentPress,
  closeAssessmentSpan,
  createAssessmentSession,
  gradeAssessmentSpan,
  replaceAssessmentTargets,
} from '../../../performance/assessmentSession.js';
import { POLICY_VERSION } from './scoreEvaluator.js';

const timingPolicy = (cfg = {}) => {
  const tolerance = Number.isFinite(cfg.timingToleranceMs) ? cfg.timingToleranceMs : 80;
  return {
    perfectWindowMs: tolerance,
    goodWindowMs: tolerance * 5,
    matchWindowMs: tolerance * 5,
    missWindowMs: tolerance * 5,
  };
};

/**
 * At-tempo performance evaluator for Sheet Music "Polish" mode.
 *
 * Incoming MIDI notes are matched against exact onset targets by the shared
 * performance judge. This hook retains the Polish lifecycle: measure-boundary
 * grades, loop boundaries, silent auto-stop, and final-measure closure.
 */
export function useScoreEvaluator({
  enabled,
  cfg,
  subscribe,
  currentMeasure,
  boundary = 0,
  targets = [],
  positionForNote,
  onMeasureGrade,
  onSilentStop,
}) {
  const enabledRef = useRef(enabled);
  const cfgRef = useRef(cfg);
  const currentMeasureRef = useRef(currentMeasure);
  const positionForNoteRef = useRef(positionForNote);
  const onMeasureGradeRef = useRef(onMeasureGrade);
  const onSilentStopRef = useRef(onSilentStop);
  const runRef = useRef(createAssessmentSession({
    matcher: 'timed', expectation: { targets }, policy: timingPolicy(cfg),
  }));
  const targetIdsRef = useRef(targets.map((target) => target.id).join(','));

  enabledRef.current = enabled;
  cfgRef.current = cfg;
  currentMeasureRef.current = currentMeasure;
  positionForNoteRef.current = positionForNote;
  onMeasureGradeRef.current = onMeasureGrade;
  onSilentStopRef.current = onSilentStop;

  const prevMeasureRef = useRef(null);
  const prevBoundaryRef = useRef(boundary);
  const silentRunRef = useRef(0);
  const stoppedRef = useRef(false);
  const finalizedRef = useRef(false);
  const advancedRef = useRef(false);
  const playedRef = useRef(false);
  const gradedRef = useRef(new Set());

  // Target timing can change when the tempo control moves. Preserve the resolved
  // performance state by stable target id while replacing score-derived metadata.
  useEffect(() => {
    const nextIds = targets.map((target) => target.id).join(',');
    runRef.current = replaceAssessmentTargets(runRef.current, targets);
    if (nextIds !== targetIdsRef.current) gradedRef.current.clear();
    targetIdsRef.current = nextIds;
  }, [targets]);

  const gradeOne = useCallback((measure, atMs) => {
    if (gradedRef.current.has(measure)) return null;
    const closed = closeAssessmentSpan(runRef.current, measure, atMs);
    runRef.current = closed.session;
    const measureTargets = runRef.current.run.targets.filter((target) => target.measureIndex === measure);
    const unmatched = (runRef.current.run.unmatched || []).filter((event) => event.measureIndex === measure);
    if (!measureTargets.length && !unmatched.length) return null;
    const graded = {
      measure,
      ...gradeAssessmentSpan(runRef.current, measure, cfgRef.current || {}),
      policyVersion: POLICY_VERSION,
    };
    gradedRef.current.add(measure);
    onMeasureGradeRef.current?.(graded);
    return graded;
  }, []);

  const finalize = useCallback((endMeasure) => {
    if (!enabledRef.current || finalizedRef.current) return [];
    finalizedRef.current = true;
    if (!advancedRef.current && !playedRef.current) return [];
    const cur = currentMeasureRef.current;
    const measures = Number.isFinite(endMeasure) && endMeasure !== cur ? [cur, endMeasure] : [cur];
    const atMs = positionForNoteRef.current?.() ?? 0;
    return measures.map((measure) => gradeOne(measure, atMs)).filter(Boolean);
  }, [gradeOne]);

  useEffect(() => {
    if (!enabled || !subscribe) return undefined;
    return subscribe((evt) => {
      if (!evt || evt.type !== 'note_on' || !evt.velocity) return;
      playedRef.current = true;
      const atMs = positionForNoteRef.current?.() ?? 0;
      runRef.current = { ...runRef.current, policy: timingPolicy(cfgRef.current) };
      const judged = applyAssessmentPress(
        runRef.current,
        evt.note,
        atMs,
        { measureIndex: currentMeasureRef.current },
      );
      runRef.current = judged.session;
    });
  }, [enabled, subscribe]);

  useEffect(() => {
    if (!enabled) return;
    const prev = prevMeasureRef.current;
    const wrapped = boundary !== prevBoundaryRef.current;
    prevBoundaryRef.current = boundary;
    const ending = prev != null && currentMeasure !== prev ? prev : (wrapped ? currentMeasure : null);

    if (ending != null) {
      advancedRef.current = true;
      const atMs = positionForNoteRef.current?.() ?? 0;
      const graded = gradeOne(ending, atMs);
      if (graded?.silent) {
        silentRunRef.current += 1;
        const limit = cfgRef.current?.silentMeasuresToStop;
        if (Number.isFinite(limit) && silentRunRef.current >= limit && !stoppedRef.current) {
          stoppedRef.current = true;
          onSilentStopRef.current?.(graded);
        }
      } else if (graded) {
        silentRunRef.current = 0;
      }

      // A loop starts a fresh pass over its targets. Normal forward progress keeps
      // prior target resolutions intact until the run summary is produced.
      if (wrapped) {
        runRef.current = createAssessmentSession({
          matcher: 'timed', expectation: { targets }, policy: timingPolicy(cfgRef.current),
        });
        gradedRef.current.clear();
      }
    }
    prevMeasureRef.current = currentMeasure;
  }, [enabled, currentMeasure, boundary, gradeOne, targets]);

  useEffect(() => {
    if (enabled) return undefined;
    runRef.current = createAssessmentSession({
      matcher: 'timed', expectation: { targets }, policy: timingPolicy(cfgRef.current),
    });
    prevMeasureRef.current = null;
    prevBoundaryRef.current = boundary;
    silentRunRef.current = 0;
    stoppedRef.current = false;
    finalizedRef.current = false;
    advancedRef.current = false;
    playedRef.current = false;
    gradedRef.current.clear();
    return undefined;
  }, [enabled, boundary, targets]);

  useEffect(() => () => {
    runRef.current = createAssessmentSession({ matcher: 'timed', expectation: { targets: [] } });
    gradedRef.current.clear();
  }, []);

  return { finalize };
}

export default useScoreEvaluator;
