import { useEffect, useRef } from 'react';

/** Spec §8 `item.stalled` (warn): fires once at 45 s and again at 120 s. */
export const STALL_MS = [45_000, 120_000];

/**
 * `useItemStall(itemId, onStall)` arms two timers — 45 s and 120 s — against
 * this item. Any `keydown`/`pointerdown` on the window resets BOTH timers
 * (a stall is "no input since the last one", not a fixed clock from mount);
 * a change of `itemId` clears and re-arms them for the new item. `onStall`
 * is called with the elapsed ms (45000 or 120000) for each threshold it
 * reaches with no intervening activity.
 */
export function useItemStall(itemId, onStall) {
  const onStallRef = useRef(onStall);
  onStallRef.current = onStall;

  useEffect(() => {
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
  }, [itemId]);
}

export default useItemStall;
