/**
 * useReloadGuard — intentionally a NO-OP.
 *
 * It used to install a `beforeunload` handler during video playback as a
 * pull-to-refresh backstop, but on the FKB kiosk there is no user-initiated
 * refresh to protect against, and the browser's "Leave/navigate away from this
 * page?" prompt it triggered fired unexpectedly whenever the watchdog reloaded
 * the SPA mid-video — one of the surprise notices we removed. Kept as a no-op so
 * existing call sites (PianoVideoPlayer) need no change.
 *
 * @param {boolean} _active - ignored
 */
export function useReloadGuard(_active) {
  // no-op: see doc comment above
}

export default useReloadGuard;
