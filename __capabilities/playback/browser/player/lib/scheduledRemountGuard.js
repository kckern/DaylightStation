// scheduledRemountGuard.js — the fire-time check for a backoff-scheduled Player remount.
//
// Why this exists: on 2026-09-01 a story-time track stalled at 0:00 for 47s,
// recovery attempt 3 was scheduled with a 1500ms backoff, the stream then
// released and playback STARTED 20ms later, and the timer fired anyway —
// unmounting the playing element and restarting from 0. The cancel-on-success
// path in Player.jsx is the primary fix; this guard is defence in depth for any
// other way the timer gets armed, and it produces the log line that makes the
// next such incident self-explanatory.
//
// A user-initiated retry (`forceRemount`) must NEVER reach this guard — see
// scheduleSinglePlayerRemount. Progress is not a reason to discard a remount
// the viewer asked for.
//
// On the two negative flags: both are BEST-EFFORT, not guaranteed live signals,
// and they are best-effort in DIFFERENT ways. `Player.jsx`'s handlePlaybackMetrics
// only overwrites either one when the renderer sends a boolean, else it keeps the
// previous value.
//
//   - Which renderers report at all: only SinglePlayer -> useCommonMediaController
//     (SinglePlayer.jsx:166-173). RemuxPlayer.jsx:89 and ImageFrame.jsx:266,496
//     call onPlaybackMetrics WITHOUT either field, so on those renderers both
//     flags latch at whatever they last held — in practice permanently false.
//   - On the SinglePlayer path the two differ: `isSeeking` is coerced with
//     `?? false`, so it is ALWAYS a boolean and never latches — a false there is
//     a real live reading. `stalled` is forwarded raw, so an undefined from the
//     controller leaves the previous value standing.
//
// Either way, treat a false here as "nothing reported a problem" rather than
// "verified healthy" — the guard must not be the only thing standing between a
// stalled element and its recovery.

/** Movement smaller than this is timer jitter, not playback. */
export const MIN_PROGRESS_SECONDS = 0.1;

/**
 * @param {object} p
 * @param {number|null} p.armedAtSeconds - playhead when the timer was armed
 * @param {number|null} p.currentSeconds - playhead now, at fire time
 * @param {boolean} [p.stalled] - renderer's stall flag (best-effort, see above)
 * @param {boolean} [p.isSeeking] - a seek is in flight (best-effort, see above).
 *   Required because a forward seek past the Plex transcoder's head wedges with
 *   `el.seeking` stuck true while `currentTime` has ALREADY jumped to the target
 *   — the one stall class that advances the clock. Without this it reads as
 *   "playback resumed" and the guard would skip the remount that unwedges it.
 * @returns {{skip: boolean, reason: string|null, advancedSeconds: number|null}}
 */
export function shouldSkipScheduledRemount({ armedAtSeconds, currentSeconds, stalled, isSeeking }) {
  if (!Number.isFinite(armedAtSeconds) || !Number.isFinite(currentSeconds)) {
    return { skip: false, reason: null, advancedSeconds: null };
  }
  const advancedSeconds = currentSeconds - armedAtSeconds;
  if (stalled === true || isSeeking === true || advancedSeconds < MIN_PROGRESS_SECONDS) {
    return { skip: false, reason: null, advancedSeconds };
  }
  return { skip: true, reason: 'playback-resumed', advancedSeconds };
}
