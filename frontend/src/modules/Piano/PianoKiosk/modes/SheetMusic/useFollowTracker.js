import { useEffect, useRef } from 'react';
import { expectedMidisAtStep, isStepSatisfied } from './activeParts.js';
import { nextStepInRange } from './focusRange.js';

/**
 * useFollowTracker — full-hand Follow tracking. Advances the cursor only once
 * EVERY active-staff note at the current step has been struck (all-notes rule),
 * and flags a plausible wrong note (within 2 octaves of an expected midi).
 *
 * Subscribes ONCE per `enabled`/`subscribe` change; step/steps/activeParts and
 * the callbacks are read from refs inside the per-note handler so incoming notes
 * neither resubscribe nor see stale closures. The `struck` set resets whenever
 * `step` changes (each step starts fresh).
 *
 * @param {object}   p
 * @param {boolean}  p.enabled
 * @param {Array}    p.steps        - [{ onsetQuarter, notes: [{ midi, staff }] }]
 * @param {object}   p.activeParts  - { [staff]: boolean }
 * @param {number}   p.step         - current step index
 * @param {Function} p.subscribe    - subscribe(fn) → unsubscribe; fn(evt)
 * @param {Function} p.onStep       - onStep(nextIndex)
 * @param {Function} p.onHit        - onHit(midi)
 * @param {Function} p.onWrong      - onWrong(midi)
 * @param {[number,number]|null} [p.range] - active focus span [lo, hi]; when set,
 *   advancement wraps back to `lo` after `hi` (loop a section) instead of running
 *   linearly to the end. `null` (default) → normal linear advance.
 */
export function useFollowTracker({ enabled, steps, activeParts, step, subscribe, onStep, onHit, onWrong, range = null }) {
  const stepsRef = useRef(steps);
  const activePartsRef = useRef(activeParts);
  const stepRef = useRef(step);
  const onStepRef = useRef(onStep);
  const onHitRef = useRef(onHit);
  const onWrongRef = useRef(onWrong);
  const rangeRef = useRef(range);
  const struckRef = useRef(new Set());

  stepsRef.current = steps;
  activePartsRef.current = activeParts;
  onStepRef.current = onStep;
  onHitRef.current = onHit;
  onWrongRef.current = onWrong;
  rangeRef.current = range;

  // A new step starts fresh — clear the accumulated struck notes.
  useEffect(() => {
    stepRef.current = step;
    struckRef.current = new Set();
  }, [step]);

  useEffect(() => {
    if (!enabled || !subscribe) return undefined;
    return subscribe((evt) => {
      if (!evt || evt.type !== 'note_on' || !evt.velocity) return;
      const stepObj = stepsRef.current?.[stepRef.current];
      if (!stepObj) return; // end of piece / empty — no throw, no advance
      const expected = expectedMidisAtStep(stepObj, activePartsRef.current || {});
      if (expected.has(evt.note)) {
        struckRef.current.add(evt.note);
        onHitRef.current?.(evt.note);
        if (isStepSatisfied(expected, struckRef.current)) {
          // With a focus range active, wrap back to its in-point after the
          // out-point (loop the section); otherwise advance linearly to the end.
          const r = rangeRef.current;
          const next = r
            ? nextStepInRange(stepRef.current, r)
            : Math.min((stepsRef.current?.length || 1) - 1, stepRef.current + 1);
          onStepRef.current?.(next);
          struckRef.current = new Set();
        }
        return;
      }
      // Plausible wrong note: within 2 octaves of anything expected here.
      for (const m of expected) {
        if (Math.abs(evt.note - m) <= 24) { onWrongRef.current?.(evt.note); return; }
      }
    });
  }, [enabled, subscribe]);
}

export default useFollowTracker;
