import { useEffect, useState } from 'react';

/**
 * A cluster is one request, however unevenly the fingers land.
 *
 * Chord input already waits for the held set to stop moving before it means
 * anything — `advanceCursor` holds for `DEFAULT_SETTLE_MS` in ./chordCursor.js.
 * Gesture input did not, and that asymmetry was a real defect: `recognizeGesture`
 * reads 3 adjacent semitones as `hint`, 4 as `best` and 5 as `replay`, so a
 * four-key best press that did not land perfectly flat passed through the
 * three-key hint shape on the way up and charged a hint nobody asked for. The
 * five-key replay press crossed BOTH the hint and the best shapes, so "show me
 * that again" fired an analysis request and voided the game for promotion.
 *
 * Neither was visible on screen. The child saw a help mark they had not
 * requested, and later a result card naming a rule they had not broken.
 *
 * So a gesture has to hold still to count, exactly as a chord does. A release
 * settles immediately — an empty hand is not a pending request, and waiting on
 * it would let the last gesture fire again after the keys were already up.
 */
export const GESTURE_SETTLE_MS = 140;

export function useSettledGesture(gesture, settleMs = GESTURE_SETTLE_MS) {
  const [settled, setSettled] = useState(null);

  useEffect(() => {
    if (!gesture) {
      setSettled(null);
      return undefined;
    }
    const timer = setTimeout(() => setSettled(gesture), settleMs);
    // A cluster still growing clears the pending timer and starts again, so
    // only the shape the hand actually rested on is ever acted upon.
    return () => clearTimeout(timer);
  }, [gesture, settleMs]);

  return settled;
}

export default useSettledGesture;
