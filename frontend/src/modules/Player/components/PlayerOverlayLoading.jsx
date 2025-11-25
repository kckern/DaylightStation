import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import spinner from '../../../assets/icons/spinner.svg';
import { playbackLog } from '../lib/playbackLogger.js';

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
  startupPending = false,
  startupWatchdogState = null,
  status = 'pending',
  togglePauseOverlay,
  playerPositionDisplay,
  intentPositionDisplay,
  countdownSeconds = null,
  onRequestHardReset,
  overlayLoggingActive = true,
  overlayLogLabel = null,
  waitKey,
  overlayRevealDelayMs = 0,
  mediaDetails: mediaDetailsProp = null
}) {
  const overlayDisplayActive = shouldRender && isVisible && !pauseOverlayActive;

  const logIntervalRef = useRef(null);
  const visibleSinceRef = useRef(null);
  const overlayVisibilityRef = useRef({
    overlayDisplayActive,
    shouldRender,
    isVisible,
    pauseOverlayActive
  });

  useEffect(() => {
    if (shouldRender && isVisible) {
      if (!visibleSinceRef.current) {
        visibleSinceRef.current = Date.now();
      }
    } else {
      visibleSinceRef.current = null;
    }
  }, [isVisible, shouldRender]);

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
      startupPending,
      ...basePayload,
      ...extra
    };
    if (!onRequestHardReset) {
      console.warn('[PlayerOverlayLoading] Hard reset requested but no handler configured', finalPayload);
      return;
    }
    try {
      onRequestHardReset(finalPayload);
    } catch (error) {
      console.error('[PlayerOverlayLoading] hard reset handler failed', error, finalPayload);
    }
  }, [onRequestHardReset, seconds, stalled, waitingToPlay, startupPending]);

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

  const positionDisplay = intentPositionDisplay || playerPositionDisplay || null;
  const hasValidPosition = positionDisplay && positionDisplay !== '0:00';
  const statusLabel = (() => {
    if (startupPending) return 'Starting…';
    if (status === 'seeking') return 'Seeking…';
    if (stalled) return 'Recovering…';
    if (waitingToPlay) return 'Loading…';
    if (status === 'pending') return 'Loading…';
    if (status === 'recovering') return 'Recovering…';
    return status;
  })();

  const blockFullscreenToggle = useCallback((event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.nativeEvent?.stopImmediatePropagation?.();
  }, []);

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
  const startupSummary = startupPending
    ? `startup:armed attempts=${startupWatchdogState?.attempts ?? 0} timeout=${startupWatchdogState?.timeoutMs ?? 'n/a'}`
    : 'startup:idle';

  const logLabel = overlayLogLabel || waitKey || '';
  const overlayLogContext = useMemo(() => ({
    waitKey: waitKey || overlayLogLabel || 'loading-overlay',
    source: 'PlayerOverlayLoading'
  }), [overlayLogLabel, waitKey]);
  const logOverlaySummary = useCallback(() => {
    const now = Date.now();
    const timestampLabel = new Date(now).toISOString();
    const visibleDurationMs = visibleSinceRef.current ? now - visibleSinceRef.current : null;
    const revealLabel = Number.isFinite(overlayRevealDelayMs) ? `${overlayRevealDelayMs}ms` : 'n/a';
    const visibilitySummary = `ts:${timestampLabel} vis:${visibleDurationMs != null ? `${visibleDurationMs}ms` : 'n/a'}/${revealLabel}`;
    const summary = `${visibilitySummary} | ${timerSummary} | ${seekSummary} | ${mediaSummary} | ${startupSummary}`;
    playbackLog('overlay-summary', logLabel ? `[${logLabel}] ${summary}` : summary, {
      level: 'debug',
      sampleRate: 0.25,
      context: overlayLogContext
    });
  }, [overlayRevealDelayMs, timerSummary, seekSummary, mediaSummary, logLabel, overlayLogContext]);

  useEffect(() => {
    if (!overlayLoggingActive) {
      if (logIntervalRef.current) {
        clearInterval(logIntervalRef.current);
        logIntervalRef.current = null;
      }
      return () => {};
    }
    logOverlaySummary();
    logIntervalRef.current = setInterval(logOverlaySummary, 1000);
    return () => {
      if (logIntervalRef.current) {
        clearInterval(logIntervalRef.current);
        logIntervalRef.current = null;
      }
    };
  }, [logOverlaySummary, overlayLoggingActive]);

  useEffect(() => {
    const prev = overlayVisibilityRef.current;
    if (
      prev.overlayDisplayActive === overlayDisplayActive
      && prev.shouldRender === shouldRender
      && prev.isVisible === isVisible
      && prev.pauseOverlayActive === pauseOverlayActive
    ) {
      return;
    }
    overlayVisibilityRef.current = {
      overlayDisplayActive,
      shouldRender,
      isVisible,
      pauseOverlayActive
    };
    const reason = overlayDisplayActive
      ? 'visible'
      : (!shouldRender
        ? 'should-render=false'
        : (!isVisible
          ? 'is-visible=false'
          : 'pause-overlay-active'));
    playbackLog('overlay-visibility', {
      label: overlayLogLabel || waitKey || 'loading-overlay',
      waitKey,
      visible: overlayDisplayActive,
      reason,
      shouldRender,
      isVisible,
      pauseOverlayActive,
      overlayRevealDelayMs
    }, {
      level: 'debug',
      context: overlayLogContext
    });
  }, [overlayDisplayActive, shouldRender, isVisible, pauseOverlayActive, overlayLogLabel, waitKey, overlayRevealDelayMs, overlayLogContext]);

  if (!overlayDisplayActive) {
    return null;
  }

  return (
    <div
      className="loading-overlay loading"
      data-no-fullscreen="true"
      style={{
        opacity: isVisible ? 1 : 0,
        transition: 'opacity 0.3s ease-in-out'
      }}
      onDoubleClick={togglePauseOverlay}
      onPointerDownCapture={blockFullscreenToggle}
      onMouseDownCapture={blockFullscreenToggle}
    >
      <div className="loading-overlay__inner">
        <div className="loading-debug-strip">
          {statusLabel} | {timerSummary} | {seekSummary} | {mediaSummary}
        </div>
        <div className="loading-timing">
          <div
            className="loading-spinner"
            data-no-fullscreen="true"
            {...spinnerInteractionProps}
          >
            <img
              src={spinner}
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
  startupPending: PropTypes.bool,
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
  })
};

export default PlayerOverlayLoading;
