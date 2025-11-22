import React, { useCallback, useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import spinner from '../../../assets/icons/spinner.svg';

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
  if (!shouldRender || !isVisible || pauseOverlayActive) {
    return null;
  }

  const [localTimerSeconds, setLocalTimerSeconds] = useState(0);
  const localTimerRef = useRef(null);
  const hardResetTriggeredRef = useRef(false);
  const logIntervalRef = useRef(null);
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

  const fallbackTimerActive = isVisible;
  const timerActive = overlayTimerActive || fallbackTimerActive;

  const emitHardReset = useCallback((reasonOrPayload, extra = {}) => {
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
      console.warn('[PlayerOverlayLoading] Hard reset requested but no handler configured', finalPayload);
      return;
    }
    try {
      onRequestHardReset(finalPayload);
    } catch (error) {
      console.error('[PlayerOverlayLoading] hard reset handler failed', error, finalPayload);
    }
  }, [onRequestHardReset, seconds, stalled, waitingToPlay]);

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
        console.warn('[PlayerOverlayLoading] failed to inspect media element', error);
      }
    };

    readElementState();
    const intervalId = setInterval(readElementState, 1000);
    return () => {
      clearInterval(intervalId);
    };
  }, [getMediaEl, isVisible]);

  const derivedTimerSeconds = Number.isFinite(countUpSeconds) ? countUpSeconds : localTimerSeconds;
  const fallbackDisplay = derivedTimerSeconds > 0 ? String(derivedTimerSeconds).padStart(2, '0') : null;
  const elapsedDisplay = typeof countUpDisplay === 'string' ? countUpDisplay : fallbackDisplay;
  const positionDisplay = intentPositionDisplay || playerPositionDisplay || null;
  const showTimer = isVisible && (Number.isFinite(derivedTimerSeconds) ? derivedTimerSeconds >= 0 : false);

  const blockFullscreenToggle = useCallback((event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.nativeEvent?.stopImmediatePropagation?.();
  }, []);

  const handleSpinnerInteraction = useCallback((event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.nativeEvent?.stopImmediatePropagation?.();
    emitHardReset('overlay-spinner-manual', { eventType: event?.type });
  }, [emitHardReset]);

  const spinnerInteractionProps = {
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

  const logOverlaySummary = useCallback(() => {
    try {
      console.log('[PlayerOverlayLoading]', `${timerSummary} | ${seekSummary} | ${mediaSummary}`);
    } catch (_) {
      /* no-op */
    }
  }, [timerSummary, seekSummary, mediaSummary]);

  useEffect(() => {
    logOverlaySummary();
    logIntervalRef.current = setInterval(logOverlaySummary, 1000);
    return () => {
      if (logIntervalRef.current) {
        clearInterval(logIntervalRef.current);
        logIntervalRef.current = null;
      }
    };
  }, [logOverlaySummary]);

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
                {positionDisplay !== '0:00' ? positionDisplay : ''}
              </div>
              <div className="loading-timer">
                {showTimer ? elapsedDisplay : ''}
              </div>
            </div>
          </div>
        </div>
        <div className="loading-debug-strip">
          {timerSummary} | {seekSummary} | {mediaSummary}
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
  togglePauseOverlay: PropTypes.func,
  countUpDisplay: PropTypes.string,
  countUpSeconds: PropTypes.number,
  playerPositionDisplay: PropTypes.string,
  intentPositionDisplay: PropTypes.string,
  overlayTimerActive: PropTypes.bool,
  hardResetDeadlineMs: PropTypes.number,
  onRequestHardReset: PropTypes.func,
  getMediaEl: PropTypes.func
};

export default PlayerOverlayLoading;
