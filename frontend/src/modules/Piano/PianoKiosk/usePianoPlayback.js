// usePianoPlayback.js — consumer hooks for PianoPlaybackContext.jsx's
// playback/lock context, split out so Fast Refresh can hot-reload the
// provider on its own.
import { useContext, useEffect } from 'react';
import { Ctx } from './PianoPlaybackContext.jsx';

export const usePianoPlayback = () => useContext(Ctx);

/**
 * Hold the player-switch lock for as long as this component is mounted.
 *
 * `reason` is what the chip tells the child when they tap it, so it must read
 * as an instruction they can act on, not as a rule they have broken.
 */
export function usePlayerLock(active, reason) {
  const { claimPlayerLock } = useContext(Ctx);
  useEffect(() => {
    if (!active) return undefined;
    return claimPlayerLock(reason);
  }, [active, reason, claimPlayerLock]);
}
