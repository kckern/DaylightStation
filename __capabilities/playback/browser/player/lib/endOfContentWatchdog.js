/**
 * End-of-content watchdog for the screens player.
 *
 * When the screens player reaches the natural end of a source whose final
 * DASH fragment came back zero-byte (Plex transcode tails are commonly
 * empty), dash.js does not call `mediaSource.endOfStream()` and the HTML5
 * `ended` event never fires. The element settles into paused-at-duration
 * with `mediaEl.seeking === true`, and `ContentScroller.handleEnded` —
 * the only queue-advance trigger — never runs.
 *
 * This watchdog calls `onAdvance` exactly once after `idleMs` of sustained
 * paused-at-duration with no `currentTime` progression. It is event-driven:
 * the caller invokes `tick()` on every player event that could change the
 * monitored state (timeupdate / pause / play / seeked / source change),
 * and the watchdog itself schedules an internal `setTimeout` to fire when
 * the idle window elapses. No external polling required.
 *
 * `reset()` cancels any pending timer, clears the one-shot guard, and
 * re-evaluates current state — so after `reset()` the watchdog is monitoring
 * again from this instant, without the caller needing to issue an extra tick.
 *
 * See: ops:docs/_wip/audits/2026-05-23-livingroom-tv-end-of-video-stuck-seeking-audit.md
 *      ops:docs/superpowers/plans/2026-05-23-screens-player-end-of-video-recovery.md
 */
import { isNearEnd } from './nearEnd.js';

// "Nothing left to play": the playhead is this close to the end of what is buffered.
const STARVED_AHEAD_SECONDS = 0.25;

/**
 * A PLAYING element starved at the very end of what it buffered, when that end
 * is within `tailSeconds` of the declared duration. An HLS playlist can promise
 * more than the content holds: Plex's direct-stream playlist for a copied video
 * with long GOPs lists 3 s segments the segmenter never wrote ("we
 * overestimated the number of segments"), answers them with a 188-byte blank,
 * hls.js cannot parse those and never calls endOfStream, and the element parks
 * ~1 s before `duration` forever: `ended` never fires and the 0.5 s
 * at-duration window never opens (2026-11-26, plex:266151 parked at 438.0 of
 * 439). The terminal gate still checks the position against the catalog end.
 */
export function isStarvedAtTail(info, tailSeconds) {
  if (!info || info.paused !== false) return false;
  const { currentTime, duration, bufferedEnd } = info;
  if (![currentTime, duration, bufferedEnd].every(Number.isFinite) || duration <= 0) return false;
  return bufferedEnd - currentTime <= STARVED_AHEAD_SECONDS && bufferedEnd >= duration - tailSeconds;
}

export function createEndOfContentWatchdog({
  onAdvance,
  onTerminalCandidate,
  getMediaInfo,           // () => { currentTime, duration, paused, seeking, bufferedEnd? }
  thresholdSeconds = 0.5, // currentTime must be within this of duration
  tailSeconds = 1.5,      // or: playing, starved at a buffered end within this of duration
  idleMs = 3000,          // how long to wait before advancing
  log = () => {}
}) {
  let timerId = null;
  let armedAtTime = null; // currentTime captured when the current timer was scheduled
  let fired = false;

  const isAtDuration = (info) => !!info
    && (isNearEnd(info.currentTime, info.duration, thresholdSeconds) || isStarvedAtTail(info, tailSeconds));

  const cancel = () => {
    if (timerId != null) {
      clearTimeout(timerId);
      timerId = null;
    }
    armedAtTime = null;
  };

  const fire = () => {
    const armedAt = armedAtTime;
    timerId = null;
    if (fired) return;
    // Verify conditions still hold at the moment the timer fires — state could
    // have changed between scheduling and firing.
    //
    // The condition is "parked at duration", NOT "paused at duration": a dash
    // element whose trailing fragment came back zero-byte sits at duration with
    // `paused === false` and `ended === false` (2026-07-10, plex:674553). What
    // actually distinguishes end-of-content from playback is that the clock has
    // not moved for the whole idle window.
    // See ops:docs/_wip/plans/2026-07-10-player-resilience-soak-defects.md
    const info = getMediaInfo();
    if (!info || !isAtDuration(info)) return;
    if (!Number.isFinite(armedAt) || Math.abs(info.currentTime - armedAt) > 0.05) {
      // The clock moved since arming but is still at the end (it crept up to
      // the buffered end after the last event): watch a fresh idle window
      // rather than dropping the watch with no event left to re-arm it.
      armedAtTime = info.currentTime;
      timerId = setTimeout(fire, idleMs);
      return;
    }
    const result = onTerminalCandidate?.({ reason: 'watchdog', nativeSeconds: info.currentTime });
    if (onTerminalCandidate && result?.accepted !== true) return;
    fired = true;
    log('playback.end-of-content-advance', {
      currentTime: info.currentTime,
      duration: info.duration,
      bufferedEnd: Number.isFinite(info.bufferedEnd) ? info.bufferedEnd : null,
      via: isNearEnd(info.currentTime, info.duration, thresholdSeconds) ? 'at-duration' : 'starved-tail',
      idleMs,
      thresholdSeconds
    });
    try { onAdvance?.(); } catch (_) { /* swallow */ }
  };

  const tick = () => {
    if (fired) return;
    const info = getMediaInfo();
    if (!info || !isAtDuration(info)) {
      cancel();
      return;
    }
    if (timerId == null) {
      // Arm: schedule the firing timer.
      armedAtTime = info.currentTime;
      timerId = setTimeout(fire, idleMs);
      return;
    }
    if (Math.abs(info.currentTime - armedAtTime) > 0.05) {
      // currentTime moved (user scrubbed within the at-duration window) —
      // restart the timer from now so we don't fire prematurely.
      clearTimeout(timerId);
      armedAtTime = info.currentTime;
      timerId = setTimeout(fire, idleMs);
    }
    // Otherwise already armed and stable — nothing to do.
  };

  const reset = () => {
    cancel();
    fired = false;
    // Reset only clears state. The caller decides whether to re-evaluate
    // by issuing the next tick() — typically on the next player event
    // after a source change. Auto-ticking inside reset() makes teardown
    // semantics ambiguous (a teardown that re-arms is no teardown).
  };

  return { tick, reset };
}
