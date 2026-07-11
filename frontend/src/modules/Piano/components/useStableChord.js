import { useState, useRef, useEffect } from 'react';

// A chord's identity is its display name (captures root, quality, inversion,
// slash). Empty / unidentified chords have no name.
const sigOf = (c) => (c && c.displayName ? c.displayName : '');

/**
 * useStableChord — buffer/hysteresis for the live chord read-out.
 *
 * The raw identification changes on every note event, so rolling or transitioning
 * between chords flashes transient partial chords (a 2-note interval mid-roll
 * reads as a power chord, etc.). This settles the read-out:
 *
 *  - **Onset settle:** a newly identified chord must remain the identified chord
 *    for `settleMs` before it replaces the shown one. Rapid changes keep
 *    resetting the window, so only the chord you land on commits — the shown
 *    chord lingers meanwhile (no flashing through intermediate states).
 *  - **Release hold:** when the keys clear, the last chord lingers `holdMs`
 *    before blanking, so a quick lift-and-replace never flickers to empty.
 *
 * `settleMs` is below the "instant" perception threshold, so a deliberately held
 * chord still appears promptly.
 *
 * @param {object} chord - the raw identifyChord() result (new object each render)
 * @param {{settleMs?:number, holdMs?:number}} [opts]
 * @returns {object} the stabilised chord to display
 */
export function useStableChord(chord, { settleMs = 80, holdMs = 500 } = {}) {
  const [shown, setShown] = useState(chord);
  const latest = useRef(chord);
  const settleTimer = useRef(null);
  const releaseTimer = useRef(null);

  // Always keep the newest raw chord for the timers to read when they fire.
  useEffect(() => { latest.current = chord; });

  const sig = sigOf(chord);
  const shownSig = sigOf(shown);

  useEffect(() => {
    if (sig) {
      // A candidate chord is present — cancel any pending blank.
      if (releaseTimer.current) { clearTimeout(releaseTimer.current); releaseTimer.current = null; }
      if (sig === shownSig) {
        // Already showing this chord: abandon any settle in progress.
        if (settleTimer.current) { clearTimeout(settleTimer.current); settleTimer.current = null; }
        return undefined;
      }
      // Different chord — (re)start the settle window; commit the LATEST once it
      // has held for settleMs (transients that get replaced never commit).
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => {
        settleTimer.current = null;
        setShown(latest.current);
      }, settleMs);
      return undefined;
    }

    // No chord (released / unidentified): drop a pending candidate, then let the
    // current read-out linger before it blanks.
    if (settleTimer.current) { clearTimeout(settleTimer.current); settleTimer.current = null; }
    if (shownSig && !releaseTimer.current) {
      releaseTimer.current = setTimeout(() => {
        releaseTimer.current = null;
        setShown(latest.current); // the empty chord captured at release
      }, holdMs);
    }
    return undefined;
  }, [sig, shownSig, settleMs, holdMs]);

  useEffect(() => () => {
    clearTimeout(settleTimer.current);
    clearTimeout(releaseTimer.current);
  }, []);

  return shown;
}

export default useStableChord;
