// useSyncedPlaybackRate.js
import { useState, useRef, useEffect, useCallback } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { nextPianoRate } from './pianoPlaybackRate.js';

/**
 * Keeps the piano video playback-rate button in sync with the ACTUAL media
 * element, instead of drifting from it. Three failure modes this fixes:
 *   - The element resets to 1x on a fresh element (DASH/Plex source swap,
 *     quality restart, remount) while the button still shows the user's
 *     last chosen rate (e.g. 1.25x) — display was stale.
 *   - `setPlaybackRate` is a no-op mid-load (element not ready) — the
 *     button advances but playback doesn't actually change.
 *   - The button goes DEAD under repeated presses. Applying a rate is an
 *     async multi-hop round trip (setPlaybackRate -> Player session state ->
 *     controller effect -> el.playbackRate -> 'ratechange' -> setState). When
 *     cycling was computed from the observed rate, a second press landing
 *     before that round trip completed recomputed from the same stale value
 *     and re-requested the rate already in flight. Prod 2026-08-17: 84 of 462
 *     presses produced no change at all, worst run 28 presses over 24.6s all
 *     asking for 0.5x. A child taps far faster than the round trip resolves.
 *
 * Design:
 *   - Cycling advances from `chosenRateRef` — what the user last ASKED for,
 *     updated synchronously on press. That is what makes N presses advance N
 *     steps regardless of how slowly the element catches up. The label moves
 *     optimistically to match, so the control always feels live.
 *   - The element remains the source of truth for rates we did NOT request.
 *     Every requested value is parked in `pendingRef`; a `ratechange` carrying
 *     one of those is just our own echo and is consumed. A `ratechange` that
 *     matches nothing pending is a genuine external change (a queued rate, a
 *     remount) and is adopted into both the display and the cycle base, so the
 *     next press advances from where playback really is.
 *   - The chosen rate is re-applied when a NEW element appears still sitting at
 *     the default 1x, so the choice survives source swaps without ever fighting
 *     a legitimate 1x.
 */
export default function useSyncedPlaybackRate(mediaEl, playerRef) {
  const [rate, setRate] = useState(1);
  const chosenRateRef = useRef(1);
  // Rates we have requested but not yet seen echoed back by the element.
  const pendingRef = useRef([]);
  const log = useCallback(() => getLogger().child({ component: 'piano-video-player' }), []);

  // Display follows the element: seed from its current rate, then track every
  // `ratechange`. Ours are consumed from the pending list; anything else is an
  // external change and retargets the cycle base too.
  useEffect(() => {
    if (!mediaEl) return undefined;
    pendingRef.current = [];
    setRate(mediaEl.playbackRate || 1);
    const onRateChange = () => {
      const actual = mediaEl.playbackRate || 1;
      const i = pendingRef.current.indexOf(actual);
      if (i !== -1) {
        // Our own echo. Drop it and everything staler than it — intermediate
        // steps of a fast cycle can be coalesced away by the apply path.
        pendingRef.current.splice(0, i + 1);
        // Only let an echo drive the label once the queue has drained, so a
        // coalesced intermediate can't yank the label backwards mid-cycle.
        if (pendingRef.current.length === 0) setRate(actual);
        return;
      }
      setRate(actual);
      chosenRateRef.current = actual;
    };
    mediaEl.addEventListener('ratechange', onRateChange);
    return () => mediaEl.removeEventListener('ratechange', onRateChange);
  }, [mediaEl]);

  // Re-apply the user's chosen rate when a fresh element shows up still at the
  // default 1x. Runs once per element identity — never re-fires from a rate the
  // element itself reports, so it can't fight a legitimate 1x.
  useEffect(() => {
    if (!mediaEl) return;
    const chosen = chosenRateRef.current;
    if (chosen !== 1 && mediaEl.playbackRate === 1) {
      pendingRef.current.push(chosen);
      playerRef.current?.setPlaybackRate?.(chosen);
      log().info('piano.video.rate', { rate: chosen, reason: 'reapply-on-swap' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- playerRef is a stable ref object; log is stable via useCallback
  }, [mediaEl]);

  const cycleRate = useCallback(() => {
    const r = nextPianoRate(chosenRateRef.current);
    chosenRateRef.current = r;
    pendingRef.current.push(r);
    setRate(r); // optimistic — the control must never feel dead under the finger
    playerRef.current?.setPlaybackRate?.(r);
    log().info('piano.video.rate', { rate: r, reason: 'press' });
  }, [playerRef, log]);

  return { rate, cycleRate };
}
