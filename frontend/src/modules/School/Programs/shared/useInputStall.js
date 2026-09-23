import { useEffect, useRef } from 'react';

/** Fires once at 45 s and again at 120 s of no input. */
export const STALL_MS = [45_000, 120_000];

/**
 * `useInputStall(key, onStall, { enabled })` arms two timers — 45 s and 120 s —
 * against whatever `key` names (a word-ladder item, a sentence on a rung). Any
 * `keydown`/`pointerdown` on the window resets BOTH timers (a stall is "no
 * input since the last one", not a fixed clock from mount); a change of `key`
 * clears and re-arms them. `onStall` is called with the elapsed ms (45000 or
 * 120000) for each threshold reached with no intervening activity.
 *
 * `enabled: false` arms nothing — for a surface with nothing on it to stall on.
 *
 * Shared by the word ladder (`item.stalled`) and the sentence ladder
 * (`rung.stalled`); what a stall MEANS, and how it is logged, stays with them.
 */
export function useInputStall(key, onStall, { enabled = true } = {}) {
  const onStallRef = useRef(onStall);
  onStallRef.current = onStall;

  useEffect(() => {
    if (!enabled) return undefined;
    let timers = [];
    const clear = () => { timers.forEach(clearTimeout); timers = []; };
    const arm = () => {
      clear();
      timers = STALL_MS.map((ms) => setTimeout(() => onStallRef.current?.(ms), ms));
    };
    const onActivity = () => arm();
    arm();
    window.addEventListener('keydown', onActivity);
    window.addEventListener('pointerdown', onActivity);
    return () => {
      clear();
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('pointerdown', onActivity);
    };
  }, [key, enabled]);
}

export default useInputStall;
