// useSyncedPlaybackRate.js
import { useState, useRef, useEffect, useCallback } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { nextPianoRate } from './pianoPlaybackRate.js';

/**
 * Keeps the piano video playback-rate button in sync with the ACTUAL media
 * element, instead of drifting from it. Two failure modes this fixes:
 *   - The element resets to 1x on a fresh element (DASH/Plex source swap,
 *     quality restart, remount) while the button still shows the user's
 *     last chosen rate (e.g. 1.25x) — display was stale.
 *   - `setPlaybackRate` is a no-op mid-load (element not ready) — the
 *     button advances but playback doesn't actually change.
 *
 * Design:
 *   - Display state mirrors the element's `ratechange` event. The element
 *     is always the source of truth for what's shown — however it got
 *     there. No setState-then-setRate cycles back onto the element from
 *     this side, so there's no feedback loop.
 *   - The user's last CHOSEN rate lives in a ref (not state — it must not
 *     retrigger the reapply effect on its own). It's re-applied only when
 *     a NEW element appears (identity change) still sitting at the
 *     default 1x, so the choice survives source swaps/remounts without
 *     ever fighting a rate the element reports on its own.
 *   - Cycling advances from the current (displayed/actual) rate, so a
 *     drifted element cycles from where it really is.
 */
export default function useSyncedPlaybackRate(mediaEl, playerRef) {
  const [rate, setRate] = useState(1);
  const chosenRateRef = useRef(1);
  const log = useCallback(() => getLogger().child({ component: 'piano-video-player' }), []);

  // Display follows the element: seed from its current rate, then track
  // every `ratechange` it reports (ours or anything else's).
  useEffect(() => {
    if (!mediaEl) return undefined;
    setRate(mediaEl.playbackRate || 1);
    const onRateChange = () => setRate(mediaEl.playbackRate || 1);
    mediaEl.addEventListener('ratechange', onRateChange);
    return () => mediaEl.removeEventListener('ratechange', onRateChange);
  }, [mediaEl]);

  // Re-apply the user's chosen rate when a fresh element shows up still at
  // the default 1x. Runs once per element identity — never re-fires from a
  // rate the element itself reports, so it can't fight a legitimate 1x.
  useEffect(() => {
    if (!mediaEl) return;
    const chosen = chosenRateRef.current;
    if (chosen !== 1 && mediaEl.playbackRate === 1) {
      playerRef.current?.setPlaybackRate?.(chosen);
      log().debug('piano.video.rate', { rate: chosen, reason: 'reapply-on-swap' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- playerRef is a stable ref object; log is stable via useCallback
  }, [mediaEl]);

  const cycleRate = useCallback(() => {
    const r = nextPianoRate(rate);
    chosenRateRef.current = r;
    playerRef.current?.setPlaybackRate?.(r);
    log().info('piano.video.rate', { rate: r });
  }, [rate, playerRef, log]);

  return { rate, cycleRate };
}
