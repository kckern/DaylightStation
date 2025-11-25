import React, { useCallback, useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import spinner from '../../../assets/icons/spinner.svg';
import pause from '../../../assets/icons/pause.svg';

/**
 * Pure presentation component for media loading / pause overlay.
 * All timing and state decisions are handled upstream by useMediaResilience.
 */
export function LoadingOverlay({
  shouldRender,
  isVisible,
  pauseOverlayActive = false,
  seconds = 0,
  stalled = false,
  waitingToPlay = false,
  startupWatchdogState = null,
  togglePauseOverlay,
  countUpDisplay,
  countUpSeconds = null,
  playerPositionDisplay,
  intentPositionDisplay,
  overlayTimerActive = false,
  hardResetDeadlineMs = 0,
  onRequestHardReset,
  getMediaEl
}) {
  if (!shouldRender) {
    return null;
  }

  const [localTimerSeconds, setLocalTimerSeconds] = useState(0);
  const localTimerRef = useRef(null);
  const hardResetTriggeredRef = useRef(false);
  const [mediaElementDetails, setMediaElementDetails] = useState({
    hasElement: false,
    currentTime: null,
    readyState: null,
    networkState: null,
    paused: null
  });

  const clearLocalTimer = useCallback(() => {
    if (localTimerRef.current) {
      clearInterval(localTimerRef.current);
      localTimerRef.current = null;
    }
    setLocalTimerSeconds(0);
  }, []);

  useEffect(() => () => {
    clearLocalTimer();
  }, [clearLocalTimer]);

  const isInitialPlayback = seconds === 0 && !stalled;
  const shouldShowPauseIcon = pauseOverlayActive && !isInitialPlayback && !waitingToPlay && !stalled;
  const imgSrc = shouldShowPauseIcon ? pause : spinner;
  const overlayStateClass = shouldShowPauseIcon ? 'paused' : 'loading';
  const fallbackTimerActive = isVisible && !shouldShowPauseIcon;
  const timerActive = overlayTimerActive || fallbackTimerActive;

  const emitHardReset = useCallback((reasonOrPayload, extra = {}) => {
    const basePayload = typeof reasonOrPayload === 'string'
      ? { reason: reasonOrPayload }
      : (reasonOrPayload && typeof reasonOrPayload === 'object' ? reasonOrPayload : {});
    const finalPayload = {
      source: 'loading-overlay',
      requestedAt: Date.now(),
      status: waitingToPlay ? 'startup' : (stalled ? 'stalling' : 'unknown'),
      ...basePayload,
      ...extra
    };
    if (!onRequestHardReset) {
      console.warn('[LoadingOverlay] Hard reset requested but no handler configured', finalPayload);
      return;
    }
    try {
      onRequestHardReset(finalPayload);
    } catch (error) {
      console.error('[LoadingOverlay] hard reset handler failed', error, finalPayload);
    }
  }, [onRequestHardReset, waitingToPlay, stalled]);

  useEffect(() => {
    if (!timerActive) {
      clearLocalTimer();
      return;
    }
    if (localTimerRef.current) {
      return;
    }
    localTimerRef.current = setInterval(() => {
      setLocalTimerSeconds((prev) => prev + 1);
    }, 1000);
    return () => {
      clearLocalTimer();
    };
  }, [timerActive, clearLocalTimer]);

  useEffect(() => {
    if (!timerActive || !hardResetDeadlineMs || hardResetDeadlineMs <= 0) {
      return;
    }
    if (hardResetTriggeredRef.current) {
      return;
    }
    const elapsedMs = (Number.isFinite(countUpSeconds) ? countUpSeconds : localTimerSeconds) * 1000;
    if (elapsedMs >= hardResetDeadlineMs) {
      hardResetTriggeredRef.current = true;
      emitHardReset('overlay-failsafe-timer', { elapsedSeconds: elapsedMs / 1000 });
    }
  }, [timerActive, hardResetDeadlineMs, localTimerSeconds, countUpSeconds, emitHardReset]);

  useEffect(() => {
    if (typeof getMediaEl !== 'function' || !isVisible) {
      setMediaElementDetails((prev) => (prev.hasElement ? {
        hasElement: false,
        currentTime: null,
        readyState: null,
        networkState: null,
        paused: null
      } : prev));
      return () => {};
    }

    const readElementState = () => {
      try {
        const el = getMediaEl();
        if (!el) {
          setMediaElementDetails((prev) => (prev.hasElement ? {
            hasElement: false,
            currentTime: null,
            readyState: null,
            networkState: null,
            paused: null
          } : prev));
          return;
        }
        setMediaElementDetails({
          hasElement: true,
          currentTime: Number.isFinite(el.currentTime) ? Number(el.currentTime).toFixed(1) : null,
          readyState: typeof el.readyState === 'number' ? el.readyState : null,
          networkState: typeof el.networkState === 'number' ? el.networkState : null,
          paused: typeof el.paused === 'boolean' ? el.paused : null
        });
      } catch (error) {
        console.warn('[LoadingOverlay] failed to inspect media element', error);
      }
    };

    readElementState();
    const intervalId = setInterval(readElementState, 1000);
    return () => {
      clearInterval(intervalId);
    };
  }, [getMediaEl, isVisible]);

  const positionDisplay = intentPositionDisplay || playerPositionDisplay || null;

  const blockFullscreenToggle = useCallback((event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.nativeEvent?.stopImmediatePropagation?.();
  }, []);

  const handleSpinnerInteraction = useCallback((event) => {
    if (shouldShowPauseIcon) {
      return;
    }
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.nativeEvent?.stopImmediatePropagation?.();
    emitHardReset('overlay-spinner-manual', { eventType: event?.type });
  }, [emitHardReset, shouldShowPauseIcon]);

  const spinnerInteractionProps = shouldShowPauseIcon ? {} : {
    onClick: handleSpinnerInteraction,
    onTouchStart: handleSpinnerInteraction,
    onDoubleClick: handleSpinnerInteraction,
    onMouseDown: handleSpinnerInteraction,
    onPointerDown: handleSpinnerInteraction
  };

  const mainTimerLabel = Number.isFinite(countUpSeconds)
    ? `${countUpSeconds}s`
    : `${localTimerSeconds}s`;
  const timerSummary = `main:${mainTimerLabel} local:${localTimerSeconds}s`;
  const seekSummary = `seek:${intentPositionDisplay || 'n/a'}`;
  const mediaSummary = mediaElementDetails.hasElement
    ? `el:t=${mediaElementDetails.currentTime ?? 'n/a'} r=${mediaElementDetails.readyState ?? 'n/a'} n=${mediaElementDetails.networkState ?? 'n/a'} p=${mediaElementDetails.paused ?? 'n/a'}`
    : 'el:none';
  const isStartupPhase = waitingToPlay;
  const startupSummary = (isStartupPhase || startupWatchdogState?.active)
    ? `startup:${startupWatchdogState?.state || 'armed'} attempts=${startupWatchdogState?.attempts ?? 0} timeout=${startupWatchdogState?.timeoutMs ?? 'n/a'}`
    : 'startup:idle';

  const logIntervalRef = useRef(null);
  const logOverlaySummary = useCallback(() => {
    if (shouldShowPauseIcon || !isVisible) return;
    try {
      console.log('[LoadingOverlay]', `${timerSummary} | ${seekSummary} | ${mediaSummary} | ${startupSummary}`);
    } catch (_) {
      /* no-op */
    }
  }, [shouldShowPauseIcon, isVisible, timerSummary, seekSummary, mediaSummary]);

  useEffect(() => {
    if (shouldShowPauseIcon || !isVisible) {
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
  }, [shouldShowPauseIcon, isVisible, logOverlaySummary]);

  return (
    <div
      className={`loading-overlay ${overlayStateClass}`}
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
        <div className="loading-timing">
          <div
            className="loading-spinner"
            data-no-fullscreen="true"
            {...spinnerInteractionProps}
          >
            <img
              src={imgSrc}
              alt=""
              draggable={false}
              data-no-fullscreen="true"
            />
            {!shouldShowPauseIcon && (
              <div className="loading-metrics">
                <div className="loading-position">
                  {positionDisplay && positionDisplay !== '0:00' ? positionDisplay : ''}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="loading-debug-strip">
          {timerSummary} | {seekSummary} | {mediaSummary} | {startupSummary}
        </div>
      </div>
    </div>
  );
}

LoadingOverlay.propTypes = {
  shouldRender: PropTypes.bool,
  isVisible: PropTypes.bool,
  isPaused: PropTypes.bool,
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
  showPauseOverlay: PropTypes.bool,
  showDebug: PropTypes.bool,
  initialStart: PropTypes.number,
  message: PropTypes.string,
  debugContext: PropTypes.object,
  getMediaEl: PropTypes.func,
  plexId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  togglePauseOverlay: PropTypes.func,
  explicitShow: PropTypes.bool,
  countUpSeconds: PropTypes.number,
  countUpDisplay: PropTypes.string,
  playerPositionDisplay: PropTypes.string,
  intentPositionDisplay: PropTypes.string,
  overlayTimerActive: PropTypes.bool,
  hardResetDeadlineMs: PropTypes.number,
  onRequestHardReset: PropTypes.func,
  getMediaEl: PropTypes.func
};
