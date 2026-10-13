// heldAtMount.js — a key already down when a game opens is not a move.
//
// The launcher selects on a key press, so the moment a game mounts that key is
// still held. The game reads `activeNotes`, sees it, and treats it as the
// player's first input: opening Connect Four dropped a disc in the column of
// whatever key picked Connect Four.
//
// The launcher already applies this rule to itself (`prevNotesRef` — "notes
// already down are not struck", which is what stops a held key selecting a game
// the instant the overlay opens). This is the same rule at the game boundary, so
// it holds for every game rather than each one re-deriving it.
//
// Masked notes are released individually: holding a chord through the mount
// suppresses exactly those keys, and each becomes live again the moment it is
// lifted. A player who genuinely wants that note plays it again, which is what
// they would do anyway.

import { useRef, useMemo } from 'react';

/**
 * `activeNotes` with any note that was already down at mount removed, until
 * that note has been released at least once.
 *
 * @param {Map<number, {velocity: number, timestamp: number}>} activeNotes
 * @returns {Map} the same Map when nothing is masked, so consumers keeping it
 *   as an effect dependency do not see a new identity every render.
 */
export function useNotesHeldAtMount(activeNotes) {
  // Captured on first render, not in an effect: a game can read notes during
  // its very first commit, which is before any effect has run.
  const maskedRef = useRef(null);
  if (maskedRef.current === null) {
    maskedRef.current = new Set(activeNotes instanceof Map ? activeNotes.keys() : []);
  }

  return useMemo(() => {
    const masked = maskedRef.current;
    if (!(activeNotes instanceof Map)) return activeNotes;
    if (masked.size === 0) return activeNotes;
    // Retire a masked note as soon as it is no longer held.
    for (const note of [...masked]) if (!activeNotes.has(note)) masked.delete(note);
    if (masked.size === 0) return activeNotes;
    // Identity only changes when something is actually being hidden.
    const out = new Map();
    for (const [note, value] of activeNotes) if (!masked.has(note)) out.set(note, value);
    return out;
  }, [activeNotes]);
}

export default useNotesHeldAtMount;
