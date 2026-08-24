import { useEffect, useRef } from 'react';
import { expectedMidisAtStep } from './activeParts.js';
import { nextPlayableStep } from './focusRange.js';
import { recognizeCursorPress } from '../../../input/recognition.js';

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
 * @param {Function} [p.onWrap]     - onWrap() — fires the instant advancement wraps
 *   from the range's out-point back to its in-point (a completed loop pass).
 *   Optional; existing callers that don't pass it are unaffected.
 * @param {[number,number]|null} [p.range] - active focus span [lo, hi]; when set,
 *   advancement wraps back to `lo` after `hi` (loop a section) instead of running
 *   linearly to the end. `null` (default) → normal linear advance.
 */
export function useFollowTracker({ enabled, steps, activeParts, step, subscribe, onStep, onHit, onWrong, onComplete, onWrap, range = null }) {
  const stepsRef = useRef(steps);
  const activePartsRef = useRef(activeParts);
  const stepRef = useRef(step);
  const onStepRef = useRef(onStep);
  const onHitRef = useRef(onHit);
  const onWrongRef = useRef(onWrong);
  const onCompleteRef = useRef(onComplete);
  const onWrapRef = useRef(onWrap);
  const rangeRef = useRef(range);
  const struckRef = useRef(new Set());

  stepsRef.current = steps;
  activePartsRef.current = activeParts;
  onStepRef.current = onStep;
  onHitRef.current = onHit;
  onWrongRef.current = onWrong;
  onCompleteRef.current = onComplete;
  onWrapRef.current = onWrap;
  rangeRef.current = range;

  // A new step starts fresh — clear the accumulated struck notes.
  useEffect(() => {
    stepRef.current = step;
    struckRef.current = new Set();
  }, [step]);

  // The cursor can be PUT on a step these hands have nothing to play at — a range
  // whose in-point falls on a left-hand onset, a hand toggled off, a tap-seek.
  // Advancing away is not enough; nothing can satisfy the step we're parked on, so
  // step off it here too. A wrap crossed this way is deliberately NOT reported: a
  // practice lap has to be played, not skipped into.
  useEffect(() => {
    if (!enabled) return;
    const stepObj = steps?.[step];
    if (!stepObj) return;
    if (expectedMidisAtStep(stepObj, activeParts || {}).size > 0) return;
    const res = nextPlayableStep(step, { steps, activeParts: activeParts || {}, range });
    if (res.complete) { onCompleteRef.current?.(); return; }
    if (res.stuck) return;
    onStepRef.current?.(res.next);
  }, [enabled, step, steps, activeParts, range]);

  useEffect(() => {
    if (!enabled || !subscribe) return undefined;
    return subscribe((evt) => {
      if (!evt || evt.type !== 'note_on' || !evt.velocity) return;
      const stepObj = stepsRef.current?.[stepRef.current];
      if (!stepObj) return; // end of piece / empty — no throw, no advance
      const expected = expectedMidisAtStep(stepObj, activePartsRef.current || {});
      const judged = recognizeCursorPress(expected, struckRef.current, evt.note, { plausibilityWindow: 24 });
      struckRef.current = judged.struck;
      if (judged.status === 'hit' || judged.status === 'complete') {
        onHitRef.current?.(evt.note);
        if (judged.complete) {
          // With a focus range active, wrap back to its in-point after the
          // out-point (loop the section); otherwise advance linearly, skipping
          // any step these hands have nothing to play at. Reaching the final
          // step (no range) COMPLETES the piece instead of clamping in place
          // (audit M5) — the piece is done, don't silently dead-end.
          const res = nextPlayableStep(stepRef.current, {
            steps: stepsRef.current,
            activeParts: activePartsRef.current || {},
            range: rangeRef.current,
          });
          struckRef.current = new Set();
          if (res.complete) { onCompleteRef.current?.(); return; }
          if (res.stuck) return; // nothing in the range is theirs to play
          if (res.wrapped) onWrapRef.current?.();
          onStepRef.current?.(res.next);
        }
        return;
      }
      if (judged.status === 'wrong') onWrongRef.current?.(evt.note);
    });
  }, [enabled, subscribe]);
}

export default useFollowTracker;
