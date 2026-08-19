// useAnyKeyToContinue.js — a finished game has to be restartable from the keys.
//
// The office screen has no touchscreen. Every board game ends on a "Play again"
// button, which on that screen is a dead end: the game is over, the board is
// frozen, and the only way out is the launcher combo. The piano IS the input
// device there, so the end of a game should answer to it like everything else.
//
// The tricky part is not the key press, it is NOT counting the one already down.
// A game ends ON a move, so the keys that played that winning move are still
// held at the moment the game becomes finished; firing on those would restart
// instantly and the player would never see who won.

import { useEffect, useRef } from 'react';

/**
 * Call `onContinue` on the first FRESH key press after `enabled` goes true.
 *
 * Fires at most once per enable: re-arms only when `enabled` goes false and
 * true again (i.e. the next game ends).
 *
 * @param {object}  args
 * @param {boolean} args.enabled     - typically `game.status.gameOver`
 * @param {Map}     args.activeNotes - live held notes
 * @param {Function} args.onContinue
 */
export function useAnyKeyToContinue({ enabled, activeNotes, onContinue }) {
  // Keys down at the moment the game ended — the winning move's own keys.
  const heldAtEnableRef = useRef(null);
  const firedRef = useRef(false);
  // Read through a ref so a fresh inline callback each render cannot re-run the
  // effect; games rebuild `restart` on every render.
  const onContinueRef = useRef(onContinue);
  onContinueRef.current = onContinue;

  useEffect(() => {
    if (!enabled) {
      heldAtEnableRef.current = null;
      firedRef.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || firedRef.current) return;
    const live = activeNotes instanceof Map ? activeNotes : new Map();

    if (heldAtEnableRef.current === null) {
      heldAtEnableRef.current = new Set(live.keys());
      return;
    }
    const stale = heldAtEnableRef.current;
    // Retire each carried-over key as it is lifted, so it can count next time.
    for (const note of [...stale]) if (!live.has(note)) stale.delete(note);

    for (const note of live.keys()) {
      if (stale.has(note)) continue;
      firedRef.current = true;
      onContinueRef.current?.();
      return;
    }
  }, [enabled, activeNotes]);
}

export default useAnyKeyToContinue;
