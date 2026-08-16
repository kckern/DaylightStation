import React, { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import PropTypes from 'prop-types';
import spinner from '../../../assets/icons/spinner.svg';
import pause from '../../../assets/icons/pause.svg';
import { playbackLog } from '../lib/playbackLogger.js';
import { subscribeSkipCard, isSkipCardPaused } from '../../../lib/Player/skipCardState.js';

/**
 * Loading / resilience overlay shown while media is buffering, stalling, or waiting to start.
 */
export function PlayerOverlayLoading({
  shouldRender,
  isVisible,
  pauseOverlayActive = false,
  effectiveMetaIsNull = false,  // phantom Player guard — see 2026-05-22 fitness audit Bug 3
  seconds = 0,
  stalled = false,
  waitingToPlay = false,
  status = 'pending',
  togglePauseOverlay,
  playerPositionDisplay,
  intentPositionDisplay,
  playerPositionUpdatedAt = null,
  intentPositionUpdatedAt = null,
  onRequestHardReset,
  overlayLoggingActive = true,
  overlayLogLabel = null,
  waitKey,
  // The same key, hashed, so these lines still join to everything logged before
  // 2026-08-16 — when `waitKey` here WAS the hash and nothing carried the raw
  // key. Kept as a separate field; the two encodings never share a name again.
  waitKeyHash = null,
  mediaDetails: mediaDetailsProp = null,
  suppressForBlackout = false,
  showPauseIcon = false,
  isExhausted = false,
  onRetryFromExhausted
}) {
  // Removed on 2026-08-16, all for the same reason: no caller anywhere in the
  // repo supplied them, so every value they ever reported came from the default
  // written on this line — `startupWatchdogState` (rendered as
  // `startup:armed attempts=0 timeout=n/a` in every startup log ever written),
  // `countdownSeconds`, `overlayRevealDelayMs` (the `/0ms` half of the vis
  // field), `currentTime` and `videoFps` (which made every
  // playback.stall_threshold_exceeded report a null playhead), and
  // `sessionInstance`, whose presence diverted the whole structured payload
  // below into a branch that never ran. A field nobody supplies does not report
  // a small truth; it reports a confident falsehood, and these ones cost real
  // hours during the remount-storm investigation.

  // Suppress the buffering spinner during a deliberate content-filter skip-card
  // pause (we pause to buffer behind the card; that's not a stall). Subscribed
  // FIRST so this hook is always called regardless of the early returns below.
  const skipCardPaused = useSyncExternalStore(subscribeSkipCard, isSkipCardPaused, isSkipCardPaused);

  // In blackout mode, keep screen completely dark (TV appears off)
  if (suppressForBlackout) {
    return null;
  }
  // Render whenever the user needs recovery feedback. During a true stall, show
  // the spinner even with the pause overlay active — the pause overlay sits ON TOP
  // (higher z-index in CSS) and tells the user "you paused", while the spinner
  // underneath signals "still trying to recover." Without this, stalled-pause
  // shows a black screen with no affordance — see the 2026-05-22 audit.
  const overlayDisplayActive = shouldRender && isVisible && (!pauseOverlayActive || stalled);

  const logIntervalRef = useRef(null);
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
    waitKey: waitKey || null,
    waitKeyHash: waitKeyHash || null
  }), [overlayLogLabel, waitKey, waitKeyHash]);

  // Gate on what is actually PAINTED (overlayDisplayActive), not on the
  // inputs to that decision. Keyed on shouldRender && isVisible, this clock
  // kept running through a pause — where the pause overlay suppresses this
  // one — and reported the loading spinner as continuously visible for
  // nearly three minutes of a paused video on 2026-08-12. A duration that
  // counts time the element spent returning null is not a duration.
  useEffect(() => {
    if (overlayDisplayActive) {
      if (!visibleSinceRef.current) {
        visibleSinceRef.current = Date.now();
        stallThresholdEmittedRef.current = false;
      }
    } else {
      visibleSinceRef.current = null;
      stallThresholdEmittedRef.current = false;
    }
  }, [overlayDisplayActive]);

  // Track last good playhead position when not stalled. Reads `seconds` — the
  // playhead the caller actually passes — rather than the `currentTime` prop
  // that nothing ever set.
  useEffect(() => {
    if (!stalled && Number.isFinite(seconds) && seconds > 0) {
      lastPlayheadRef.current = seconds;
    }
  }, [stalled, seconds]);

  // Stall threshold detection - emit event when stall exceeds 3 seconds (Issue #4 fix)
  useEffect(() => {
    if (!stalled || !visibleSinceRef.current || stallThresholdEmittedRef.current) {
      return;
    }
    const overlayDuration = Date.now() - visibleSinceRef.current;
    if (overlayDuration > 3000) {
      stallThresholdEmittedRef.current = true;
      playbackLog('playback.stall_threshold_exceeded', {
        duration: overlayDuration,
        playheadPosition: Number.isFinite(seconds) ? seconds : null,
        lastGoodPosition: lastPlayheadRef.current,
        status,
        waitKey: waitKey || null,
        waitKeyHash: waitKeyHash || null
      }, {
        level: 'warn',
        context: overlayLogContext
      });
    }
  }, [stalled, seconds, status, waitKey, waitKeyHash, overlayLogContext]);

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
        // Which object the reading was taken from. `r=n/a` had three causes and
        // one output; the <dash-video> wrapper's readyState is not a number at
        // all, and nothing recorded whether the wrapper or the inner <video>
        // had been read.
        elTag: mediaDetailsProp.elTag ?? null,
        elSource: mediaDetailsProp.elSource ?? null,
        currentTime: mediaDetailsProp.currentTime ?? null,
        duration: mediaDetailsProp.duration ?? null,
        readyState: mediaDetailsProp.readyState ?? null,
        networkState: mediaDetailsProp.networkState ?? null,
        paused: mediaDetailsProp.paused ?? null
      };
    }
    return {
      hasElement: false,
      elTag: null,
      elSource: null,
      currentTime: null,
      duration: null,
      readyState: null,
      networkState: null,
      paused: null
    };
  }, [mediaDetailsProp]);

  // Audit 2026-05-23 (Layer C): when the element is paused at duration, the
  // spec-compliant `mediaEl.seeking` flag stays true after a seek-to-duration
  // whose target fragment came back zero-byte. The loading overlay then holds
  // on a static end-of-content frame for as long as it takes the user to
  // intervene. Suppress the overlay entirely once we are within 0.5s of
  // duration and paused — `useEndOfContentWatchdog` will drive the queue
  // advance shortly after.
  const isPausedAtDuration = useMemo(() => {
    const ct = normalizedMediaDetails.currentTime;
    const dur = normalizedMediaDetails.duration;
    if (!Number.isFinite(ct) || !Number.isFinite(dur) || dur <= 0) return false;
    if (normalizedMediaDetails.paused !== true) return false;
    return ct >= (dur - 0.5);
  }, [normalizedMediaDetails]);

  // Removed 2026-08-16 (Task 4.9): a 1Hz `buildMediaDiagnostics` poll gated on
  // `debugEnabled && typeof getMediaEl === 'function'`. No caller in the repo
  // ever passed `getMediaEl` or `showDebugDiagnostics`, so the block could not
  // run even with the debug flag set — and reviving it would have produced
  // nothing, because its output went into a `detailedDiagnostics` state that no
  // JSX rendered and no log carried. The on-screen strip it once fed
  // (`.loading-debug-strip`, still in Player.scss) is gone from the markup.
  //
  // Its readings are not lost: `usePlaybackHealth` already computes
  // `bufferRunwayMs` and `frameInfo.dropped/total`, and the overlay-summary line
  // below carries readyState / networkState / paused / currentTime. Deleted
  // rather than wired, because wiring it would only have added a timer and a
  // pair of `timer.lifecycle` lines in exchange for no observable output.

  // Determine position display using freshness-based priority (Fix 3: position display audit)
  // While the wait is seek-driven (seeking, or the stall/loading that follows a
  // seek), the playhead is pinned at — or recovery-reset to — the wrong spot, so
  // the intent (the destination the user asked for) always wins, no matter how
  // long recovery takes. Freshness only arbitrates outside those states (e.g.
  // the pause overlay), where the current playhead is the truthful display.
  const STALE_THRESHOLD_MS = 5000; // Consider intent stale after 5 seconds
  const isSeekInProgress = status === 'seeking';
  const positionDisplay = useMemo(() => {
    if (isSeekInProgress || stalled || waitingToPlay) {
      return intentPositionDisplay || playerPositionDisplay || null;
    }
    // Use freshness-based selection when not waiting on a seek
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
  }, [isSeekInProgress, stalled, waitingToPlay, intentPositionDisplay, playerPositionDisplay, intentPositionUpdatedAt, playerPositionUpdatedAt]);
  const hasValidPosition = positionDisplay && positionDisplay !== '0:00';
  const isStartupPhase = status === 'startup';
  const statusLabel = (() => {
    if (isExhausted) return 'Tap to Retry';
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
    if (isExhausted && typeof onRetryFromExhausted === 'function') {
      onRetryFromExhausted();
      return;
    }
    emitManualReset('overlay-spinner-manual', { eventType: event?.type });
  }, [emitManualReset, isExhausted, onRetryFromExhausted]);

  const spinnerInteractionProps = {
    onClick: handleSpinnerInteraction,
    onTouchStart: handleSpinnerInteraction,
    onDoubleClick: handleSpinnerInteraction,
    onMouseDown: handleSpinnerInteraction,
    onPointerDown: handleSpinnerInteraction
  };

  const seekSummary = `seek:${intentPositionDisplay || 'n/a'}`;
  const mediaSummary = normalizedMediaDetails.hasElement
    ? `el:${normalizedMediaDetails.elTag || 'unknown'}/${normalizedMediaDetails.elSource || 'unknown'}`
      + ` t=${normalizedMediaDetails.currentTime ?? 'n/a'}`
      + ` r=${normalizedMediaDetails.readyState ?? 'n/a'}`
      + ` n=${normalizedMediaDetails.networkState ?? 'n/a'}`
      + ` p=${normalizedMediaDetails.paused ?? 'n/a'}`
    : 'el:none';

  const logLabel = overlayLogLabel || waitKey || '';
  const logOverlaySummary = useCallback(() => {
    // Phantom Player guard: a Player mounted with no effectiveMeta sits in
    // STATUS.startup forever (useMediaResilience cannot arm without metadata).
    // Without this guard, the 1s log interval below leaks ~600 events per workout.
    // See 2026-05-22 fitness audit Bug 3.
    if (effectiveMetaIsNull) return;
    // Suppress noisy logging whenever nothing is painted and playback is in a
    // steady state. Gated on `isVisible && status === 'playing'` this only
    // covered healthy playback, so a paused video shipped one event per
    // second forever — 135 of them during a single pause on 2026-08-12,
    // drowning the signal in the very log used to diagnose it. Abnormal
    // states (stalled, recovering, buffering, error) still report.
    const steadyState = status === 'playing' || status === 'paused';
    if (!overlayDisplayActive && steadyState) return;

    const now = Date.now();
    const timestampLabel = new Date(now).toISOString();
    const visibleDurationMs = visibleSinceRef.current ? now - visibleSinceRef.current : null;
    const line = `ts:${timestampLabel} vis:${visibleDurationMs != null ? `${visibleDurationMs}ms` : 'n/a'} | status:${statusLabel} | ${seekSummary} | ${mediaSummary}`;
    // The structured payload used to be built here and thrown away: it was
    // handed to `sessionInstance.logEvent`, and no caller in modules/Player has
    // ever passed a sessionInstance (every one in the repo is Fitness's). The
    // string below it is what shipped. Both now go out together through
    // playbackLog — the fields for anything reading the log, `summary` for
    // anyone reading it with their eyes.
    playbackLog('overlay-summary', {
      timestamp: timestampLabel,
      visibleDurationMs,
      status: statusLabel,
      intentPosition: intentPositionDisplay || null,
      mediaDetails: normalizedMediaDetails,
      stalled,
      waitingToPlay,
      waitKey: waitKey || null,
      waitKeyHash: waitKeyHash || null,
      overlayLogLabel: overlayLogLabel || null,
      summary: logLabel ? `[${logLabel}] ${line}` : line
    }, {
      level: 'info',
      context: overlayLogContext
    });
  }, [effectiveMetaIsNull, overlayDisplayActive, isVisible, status, seekSummary, mediaSummary, logLabel, overlayLogContext, statusLabel, intentPositionDisplay, normalizedMediaDetails, stalled, waitingToPlay, waitKey, waitKeyHash, overlayLogLabel]);

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

    if (effectiveMetaIsNull) return undefined;  // phantom Player — see Bug 3 guard above

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
  }, [effectiveMetaIsNull, overlayLoggingActive, overlayLogContext]);

  if (!overlayDisplayActive) {
    return null;
  }

  // Deliberate skip-card pause — hide the spinner so the card reads as intentional.
  if (skipCardPaused) {
    return null;
  }

  // Use different transition delay for showing vs hiding
  // When appearing, add 300ms delay to avoid flashing during brief buffering
  // When disappearing, no delay for instant feedback
  const transitionStyle = isVisible
    ? 'opacity 0.3s ease-in-out 0.3s' // 0.3s delay before showing
    : 'opacity 0.2s ease-in-out 0s';  // No delay when hiding

  if (isPausedAtDuration) {
    return null;
  }

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
  effectiveMetaIsNull: PropTypes.bool,
  seconds: PropTypes.number,
  stalled: PropTypes.bool,
  waitingToPlay: PropTypes.bool,
  togglePauseOverlay: PropTypes.func,
  status: PropTypes.string,
  playerPositionDisplay: PropTypes.string,
  intentPositionDisplay: PropTypes.string,
  playerPositionUpdatedAt: PropTypes.number,
  intentPositionUpdatedAt: PropTypes.number,
  onRequestHardReset: PropTypes.func,
  overlayLoggingActive: PropTypes.bool,
  overlayLogLabel: PropTypes.string,
  waitKey: PropTypes.any,
  waitKeyHash: PropTypes.string,
  mediaDetails: PropTypes.shape({
    hasElement: PropTypes.bool,
    elTag: PropTypes.string,
    elSource: PropTypes.string,
    currentTime: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    duration: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    readyState: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    networkState: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    paused: PropTypes.bool
  }),
  suppressForBlackout: PropTypes.bool,
  showPauseIcon: PropTypes.bool,
  isExhausted: PropTypes.bool,
  onRetryFromExhausted: PropTypes.func
};

export default PlayerOverlayLoading;
