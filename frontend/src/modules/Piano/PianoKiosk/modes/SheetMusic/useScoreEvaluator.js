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
 * @param {Function} p.onSilentStop       - onSilentStop(graded) — receives the
 *   grade of the measure that tripped the stop. It is produced in the same tick,
 *   so a caller summarizing the run must fold it in: a render-time grades
 *   snapshot does not contain it yet.
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
  // Has this run actually run? Set the first time a measure boundary is crossed
  // (an advance or a loop wrap). Distinguishes "the user worked a passage" from
  // "the user tapped Play and changed their mind" — see finalize.
  const advancedRef = useRef(false);

  // Close out the run at end-of-piece: the advance-driven grader only fires when
  // currentMeasure changes, so the last measure the cursor never leaves would
  // otherwise never be graded (audit H1). Idempotent; no-op when disabled.
  //
  // `endMeasure` is the measure the run actually ENDED on, which the hook cannot
  // work out for itself: the transport fires the final step's onEvent and completes
  // in the same tick, so that setStep never commits (and the caller then sends the
  // cursor home) — currentMeasureRef still reads the SECOND-TO-LAST measure. The
  // probe's 5-measure run graded 0–3 and never 4.
  //
  // When the two differ, the completing tick swallowed a measure boundary and BOTH
  // measures are still ungraded. Grade both from the same undivided buffer: the run
  // ended before the boundary could be observed, so there is no honest way to say
  // which side a hit fell on — and gradeMeasure scores only the notes a measure
  // EXPECTS (extra hits cost nothing), so neither is punished for the other's.
  // Handing the whole buffer to one of them instead would leave the other with a
  // false red (or no grade at all) on every piece that ends on a single chord.
  //
  // @param {number} [endMeasure] - measure the run ended on; defaults to current.
  // @returns {Array<object>} the grades produced (0, 1, or 2), newest last.
  const finalize = useCallback((endMeasure) => {
    if (!enabledRef.current || finalizedRef.current) return [];
    finalizedRef.current = true;
    // A measure with expected notes and zero hits is NOT automatically a failure
    // at finalize time. Silence only reads as a failed measure once the run has
    // actually run THROUGH one — and measures the run ran through are the
    // advance-driven grader's job, not finalize's. When nothing has happened at
    // all (no boundary crossed, no note played) the user tapped Play and stopped;
    // grading that would bank a red they never earned, wash the measure on the
    // score, and count toward the silent stop.
    if (!advancedRef.current && hitsRef.current.length === 0) return [];
    const cur = currentMeasureRef.current;
    const swallowed = Number.isFinite(endMeasure) && endMeasure !== cur;
    const out = [];
    for (const m of swallowed ? [cur, endMeasure] : [cur]) {
      const expected = expectedForMeasureRef.current?.(m) || [];
      if (expected.length === 0 && hitsRef.current.length === 0) continue; // nothing to grade
      const graded = { measure: m, ...gradeMeasure({ expected, hits: hitsRef.current }, cfgRef.current || {}) };
      onMeasureGradeRef.current?.(graded);
      out.push(graded);
    }
    hitsRef.current = [];
    // Returned so a caller opening the run summary in the SAME tick can fold these
    // in: gradesRef is assigned during render, so it does not yet contain them.
    return out;
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
      advancedRef.current = true; // the run has run through a measure
      const g = gradeMeasure(
        { expected: expectedForMeasureRef.current?.(ending) || [], hits: hitsRef.current },
        cfgRef.current || {},
      );
      const graded = { measure: ending, ...g };
      onMeasureGradeRef.current?.(graded);

      if (g.silent) {
        silentRunRef.current += 1;
        const limit = cfgRef.current?.silentMeasuresToStop;
        if (
          Number.isFinite(limit) &&
          silentRunRef.current >= limit &&
          !stoppedRef.current
        ) {
          stoppedRef.current = true;
          // Hand the stopping measure's grade to the callback: this fires in the
          // SAME tick as its onMeasureGrade, so a summary opened from here reads a
          // render-time grades snapshot that is one measure behind (the probe
          // graded four reds and logged reds: 3).
          onSilentStopRef.current?.(graded);
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
    advancedRef.current = false;  // …and must earn its right to finalize again
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
    advancedRef.current = false;
  }, []);

  return { finalize };
}

export default useScoreEvaluator;
