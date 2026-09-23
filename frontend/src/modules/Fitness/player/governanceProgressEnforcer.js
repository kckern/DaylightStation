import { useCallback, useEffect, useRef } from 'react';

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

/**
 * React wiring for enforceGovernanceOnProgress. Owns the live governance ref so
 * callers cannot hand <Player> a handler that closes over a render's boolean.
 *
 * `enforce` and `isLocked` keep one identity across governance changes (they
 * change only if pausePlayback / setVideoPlayerPaused / logger change), and both
 * read the verdict at call time. After unmount `enforce` does nothing at all:
 * no pause, no setVideoPlayerPaused, no log. FitnessContext outlives
 * FitnessPlayer, so a leaked listener on a dead element must not be able to
 * set videoPlayerPaused and freeze governance. `isLocked` reads false.
 *
 * On unmount, if the value this hook last wrote to setVideoPlayerPaused was
 * true, it writes false once, so FitnessContext's governance freeze and the
 * music player do not stay paused until the next mount. Other owners also
 * write that flag (voice memo overlay, EmergencyPlaybackController, module
 * pause requests); `isPauseHeldElsewhere` lets the caller veto the clear while
 * one of them holds a pause. FitnessPlayer's veto covers the voice memo overlay
 * and the emergency phase only; module pause requests via useFitnessModule's
 * `pauseVideo` (no callers today) are NOT vetoed. The enforcer overwrites the flag on every tick
 * while mounted, so "last value the enforcer wrote" plus that veto is the
 * owner information available here.
 *
 * @param {object} args
 * @param {boolean} args.governancePaused  this render's governance verdict
 * @param {() => void} [args.pausePlayback]
 * @param {(paused: boolean) => void} [args.setVideoPlayerPaused]
 * @param {object} [args.logger]  structured logger with .sampled()
 * @param {() => object} [args.getContext]  governance snapshot for telemetry, read at log time
 * @param {() => boolean} [args.isPauseHeldElsewhere]  true while another owner holds a pause, read at unmount
 *   (FitnessPlayer: voice memo open or emergency active; useFitnessModule `pauseVideo` is not covered)
 * @returns {{ enforce: (progress: {paused: boolean, currentTime?: number}, branch: string) => void, isLocked: () => boolean }}
 */
export function useGovernanceProgressEnforcer({
  governancePaused,
  pausePlayback,
  setVideoPlayerPaused,
  logger,
  getContext,
  isPauseHeldElsewhere,
}) {
  const lockedRef = useRef(Boolean(governancePaused));
  lockedRef.current = Boolean(governancePaused);
  const getContextRef = useRef(getContext);
  getContextRef.current = getContext;
  const isPauseHeldElsewhereRef = useRef(isPauseHeldElsewhere);
  isPauseHeldElsewhereRef.current = isPauseHeldElsewhere;
  const setVideoPlayerPausedRef = useRef(setVideoPlayerPaused);
  setVideoPlayerPausedRef.current = setVideoPlayerPaused;
  const mountedRef = useRef(true);
  // Value this hook last passed to setVideoPlayerPaused (null = never wrote).
  const lastWrittenRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    // Gate on mount state rather than zeroing lockedRef: StrictMode's simulated
    // unmount/remount would otherwise leave the verdict false until next render.
    return () => {
      mountedRef.current = false;
      if (lastWrittenRef.current !== true) return;
      lastWrittenRef.current = null;
      let heldElsewhere = false;
      try { heldElsewhere = Boolean(isPauseHeldElsewhereRef.current?.()); } catch { heldElsewhere = false; }
      if (heldElsewhere) return;
      setVideoPlayerPausedRef.current?.(false);
    };
  }, []);

  const isLocked = useCallback(() => mountedRef.current && lockedRef.current, []);

  const enforce = useCallback((progress, branch) => {
    if (!mountedRef.current) return;
    enforceGovernanceOnProgress(progress, {
      isGovernanceLocked: isLocked,
      pausePlayback,
      setVideoPlayerPaused: setVideoPlayerPaused
        ? (value) => { lastWrittenRef.current = value; setVideoPlayerPaused(value); }
        : undefined,
      onEnforced: () => {
        let snapshot = null;
        try { snapshot = getContextRef.current?.() || null; } catch { snapshot = null; }
        logger?.sampled?.('fitness.governance.pause-enforced', {
          branch: branch || null,
          currentTime: Number.isFinite(progress?.currentTime) ? progress.currentTime : null,
          ...(snapshot || {}),
        }, { maxPerMinute: 10, aggregate: true });
      },
    });
  }, [isLocked, pausePlayback, setVideoPlayerPaused, logger]);

  return { enforce, isLocked };
}

export default enforceGovernanceOnProgress;
