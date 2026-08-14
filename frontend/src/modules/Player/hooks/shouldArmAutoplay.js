/**
 * Whether a freshly-built media element should arm `autoplay`.
 *
 * A resilience remount rebuilds the element from scratch and previously armed autoplay
 * unconditionally, which silently resumed a player the user had deliberately paused —
 * a paused seek that wedges trips the jolt ladder (isStuck requires !isUserPaused, and
 * seeking clears that flag), and ~9.5s later the rebuilt element just started playing.
 *
 * @param {object|null} remountDiagnostics - remount context; `wasPaused` set by the remount
 * @returns {boolean}
 */
export function shouldArmAutoplay(remountDiagnostics) {
  return !remountDiagnostics?.wasPaused;
}

export default shouldArmAutoplay;
