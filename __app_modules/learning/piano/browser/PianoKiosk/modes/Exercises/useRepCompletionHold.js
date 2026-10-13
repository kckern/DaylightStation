import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { heldRepWindow, repBoundaryCrossed } from './deckProgress.js';

/**
 * How long a finished rep stays on screen, every note done, before the next
 * rep's notes replace it. Long enough to see the last note go green, short
 * enough that a child playing straight on is never made to wait: any progress
 * in the next rep ends the hold at once.
 */
export const REP_HOLD_MS = 600;

/**
 * DISPLAY ONLY. The judge's cursor is never held. Notes played during the beat
 * count toward the next rep exactly as before. This hook only decides which
 * rep the staff shows.
 */
export default function useRepCompletionHold({ instance, cursorIndex, enabled, logger, traceFields }) {
  const [hold, setHold] = useState(null);
  const prevRef = useRef({ instance, cursorIndex });
  const timerRef = useRef(null);
  const holdRef = useRef(null);
  const loggerRef = useRef(logger);
  const traceRef = useRef(traceFields);
  loggerRef.current = logger;
  traceRef.current = traceFields;

  const release = (endedBy) => {
    if (timerRef.current) { globalThis.clearTimeout(timerRef.current); timerRef.current = null; }
    const current = holdRef.current;
    if (!current) return;
    holdRef.current = null;
    setHold(null);
    if (endedBy) loggerRef.current?.info?.('piano.exercise-rep-hold-released', { ...traceRef.current, repIndex: current.repIndex, endedBy });
  };

  // Layout effect: the hold must be in place before the browser paints, or the
  // next rep would show for one frame ahead of the rep being held.
  useLayoutEffect(() => {
    const prev = prevRef.current;
    prevRef.current = { instance, cursorIndex };
    if (prev.instance !== instance || !enabled) { release(null); return; }
    if (holdRef.current && cursorIndex !== prev.cursorIndex) release(cursorIndex > prev.cursorIndex ? 'next-input' : 'reset');
    const crossed = repBoundaryCrossed(instance, prev.cursorIndex, cursorIndex);
    if (!crossed) return;
    const next = { repOffset: crossed.repOffset, repIndex: crossed.repIndex, window: heldRepWindow(instance, crossed.repOffset) };
    holdRef.current = next;
    setHold(next);
    loggerRef.current?.info?.('piano.exercise-rep-completed', { ...traceRef.current, repIndex: crossed.repIndex, unit: crossed.unit, holdMs: REP_HOLD_MS });
    timerRef.current = globalThis.setTimeout(() => { timerRef.current = null; release('timer'); }, REP_HOLD_MS);
  }, [instance, cursorIndex, enabled]);

  useEffect(() => () => { if (timerRef.current) globalThis.clearTimeout(timerRef.current); }, []);

  return hold;
}
