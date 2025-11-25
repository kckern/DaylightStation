import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { playbackLog } from '../lib/playbackLogger.js';
import { RESILIENCE_STATUS } from './useResilienceState.js';

export const formatSecondsForLog = (value, precision = 3) => (Number.isFinite(value)
  ? Number(value.toFixed(precision))
  : null);

const DEFAULT_MEDIA_DETAILS = Object.freeze({
  hasElement: false,
  currentTime: null,
  readyState: null,
  networkState: null,
  paused: null
});

const deriveOverlayDrivers = ({
  waitingToPlay,
  stallOverlayActive,
  explicitShow,
  pauseOverlayActive,
  holdOverlayActive
}) => ({
  waiting: Boolean(waitingToPlay),
  stalled: Boolean(stallOverlayActive),
  explicit: Boolean(explicitShow),
  pause: Boolean(pauseOverlayActive),
  hold: Boolean(holdOverlayActive)
});

const summarizeActiveDrivers = (drivers) => Object.entries(drivers)
  .filter(([, active]) => Boolean(active))
  .map(([key]) => key);

const areStringArraysEqual = (a, b) => {
  if (a === b) return true;
  const left = Array.isArray(a) ? a : [];
  const right = Array.isArray(b) ? b : [];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
};

const hasOverlayDecisionChanged = (previous, next) => {
  if (!previous) return true;
  return (
    previous.waitKey !== next.waitKey
    || previous.status !== next.status
    || previous.shouldRender !== next.shouldRender
    || previous.isVisible !== next.isVisible
    || previous.revealDelayMs !== next.revealDelayMs
    || previous.overlayHoldActive !== next.overlayHoldActive
    || previous.holdOverlayActive !== next.holdOverlayActive
    || previous.playbackHasProgress !== next.playbackHasProgress
    || previous.waitingToPlay !== next.waitingToPlay
    || previous.stalled !== next.stalled
    || previous.pauseOverlayActive !== next.pauseOverlayActive
    || previous.explicitShow !== next.explicitShow
    || previous.overlayTimerActive !== next.overlayTimerActive
    || previous.overlayGraceReason !== next.overlayGraceReason
    || !areStringArraysEqual(previous.activeReasons, next.activeReasons)
  );
};

const hasOverlayVisibilityChanged = (previous, next) => {
  if (!previous) return true;
  return (
    previous.waitKey !== next.waitKey
    || previous.shouldRender !== next.shouldRender
    || previous.isVisible !== next.isVisible
    || previous.revealDelayMs !== next.revealDelayMs
    || previous.overlayHoldActive !== next.overlayHoldActive
    || previous.holdOverlayActive !== next.holdOverlayActive
    || previous.waitingToPlay !== next.waitingToPlay
    || previous.paused !== next.paused
    || previous.stalled !== next.stalled
    || previous.overlayGraceReason !== next.overlayGraceReason
    || !areStringArraysEqual(previous.reasons, next.reasons)
  );
};

const useOverlayTimer = (overlayActive, overlayDeadlineMs, triggerRecovery) => {
  const [elapsedMs, setElapsedMs] = useState(0);
  const rafRef = useRef(null);
  const intervalRef = useRef(null);
  const startTimeRef = useRef(0);
  const overlayAlertedRef = useRef(false);
  const triggerRecoveryRef = useRef(triggerRecovery);

  useEffect(() => {
    triggerRecoveryRef.current = triggerRecovery;
  }, [triggerRecovery]);

  const clearTicker = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!overlayActive) {
      setElapsedMs(0);
      overlayAlertedRef.current = false;
      clearTicker();
      return () => {};
    }

    startTimeRef.current = Date.now();
    setElapsedMs(0);

    const hasRAF = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function';
    if (hasRAF) {
      const tick = () => {
        setElapsedMs(Date.now() - startTimeRef.current);
        rafRef.current = window.requestAnimationFrame(tick);
      };
      rafRef.current = window.requestAnimationFrame(tick);
    } else {
      intervalRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startTimeRef.current);
      }, 500);
    }

    return () => {
      clearTicker();
    };
  }, [overlayActive, clearTicker]);

  useEffect(() => {
    if (!overlayActive || overlayAlertedRef.current) return;
    if (overlayDeadlineMs > 0 && elapsedMs >= overlayDeadlineMs) {
      overlayAlertedRef.current = true;
      triggerRecoveryRef.current?.('overlay-hard-recovery', { ignorePaused: true, force: true });
    }
  }, [elapsedMs, overlayActive, overlayDeadlineMs]);

  useEffect(() => () => {
    clearTicker();
  }, [clearTicker]);

  const effectiveDeadline = Math.max(overlayDeadlineMs, 0) || elapsedMs;
  const cappedMs = Math.min(elapsedMs, effectiveDeadline);
  return Math.max(0, Math.floor(cappedMs / 1000));
};

let pauseOverlayPreference = true;

export function useOverlayPresentation({
  overlayConfig,
  waitKey,
  logWaitKey,
  status,
  explicitShow,
  isSeeking,
  getMediaEl,
  meta,
  hardRecoverAfterStalledForMs,
  loadingGraceDeadlineMs,
  triggerRecovery,
  stallOverlayActive,
  waitingToPlay,
  playbackHasProgress,
  userIntentIsPaused,
  explicitPauseActive,
  isPaused,
  computedStalled,
  playbackHealth,
  loadingIntentActive,
  seconds
}) {
  const [isOverlayVisible, setOverlayVisible] = useState(() => !overlayConfig.revealDelayMs);
  const [showPauseOverlay, setShowPauseOverlay] = useState(pauseOverlayPreference);
  const [overlayHoldActive, setOverlayHoldActive] = useState(false);
  const [initialOverlayGraceActive, setInitialOverlayGraceActive] = useState(Boolean(overlayConfig.revealDelayMs));
  const [mediaDetails, setMediaDetails] = useState(DEFAULT_MEDIA_DETAILS);
  const overlayDecisionRef = useRef(null);
  const overlayVisibilityRef = useRef(null);
  const overlayHoldLogRef = useRef(false);

  const resetOverlayState = useCallback(() => {
    setShowPauseOverlay(pauseOverlayPreference);
    setOverlayVisible(!overlayConfig.revealDelayMs);
    setOverlayHoldActive(true);
    setInitialOverlayGraceActive(Boolean(overlayConfig.revealDelayMs));
  }, [overlayConfig.revealDelayMs]);

  useEffect(() => {
    resetOverlayState();
  }, [resetOverlayState, waitKey]);

  const playbackElementPlaying = Boolean(playbackHealth?.elementSignals?.playing);

  useEffect(() => {
    if (status === RESILIENCE_STATUS.recovering) {
      setOverlayHoldActive(true);
      return;
    }
    if (playbackHasProgress || playbackElementPlaying) {
      setOverlayHoldActive(false);
    }
  }, [status, playbackHasProgress, playbackElementPlaying]);

  const pauseToggleKeys = useMemo(() => {
    const keys = overlayConfig?.pauseToggleKeys;
    if (!Array.isArray(keys)) return [];
    return keys.filter((key) => typeof key === 'string' && key.length);
  }, [overlayConfig?.pauseToggleKeys]);

  const overlayRevealDelayMs = Number.isFinite(overlayConfig.revealDelayMs)
    ? Math.max(0, overlayConfig.revealDelayMs)
    : 0;

  const holdOverlayActive = overlayHoldActive && !playbackHasProgress;

  const overlayIntentActive = waitingToPlay
    || stallOverlayActive
    || explicitShow
    || holdOverlayActive;

  useEffect(() => {
    if (!initialOverlayGraceActive) return () => {};
    if (!overlayRevealDelayMs) {
      setInitialOverlayGraceActive(false);
      return () => {};
    }
    if (!overlayIntentActive) {
      setInitialOverlayGraceActive(false);
      return () => {};
    }
    const timer = setTimeout(() => {
      setInitialOverlayGraceActive(false);
    }, overlayRevealDelayMs);
    return () => clearTimeout(timer);
  }, [initialOverlayGraceActive, overlayIntentActive, overlayRevealDelayMs]);

  const pauseOverlayEligible = overlayConfig.showPausedOverlay && showPauseOverlay;
  const pauseOverlayActive = pauseOverlayEligible
    && explicitPauseActive
    && userIntentIsPaused
    && isPaused
    && !waitingToPlay
    && !computedStalled;

  const overlayDrivers = useMemo(() => deriveOverlayDrivers({
    waitingToPlay,
    stallOverlayActive,
    explicitShow,
    pauseOverlayActive,
    holdOverlayActive
  }), [waitingToPlay, stallOverlayActive, explicitShow, pauseOverlayActive, holdOverlayActive]);
  const overlayActiveReasons = useMemo(() => summarizeActiveDrivers(overlayDrivers), [overlayDrivers]);

  useEffect(() => {
    if (overlayHoldLogRef.current === overlayHoldActive) return;
    overlayHoldLogRef.current = overlayHoldActive;
    playbackLog('overlay-hold', {
      waitKey: logWaitKey,
      active: overlayHoldActive,
      holdOverlayActive,
      playbackHasProgress,
      status,
      reasons: overlayActiveReasons.join(',') || 'none'
    }, { level: 'debug' });
  }, [overlayHoldActive, holdOverlayActive, playbackHasProgress, logWaitKey, status, overlayActiveReasons]);

  const shouldRenderOverlay = overlayDrivers.waiting
    || overlayDrivers.stalled
    || overlayDrivers.explicit
    || overlayDrivers.pause
    || overlayDrivers.hold;
  const overlayActive = shouldRenderOverlay && isOverlayVisible;
  const overlayTimerActive = overlayActive && !pauseOverlayActive;
  const overlayGraceReason = (() => {
    if (!overlayRevealDelayMs) return null;
    if (initialOverlayGraceActive) return 'initial-load';
    if (isSeeking) return 'seeking';
    return null;
  })();
  const overlayGraceActive = Boolean(overlayGraceReason);

  useEffect(() => {
    const decisionSnapshot = {
      waitKey: logWaitKey,
      status,
      shouldRender: shouldRenderOverlay,
      isVisible: isOverlayVisible,
      revealDelayMs: overlayRevealDelayMs,
      overlayHoldActive,
      holdOverlayActive,
      playbackHasProgress,
      waitingToPlay,
      stalled: stallOverlayActive,
      pauseOverlayActive,
      explicitShow,
      overlayTimerActive,
      overlayGraceReason,
      activeReasons: overlayActiveReasons,
      seconds: formatSecondsForLog(seconds)
    };
    if (!hasOverlayDecisionChanged(overlayDecisionRef.current, decisionSnapshot)) {
      return;
    }
    overlayDecisionRef.current = decisionSnapshot;
    playbackLog('overlay-decision', decisionSnapshot, { level: 'debug' });
  }, [
    overlayActiveReasons,
    overlayHoldActive,
    holdOverlayActive,
    overlayTimerActive,
    overlayRevealDelayMs,
    isOverlayVisible,
    shouldRenderOverlay,
    logWaitKey,
    status,
    playbackHasProgress,
    waitingToPlay,
    stallOverlayActive,
    pauseOverlayActive,
    explicitShow,
    seconds,
    overlayGraceReason
  ]);

  useEffect(() => {
    const visibilitySnapshot = {
      waitKey: logWaitKey,
      shouldRender: shouldRenderOverlay,
      isVisible: isOverlayVisible,
      revealDelayMs: overlayRevealDelayMs,
      overlayHoldActive,
      holdOverlayActive,
      reasons: overlayActiveReasons,
      waitingToPlay,
      paused: isPaused,
      stalled: stallOverlayActive,
      overlayGraceReason
    };
    if (!hasOverlayVisibilityChanged(overlayVisibilityRef.current, visibilitySnapshot)) {
      return;
    }
    overlayVisibilityRef.current = visibilitySnapshot;
    playbackLog('overlay-visibility-gate', visibilitySnapshot, { level: 'debug' });
  }, [
    isOverlayVisible,
    shouldRenderOverlay,
    overlayRevealDelayMs,
    overlayHoldActive,
    holdOverlayActive,
    overlayActiveReasons,
    waitingToPlay,
    isPaused,
    stallOverlayActive,
    logWaitKey,
    overlayGraceReason
  ]);

  useEffect(() => {
    if (!shouldRenderOverlay) {
      setOverlayVisible(false);
      return () => {};
    }
    if (!overlayGraceActive) {
      setOverlayVisible(true);
      return () => {};
    }
    setOverlayVisible(false);
    const timeout = setTimeout(() => setOverlayVisible(true), overlayRevealDelayMs);
    return () => clearTimeout(timeout);
  }, [shouldRenderOverlay, overlayGraceActive, overlayRevealDelayMs]);

  useEffect(() => {
    if (typeof getMediaEl !== 'function' || !overlayActive) {
      setMediaDetails(DEFAULT_MEDIA_DETAILS);
      return () => {};
    }

    let cancelled = false;
    const readDetails = () => {
      if (cancelled) return;
      let nextDetails = DEFAULT_MEDIA_DETAILS;
      try {
        const el = getMediaEl();
        if (el) {
          nextDetails = {
            hasElement: true,
            currentTime: Number.isFinite(el.currentTime) ? Number(el.currentTime).toFixed(1) : null,
            readyState: typeof el.readyState === 'number' ? el.readyState : null,
            networkState: typeof el.networkState === 'number' ? el.networkState : null,
            paused: typeof el.paused === 'boolean' ? el.paused : null
          };
        }
      } catch (_) {
        nextDetails = DEFAULT_MEDIA_DETAILS;
      }

      setMediaDetails((prev) => (
        prev.hasElement === nextDetails.hasElement
        && prev.currentTime === nextDetails.currentTime
        && prev.readyState === nextDetails.readyState
        && prev.networkState === nextDetails.networkState
        && prev.paused === nextDetails.paused
      ) ? prev : nextDetails);
    };

    readDetails();
    const intervalId = setInterval(readDetails, 1000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [getMediaEl, overlayActive, waitKey]);

  const resolvedStallDeadlineMs = hardRecoverAfterStalledForMs > 0 ? hardRecoverAfterStalledForMs : 6000;
  const resolvedLoadingDeadlineMs = Number.isFinite(loadingGraceDeadlineMs) && loadingGraceDeadlineMs > 0
    ? loadingGraceDeadlineMs
    : resolvedStallDeadlineMs;
  const overlayDeadlineMs = stallOverlayActive
    ? resolvedStallDeadlineMs
    : ((waitingToPlay || loadingIntentActive) ? resolvedLoadingDeadlineMs : resolvedStallDeadlineMs);
  const overlayElapsedSeconds = useOverlayTimer(overlayTimerActive, overlayDeadlineMs, triggerRecovery);
  const overlayCountdownSeconds = overlayTimerActive && overlayDeadlineMs > 0
    ? Math.max(0, Math.ceil((overlayDeadlineMs - overlayElapsedSeconds * 1000) / 1000))
    : null;
  const playbackHealthy = Boolean(
    playbackHealth?.elementSignals?.playing && !playbackHealth?.isWaiting && !playbackHealth?.isStalledEvent
  );
  const overlayLoggingActive = overlayTimerActive && (!playbackHealthy || explicitShow);
  const overlayLogLabel = logWaitKey || waitKey || meta?.title || meta?.media_url || 'player-overlay';

  const togglePauseOverlay = useCallback(() => {
    setShowPauseOverlay((prev) => {
      const next = !prev;
      pauseOverlayPreference = next;
      return next;
    });
  }, []);

  const setPauseOverlayVisible = useCallback((value) => {
    const next = value ?? true;
    pauseOverlayPreference = next;
    setShowPauseOverlay(next);
  }, []);

  useEffect(() => {
    if (!pauseToggleKeys.length) return () => {};
    if (!(userIntentIsPaused || isPaused)) return () => {};
    const handleKeyDown = (event) => {
      if (!pauseToggleKeys.includes(event.key)) return;
      event.preventDefault();
      togglePauseOverlay();
    };
    window.addEventListener('keydown', handleKeyDown, { passive: false });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { passive: false });
    };
  }, [pauseToggleKeys, userIntentIsPaused, isPaused, togglePauseOverlay]);

  return {
    isOverlayVisible,
    showPauseOverlay,
    pauseOverlayActive,
    shouldRenderOverlay,
    overlayRevealDelayMs,
    overlayCountdownSeconds,
    overlayLoggingActive,
    overlayLogLabel,
    mediaDetails,
    togglePauseOverlay,
    setPauseOverlayVisible,
    resetOverlayState
  };
}
