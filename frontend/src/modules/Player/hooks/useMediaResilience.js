import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { playbackLog } from '../lib/playbackLogger.js';
import { getLogWaitKey } from '../lib/waitKeyLabel.js';
import { usePlaybackHealth } from './usePlaybackHealth.js';
import { useResilienceConfig } from './useResilienceConfig.js';
import { useResilienceState, RESILIENCE_STATUS } from './useResilienceState.js';
import { usePlaybackSession } from './usePlaybackSession.js';
import { resolveMediaIdentity } from '../utils/mediaIdentity.js';
import { formatTime } from '../lib/helpers.js';

export { DEFAULT_MEDIA_RESILIENCE_CONFIG, MediaResilienceConfigContext, mergeMediaResilienceConfig } from './useResilienceConfig.js';
export { RESILIENCE_STATUS } from './useResilienceState.js';

const STATUS = RESILIENCE_STATUS;

const USER_INTENT = Object.freeze({
  playing: 'playing',
  paused: 'paused',
  seeking: 'seeking'
});

const useLatest = (value) => {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
};

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
  const { monitorSettings, recoveryConfig } = useResilienceConfig({ configOverrides });
  const {
    epsilonSeconds,
    stallDetectionThresholdMs,
    hardRecoverAfterStalledForMs,
    hardRecoverLoadingGraceMs,
    recoveryCooldownMs
  } = monitorSettings;

  const { state: resilienceState, status, statusRef, actions } = useResilienceState(STATUS.startup);
  
  const [showPauseOverlay, setShowPauseOverlay] = useState(true);
  const [lastReloadAt, setLastReloadAt] = useState(0);
  const [stallCountdown, setStallCountdown] = useState(null);

  const logWaitKey = useMemo(() => getLogWaitKey(waitKey), [waitKey]);
  const mediaIdentity = useMemo(() => resolveMediaIdentity(meta), [meta]);

  const playbackHealth = usePlaybackHealth({
    seconds,
    getMediaEl,
    waitKey,
    mediaType: mediaTypeHint || meta?.media_type,
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

  // Main Watchdog Timers
  const stallTimerRef = useRef(null);
  const recoveryTimerRef = useRef(null);
  const lastProgressTokenRef = useRef(-1);
  const startupDeadlineRef = useRef(null);

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
      clearTimeout(stallTimerRef.current);
      clearTimeout(recoveryTimerRef.current);
      return;
    }

    const hasProgress = playbackHealth.progressToken !== lastProgressTokenRef.current;
    
    if (hasProgress) {
      lastProgressTokenRef.current = playbackHealth.progressToken;
      if (status !== STATUS.playing) actions.setStatus(STATUS.playing);
      clearTimeout(stallTimerRef.current);
      clearTimeout(recoveryTimerRef.current);
      clearTimeout(startupDeadlineRef.current);
      setStallCountdown(null);
      return;
    }

    // No progress...
    if (status === STATUS.playing) {
      if (!stallTimerRef.current) {
        stallTimerRef.current = setTimeout(() => {
          actions.setStatus(STATUS.stalling);
          stallTimerRef.current = null;
        }, stallDetectionThresholdMs);
      }
    } else if (status === STATUS.stalling) {
      if (!recoveryTimerRef.current) {
        recoveryTimerRef.current = setTimeout(() => {
          triggerRecovery('stall-deadline-exceeded');
          recoveryTimerRef.current = null;
        }, hardRecoverAfterStalledForMs);
      }
    } else if (status === STATUS.startup || status === STATUS.recovering) {
       if (!startupDeadlineRef.current) {
         startupDeadlineRef.current = setTimeout(() => {
           triggerRecovery('startup-deadline-exceeded');
           startupDeadlineRef.current = null;
         }, hardRecoverLoadingGraceMs);
       }
    }

    return () => {
      // Cleanup is handled by the effect dependencies or next run
    };
  }, [status, playbackHealth.progressToken, userIntent, actions, stallDetectionThresholdMs, hardRecoverAfterStalledForMs, triggerRecovery, hardRecoverLoadingGraceMs]);

  // Clean up timers on unmount or waitKey change
  useEffect(() => {
    return () => {
      clearTimeout(stallTimerRef.current);
      clearTimeout(recoveryTimerRef.current);
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

  // Presentation logic
  // If externalStalled is provided (from useCommonMediaController), trust it over internal detection
  const internalStalled = status === STATUS.stalling;
  const isStalled = externalStalled !== null ? externalStalled : internalStalled;
  const isRecovering = status === STATUS.recovering;
  const isStartup = status === STATUS.startup;
  const isUserPaused = userIntent === USER_INTENT.paused;
  const isBuffering = playbackHealth.isWaiting || playbackHealth.isStalledEvent;

  // The overlay should appear if:
  // - We are in a resilience error state (stalling, recovering, startup)
  // - We are actively seeking
  // - The media element is reporting 'waiting' or 'buffering'
  // - The user has paused the video (and wants the overlay shown)
  const shouldShowOverlay = isStalled || isRecovering || isStartup || isSeeking || isBuffering || isUserPaused;

  const overlayProps = useMemo(() => ({
    status: isSeeking ? 'seeking' : status,
    isVisible: shouldShowOverlay && (isUserPaused ? showPauseOverlay : true),
    shouldRender: shouldShowOverlay,
    waitingToPlay: isStartup || isRecovering || (isBuffering && !isStalled),
    isPaused: isUserPaused,
    userIntent,
    systemHealth: (isStalled || (isBuffering && status === STATUS.playing)) ? 'stalled' : 'ok',
    pauseOverlayActive: isUserPaused && showPauseOverlay,
    seconds,
    stalled: isStalled || (isBuffering && status === STATUS.playing),
    showPauseOverlay,
    showDebug: isStalled || isRecovering || isSeeking,
    initialStart,
    message,
    plexId,
    debugContext,
    lastProgressTs: playbackHealth.lastProgressAt,
    togglePauseOverlay: () => setShowPauseOverlay(p => !p),
    isSeeking,
    waitKey: logWaitKey,
    onRequestHardReset: () => triggerRecovery('manual-reset'),
    playerPositionDisplay: formatTime(Math.max(0, seconds)),
    intentPositionDisplay: Number.isFinite(targetTimeSeconds) ? formatTime(Math.max(0, targetTimeSeconds)) : null,
    playerPositionUpdatedAt,
    intentPositionUpdatedAt,
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
    isBuffering, 
    isUserPaused, 
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
    onStartupSignal: () => {} // No-op for now, simplified
  };
}
