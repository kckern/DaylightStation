import { useEffect, useRef, useCallback } from 'react';
import { gradeMeasure } from './scoreEvaluator.js';

/**
 * useScoreEvaluator — per-measure grading + silent auto-stop for "Polish" mode.
 *
 * A controlled hook: the parent owns `currentMeasure` (derived from the cursor).
 * MIDI hits are buffered while a measure is current; when `currentMeasure`
 * advances, the measure that just ended is graded via `gradeMeasure` and reported.
 * After `cfg.silentMeasuresToStop` consecutive silent measures, `onSilentStop`
 * fires once.
 *
 * Subscribes ONCE per `enabled`/`subscribe` change; config, per-measure expected
 * midis, drift timing, and callbacks are read from refs inside the per-note
 * handler so incoming notes neither resubscribe nor see stale closures.
 *
 * @param {object}   p
 * @param {boolean}  p.enabled
 * @param {object}   p.cfg                - { silentMeasuresToStop, timingToleranceMs, thresholds }
 * @param {Function} p.subscribe          - subscribe(fn) → unsubscribe; fn(evt)
 * @param {number}   p.currentMeasure     - current measure index (parent-owned)
 * @param {number}   [p.boundary]        - bump this to force an end-of-measure
 *   grade without a measure-index change (a loop wrapping onto the SAME measure).
 * @param {Function} p.expectedForMeasure - (measure) → number[] of expected midis
 * @param {Function} p.driftForNote       - (note) → drift in ms for a hit
 * @param {Function} p.onMeasureGrade     - onMeasureGrade({ measure, ...grade })
 * @param {Function} p.onSilentStop       - onSilentStop()
 */
export function useScoreEvaluator({
  enabled,
  cfg,
  subscribe,
  currentMeasure,
  boundary = 0,
  expectedForMeasure,
  driftForNote,
  onMeasureGrade,
  onSilentStop,
}) {
  const enabledRef = useRef(enabled);
  const cfgRef = useRef(cfg);
  const currentMeasureRef = useRef(currentMeasure);
  const expectedForMeasureRef = useRef(expectedForMeasure);
  const driftForNoteRef = useRef(driftForNote);
  const onMeasureGradeRef = useRef(onMeasureGrade);
  const onSilentStopRef = useRef(onSilentStop);

  enabledRef.current = enabled;
  cfgRef.current = cfg;
  currentMeasureRef.current = currentMeasure;
  expectedForMeasureRef.current = expectedForMeasure;
  driftForNoteRef.current = driftForNote;
  onMeasureGradeRef.current = onMeasureGrade;
  onSilentStopRef.current = onSilentStop;

  const hitsRef = useRef([]);
  const prevMeasureRef = useRef(null);
  const prevBoundaryRef = useRef(boundary);
  const silentRunRef = useRef(0);
  const stoppedRef = useRef(false);
  const finalizedRef = useRef(false);

  // Grade the CURRENT measure once at end-of-piece: the advance-driven grader only
  // fires when currentMeasure changes, so the last measure the cursor never leaves
  // would otherwise never be graded (audit H1). Idempotent; no-op when disabled.
  const finalize = useCallback(() => {
    if (!enabledRef.current || finalizedRef.current) return undefined;
    finalizedRef.current = true;
    const m = currentMeasureRef.current;
    const expected = expectedForMeasureRef.current?.(m) || [];
    if (expected.length === 0 && hitsRef.current.length === 0) return undefined; // nothing to grade
    const g = gradeMeasure({ expected, hits: hitsRef.current }, cfgRef.current || {});
    const graded = { measure: m, ...g };
    onMeasureGradeRef.current?.(graded);
    hitsRef.current = [];
    // Returned so a caller opening the run summary in the SAME tick can fold this
    // in: gradesRef is assigned during render, so it does not yet contain it.
    return graded;
  }, []);

  // Buffer MIDI hits for the current measure. Subscribe once per enabled/subscribe.
  useEffect(() => {
    if (!enabled || !subscribe) return undefined;
    return subscribe((evt) => {
      if (!evt || evt.type !== 'note_on' || !evt.velocity) return;
      const driftMs = driftForNoteRef.current?.(evt.note) ?? 0;
      hitsRef.current.push({ note: evt.note, driftMs });
    });
  }, [enabled, subscribe]);

  // Grade the measure that just ended: normally when `currentMeasure` advances,
  // but ALSO when `boundary` bumps. A single-measure loop wraps from the end of
  // measure N back to its start, so currentMeasure never changes and the advance
  // rule alone would never grade — the field logs show a 5.5s Polish run over a
  // one-measure loop producing 17 note events and zero grades.
  useEffect(() => {
    if (!enabled) return;
    const prev = prevMeasureRef.current;
    const wrapped = boundary !== prevBoundaryRef.current;
    prevBoundaryRef.current = boundary;
    // An advance names the measure we LEFT; a wrap onto the same measure names
    // the one we're still on. A multi-measure wrap is both — prefer `prev` so it
    // grades the outgoing measure once, never twice.
    const ending = (prev != null && currentMeasure !== prev)
      ? prev
      : (wrapped ? currentMeasure : null);

    if (ending != null) {
      const g = gradeMeasure(
        { expected: expectedForMeasureRef.current?.(ending) || [], hits: hitsRef.current },
        cfgRef.current || {},
      );
      onMeasureGradeRef.current?.({ measure: ending, ...g });

      if (g.silent) {
        silentRunRef.current += 1;
        const limit = cfgRef.current?.silentMeasuresToStop;
        if (
          Number.isFinite(limit) &&
          silentRunRef.current >= limit &&
          !stoppedRef.current
        ) {
          stoppedRef.current = true;
          onSilentStopRef.current?.();
        }
      } else {
        silentRunRef.current = 0;
      }

      hitsRef.current = [];
    }
    prevMeasureRef.current = currentMeasure;
  }, [enabled, currentMeasure, boundary]);

  // Reset all state when disabled or on unmount; never grade while disabled.
  // `boundary` is a dependency so wraps that happen WHILE disabled keep
  // prevBoundaryRef in step: the loop follows Listen↔Polish, so a Listen loop
  // bumps the counter with grading off, and a stale ref would read as a wrap on
  // the first commit back in Polish — a red wash before a note is played.
  useEffect(() => {
    if (enabled) return undefined;
    hitsRef.current = [];
    prevMeasureRef.current = null;
    prevBoundaryRef.current = boundary;
    silentRunRef.current = 0;
    stoppedRef.current = false;
    finalizedRef.current = false; // a fresh run may finalize again
    return undefined;
  }, [enabled, boundary]);

  useEffect(() => () => {
    hitsRef.current = [];
    prevMeasureRef.current = null;
    // Mount-time value on purpose — do NOT promote `boundary` to a dependency
    // here: this teardown runs once, and nothing reads these refs after it.
    prevBoundaryRef.current = boundary;
    silentRunRef.current = 0;
    stoppedRef.current = false;
    finalizedRef.current = false;
  }, []);

  return { finalize };
}

export default useScoreEvaluator;
