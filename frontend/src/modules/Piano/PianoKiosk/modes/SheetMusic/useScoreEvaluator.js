import { useEffect, useRef } from 'react';
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
  expectedForMeasure,
  driftForNote,
  onMeasureGrade,
  onSilentStop,
}) {
  const cfgRef = useRef(cfg);
  const expectedForMeasureRef = useRef(expectedForMeasure);
  const driftForNoteRef = useRef(driftForNote);
  const onMeasureGradeRef = useRef(onMeasureGrade);
  const onSilentStopRef = useRef(onSilentStop);

  cfgRef.current = cfg;
  expectedForMeasureRef.current = expectedForMeasure;
  driftForNoteRef.current = driftForNote;
  onMeasureGradeRef.current = onMeasureGrade;
  onSilentStopRef.current = onSilentStop;

  const hitsRef = useRef([]);
  const prevMeasureRef = useRef(null);
  const silentRunRef = useRef(0);
  const stoppedRef = useRef(false);

  // Buffer MIDI hits for the current measure. Subscribe once per enabled/subscribe.
  useEffect(() => {
    if (!enabled || !subscribe) return undefined;
    return subscribe((evt) => {
      if (!evt || evt.type !== 'note_on' || !evt.velocity) return;
      const driftMs = driftForNoteRef.current?.(evt.note) ?? 0;
      hitsRef.current.push({ note: evt.note, driftMs });
    });
  }, [enabled, subscribe]);

  // Grade the measure that just ended whenever currentMeasure advances.
  useEffect(() => {
    if (!enabled) return;
    const prev = prevMeasureRef.current;
    if (prev != null && currentMeasure !== prev) {
      const g = gradeMeasure(
        { expected: expectedForMeasureRef.current?.(prev) || [], hits: hitsRef.current },
        cfgRef.current || {},
      );
      onMeasureGradeRef.current?.({ measure: prev, ...g });

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
  }, [enabled, currentMeasure]);

  // Reset all state when disabled or on unmount; never grade while disabled.
  useEffect(() => {
    if (enabled) return undefined;
    hitsRef.current = [];
    prevMeasureRef.current = null;
    silentRunRef.current = 0;
    stoppedRef.current = false;
    return undefined;
  }, [enabled]);

  useEffect(() => () => {
    hitsRef.current = [];
    prevMeasureRef.current = null;
    silentRunRef.current = 0;
    stoppedRef.current = false;
  }, []);
}

export default useScoreEvaluator;
