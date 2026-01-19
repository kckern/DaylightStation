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

const USER_INTENT = Object.freeze({
  playing: 'playing',
  paused: 'paused',
  seeking: 'seeking'
});

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

  // Startup deadline timer (for initial load grace period)
  const startupDeadlineRef = useRef(null);
  // Track if video has ever successfully played (for loop/buffering grace detection)
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

  // Presentation logic
  // Stall detection is now handled externally by useCommonMediaController
  const isStalled = externalStalled === true;
  const isRecovering = status === STATUS.recovering;
  const isStartup = status === STATUS.startup;
  const isUserPaused = userIntent === USER_INTENT.paused;
  const isBuffering = playbackHealth.isWaiting || playbackHealth.isStalledEvent;

  // Track whether buffering has exceeded grace period (500ms)
  // Only show overlay after grace period to avoid flashes during loop transitions
  const [bufferingPastGrace, setBufferingPastGrace] = useState(false);
  const bufferingGraceTimerRef = useRef(null);

  useEffect(() => {
    if (isBuffering && hasEverPlayedRef.current) {
      // Start grace period timer - only show overlay after 500ms of buffering
      if (!bufferingGraceTimerRef.current) {
        bufferingGraceTimerRef.current = setTimeout(() => {
          setBufferingPastGrace(true);
          bufferingGraceTimerRef.current = null;
        }, 500);
      }
    } else {
      // Clear timer and reset state when not buffering
      if (bufferingGraceTimerRef.current) {
        clearTimeout(bufferingGraceTimerRef.current);
        bufferingGraceTimerRef.current = null;
      }
      if (bufferingPastGrace) {
        setBufferingPastGrace(false);
      }
    }
    return () => {
      if (bufferingGraceTimerRef.current) {
        clearTimeout(bufferingGraceTimerRef.current);
      }
    };
  }, [isBuffering, bufferingPastGrace]);

  // Suppress overlay for brief buffering after we've started playing
  // Show buffering overlay only if: not yet played, OR buffering has lasted past grace period
  const isBriefBuffering = hasEverPlayedRef.current && isBuffering && !bufferingPastGrace && !isStalled && !isRecovering;

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
  // - We are actively seeking
  // - The media element is reporting 'waiting' or 'buffering' (except for brief buffering or loop transitions)
  // - The user has paused the video (and wants the overlay shown)
  const shouldShowOverlay = !isLoopTransition && (isStalled || isRecovering || (isStartup && !hasEverPlayedRef.current) || isSeeking || (isBuffering && !isBriefBuffering) || isUserPaused);

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
