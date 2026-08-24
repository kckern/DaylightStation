import { useEffect, useRef } from 'react';
import { expectedMidisAtStep } from './activeParts.js';
import { nextPlayableStep } from './focusRange.js';

const onsetKey = (value) => Number(value || 0).toFixed(6);

function stepForAssessmentEvent(steps, event) {
  if (!event) return -1;
  const key = onsetKey(event.onsetQuarter);
  return (steps || []).findIndex((step) => onsetKey(step.onsetQuarter) === key);
}

/**
 * Bind Learn MIDI to the canonical assessment runtime and project its classified
 * events onto the score cursor. This hook owns no musical matching state.
 */
export function useLearnAssessmentProjection({
  enabled,
  runtimeRef,
  steps,
  activeParts,
  step,
  subscribe,
  onStep,
  onHit,
  onWrong,
  onComplete,
  onWrap,
  range = null,
  now = () => performance.now(),
}) {
  const valuesRef = useRef({ steps, activeParts, step, onStep, onHit, onWrong, onComplete, onWrap, range, now });
  valuesRef.current = { steps, activeParts, step, onStep, onHit, onWrong, onComplete, onWrap, range, now };

  // Keep the visible cursor aligned with the first playable event already
  // selected by the canonical cursor (for seeks, ranges, and hand filtering).
  useEffect(() => {
    if (!enabled) return;
    const stepObj = steps?.[step];
    if (!stepObj || expectedMidisAtStep(stepObj, activeParts || {}).size > 0) return;
    const next = nextPlayableStep(step, { steps, activeParts: activeParts || {}, range });
    if (next.complete) onComplete?.();
    else if (!next.stuck) onStep?.(next.next);
  }, [activeParts, enabled, onComplete, onStep, range, step, steps]);

  useEffect(() => {
    if (!enabled || !subscribe) return undefined;
    return subscribe((input) => {
      if (!input || input.type !== 'note_on' || !input.velocity) return;
      const current = valuesRef.current;
      const runtime = runtimeRef.current;
      if (!runtime) return;
      const observed = runtime.observe({
        midi: input.note,
        // useMidiSubscription stamps wall-clock Date.now(); this attempt starts
        // on performance.now(). Keep one monotonic domain instead of forwarding
        // a numerically valid but incompatible timestamp.
        time: current.now(),
        clock: 'score-learn',
      });
      const classified = observed?.events?.length ? observed.events : [observed?.event].filter(Boolean);
      if (classified.some((event) => event.type === 'wrong')) {
        current.onWrong?.(input.note);
        return;
      }
      if (!classified.some((event) => event.type === 'hit' || event.type === 'onset_complete')) return;
      current.onHit?.(input.note);
      if (!classified.some((event) => event.type === 'onset_complete')) return;

      // Project from the canonical cursor, not the React step prop: several
      // MIDI attacks can arrive before React commits the preceding cursor move.
      // The expectation cursor has already advanced synchronously and remains
      // the authority even in that burst.
      if (observed.attempt.status === 'completed') {
        if (!current.range) {
          current.onComplete?.();
          return;
        }
        const firstEvent = observed.attempt.expectation.events.find((event) => event.notes.length > 0);
        const firstStep = stepForAssessmentEvent(current.steps, firstEvent);
        current.onWrap?.();
        if (firstStep >= 0) current.onStep?.(firstStep);
        return;
      }

      const nextEvent = observed.attempt.expectation.events[observed.attempt.cursor];
      const nextStep = stepForAssessmentEvent(current.steps, nextEvent);
      if (nextStep >= 0) current.onStep?.(nextStep);
      else {
        // Geometry extraction can lag a rebuilt expectation for one commit.
        // Preserve visual continuity without changing musical state.
        const fallback = nextPlayableStep(current.step, {
          steps: current.steps,
          activeParts: current.activeParts || {},
          range: current.range,
        });
        if (!fallback.complete && !fallback.stuck) current.onStep?.(fallback.next);
      }
    });
  }, [enabled, runtimeRef, subscribe]);
}

export default useLearnAssessmentProjection;
