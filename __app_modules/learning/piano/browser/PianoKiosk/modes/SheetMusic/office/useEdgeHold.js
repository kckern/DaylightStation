// useEdgeHold.js — the board's lowest and highest keys, held together.
//
// In Sheet Music on the office screen this is the one gesture that is not
// music: held 2 s it opens the menu. The two edge keys come from the office
// keyboard's configured range (E1 and G7 on the 76-key board), and the host
// keeps them from ever reaching a take as notes.
import { useEffect, useRef, useState } from 'react';

const EMPTY = new Map();

/**
 * `onHold` fires once per hold: both edge keys down continuously for `holdMs`.
 * Releasing either before then cancels it; a new hold needs both keys up first.
 * Returns `{ holding }`, true while a hold is counting (for the hold ring).
 */
export default function useEdgeHold({ activeNotes, low, high, holdMs = 2000, enabled = true, onHold }) {
  const live = activeNotes instanceof Map ? activeNotes : EMPTY;
  const both = enabled && Number.isFinite(low) && Number.isFinite(high) && low !== high && live.has(low) && live.has(high);
  const anyDown = live.has(low) || live.has(high);
  const [fired, setFired] = useState(false); // this hold already fired: wait for both keys up
  const onHoldRef = useRef(onHold);
  onHoldRef.current = onHold;

  useEffect(() => {
    if (fired && !anyDown) setFired(false);
  }, [fired, anyDown]);

  const counting = both && !fired;
  useEffect(() => {
    if (!counting) return undefined;
    const timer = setTimeout(() => { setFired(true); onHoldRef.current?.(); }, holdMs);
    return () => clearTimeout(timer);
  }, [counting, holdMs]);

  return { holding: counting };
}
