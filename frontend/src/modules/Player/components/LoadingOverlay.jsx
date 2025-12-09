import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import PropTypes from 'prop-types';
import spinner from '../../../assets/icons/spinner.svg';
import pause from '../../../assets/icons/pause.svg';
import { playbackLog } from '../lib/playbackLogger.js';

const EMPTY_MEDIA_DIAGNOSTICS = Object.freeze({
  hasElement: false,
  currentTime: null,
  readyState: null,
  networkState: null,
  paused: null,
  playbackRate: null,
  buffered: [],
  bufferAheadSeconds: null,
  bufferBehindSeconds: null,
  nextBufferStartSeconds: null,
  bufferGapSeconds: null,
  droppedFrames: null,
  totalFrames: null
});

const serializeRanges = (ranges) => {
  if (!ranges || typeof ranges.length !== 'number') {
    return [];
  }
  const out = [];
  for (let index = 0; index < ranges.length; index += 1) {
    try {
      const start = ranges.start(index);
      const end = ranges.end(index);
      out.push({
        start: Number.isFinite(start) ? Number(start.toFixed(3)) : start,
        end: Number.isFinite(end) ? Number(end.toFixed(3)) : end
      });
    } catch (_) {
      // ignore bad range
    }
  }
  return out;
};

const computeBufferDiagnostics = (mediaEl) => {
  if (!mediaEl) {
    return {
      buffered: [],
      bufferAheadSeconds: null,
      bufferBehindSeconds: null,
      nextBufferStartSeconds: null,
      bufferGapSeconds: null
    };
  }
  const buffered = serializeRanges(mediaEl.buffered);
  const currentTime = Number.isFinite(mediaEl.currentTime) ? mediaEl.currentTime : null;
  if (!buffered.length || !Number.isFinite(currentTime)) {
    return {
      buffered,
      bufferAheadSeconds: null,
      bufferBehindSeconds: null,
      nextBufferStartSeconds: null,
      bufferGapSeconds: null
    };
  }
  let bufferAheadSeconds = null;
  let bufferBehindSeconds = null;
  let nextBufferStartSeconds = null;
  for (let index = 0; index < buffered.length; index += 1) {
    const range = buffered[index];
    if (currentTime >= range.start && currentTime <= range.end) {
      bufferAheadSeconds = Number((range.end - currentTime).toFixed(3));
      bufferBehindSeconds = Number((currentTime - range.start).toFixed(3));
      if (index + 1 < buffered.length) {
        nextBufferStartSeconds = buffered[index + 1].start;
      }
      break;
    }
    if (currentTime < range.start) {
      nextBufferStartSeconds = range.start;
      break;
    }
  }
  const bufferGapSeconds = Number.isFinite(nextBufferStartSeconds)
    ? Number((nextBufferStartSeconds - currentTime).toFixed(3))
    : null;
  return {
    buffered,
    bufferAheadSeconds,
    bufferBehindSeconds,
    nextBufferStartSeconds,
    bufferGapSeconds
  };
};

const readPlaybackQuality = (mediaEl) => {
  if (!mediaEl) {
    return {
      droppedFrames: null,
      totalFrames: null
    };
  }
  try {
    if (typeof mediaEl.getVideoPlaybackQuality === 'function') {
      const sample = mediaEl.getVideoPlaybackQuality();
      return {
        droppedFrames: Number.isFinite(sample?.droppedVideoFrames)
          ? sample.droppedVideoFrames
          : (Number.isFinite(sample?.droppedFrames) ? sample.droppedFrames : null),
        totalFrames: Number.isFinite(sample?.totalVideoFrames)
          ? sample.totalVideoFrames
          : (Number.isFinite(sample?.totalFrames) ? sample.totalFrames : null)
      };
    }
  } catch (_) {
    // ignore playback quality errors
  }
  const dropped = Number.isFinite(mediaEl?.webkitDroppedFrameCount)
    ? mediaEl.webkitDroppedFrameCount
    : null;
  const decoded = Number.isFinite(mediaEl?.webkitDecodedFrameCount)
    ? mediaEl.webkitDecodedFrameCount
    : null;
  return {
    droppedFrames: dropped,
    totalFrames: decoded
  };
};

const buildMediaDiagnostics = (mediaEl) => {
  if (!mediaEl) {
    return EMPTY_MEDIA_DIAGNOSTICS;
  }
  const buffer = computeBufferDiagnostics(mediaEl);
  const quality = readPlaybackQuality(mediaEl);
  return {
    hasElement: true,
    currentTime: Number.isFinite(mediaEl.currentTime) ? Number(mediaEl.currentTime.toFixed(1)) : null,
    readyState: typeof mediaEl.readyState === 'number' ? mediaEl.readyState : null,
    networkState: typeof mediaEl.networkState === 'number' ? mediaEl.networkState : null,
    paused: typeof mediaEl.paused === 'boolean' ? mediaEl.paused : null,
    playbackRate: Number.isFinite(mediaEl.playbackRate) ? Number(mediaEl.playbackRate.toFixed(3)) : null,
    buffered: buffer.buffered,
    bufferAheadSeconds: buffer.bufferAheadSeconds,
    bufferBehindSeconds: buffer.bufferBehindSeconds,
    nextBufferStartSeconds: buffer.nextBufferStartSeconds,
    bufferGapSeconds: buffer.bufferGapSeconds,
    droppedFrames: quality.droppedFrames,
    totalFrames: quality.totalFrames
  };
};

const bufferedRangesEqual = (left = [], right = []) => {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!a || !b) return false;
    if (a.start !== b.start || a.end !== b.end) {
      return false;
    }
  }
  return true;
};

const mediaDiagnosticsEqual = (prev, next) => {
  if (prev === next) return true;
  if (!prev || !next) return false;
  const keys = Object.keys(EMPTY_MEDIA_DIAGNOSTICS);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === 'buffered') {
      if (!bufferedRangesEqual(prev[key], next[key])) {
        return false;
      }
      continue;
    }
    if (prev[key] !== next[key]) {
      return false;
    }
  }
  return true;
};

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
  const [mediaElementDetails, setMediaElementDetails] = useState(EMPTY_MEDIA_DIAGNOSTICS);

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
  const overlayLogContext = useMemo(() => ({ source: 'LoadingOverlay' }), []);

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
    playbackLog('overlay.hard-reset-request', {
      ...finalPayload,
      overlayTimerActive: timerActive,
      hardResetDeadlineMs
    }, {
      level: stalled ? 'error' : 'warn',
      context: overlayLogContext
    });
    if (!onRequestHardReset) {
      playbackLog('overlay.hard-reset-error', {
        reason: 'missing-handler',
        payload: finalPayload
      }, {
        level: 'error',
        context: overlayLogContext
      });
      return;
    }
    try {
      onRequestHardReset(finalPayload);
    } catch (error) {
      playbackLog('overlay.hard-reset-error', {
        reason: 'handler-threw',
        error: error?.message || String(error),
        payload: finalPayload
      }, {
        level: 'error',
        context: overlayLogContext
      });
    }
  }, [hardResetDeadlineMs, onRequestHardReset, overlayLogContext, stalled, timerActive, waitingToPlay]);

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
      playbackLog('overlay.hard-reset-failsafe', {
        elapsedSeconds: Number((elapsedMs / 1000).toFixed(2)),
        hardResetDeadlineMs,
        stalled,
        waitingToPlay,
        timerActive
      }, {
        level: 'error',
        context: overlayLogContext
      });
      emitHardReset('overlay-failsafe-timer', { elapsedSeconds: elapsedMs / 1000 });
    }
  }, [countUpSeconds, emitHardReset, hardResetDeadlineMs, localTimerSeconds, overlayLogContext, stalled, timerActive, waitingToPlay]);

  useEffect(() => {
    if (typeof getMediaEl !== 'function' || !isVisible) {
      setMediaElementDetails((prev) => (prev.hasElement ? EMPTY_MEDIA_DIAGNOSTICS : prev));
      return () => {};
    }

    const readElementState = () => {
      try {
        const el = getMediaEl();
        if (!el) {
          setMediaElementDetails((prev) => (prev.hasElement ? EMPTY_MEDIA_DIAGNOSTICS : prev));
          return;
        }
        const diagnostics = buildMediaDiagnostics(el);
        setMediaElementDetails((prev) => (mediaDiagnosticsEqual(prev, diagnostics) ? prev : diagnostics));
      } catch (error) {
        playbackLog('overlay.media-inspect-error', {
          error: error?.message || String(error)
        }, {
          level: 'warn',
          context: overlayLogContext
        });
      }
    };

    readElementState();
    const intervalId = setInterval(readElementState, 1000);
    return () => {
      clearInterval(intervalId);
    };
  }, [getMediaEl, isVisible, overlayLogContext]);

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
    playbackLog('overlay.spinner-interaction', {
      eventType: event?.type || 'unknown',
      seconds,
      stalled,
      waitingToPlay,
      mediaDetails: mediaElementDetails
    }, {
      level: 'info',
      context: overlayLogContext
    });
    emitHardReset('overlay-spinner-manual', { eventType: event?.type });
  }, [emitHardReset, mediaElementDetails, overlayLogContext, seconds, shouldShowPauseIcon, stalled, waitingToPlay]);

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
  const clearOverlayLogInterval = useCallback(() => {
    if (logIntervalRef.current) {
      clearInterval(logIntervalRef.current);
      logIntervalRef.current = null;
    }
  }, []);

  const logOverlaySummary = useCallback(() => {
    if (shouldShowPauseIcon || !isVisible) {
      return;
    }
    playbackLog('overlay.loading-summary', {
      summary: `${timerSummary} | ${seekSummary} | ${mediaSummary} | ${startupSummary}`,
      seconds,
      stalled,
      waitingToPlay,
      timerSeconds: localTimerSeconds,
      countUpSeconds: Number.isFinite(countUpSeconds) ? countUpSeconds : null,
      hardResetDeadlineMs,
      overlayTimerActive,
      timerActive,
      overlayStateClass,
      mediaDetails: mediaElementDetails,
      startupWatchdogState,
      pauseOverlayActive,
      shouldShowPauseIcon
    }, {
      level: stalled ? 'warn' : 'info',
      context: overlayLogContext
    });
  }, [countUpSeconds, hardResetDeadlineMs, isVisible, localTimerSeconds, mediaElementDetails, overlayLogContext, overlayStateClass, overlayTimerActive, pauseOverlayActive, seekSummary, seconds, shouldShowPauseIcon, stalled, startupSummary, startupWatchdogState, timerActive, timerSummary, waitingToPlay]);

  useEffect(() => {
    if (shouldShowPauseIcon || !isVisible) {
      clearOverlayLogInterval();
      return () => {};
    }

    logOverlaySummary();
    logIntervalRef.current = setInterval(logOverlaySummary, 1000);

    return clearOverlayLogInterval;
  }, [clearOverlayLogInterval, isVisible, logOverlaySummary, shouldShowPauseIcon]);

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
