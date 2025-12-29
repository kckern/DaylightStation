import { useEffect, useMemo, useRef, useState } from 'react';
import { formatTime } from '../../lib/helpers.js';
import { useOverlayPresentation } from '../useOverlayPresentation.js';
import { RESILIENCE_STATUS } from '../useResilienceState.js';

function createOverlayProps({
  status,
  isOverlayVisible,
  shouldRenderOverlay,
  waitingToPlay,
  isPaused,
  userIntent,
  systemHealth,
  pauseOverlayActive,
  seconds,
  computedStalled,
  showPauseOverlay,
  showDebug,
  initialStart,
  message,
  resolvedPlexId,
  debugContext,
  lastProgressTs,
  togglePauseOverlay,
  explicitShow,
  isSeeking,
  overlayLoggingActive,
  overlayLogLabel,
  overlayRevealDelayMs,
  waitKey,
  requestOverlayHardReset,
  overlayCountdownSeconds,
  playerPositionDisplay,
  intentPositionDisplay,
  playerPositionUpdatedAt,
  intentPositionUpdatedAt,
  playbackHealth,
  mediaDetails,
  startupWatchdogState
}) {
  return {
    status,
    isVisible: isOverlayVisible && shouldRenderOverlay,
    shouldRender: shouldRenderOverlay,
    waitingToPlay,
    isPaused,
    userIntent,
    systemHealth,
    pauseOverlayActive,
    seconds,
    stalled: computedStalled,
    showPauseOverlay,
    showDebug,
    initialStart,
    message,
    plexId: resolvedPlexId,
    debugContext,
    lastProgressTs,
    togglePauseOverlay,
    explicitShow,
    isSeeking,
    overlayLoggingActive,
    overlayLogLabel,
    overlayRevealDelayMs,
    waitKey,
    onRequestHardReset: requestOverlayHardReset,
    countdownSeconds: overlayCountdownSeconds,
    playerPositionDisplay,
    intentPositionDisplay,
    playerPositionUpdatedAt,
    intentPositionUpdatedAt,
    playbackHealth,
    mediaDetails,
    startupWatchdogState
  };
}

export function useResiliencePresentation({
  overlayConfig,
  debugRevealDelayMs,
  waitKey,
  logWaitKey,
  status,
  explicitShow,
  isSeeking,
  getMediaEl,
  meta,
  hardRecoverAfterStalledForMs,
  loadingGraceMs,
  triggerRecovery,
  stallOverlayActive,
  waitingToPlay,
  playbackHasProgress,
  pauseIntent,
  userIntent,
  explicitPauseActive,
  resolvedIsPaused,
  computedStalled,
  playbackHealth,
  loadingIntentActive,
  seconds,
  initialStart,
  message,
  resolvedPlexId,
  debugContext,
  lastProgressTs,
  requestOverlayHardReset,
  systemHealth,
  startupWatchdogState,
  intentMsForDisplay
}) {
  const [showDebug, setShowDebug] = useState(false);

  // Track timestamps for position freshness (Fix 3: position display audit)
  const playerPositionUpdatedAtRef = useRef(Date.now());
  const intentPositionUpdatedAtRef = useRef(null);
  const lastSecondsRef = useRef(seconds);
  const lastIntentMsRef = useRef(intentMsForDisplay);

  // Update player position timestamp when seconds changes
  useEffect(() => {
    if (seconds !== lastSecondsRef.current) {
      lastSecondsRef.current = seconds;
      playerPositionUpdatedAtRef.current = Date.now();
    }
  }, [seconds]);

  // Update intent position timestamp when intentMsForDisplay changes
  useEffect(() => {
    if (intentMsForDisplay !== lastIntentMsRef.current) {
      lastIntentMsRef.current = intentMsForDisplay;
      intentPositionUpdatedAtRef.current = Number.isFinite(intentMsForDisplay) ? Date.now() : null;
    }
  }, [intentMsForDisplay]);

  useEffect(() => {
    const waiting = status === RESILIENCE_STATUS.pending || status === RESILIENCE_STATUS.recovering;
    if (userIntent === 'paused') {
      setShowDebug(false);
      return () => {};
    }
    if (!(explicitShow || waiting)) {
      setShowDebug(false);
      return () => {};
    }
    const timeout = setTimeout(() => setShowDebug(true), debugRevealDelayMs ?? 3000);
    return () => clearTimeout(timeout);
  }, [explicitShow, userIntent, status, debugRevealDelayMs]);

  const overlayInputs = useOverlayPresentation({
    overlayConfig,
    waitKey,
    logWaitKey,
    status,
    explicitShow,
    isSeeking,
    getMediaEl,
    meta,
    hardRecoverAfterStalledForMs,
    loadingGraceDeadlineMs: loadingGraceMs,
    triggerRecovery,
    stallOverlayActive,
    waitingToPlay,
    playbackHasProgress,
    pauseIntentIsUser: pauseIntent === 'user',
    userIntentIsPaused: userIntent === 'paused',
    explicitPauseActive,
    isPaused: resolvedIsPaused,
    computedStalled,
    playbackHealth,
    loadingIntentActive,
    seconds
  });

  const overlayProps = useMemo(() => {
    const intentSecondsForDisplay = Number.isFinite(intentMsForDisplay)
      ? Math.max(0, intentMsForDisplay / 1000)
      : null;
    const playerPositionDisplay = formatTime(Math.max(0, seconds));
    const intentPositionDisplay = Number.isFinite(intentSecondsForDisplay)
      ? formatTime(Math.max(0, intentSecondsForDisplay))
      : null;

    return createOverlayProps({
      status,
      isOverlayVisible: overlayInputs.isOverlayVisible,
      shouldRenderOverlay: overlayInputs.shouldRenderOverlay,
      waitingToPlay,
      isPaused: resolvedIsPaused,
      userIntent,
      systemHealth,
      pauseOverlayActive: overlayInputs.pauseOverlayActive,
      seconds,
      computedStalled,
      showPauseOverlay: overlayInputs.showPauseOverlay,
      showDebug,
      initialStart,
      message,
      resolvedPlexId,
      debugContext,
      lastProgressTs,
      togglePauseOverlay: overlayInputs.togglePauseOverlay,
      explicitShow,
      isSeeking,
      overlayLoggingActive: overlayInputs.overlayLoggingActive,
      overlayLogLabel: overlayInputs.overlayLogLabel,
      overlayRevealDelayMs: overlayInputs.overlayRevealDelayMs,
      waitKey,
      requestOverlayHardReset,
      overlayCountdownSeconds: overlayInputs.overlayCountdownSeconds,
      playerPositionDisplay,
      intentPositionDisplay,
      playerPositionUpdatedAt: playerPositionUpdatedAtRef.current,
      intentPositionUpdatedAt: intentPositionUpdatedAtRef.current,
      playbackHealth,
      mediaDetails: overlayInputs.mediaDetails,
      startupWatchdogState
    });
  }, [
    status,
    overlayInputs.isOverlayVisible,
    overlayInputs.shouldRenderOverlay,
    waitingToPlay,
    resolvedIsPaused,
    userIntent,
    systemHealth,
    overlayInputs.pauseOverlayActive,
    seconds,
    computedStalled,
    overlayInputs.showPauseOverlay,
    showDebug,
    initialStart,
    message,
    resolvedPlexId,
    debugContext,
    lastProgressTs,
    overlayInputs.togglePauseOverlay,
    explicitShow,
    isSeeking,
    overlayInputs.overlayLoggingActive,
    overlayInputs.overlayLogLabel,
    overlayInputs.overlayRevealDelayMs,
    waitKey,
    requestOverlayHardReset,
    overlayInputs.overlayCountdownSeconds,
    playbackHealth,
    overlayInputs.mediaDetails,
    startupWatchdogState,
    seconds,
    intentMsForDisplay
  ]);

  return {
    overlayProps,
    presentationState: {
      isOverlayVisible: overlayInputs.isOverlayVisible,
      showPauseOverlay: overlayInputs.showPauseOverlay,
      showDebug,
      shouldRenderOverlay: overlayInputs.shouldRenderOverlay,
      pauseOverlayActive: overlayInputs.pauseOverlayActive
    },
    controls: {
      togglePauseOverlay: overlayInputs.togglePauseOverlay,
      setOverlayPausePreference: overlayInputs.setPauseOverlayVisible,
      resetOverlayState: overlayInputs.resetOverlayState
    }
  };
}

export default useResiliencePresentation;
