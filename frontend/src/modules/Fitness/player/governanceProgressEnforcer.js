/**
 * Governance enforcement on a progress tick.
 *
 * THE RULE: governance may pause only while it is locked RIGHT NOW. When it is
 * clear, a play press plays and nothing here pauses it.
 *
 * `isGovernanceLocked` is a function, read at call time, never a captured
 * boolean. On 2026-09-22 a progress handler that had captured `locked=true`
 * during the startup lock survived (via a leaked media listener) and kept
 * pausing the video after governance unlocked — 41 play presses overruled.
 * See docs/_wip/plans/2026-09-22-fitness-play-means-play.md.
 *
 * @param {{paused: boolean}} progress  native element state from onProgress
 * @param {object} deps
 * @param {() => boolean} deps.isGovernanceLocked  live governance verdict
 * @param {() => void} [deps.pausePlayback]
 * @param {(paused: boolean) => void} [deps.setVideoPlayerPaused]
 * @param {() => void} [deps.onEnforced]  telemetry hook, called once per enforced pause
 */
export function enforceGovernanceOnProgress(progress, deps) {
  const paused = Boolean(progress?.paused);
  const locked = Boolean(deps?.isGovernanceLocked?.());
  if (locked && !paused && deps?.pausePlayback) {
    deps.onEnforced?.();
    deps.pausePlayback();
  }
  deps?.setVideoPlayerPaused?.(paused || locked);
}

export default enforceGovernanceOnProgress;
