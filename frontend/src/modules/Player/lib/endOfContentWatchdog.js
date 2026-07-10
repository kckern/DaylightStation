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
 * See: docs/_wip/audits/2026-05-23-livingroom-tv-end-of-video-stuck-seeking-audit.md
 *      docs/superpowers/plans/2026-05-23-screens-player-end-of-video-recovery.md
 */
import { isNearEnd } from './nearEnd.js';

export function createEndOfContentWatchdog({
  onAdvance,
  getMediaInfo,           // () => { currentTime, duration, paused, seeking }
  thresholdSeconds = 0.5, // currentTime must be within this of duration
  idleMs = 3000,          // how long to wait before advancing
  log = () => {}
}) {
  let timerId = null;
  let armedAtTime = null; // currentTime captured when the current timer was scheduled
  let fired = false;

  const isAtDuration = (info) => !!info && isNearEnd(info.currentTime, info.duration, thresholdSeconds);

  const cancel = () => {
    if (timerId != null) {
      clearTimeout(timerId);
      timerId = null;
    }
    armedAtTime = null;
  };

  const fire = () => {
    timerId = null;
    if (fired) return;
    // Verify conditions still hold at the moment the timer fires —
    // state could have changed between scheduling and firing.
    const info = getMediaInfo();
    if (!info || !info.paused || !isAtDuration(info)) return;
    fired = true;
    log('playback.end-of-content-advance', {
      currentTime: info.currentTime,
      duration: info.duration,
      idleMs,
      thresholdSeconds
    });
    try { onAdvance?.(); } catch (_) { /* swallow */ }
  };

  const tick = () => {
    if (fired) return;
    const info = getMediaInfo();
    if (!info || !info.paused || !isAtDuration(info)) {
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
