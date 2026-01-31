import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import spinner from '../../../assets/icons/spinner.svg';
import pause from '../../../assets/icons/pause.svg';
import { playbackLog } from '../lib/playbackLogger.js';
import { buildMediaDiagnostics, EMPTY_MEDIA_DIAGNOSTICS } from '../lib/mediaDiagnostics.js';

/**
 * Loading / resilience overlay shown while media is buffering, stalling, or waiting to start.
 */
export function PlayerOverlayLoading({
  shouldRender,
  isVisible,
  pauseOverlayActive = false,
  seconds = 0,
  stalled = false,
  waitingToPlay = false,
  startupWatchdogState = null,
  status = 'pending',
  togglePauseOverlay,
  playerPositionDisplay,
  intentPositionDisplay,
  playerPositionUpdatedAt = null,
  intentPositionUpdatedAt = null,
  countdownSeconds = null,
  onRequestHardReset,
  overlayLoggingActive = true,
  overlayLogLabel = null,
  waitKey,
  overlayRevealDelayMs = 0,
  mediaDetails: mediaDetailsProp = null,
  suppressForBlackout = false,
  showPauseIcon = false,
  showDebugDiagnostics = false,
  getMediaEl,
  sessionInstance = null,
  currentTime = null,
  videoFps = null
}) {
  // In blackout mode, keep screen completely dark (TV appears off)
  if (suppressForBlackout) {
    return null;
  }
  const overlayDisplayActive = shouldRender && isVisible && !pauseOverlayActive;

  const logIntervalRef = useRef(null);
  const diagnosticIntervalRef = useRef(null);
  const visibleSinceRef = useRef(null);
  const componentIdRef = useRef(`overlay-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`);
  const lastPlayheadRef = useRef(null);
  const stallThresholdEmittedRef = useRef(false);
  const overlayVisibilityRef = useRef({
    overlayDisplayActive,
    shouldRender,
    isVisible,
    pauseOverlayActive
  });
  const overlayLogContext = useMemo(() => ({
    source: 'PlayerOverlayLoading',
    overlayLogLabel: overlayLogLabel || null,
    waitKey: waitKey || null
  }), [overlayLogLabel, waitKey]);

  useEffect(() => {
    if (shouldRender && isVisible) {
      if (!visibleSinceRef.current) {
        visibleSinceRef.current = Date.now();
        stallThresholdEmittedRef.current = false;
      }
    } else {
      visibleSinceRef.current = null;
      stallThresholdEmittedRef.current = false;
    }
  }, [isVisible, shouldRender]);

  // Track last good playhead position when not stalled
  useEffect(() => {
    if (!stalled && Number.isFinite(currentTime) && currentTime > 0) {
      lastPlayheadRef.current = currentTime;
    }
  }, [stalled, currentTime]);

  // Stall threshold detection - emit event when stall exceeds 3 seconds (Issue #4 fix)
  useEffect(() => {
    if (!stalled || !visibleSinceRef.current || stallThresholdEmittedRef.current) {
      return;
    }
    const overlayDuration = Date.now() - visibleSinceRef.current;
    if (overlayDuration > 3000) {
      stallThresholdEmittedRef.current = true;
      const payload = {
        duration: overlayDuration,
        playheadPosition: currentTime,
        videoFps: videoFps ?? null,
        lastGoodPosition: lastPlayheadRef.current,
        status,
        waitKey: waitKey || null
      };
      // Prefer sessionInstance for remote transport; fall back to playbackLog
      if (sessionInstance && typeof sessionInstance.logEvent === 'function') {
        sessionInstance.logEvent('playback.stall_threshold_exceeded', payload);
      } else {
        playbackLog('playback.stall_threshold_exceeded', payload, {
          level: 'warn',
          context: overlayLogContext
        });
      }
    }
  }, [stalled, currentTime, videoFps, status, waitKey, sessionInstance, overlayLogContext]);

  const emitManualReset = useCallback((reasonOrPayload, extra = {}) => {
    const basePayload = typeof reasonOrPayload === 'string'
      ? { reason: reasonOrPayload }
      : (reasonOrPayload && typeof reasonOrPayload === 'object' ? reasonOrPayload : {});
    const finalPayload = {
      source: 'loading-overlay',
      requestedAt: Date.now(),
      seconds,
      stalled,
      waitingToPlay,
      ...basePayload,
      ...extra
    };
    if (!onRequestHardReset) {
      playbackLog('overlay.hard-reset-missing-handler', finalPayload, {
        level: 'error',
        context: overlayLogContext
      });
      return;
    }
    try {
      onRequestHardReset(finalPayload);
    } catch (error) {
      playbackLog('overlay.hard-reset-handler-error', {
        ...finalPayload,
        error: error?.message || String(error)
      }, {
        level: 'error',
        context: overlayLogContext
      });
    }
  }, [onRequestHardReset, overlayLogContext, seconds, stalled, waitingToPlay]);

  const normalizedMediaDetails = useMemo(() => {
    if (mediaDetailsProp && typeof mediaDetailsProp === 'object') {
      return {
        hasElement: Boolean(mediaDetailsProp.hasElement),
        currentTime: mediaDetailsProp.currentTime ?? null,
        readyState: mediaDetailsProp.readyState ?? null,
        networkState: mediaDetailsProp.networkState ?? null,
        paused: mediaDetailsProp.paused ?? null
      };
    }
    return {
      hasElement: false,
      currentTime: null,
      readyState: null,
      networkState: null,
      paused: null
    };
  }, [mediaDetailsProp]);

  // Debug-only detailed diagnostics (buffer, dropped frames)
  const debugEnabled = showDebugDiagnostics ||
    (typeof window !== 'undefined' && window.PLAYER_DEBUG_OVERLAY);

  const [detailedDiagnostics, setDetailedDiagnostics] = useState(EMPTY_MEDIA_DIAGNOSTICS);

  useEffect(() => {
    // Clear any existing diagnostic timer first to prevent duplicates
    if (diagnosticIntervalRef.current) {
      clearInterval(diagnosticIntervalRef.current);
      diagnosticIntervalRef.current = null;
    }

    if (!debugEnabled || typeof getMediaEl !== 'function' || !isVisible) {
      return () => {};
    }

    const readDiagnostics = () => {
      try {
        const el = getMediaEl();
        if (el) {
          setDetailedDiagnostics(buildMediaDiagnostics(el));
        }
      } catch (_) {
        // ignore diagnostic errors
      }
    };

    readDiagnostics();
    const timerId = `diag-${componentIdRef.current}-${Date.now()}`;
    playbackLog('timer.lifecycle', {
      timerId,
      action: 'started',
      componentName: 'PlayerOverlayLoading',
      timerType: 'diagnostic'
    }, { level: 'debug', context: overlayLogContext });

    diagnosticIntervalRef.current = setInterval(readDiagnostics, 1000);

    return () => {
      if (diagnosticIntervalRef.current) {
        playbackLog('timer.lifecycle', {
          timerId,
          action: 'stopped',
          componentName: 'PlayerOverlayLoading',
          timerType: 'diagnostic'
        }, { level: 'debug', context: overlayLogContext });
        clearInterval(diagnosticIntervalRef.current);
        diagnosticIntervalRef.current = null;
      }
    };
  }, [debugEnabled, getMediaEl, isVisible, overlayLogContext]);

  // Determine position display using freshness-based priority (Fix 3: position display audit)
  // If actively seeking, prefer intent; otherwise use freshness to pick the most recent value
  const STALE_THRESHOLD_MS = 5000; // Consider intent stale after 5 seconds
  const isSeekInProgress = status === 'seeking';
  const positionDisplay = useMemo(() => {
    if (isSeekInProgress) {
      // During active seek, always prefer intent position
      return intentPositionDisplay || playerPositionDisplay || null;
    }
    // Use freshness-based selection when not actively seeking
    const now = Date.now();
    const intentAge = intentPositionUpdatedAt ? now - intentPositionUpdatedAt : Infinity;
    const playerAge = playerPositionUpdatedAt ? now - playerPositionUpdatedAt : Infinity;
    // Prefer intent only if it's fresher AND not stale
    const preferIntent = intentPositionDisplay
      && intentAge < playerAge
      && intentAge < STALE_THRESHOLD_MS;
    if (preferIntent) {
      return intentPositionDisplay;
    }
    return playerPositionDisplay || intentPositionDisplay || null;
  }, [isSeekInProgress, intentPositionDisplay, playerPositionDisplay, intentPositionUpdatedAt, playerPositionUpdatedAt]);
  const hasValidPosition = positionDisplay && positionDisplay !== '0:00';
  const isStartupPhase = status === 'startup';
  const statusLabel = (() => {
    if (isStartupPhase) return 'Starting…';
    if (status === 'seeking') return 'Seeking…';
    if (stalled) return 'Recovering…';
    if (waitingToPlay) return 'Loading…';
    if (status === 'pending') return 'Loading…';
    if (status === 'recovering') return 'Recovering…';
    return status;
  })();

  const handleSpinnerInteraction = useCallback((event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.nativeEvent?.stopImmediatePropagation?.();
    emitManualReset('overlay-spinner-manual', { eventType: event?.type });
  }, [emitManualReset]);

  const spinnerInteractionProps = {
    onClick: handleSpinnerInteraction,
    onTouchStart: handleSpinnerInteraction,
    onDoubleClick: handleSpinnerInteraction,
    onMouseDown: handleSpinnerInteraction,
    onPointerDown: handleSpinnerInteraction
  };

  const countdownLabel = Number.isFinite(countdownSeconds)
    ? `${Math.max(0, Math.floor(countdownSeconds))}s`
    : 'n/a';
  const timerSummary = `countdown:${countdownLabel}`;
  const seekSummary = `seek:${intentPositionDisplay || 'n/a'}`;
  const mediaSummary = normalizedMediaDetails.hasElement
    ? `el:t=${normalizedMediaDetails.currentTime ?? 'n/a'} r=${normalizedMediaDetails.readyState ?? 'n/a'} n=${normalizedMediaDetails.networkState ?? 'n/a'} p=${normalizedMediaDetails.paused ?? 'n/a'}`
    : 'el:none';
  const startupSummary = (isStartupPhase || startupWatchdogState?.active)
    ? `startup:${startupWatchdogState?.state || 'armed'} attempts=${startupWatchdogState?.attempts ?? 0} timeout=${startupWatchdogState?.timeoutMs ?? 'n/a'}`
    : 'startup:idle';

  const logLabel = overlayLogLabel || waitKey || '';
  const logOverlaySummary = useCallback(() => {
    const now = Date.now();
    const timestampLabel = new Date(now).toISOString();
    const visibleDurationMs = visibleSinceRef.current ? now - visibleSinceRef.current : null;
    const revealLabel = Number.isFinite(overlayRevealDelayMs) ? `${overlayRevealDelayMs}ms` : 'n/a';
    // Build structured payload for session logging
    const payload = {
      timestamp: timestampLabel,
      visibleDurationMs,
      revealDelayMs: overlayRevealDelayMs,
      status: statusLabel,
      countdownSeconds: countdownSeconds ?? null,
      intentPosition: intentPositionDisplay || null,
      mediaDetails: normalizedMediaDetails,
      startupState: (isStartupPhase || startupWatchdogState?.active)
        ? {
          state: startupWatchdogState?.state || 'armed',
          attempts: startupWatchdogState?.attempts ?? 0,
          timeoutMs: startupWatchdogState?.timeoutMs ?? null
        }
        : null,
      stalled,
      waitingToPlay,
      waitKey: waitKey || null,
      overlayLogLabel: overlayLogLabel || null
    };
    // Issue #4 fix: Use sessionInstance.logEvent() for critical telemetry (no sampling)
    // This ensures overlay events reach remote transport for production debugging
    if (sessionInstance && typeof sessionInstance.logEvent === 'function') {
      sessionInstance.logEvent('overlay-summary', payload);
    } else {
      // Fallback to playbackLog with info level (elevated from debug) for non-session contexts
      const summary = `ts:${timestampLabel} vis:${visibleDurationMs != null ? `${visibleDurationMs}ms` : 'n/a'}/${revealLabel} | status:${statusLabel} | ${timerSummary} | ${seekSummary} | ${mediaSummary} | ${startupSummary}`;
      playbackLog('overlay-summary', logLabel ? `[${logLabel}] ${summary}` : summary, {
        level: 'info',
        context: overlayLogContext
      });
    }
  }, [overlayRevealDelayMs, timerSummary, seekSummary, mediaSummary, startupSummary, logLabel, overlayLogContext, sessionInstance, statusLabel, countdownSeconds, intentPositionDisplay, normalizedMediaDetails, isStartupPhase, startupWatchdogState, stalled, waitingToPlay, waitKey, overlayLogLabel]);

  // Use a ref to store the latest logOverlaySummary function to avoid timer recreation
  const logOverlaySummaryRef = useRef(logOverlaySummary);
  useEffect(() => {
    logOverlaySummaryRef.current = logOverlaySummary;
  }, [logOverlaySummary]);

  useEffect(() => {
    // Clear any existing timer first to prevent duplicates
    if (logIntervalRef.current) {
      clearInterval(logIntervalRef.current);
      logIntervalRef.current = null;
    }

    if (!overlayLoggingActive) {
      return () => {};
    }

    const timerId = `log-${componentIdRef.current}-${Date.now()}`;
    playbackLog('timer.lifecycle', {
      timerId,
      action: 'started',
      componentName: 'PlayerOverlayLoading',
      timerType: 'logging'
    }, { level: 'debug', context: overlayLogContext });

    // Use ref-based callback to avoid recreating interval when callback changes
    const tick = () => logOverlaySummaryRef.current();
    tick(); // Call immediately
    logIntervalRef.current = setInterval(tick, 1000);

    return () => {
      if (logIntervalRef.current) {
        playbackLog('timer.lifecycle', {
          timerId,
          action: 'stopped',
          componentName: 'PlayerOverlayLoading',
          timerType: 'logging'
        }, { level: 'debug', context: overlayLogContext });
        clearInterval(logIntervalRef.current);
        logIntervalRef.current = null;
      }
    };
  }, [overlayLoggingActive, overlayLogContext]);

  if (!overlayDisplayActive) {
    return null;
  }

  // Use different transition delay for showing vs hiding
  // When appearing, add 300ms delay to avoid flashing during brief buffering
  // When disappearing, no delay for instant feedback
  const transitionStyle = isVisible
    ? 'opacity 0.3s ease-in-out 0.3s' // 0.3s delay before showing
    : 'opacity 0.2s ease-in-out 0s';  // No delay when hiding

  return (
    <div
      className={`loading-overlay ${showPauseIcon ? 'paused' : 'loading'}`}
      data-no-fullscreen="true"
      style={{
        opacity: isVisible ? 1 : 0,
        transition: transitionStyle
      }}
      onDoubleClick={togglePauseOverlay}
    >
      <div className="loading-overlay__inner">
        <div className="loading-timing">
          <div
            className="loading-spinner"
            data-no-fullscreen="true"
            {...spinnerInteractionProps}
          >
            <img
              src={showPauseIcon ? pause : spinner}
              alt=""
              draggable={false}
              data-no-fullscreen="true"
            />
            <div className="loading-metrics">
              <div className="loading-position">
                {hasValidPosition ? positionDisplay : ''}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

PlayerOverlayLoading.propTypes = {
  shouldRender: PropTypes.bool,
  isVisible: PropTypes.bool,
  pauseOverlayActive: PropTypes.bool,
  seconds: PropTypes.number,
  stalled: PropTypes.bool,
  waitingToPlay: PropTypes.bool,
  startupWatchdogState: PropTypes.shape({
    active: PropTypes.bool,
    state: PropTypes.string,
    reason: PropTypes.string,
    attempts: PropTypes.number,
    timeoutMs: PropTypes.number,
    timestamp: PropTypes.number
  }),
  togglePauseOverlay: PropTypes.func,
  status: PropTypes.string,
  playerPositionDisplay: PropTypes.string,
  intentPositionDisplay: PropTypes.string,
  playerPositionUpdatedAt: PropTypes.number,
  intentPositionUpdatedAt: PropTypes.number,
  countdownSeconds: PropTypes.number,
  onRequestHardReset: PropTypes.func,
  overlayLoggingActive: PropTypes.bool,
  overlayLogLabel: PropTypes.string,
  waitKey: PropTypes.any,
  overlayRevealDelayMs: PropTypes.number,
  mediaDetails: PropTypes.shape({
    hasElement: PropTypes.bool,
    currentTime: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    readyState: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    networkState: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    paused: PropTypes.bool
  }),
  suppressForBlackout: PropTypes.bool,
  showPauseIcon: PropTypes.bool,
  showDebugDiagnostics: PropTypes.bool,
  getMediaEl: PropTypes.func,
  sessionInstance: PropTypes.shape({
    logEvent: PropTypes.func
  }),
  currentTime: PropTypes.number,
  videoFps: PropTypes.number
};

export default PlayerOverlayLoading;
