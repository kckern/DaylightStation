import { useEffect, useRef, useCallback } from 'react';
import {
  applyPerformancePress,
  closePerformanceMeasure,
  createPerformanceRun,
} from '../../../performance/performanceJudge.js';
import { gradePerformanceMeasure } from './scoreEvaluator.js';

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
  const runRef = useRef(createPerformanceRun(targets));
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
    const previous = new Map(runRef.current.targets.map((target) => [target.id, target]));
    runRef.current = {
      ...runRef.current,
      targets: targets.map((target) => {
        const old = previous.get(target.id);
        return old ? {
          ...target,
          state: old.state,
          hitPitches: old.hitPitches,
          drifts: old.drifts,
          resolvedAt: old.resolvedAt,
          result: old.result,
        } : createPerformanceRun([target]).targets[0];
      }),
    };
    if (nextIds !== targetIdsRef.current) gradedRef.current.clear();
    targetIdsRef.current = nextIds;
  }, [targets]);

  const gradeOne = useCallback((measure, atMs) => {
    if (gradedRef.current.has(measure)) return null;
    const closed = closePerformanceMeasure(runRef.current, measure, atMs);
    runRef.current = closed.run;
    const measureTargets = runRef.current.targets.filter((target) => target.measureIndex === measure);
    const unmatched = (runRef.current.unmatched || []).filter((event) => event.measureIndex === measure);
    if (!measureTargets.length && !unmatched.length) return null;
    const graded = {
      measure,
      ...gradePerformanceMeasure({ targets: measureTargets, unmatched }, cfgRef.current || {}),
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
      const judged = applyPerformancePress(
        runRef.current,
        evt.note,
        atMs,
        timingPolicy(cfgRef.current),
        { measureIndex: currentMeasureRef.current },
      );
      runRef.current = judged.run;
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
        runRef.current = createPerformanceRun(targets);
        gradedRef.current.clear();
      }
    }
    prevMeasureRef.current = currentMeasure;
  }, [enabled, currentMeasure, boundary, gradeOne, targets]);

  useEffect(() => {
    if (enabled) return undefined;
    runRef.current = createPerformanceRun(targets);
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
    runRef.current = createPerformanceRun([]);
    gradedRef.current.clear();
  }, []);

  return { finalize };
}

export default useScoreEvaluator;
