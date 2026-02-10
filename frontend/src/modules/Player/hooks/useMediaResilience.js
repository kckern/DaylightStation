import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { playbackLog } from '../lib/playbackLogger.js';
import { getLogWaitKey } from '../lib/waitKeyLabel.js';
import { usePlaybackHealth } from './usePlaybackHealth.js';
import { useResilienceConfig } from './useResilienceConfig.js';
import { useResilienceState, RESILIENCE_STATUS } from './useResilienceState.js';
import { usePlaybackSession } from './usePlaybackSession.js';
import { formatTime } from '../lib/helpers.js';

export { DEFAULT_MEDIA_RESILIENCE_CONFIG, MediaResilienceConfigContext, mergeMediaResilienceConfig } from './useResilienceConfig.js';
export { RESILIENCE_STATUS } from './useResilienceState.js';

const STATUS = RESILIENCE_STATUS;

// Stable no-op function to avoid creating new function references on each render
const NOOP = () => {};

const USER_INTENT = Object.freeze({
  playing: 'playing',
  paused: 'paused',
  seeking: 'seeking'
});

// Grace period (ms) to suppress overlay during brief seeks (ffwd/rew bumps)
const SEEK_OVERLAY_GRACE_MS = 600;

/**
 * Simplified Media Resilience Hook
 * Gutted after backend bug fix to provide only basic stall recovery.
 */
export function useMediaResilience({
  getMediaEl,
  meta = {},
  seconds = 0,
  isPaused = false,
  isSeeking = false,
  pauseIntent = null,
  initialStart = 0,
  explicitStartProvided = false,
  waitKey,
  onStateChange,
  onReload,
  configOverrides,
  controllerRef,
  plexId,
  playbackSessionKey,
  debugContext,
  message,
  mediaTypeHint,
  playerFlavorHint,
  externalPauseReason = null,
  // External stall state from useCommonMediaController - if provided, trust this instead of internal detection
  externalStalled = null,
  externalStallState = null
}) {
  const { monitorSettings } = useResilienceConfig({ configOverrides });
  const {
    epsilonSeconds,
    hardRecoverLoadingGraceMs,
    recoveryCooldownMs
  } = monitorSettings;

  const { state: resilienceState, status, statusRef, actions } = useResilienceState(STATUS.startup);
  
  const [showPauseOverlay, setShowPauseOverlay] = useState(true);
  const [lastReloadAt, setLastReloadAt] = useState(0);

  const logWaitKey = useMemo(() => getLogWaitKey(waitKey), [waitKey]);

  const playbackHealth = usePlaybackHealth({
    seconds,
    getMediaEl,
    waitKey,
    mediaType: mediaTypeHint || meta?.mediaType,
    playerFlavor: playerFlavorHint,
    epsilonSeconds
  });

  const { targetTimeSeconds, setTargetTimeSeconds, consumeTargetTimeSeconds } = usePlaybackSession({ 
    sessionKey: playbackSessionKey 
  });

  // User Intent tracking
  const [userIntent, setUserIntent] = useState(USER_INTENT.playing);
  useEffect(() => {
    if (isSeeking) {
      setUserIntent(USER_INTENT.seeking);
    } else if (isPaused && pauseIntent !== 'system') {
      setUserIntent(USER_INTENT.paused);
    } else {
      setUserIntent(USER_INTENT.playing);
    }
  }, [isPaused, isSeeking, pauseIntent]);

  // Startup deadline timer (for initial load grace period)
  const startupDeadlineRef = useRef(null);
  // Track if video has ever successfully played (for loop detection)
  const hasEverPlayedRef = useRef(false);

  const triggerRecovery = useCallback((reason) => {
    const now = Date.now();
    if (now - lastReloadAt < recoveryCooldownMs) return;

    playbackLog('resilience-recovery', { reason, waitKey: logWaitKey, status: statusRef.current });
    setLastReloadAt(now);
    actions.setStatus(STATUS.recovering);

    if (typeof onReload === 'function') {
      onReload({ 
        reason, 
        meta, 
        waitKey, 
        seekToIntentMs: (targetTimeSeconds || playbackHealth.lastProgressSeconds || seconds || 0) * 1000 
      });
    }
  }, [actions, lastReloadAt, logWaitKey, meta, onReload, playbackHealth.lastProgressSeconds, recoveryCooldownMs, seconds, statusRef, targetTimeSeconds, waitKey]);

  useEffect(() => {
    if (userIntent === USER_INTENT.paused) {
      if (status !== STATUS.paused) actions.setStatus(STATUS.paused);
      return;
    }

    // Check if we have progress (used to track hasEverPlayed and clear startup deadline)
    if (playbackHealth.progressToken > 0) {
      if (status !== STATUS.playing) actions.setStatus(STATUS.playing);
      // Mark that we've successfully played (used for loop detection)
      hasEverPlayedRef.current = true;
      clearTimeout(startupDeadlineRef.current);
      startupDeadlineRef.current = null;
      return;
    }

    // Startup/recovering: set a deadline for initial load
    if (status === STATUS.startup || status === STATUS.recovering) {
      if (!startupDeadlineRef.current) {
        startupDeadlineRef.current = setTimeout(() => {
          triggerRecovery('startup-deadline-exceeded');
          startupDeadlineRef.current = null;
        }, hardRecoverLoadingGraceMs);
      }
    }
  }, [status, playbackHealth.progressToken, userIntent, actions, triggerRecovery, hardRecoverLoadingGraceMs]);

  // Clean up timers on unmount or waitKey change
  useEffect(() => {
    return () => {
      clearTimeout(startupDeadlineRef.current);
    };
  }, [waitKey]);

  // Handle outside onStateChange
  useEffect(() => {
    if (onStateChange) onStateChange(resilienceState);
  }, [resilienceState, onStateChange]);

  // Track timestamps for position freshness
  const [playerPositionUpdatedAt, setPlayerPositionUpdatedAt] = useState(Date.now());
  const [intentPositionUpdatedAt, setIntentPositionUpdatedAt] = useState(null);
  const lastSecondsRef = useRef(seconds);
  const lastIntentSecondsRef = useRef(targetTimeSeconds);

  useEffect(() => {
    if (seconds !== lastSecondsRef.current) {
      lastSecondsRef.current = seconds;
      setPlayerPositionUpdatedAt(Date.now());
    }
  }, [seconds]);

  useEffect(() => {
    if (targetTimeSeconds !== lastIntentSecondsRef.current) {
      lastIntentSecondsRef.current = targetTimeSeconds;
      setIntentPositionUpdatedAt(Number.isFinite(targetTimeSeconds) ? Date.now() : null);
    }
  }, [targetTimeSeconds]);

  // SYNCHRONOUS: read the media element's state directly during render.
  // This catches seeks BEFORE React's isSeeking prop propagates (which can lag behind
  // isBuffering, causing the overlay to flash with the old position).
  // Also reads __seekSource ('bump' for arrow keys, 'click' for progress bar) to decide
  // whether the seek grace period should apply.
  const mediaElSnapshot = (() => {
    try {
      const el = getMediaEl?.();
      return { seeking: el?.seeking === true, seekSource: el?.__seekSource || null };
    } catch {
      return { seeking: false, seekSource: null };
    }
  })();
  const effectiveSeeking = isSeeking || mediaElSnapshot.seeking;
  const isBumpSeek = mediaElSnapshot.seekSource === 'bump';

  // Sticky intent: preserve last known intent display for overlay use after consumption.
  // Uses SYNCHRONOUS render-time capture so the intent is available on the same render
  // that seeking starts (useEffect would be too late, causing a flash).
  const stickyIntentDisplayRef = useRef(null);
  const stickyIntentUpdatedAtRef = useRef(null);
  const prevEffectiveSeekingRef = useRef(false);

  // Capture intent from targetTimeSeconds (queue-initiated seeks) — useEffect is fine
  // here because targetTimeSeconds is set BEFORE seeking transitions.
  useEffect(() => {
    if (Number.isFinite(targetTimeSeconds)) {
      stickyIntentDisplayRef.current = formatTime(Math.max(0, targetTimeSeconds));
      stickyIntentUpdatedAtRef.current = Date.now();
    }
  }, [targetTimeSeconds]);

  // SYNCHRONOUS: capture sticky intent from media element on the render where
  // effectiveSeeking transitions to true (for progress bar clicks that bypass targetTimeSeconds).
  // Clear sticky intent on the render where effectiveSeeking transitions to false.
  if (effectiveSeeking && !prevEffectiveSeekingRef.current) {
    // Just started seeking — capture target from media element if no intent yet
    if (!stickyIntentDisplayRef.current) {
      try {
        const el = getMediaEl?.();
        if (el && Number.isFinite(el.currentTime)) {
          stickyIntentDisplayRef.current = formatTime(Math.max(0, el.currentTime));
          stickyIntentUpdatedAtRef.current = Date.now();
        }
      } catch { /* ignore */ }
    }
  }
  if (!effectiveSeeking && prevEffectiveSeekingRef.current) {
    // Just stopped seeking — clear sticky intent
    stickyIntentDisplayRef.current = null;
    stickyIntentUpdatedAtRef.current = null;
  }
  prevEffectiveSeekingRef.current = effectiveSeeking;

  // Seek grace period: suppress overlay during brief seeks (ffwd/rew bumps).
  // Uses a SYNCHRONOUS ref to suppress on the very first render (prevents flash),
  // plus an async timer to force re-render when the grace period expires.
  const seekGraceTimerRef = useRef(null);
  const seekStartedAtRef = useRef(null);
  const [seekGraceExpired, setSeekGraceExpired] = useState(false);

  // SYNCHRONOUS: track when seeking starts/stops (ref only, no setState during render)
  if (effectiveSeeking && seekStartedAtRef.current === null) {
    seekStartedAtRef.current = Date.now();
  }
  if (!effectiveSeeking) {
    seekStartedAtRef.current = null;
  }

  // Async timer: force re-render when grace expires so overlay can appear for long seeks
  useEffect(() => {
    if (effectiveSeeking) {
      clearTimeout(seekGraceTimerRef.current);
      seekGraceTimerRef.current = setTimeout(() => {
        setSeekGraceExpired(true);
      }, SEEK_OVERLAY_GRACE_MS);
    } else {
      setSeekGraceExpired(false);
      clearTimeout(seekGraceTimerRef.current);
      seekGraceTimerRef.current = null;
    }
    return () => clearTimeout(seekGraceTimerRef.current);
  }, [effectiveSeeking]);

  // Effective grace: only suppress overlay for bump seeks (arrow key ffwd/rew),
  // NOT for progress bar click seeks which should show the spinner immediately.
  const seekGraceActive = isBumpSeek && effectiveSeeking && !seekGraceExpired;

  // Presentation logic
  // Stall detection is now handled externally by useCommonMediaController
  const isStalled = externalStalled === true;
  const isRecovering = status === STATUS.recovering;
  const isStartup = status === STATUS.startup;
  const isUserPaused = userIntent === USER_INTENT.paused;
  const isBuffering = playbackHealth.isWaiting || playbackHealth.isStalledEvent;

  // Detect loop transition: video has loop=true, we've played before, and we're near the start
  // This check runs synchronously during render to prevent overlay flash on loop
  const isLoopTransition = (() => {
    if (!hasEverPlayedRef.current) return false;
    if (seconds >= 1) return false; // Not near start
    try {
      const mediaEl = getMediaEl?.();
      return mediaEl?.loop === true;
    } catch {
      return false;
    }
  })();

  // The overlay should appear if:
  // - We are in a resilience error state (stalling, recovering, startup)
  // - We are buffering AND not in a seek grace period
  // - The user has paused the video (and wants the overlay shown)
  // Seek grace: brief seeks (ffwd/rew bumps) suppress the overlay for SEEK_OVERLAY_GRACE_MS.
  // If the seek stalls beyond the grace period, buffering/stall triggers show the overlay.
  // Note: isLoopTransition still handles loop restart case
  const shouldShowOverlay = !isLoopTransition && !seekGraceActive && (isStalled || isRecovering || (isStartup && !hasEverPlayedRef.current) || isBuffering || isUserPaused);

  const overlayProps = useMemo(() => ({
    status: effectiveSeeking ? 'seeking' : status,
    isVisible: shouldShowOverlay && (isUserPaused ? showPauseOverlay : true),
    shouldRender: shouldShowOverlay,
    waitingToPlay: isStartup || isRecovering || isBuffering,
    isPaused: isUserPaused,
    userIntent,
    systemHealth: (isStalled || isBuffering) ? 'stalled' : 'ok',
    pauseOverlayActive: isUserPaused && showPauseOverlay,
    seconds,
    stalled: isStalled || isBuffering,
    showPauseOverlay,
    showDebug: isStalled || isRecovering || effectiveSeeking,
    initialStart,
    message,
    plexId,
    debugContext,
    lastProgressTs: playbackHealth.lastProgressAt,
    togglePauseOverlay: () => setShowPauseOverlay(p => !p),
    isSeeking: effectiveSeeking,
    waitKey: logWaitKey,
    onRequestHardReset: () => triggerRecovery('manual-reset'),
    playerPositionDisplay: formatTime(Math.max(0, seconds)),
    intentPositionDisplay: (Number.isFinite(targetTimeSeconds) ? formatTime(Math.max(0, targetTimeSeconds)) : null)
      || (effectiveSeeking ? stickyIntentDisplayRef.current : null),
    playerPositionUpdatedAt,
    intentPositionUpdatedAt: intentPositionUpdatedAt
      || (effectiveSeeking ? stickyIntentUpdatedAtRef.current : null),
    mediaDetails: {
      hasElement: true,
      currentTime: seconds.toFixed(1),
      readyState: playbackHealth.elementSignals.readyState,
      networkState: playbackHealth.elementSignals.networkState,
      paused: playbackHealth.elementSignals.paused
    }
  }), [
    status,
    isStalled,
    isRecovering,
    isStartup,
    isSeeking,
    mediaElSnapshot.seeking,
    effectiveSeeking,
    isBumpSeek,
    isBuffering,
    isUserPaused,
    seekGraceActive,
    seekGraceExpired,
    shouldShowOverlay,
    showPauseOverlay,
    userIntent,
    seconds,
    initialStart,
    message,
    plexId,
    debugContext,
    playbackHealth,
    logWaitKey,
    triggerRecovery,
    targetTimeSeconds,
    playerPositionUpdatedAt,
    intentPositionUpdatedAt
  ]);

  // Controller API
  useMemo(() => {
    if (controllerRef && 'current' in controllerRef) {
      controllerRef.current = {
        getState: () => resilienceState,
        reset: () => actions.reset(),
        forceReload: (opts) => onReload?.(opts),
        clearSeekIntent: () => consumeTargetTimeSeconds()
      };
    }
  }, [controllerRef, resilienceState, actions, onReload, consumeTargetTimeSeconds]);

  return {
    overlayProps,
    state: resilienceState,
    onStartupSignal: NOOP // Stable reference to avoid re-render cascades
  };
}
