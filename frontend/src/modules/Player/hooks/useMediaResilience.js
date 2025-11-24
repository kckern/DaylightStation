import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatTime } from '../lib/helpers.js';
import { playbackLog } from '../lib/playbackLogger.js';
import { getLogWaitKey } from '../lib/waitKeyLabel.js';
import { usePlaybackHealth } from './usePlaybackHealth.js';
import { useResilienceConfig } from './useResilienceConfig.js';
import { useResilienceState, RESILIENCE_STATUS } from './useResilienceState.js';
import { useResilienceRecovery } from './useResilienceRecovery.js';

export { DEFAULT_MEDIA_RESILIENCE_CONFIG, MediaResilienceConfigContext, mergeMediaResilienceConfig } from './useResilienceConfig.js';
export { RESILIENCE_STATUS } from './useResilienceState.js';
export { USER_INTENT, SYSTEM_HEALTH };

const defaultReload = () => {
  try {
    if (typeof window !== 'undefined' && typeof window.location?.reload === 'function') {
      window.location.reload();
    }
  } catch (_) {
    // no-op
  }
};

const STATUS = {
  pending: RESILIENCE_STATUS.idle,
  playing: RESILIENCE_STATUS.playing,
  stalling: RESILIENCE_STATUS.stalling,
  recovering: RESILIENCE_STATUS.recovering
};

const USER_INTENT = Object.freeze({
  playing: 'playing',
  paused: 'paused',
  seeking: 'seeking'
});

const SYSTEM_HEALTH = Object.freeze({
  ok: 'ok',
  buffering: 'buffering',
  stalled: 'stalled'
});

const formatSecondsForLog = (value, precision = 3) => (Number.isFinite(value)
  ? Number(value.toFixed(precision))
  : null);

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

const DEFAULT_MEDIA_DETAILS = Object.freeze({
  hasElement: false,
  currentTime: null,
  readyState: null,
  networkState: null,
  paused: null
});

let pauseOverlayPreference = true;

const useLatest = (value) => {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
};

const useOverlayTimer = (overlayActive, stallDeadlineMs, triggerRecovery) => {
  const [elapsedMs, setElapsedMs] = useState(0);
  const rafRef = useRef(null);
  const intervalRef = useRef(null);
  const startTimeRef = useRef(0);
  const overlayAlertedRef = useRef(false);
  const triggerRecoveryRef = useLatest(triggerRecovery);


function useUserIntentControls({ isPaused, isSeeking }) {
  const computeInitialIntent = () => {
    if (isSeeking) return USER_INTENT.seeking;
    if (isPaused) return USER_INTENT.paused;
    return USER_INTENT.playing;
  };

  const [userIntent, setUserIntent] = useState(computeInitialIntent);
  const userIntentRef = useLatest(userIntent);
  const explicitPauseRef = useRef(false);
  const [explicitPauseActive, setExplicitPauseActive] = useState(false);

  const updateExplicitPauseState = useCallback((value) => {
    const next = Boolean(value);
    if (explicitPauseRef.current === next) return;
    explicitPauseRef.current = next;
    setExplicitPauseActive(next);
  }, []);

  return {
    userIntent,
    userIntentRef,
    explicitPauseActive,
    explicitPauseRef,
    updateExplicitPauseState
  };
}
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
    if (stallDeadlineMs > 0 && elapsedMs >= stallDeadlineMs) {
      overlayAlertedRef.current = true;
      triggerRecoveryRef.current?.('overlay-hard-recovery', { ignorePaused: true, force: true });
    }
  }, [elapsedMs, overlayActive, stallDeadlineMs, triggerRecoveryRef]);

  useEffect(() => () => {
    clearTicker();
  }, [clearTicker]);

  const effectiveDeadline = Math.max(stallDeadlineMs, 0) || elapsedMs;
  const cappedMs = Math.min(elapsedMs, effectiveDeadline);
  return Math.max(0, Math.floor(cappedMs / 1000));
};

export function useMediaResilience({
  getMediaEl,
  meta = {},
  seconds = 0,
  isPaused = false,
  isSeeking = false,
  initialStart = 0,
  waitKey,
  fetchVideoInfo,
  onStateChange,
  onReload = defaultReload,
  configOverrides,
  controllerRef,
  explicitShow = false,
  plexId,
  debugContext,
  message,
  stalled: stalledOverride,
  mediaTypeHint,
  playerFlavorHint,
  threadId = null
}) {
  const [runtimeOverrides, setRuntimeOverrides] = useState(null);
  const {
    overlayConfig,
    debugConfig,
    monitorSettings,
    recoveryConfig
  } = useResilienceConfig({ configOverrides, runtimeOverrides });

  const {
    epsilonSeconds,
    stallDetectionThresholdMs,
    hardRecoverAfterStalledForMs,
    mountTimeoutMs,
    mountPollIntervalMs,
    mountMaxAttempts
  } = monitorSettings;

  const [isOverlayVisible, setOverlayVisible] = useState(() => !overlayConfig.revealDelayMs);
  const [showDebug, setShowDebug] = useState(false);
  const [showPauseOverlay, setShowPauseOverlay] = useState(pauseOverlayPreference);
  const {
    userIntent,
    userIntentRef,
    explicitPauseActive,
    explicitPauseRef,
    updateExplicitPauseState
  } = useUserIntentControls({ isPaused, isSeeking });
  const {
    state: resilienceState,
    status,
    statusRef,
    actions: resilienceActions
  } = useResilienceState(STATUS.pending);
  const [lastFetchAt, setLastFetchAt] = useState(null);
  const [overlayHoldActive, setOverlayHoldActive] = useState(false);
  const [initialOverlayGraceActive, setInitialOverlayGraceActive] = useState(Boolean(overlayConfig.revealDelayMs));
  const [mediaDetails, setMediaDetails] = useState(DEFAULT_MEDIA_DETAILS);
  const overlayDecisionRef = useRef(null);
  const overlayVisibilityRef = useRef(null);
  const overlayHoldLogRef = useRef(false);
  const playbackHeartbeatRef = useRef(null);

  const fetchVideoInfoRef = useLatest(fetchVideoInfo);
  const onReloadRef = useLatest(onReload);
  const lastProgressTsRef = useRef(null);
  const lastProgressSecondsRef = useRef(null);
  const stallTimerRef = useRef(null);
  const reloadTimerRef = useRef(null);
  const hardRecoveryTimerRef = useRef(null);
  const lastReloadAtRef = useRef(0);
  const mediaIdentity = meta?.media_key || meta?.key || meta?.plex || meta?.id || meta?.guid || meta?.media_url || null;
  const mediaIdentityRef = useRef(mediaIdentity);
  const logWaitKey = useMemo(() => getLogWaitKey(waitKey), [waitKey]);
  const logContextRef = useLatest({
    waitKey: logWaitKey,
    mediaIdentity,
    metaTitle: meta?.title || meta?.name || meta?.grandparentTitle || null,
    threadId
  });
  const seekIntentMsRef = useRef(null);
  const lastSecondsRef = useRef(Number.isFinite(seconds) ? seconds : 0);
  const progressTokenRef = useRef(0);
  const mountWatchdogTimerRef = useRef(null);
  const mountWatchdogStartRef = useRef(null);
  const mountWatchdogReasonRef = useRef(null);
  const mountWatchdogAttemptsRef = useRef(0);
  const statusTransitionRef = useRef(status);


  const logResilienceEvent = useCallback((event, details = {}) => {
    const context = logContextRef.current || {};
    playbackLog('media-resilience', {
      event,
      ...context,
      ...details
    });
  }, [logContextRef]);

  const resolvedMediaType = useMemo(() => {
    if (mediaTypeHint) return mediaTypeHint;
    const type = String(meta?.media_type || '').toLowerCase();
    if (type.includes('video')) return 'video';
    if (type.includes('audio')) return 'audio';
    return 'unknown';
  }, [mediaTypeHint, meta?.media_type]);

  const resolvedPlayerFlavor = useMemo(() => {
    if (playerFlavorHint) return playerFlavorHint;
    if (resolvedMediaType === 'video') {
      return meta?.media_type === 'dash_video' ? 'shaka' : 'html5-video';
    }
    if (resolvedMediaType === 'audio') {
      return 'html5-audio';
    }
    return 'generic';
  }, [playerFlavorHint, resolvedMediaType, meta?.media_type]);

  const playbackHealth = usePlaybackHealth({
    seconds,
    getMediaEl,
    waitKey,
    mediaType: resolvedMediaType,
    playerFlavor: resolvedPlayerFlavor,
    epsilonSeconds
  });

  useEffect(() => {
    progressTokenRef.current = 0;
    lastProgressSecondsRef.current = null;
    lastProgressTsRef.current = null;
    statusTransitionRef.current = STATUS.pending;
    lastSecondsRef.current = 0;
    playbackLog('resilience-wait-key', {
      waitKey: logWaitKey,
      status: STATUS.pending,
      overlayHoldPrimed: true
    });
  }, [waitKey, logWaitKey]);

  useEffect(() => {
    if (isSeeking) {
      setUserIntent(USER_INTENT.seeking);
      return;
    }
    if (isPaused) {
      setUserIntent(USER_INTENT.paused);
      return;
    }
    setUserIntent(USER_INTENT.playing);
  }, [isPaused, isSeeking]);

  useEffect(() => {
    if (Number.isFinite(seconds)) {
      lastSecondsRef.current = seconds;
      const intentMs = seekIntentMsRef.current;
      if (Number.isFinite(intentMs)) {
        const targetSeconds = intentMs / 1000;
        if (Math.abs(seconds - targetSeconds) <= 1) {
          seekIntentMsRef.current = null;
        }
      }
    }
  }, [seconds]);

  useEffect(() => {
    setShowPauseOverlay(pauseOverlayPreference);
  }, [waitKey]);

  useEffect(() => {
    if (mediaIdentityRef.current !== mediaIdentity) {
      mediaIdentityRef.current = mediaIdentity;
      seekIntentMsRef.current = null;
    }
  }, [mediaIdentity]);

  const clearTimer = useCallback((ref) => {
    if (ref.current) {
      clearTimeout(ref.current);
      ref.current = null;
    }
  }, []);

  const clearMountWatchdog = useCallback(() => {
    if (mountWatchdogTimerRef.current) {
      clearTimeout(mountWatchdogTimerRef.current);
      mountWatchdogTimerRef.current = null;
    }
    mountWatchdogStartRef.current = null;
    mountWatchdogReasonRef.current = null;
  }, []);

  const invalidatePendingStallDetection = useCallback((reason = 'seek-intent') => {
    const hadPendingTimers = Boolean(stallTimerRef.current || hardRecoveryTimerRef.current);
    const wasStalling = statusRef.current === STATUS.stalling;

    clearTimer(stallTimerRef);
    clearTimer(hardRecoveryTimerRef);

    if (resilienceState.lastStallToken != null) {
      resilienceActions.setStatus(statusRef.current, { clearStallToken: true });
    }

    if (wasStalling && statusRef.current !== STATUS.recovering) {
      resilienceActions.setStatus(STATUS.pending, { clearRecoveryGuard: true });
    }

    if (hadPendingTimers || wasStalling) {
      logResilienceEvent('stall-invalidated', { reason });
    }
  }, [clearTimer, logResilienceEvent, resilienceActions, resilienceState.lastStallToken, statusRef]);

  const resetDetectionState = useCallback(() => {
    clearTimer(stallTimerRef);
    clearTimer(reloadTimerRef);
    clearTimer(hardRecoveryTimerRef);
    lastProgressTsRef.current = null;
    lastProgressSecondsRef.current = null;
  }, [clearTimer]);

  useEffect(() => {
    resetDetectionState();
    setShowDebug(false);
    setOverlayVisible(!overlayConfig.revealDelayMs);
    setOverlayHoldActive(true);
    setInitialOverlayGraceActive(Boolean(overlayConfig.revealDelayMs));
    resilienceActions.reset({
      nextStatus: resilienceState.carryRecovery ? STATUS.recovering : STATUS.pending
    });
  }, [waitKey, resetDetectionState, overlayConfig.revealDelayMs, resilienceActions, resilienceState.carryRecovery]);

  useEffect(() => {
    updateExplicitPauseState(false);
  }, [waitKey, updateExplicitPauseState]);

  useEffect(() => {
    resilienceActions.setStatus(STATUS.pending);
    setShowDebug(false);
  }, [mediaIdentity, resilienceActions]);

  const recordSeekIntentMs = useCallback((valueMs, reason = 'seek-intent') => {
    if (!Number.isFinite(valueMs) || valueMs < 0) return;
    seekIntentMsRef.current = valueMs;
    invalidatePendingStallDetection(reason);
  }, [invalidatePendingStallDetection]);

  const recordSeekIntentSeconds = useCallback((valueSeconds, reason = 'seek-intent') => {
    if (!Number.isFinite(valueSeconds)) return;
    recordSeekIntentMs(Math.max(0, valueSeconds * 1000), reason);
  }, [recordSeekIntentMs]);

  useEffect(() => {
    if (typeof getMediaEl !== 'function') return () => {};
    const mediaEl = getMediaEl();
    if (!mediaEl) return () => {};

    const handleSeeking = () => {
      if (Number.isFinite(mediaEl.currentTime)) {
        recordSeekIntentSeconds(mediaEl.currentTime, 'media-element-seeking');
      } else {
        invalidatePendingStallDetection('media-element-seeking');
      }
    };

    mediaEl.addEventListener('seeking', handleSeeking);
    return () => {
      mediaEl.removeEventListener('seeking', handleSeeking);
    };
  }, [getMediaEl, recordSeekIntentSeconds, invalidatePendingStallDetection, waitKey]);

  const resolveSeekIntentMs = useCallback((overrideMs = null) => {
    if (Number.isFinite(overrideMs)) {
      return Math.max(0, overrideMs);
    }
    if (Number.isFinite(seekIntentMsRef.current)) {
      return Math.max(0, seekIntentMsRef.current);
    }
    if (Number.isFinite(lastProgressSecondsRef.current)) {
      return Math.max(0, lastProgressSecondsRef.current * 1000);
    }
    if (Number.isFinite(lastSecondsRef.current)) {
      return Math.max(0, lastSecondsRef.current * 1000);
    }
    return null;
  }, []);

  const {
    triggerRecovery,
    scheduleHardRecovery,
    forcePlayerRemount,
    requestOverlayHardReset
  } = useResilienceRecovery({
    recoveryConfig,
    hardRecoverAfterStalledForMs,
    meta,
    waitKey,
    resolveSeekIntentMs,
    epsilonSeconds,
    logResilienceEvent,
    defaultReload,
    onReloadRef,
    seekIntentMsRef,
    lastReloadAtRef,
    lastProgressSecondsRef,
    lastSecondsRef,
    clearTimer,
    reloadTimerRef,
    hardRecoveryTimerRef,
    progressTokenRef,
    resilienceActions,
    statusRef,
    pendingStatusValue: STATUS.pending,
    recoveringStatusValue: STATUS.recovering,
    userIntentRef,
    pausedIntentValue: USER_INTENT.paused,
    recoveryAttempts: resilienceState.recoveryAttempts
  });

  const startMountWatchdog = useCallback((reason = 'pending') => {
    if (!mountTimeoutMs || mountTimeoutMs <= 0) return;
    if (typeof getMediaEl !== 'function') return;

    const pollDelay = Math.max(250, Number.isFinite(mountPollIntervalMs)
      ? mountPollIntervalMs
      : 750);

    clearMountWatchdog();
    mountWatchdogReasonRef.current = reason;
    mountWatchdogStartRef.current = Date.now();

    const poll = () => {
      if (!mountWatchdogReasonRef.current) return;

      let mediaEl = null;
      try {
        mediaEl = getMediaEl();
      } catch (error) {
        console.warn('[useMediaResilience] failed to read media element during mount watchdog', error);
      }

      if (mediaEl) {
        mountWatchdogAttemptsRef.current = 0;
        clearMountWatchdog();
        return;
      }

      const elapsed = Date.now() - (mountWatchdogStartRef.current || 0);
      if (elapsed >= mountTimeoutMs) {
        clearMountWatchdog();
        const attempts = ++mountWatchdogAttemptsRef.current;
        console.warn(`[useMediaResilience] mount watchdog fired (${reason})`, { attempts });
        if (mountMaxAttempts && attempts > mountMaxAttempts) {
          console.error('[useMediaResilience] mount watchdog exceeded max attempts; forcing hard reload');
          onReloadRef.current?.({ reason: 'mount-watchdog-max', meta, waitKey, forceFullReload: true });
          defaultReload();
          return;
        }
        triggerRecovery('mount-watchdog', { ignorePaused: true, force: true });
        return;
      }

      mountWatchdogTimerRef.current = setTimeout(poll, pollDelay);
    };

    poll();
  }, [mountTimeoutMs, mountPollIntervalMs, mountMaxAttempts, getMediaEl, clearMountWatchdog, triggerRecovery, onReloadRef, meta, waitKey, defaultReload]);

  const enterStallingState = useCallback(() => {
    if (
      resilienceState.lastStallToken === playbackHealth.progressToken
      && statusRef.current === STATUS.stalling
    ) {
      return;
    }
    if (statusRef.current === STATUS.recovering) {
      return;
    }
    resilienceActions.stallDetected({ stallToken: playbackHealth.progressToken });
  }, [playbackHealth.progressToken, resilienceActions, resilienceState.lastStallToken, statusRef]);

  const scheduleStallCheck = useCallback((timeoutMs, { restart = true } = {}) => {
    if (!timeoutMs || timeoutMs <= 0) {
      clearTimer(stallTimerRef);
      return;
    }
    if (!restart && stallTimerRef.current) {
      return;
    }
    clearTimer(stallTimerRef);
    stallTimerRef.current = setTimeout(() => {
      if (userIntentRef.current === USER_INTENT.paused) return;
      enterStallingState();
      scheduleHardRecovery();
    }, timeoutMs);
  }, [clearTimer, scheduleHardRecovery, enterStallingState, userIntentRef]);

  useEffect(() => {
    if (status === STATUS.stalling) {
      scheduleHardRecovery();
    }
  }, [scheduleHardRecovery, status]);

  const normalizedSeconds = Number.isFinite(seconds) ? seconds : null;

  useEffect(() => {
    const previous = statusTransitionRef.current;
    if (previous === status) {
      return;
    }

    logResilienceEvent('status-transition', {
      from: previous,
      to: status,
      seconds: normalizedSeconds,
      waitKey: logWaitKey
    });

    if (status === STATUS.stalling && previous !== STATUS.recovering) {
      logResilienceEvent('stall-detected', {
        seconds: normalizedSeconds,
        lastProgressSeconds: lastProgressSecondsRef.current,
        progressToken: playbackHealth.progressToken
      });
    } else if (status === STATUS.playing && previous === STATUS.stalling) {
      logResilienceEvent('stall-recovered', {
        seconds: normalizedSeconds,
        lastProgressSeconds: lastProgressSecondsRef.current,
        progressToken: playbackHealth.progressToken
      });
    } else if (status === STATUS.recovering && previous !== STATUS.recovering) {
      logResilienceEvent('stall-recovering', {
        seconds: normalizedSeconds,
        attempts: resilienceState.recoveryAttempts,
        reason: mountWatchdogReasonRef.current || 'auto'
      });
    }

    statusTransitionRef.current = status;
  }, [status, logResilienceEvent, normalizedSeconds, playbackHealth.progressToken, logWaitKey, resilienceState.recoveryAttempts]);

  const monitorSuspended = userIntent === USER_INTENT.paused;

  useEffect(() => {
    const detectionDelay = stallDetectionThresholdMs;

    if (typeof stalledOverride === 'boolean') {
      if (stalledOverride) {
        enterStallingState();
        scheduleHardRecovery();
      } else if (status === STATUS.stalling) {
        resilienceActions.setStatus(STATUS.playing, {
          clearStallToken: true,
          clearRecoveryGuard: true,
          resetAttempts: true
        });
      }
      return;
    }

    if (monitorSuspended) {
      clearTimer(stallTimerRef);
      clearTimer(hardRecoveryTimerRef);
      return;
    }

    const progressTokenChanged = playbackHealth.progressToken !== progressTokenRef.current;
    if (progressTokenChanged) {
      const guardToken = resilienceState.recoveryGuardToken;
      if (guardToken != null && playbackHealth.progressToken <= guardToken) {
        return;
      }

      progressTokenRef.current = playbackHealth.progressToken;

      const progressSource = playbackHealth.lastProgressSource;
      const progressSecondsValue = Number.isFinite(playbackHealth.lastProgressSeconds)
        ? playbackHealth.lastProgressSeconds
        : (Number.isFinite(normalizedSeconds) ? normalizedSeconds : lastProgressSecondsRef.current);
      const exceedsEpsilon = Number.isFinite(progressSecondsValue) && progressSecondsValue > epsilonSeconds;
      const eventProgress = progressSource === 'event'
        && playbackHealth.progressDetails === 'playing'
        && exceedsEpsilon;

      // Be strict about what constitutes meaningful progress to avoid false positives
      // during recovery or initial load.
      const hasMeaningfulProgress = eventProgress
        || (['clock', 'frame'].includes(progressSource) && (exceedsEpsilon || playbackHealth.elementSignals?.playing))
        || exceedsEpsilon;

      if (hasMeaningfulProgress) {
        lastProgressSecondsRef.current = progressSecondsValue ?? lastProgressSecondsRef.current;
        lastProgressTsRef.current = playbackHealth.lastProgressAt ?? Date.now();
        clearTimer(hardRecoveryTimerRef);
        resilienceActions.progressTick({ nextStatus: STATUS.playing });
        scheduleStallCheck(detectionDelay, { restart: true });
      } else {
        // Ignore early signals (e.g., "playing" events before the clock advances)
        lastProgressTsRef.current = playbackHealth.lastProgressAt ?? lastProgressTsRef.current;
        if (statusRef.current !== STATUS.recovering) {
          resilienceActions.setStatus(STATUS.pending);
        }
        clearTimer(stallTimerRef);
        clearTimer(hardRecoveryTimerRef);
      }
      return;
    }

    const playbackHasSignaled = playbackHealth?.progressToken > 0
      || Boolean(playbackHealth?.elementSignals?.playing);
    const hasObservedClockOrFrameProgress = ['clock', 'frame'].includes(playbackHealth?.lastProgressSource);
    const hasObservedSecondsProgress = (lastProgressSecondsRef.current ?? 0) > 0;
    // Treat clock/frame sourced progress as real playback movement so we can wait for media to settle
    // before escalating into the stall state.
    const hasObservedProgress = hasObservedClockOrFrameProgress || hasObservedSecondsProgress;
    // Some media targets emit playing events before clock time advances past 0s; treat that as "started"
    // so we do not stay in pending -> mount watchdog loops waiting for fractional progress updates.
    const hasStarted = playbackHasSignaled || hasObservedSecondsProgress;

    if (status === STATUS.recovering) {
      scheduleStallCheck(detectionDelay, { restart: false });
      return;
    }

    if (!hasStarted) {
      if (status !== STATUS.stalling) {
        resilienceActions.setStatus(STATUS.pending);
      }
      clearTimer(stallTimerRef);
      clearTimer(hardRecoveryTimerRef);
      return;
    }

    if (!hasObservedProgress) {
      if (status !== STATUS.stalling) {
        resilienceActions.setStatus(STATUS.pending);
      }
      clearTimer(stallTimerRef);
      clearTimer(hardRecoveryTimerRef);
      return;
    }

    if (playbackHealth.isWaiting || playbackHealth.isStalledEvent) {
      enterStallingState();
      scheduleHardRecovery();
      return;
    }

    if (status === STATUS.stalling) {
      scheduleHardRecovery();
      return;
    }

    scheduleStallCheck(detectionDelay, { restart: false });
  }, [
    clearTimer,
    monitorSuspended,
    normalizedSeconds,
    playbackHealth,
    scheduleHardRecovery,
    scheduleStallCheck,
    stalledOverride,
    stallDetectionThresholdMs,
    status,
    enterStallingState,
    epsilonSeconds,
    resilienceActions,
    resilienceState.recoveryGuardToken
  ]);

  useEffect(() => () => {
    clearTimer(stallTimerRef);
    clearTimer(reloadTimerRef);
    clearTimer(hardRecoveryTimerRef);
    clearMountWatchdog();
  }, [clearTimer, clearMountWatchdog]);


  useEffect(() => {
    const waiting = status === STATUS.pending || status === STATUS.recovering;
    if (userIntent === USER_INTENT.paused) {
      setShowDebug(false);
      return () => {};
    }
    if (!(explicitShow || waiting)) {
      setShowDebug(false);
      return () => {};
    }
    const timeout = setTimeout(() => setShowDebug(true), debugConfig.revealDelayMs ?? 3000);
    return () => clearTimeout(timeout);
  }, [explicitShow, userIntent, status, debugConfig.revealDelayMs]);

  const waitingToPlay = status === STATUS.pending || status === STATUS.recovering;
  const baseSystemHealth = (() => {
    if (status === STATUS.stalling || playbackHealth.isStalledEvent) {
      return SYSTEM_HEALTH.stalled;
    }
    if (waitingToPlay || playbackHealth.isWaiting) {
      return SYSTEM_HEALTH.buffering;
    }
    return SYSTEM_HEALTH.ok;
  })();
  const systemHealth = (() => {
    if (typeof stalledOverride === 'boolean') {
      return stalledOverride ? SYSTEM_HEALTH.stalled : SYSTEM_HEALTH.ok;
    }
    return baseSystemHealth;
  })();
  const computedStalled = systemHealth === SYSTEM_HEALTH.stalled || status === STATUS.recovering;
  const stallOverlayActive = computedStalled;

  const telemetryHasProgress = playbackHealth.progressToken > 0
    && Number.isFinite(playbackHealth?.lastProgressSeconds);
  const observedProgressSeconds = Number.isFinite(lastProgressSecondsRef.current)
    ? lastProgressSecondsRef.current
    : (telemetryHasProgress
      ? playbackHealth.lastProgressSeconds
      : null);
  const playbackHasProgress = status === STATUS.recovering
    ? false
    : (Number.isFinite(observedProgressSeconds) && observedProgressSeconds > epsilonSeconds);
  const implicitPauseState = waitingToPlay
    || computedStalled
    || playbackHealth.isWaiting
    || playbackHealth.isStalledEvent
    || isSeeking;

  useEffect(() => {
    if (userIntent !== USER_INTENT.paused || !playbackHasProgress || implicitPauseState) {
      if (explicitPauseRef.current) {
        updateExplicitPauseState(false);
      }
      return;
    }
    updateExplicitPauseState(true);
  }, [
    userIntent,
    playbackHasProgress,
    implicitPauseState,
    updateExplicitPauseState
  ]);

  const pauseOverlayEligible = overlayConfig.showPausedOverlay && showPauseOverlay;
  const pauseOverlayActive = pauseOverlayEligible
    && explicitPauseActive
    && userIntent === USER_INTENT.paused
    && isPaused
    && !waitingToPlay
    && !computedStalled;

  useEffect(() => {
    if (status === STATUS.recovering) {
      setOverlayHoldActive(true);
      return;
    }
    if (playbackHasProgress) {
      setOverlayHoldActive(false);
    }
  }, [status, playbackHasProgress]);

  useEffect(() => {
    if (!initialOverlayGraceActive) return;
    if (!playbackHasProgress) return;
    setInitialOverlayGraceActive(false);
  }, [initialOverlayGraceActive, playbackHasProgress]);

  const holdOverlayActive = overlayHoldActive && !playbackHasProgress;
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
    });
  }, [overlayHoldActive, holdOverlayActive, playbackHasProgress, logWaitKey, status, overlayActiveReasons]);
  const shouldRenderOverlay = waitingToPlay
    || stallOverlayActive
    || explicitShow
    || pauseOverlayActive
    || holdOverlayActive;
  const overlayActive = shouldRenderOverlay && isOverlayVisible;
  const overlayTimerActive = overlayActive && !pauseOverlayActive;
  const overlayRevealDelayMs = Number.isFinite(overlayConfig.revealDelayMs)
    ? Math.max(0, overlayConfig.revealDelayMs)
    : 0;
  const overlayGraceReason = (() => {
    if (!overlayRevealDelayMs) return null;
    if (initialOverlayGraceActive) return 'initial-load';
    if (isSeeking) return 'seeking';
    return null;
  })();
  const overlayGraceActive = Boolean(overlayGraceReason);

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
    const serialized = JSON.stringify({
      shouldRender: decisionSnapshot.shouldRender,
      isVisible: decisionSnapshot.isVisible,
      overlayHoldActive: decisionSnapshot.overlayHoldActive,
      holdOverlayActive: decisionSnapshot.holdOverlayActive,
      reasons: decisionSnapshot.activeReasons
    });
    if (overlayDecisionRef.current === serialized) return;
    overlayDecisionRef.current = serialized;
    playbackLog('overlay-decision', decisionSnapshot);
  }, [
    overlayActiveReasons,
    overlayGraceReason,
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
    const serialized = JSON.stringify(visibilitySnapshot);
    if (overlayVisibilityRef.current === serialized) return;
    overlayVisibilityRef.current = serialized;
    playbackLog('overlay-visibility-gate', visibilitySnapshot);
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
    if (!mountTimeoutMs || mountTimeoutMs <= 0) {
      clearMountWatchdog();
      return;
    }
    if (status === STATUS.pending || status === STATUS.recovering) {
      startMountWatchdog(status);
    } else {
      clearMountWatchdog();
    }
  }, [status, mountTimeoutMs, startMountWatchdog, clearMountWatchdog]);

  useEffect(() => {
    mountWatchdogAttemptsRef.current = 0;
  }, [waitKey]);

  useEffect(() => {
    if (status === STATUS.playing) {
      mountWatchdogAttemptsRef.current = 0;
    }
  }, [status]);

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

  const overlayBaseDeadlineMs = hardRecoverAfterStalledForMs > 0 ? hardRecoverAfterStalledForMs : 6000;
  const overlayElapsedSeconds = useOverlayTimer(overlayTimerActive, overlayBaseDeadlineMs, triggerRecovery);
  const overlayCountdownSeconds = overlayTimerActive
    ? Math.max(0, Math.ceil((overlayBaseDeadlineMs - overlayElapsedSeconds * 1000) / 1000))
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

  const markHealthy = useCallback(() => {
    clearTimer(stallTimerRef);
    clearTimer(reloadTimerRef);
    resilienceActions.setStatus(STATUS.playing, {
      clearStallToken: true,
      clearRecoveryGuard: true,
      resetAttempts: true
    });
  }, [clearTimer, resilienceActions]);

  const state = useMemo(() => ({
    status,
    waitingToPlay,
    waitingForPlayback: waitingToPlay,
    graceElapsed: !waitingToPlay,
    isOverlayVisible,
    showPauseOverlay,
    showDebug,
    stalled: computedStalled,
    seconds,
    isPaused,
    isSeeking,
    userIntent,
    systemHealth,
    meta,
    waitKey,
    lastFetchAt,
    shouldRenderOverlay,
    playbackHealth,
    hardRecoverAfterStalledForMs
  }), [
    status,
    waitingToPlay,
    isOverlayVisible,
    showPauseOverlay,
    showDebug,
    computedStalled,
    systemHealth,
    seconds,
    isPaused,
    isSeeking,
    userIntent,
    meta,
    waitKey,
    lastFetchAt,
    shouldRenderOverlay,
    playbackHealth,
    hardRecoverAfterStalledForMs
  ]);
  const stateRef = useLatest(state);

  useEffect(() => {
    if (typeof onStateChange === 'function') {
      onStateChange(state);
    }
  }, [onStateChange, state]);

  const controller = useMemo(() => ({
    reset: () => {
      resetDetectionState();
      resilienceActions.reset({ nextStatus: STATUS.pending, clearCarry: true });
      setOverlayVisible(!overlayConfig.revealDelayMs);
      setShowDebug(false);
    },
    forceReload: (options = {}) => {
      const overrideMs = Number.isFinite(options.seekToIntentMs)
        ? Math.max(0, options.seekToIntentMs)
        : Number.isFinite(options.seekSeconds)
          ? Math.max(0, options.seekSeconds * 1000)
          : null;
      if (overrideMs != null) {
        recordSeekIntentMs(overrideMs);
      }
      triggerRecovery('manual', { ignorePaused: true, seekToIntentMs: overrideMs });
      const fallbackIntentMs = resolveSeekIntentMs(overrideMs);
      onReloadRef.current?.({ reason: 'manual', meta, waitKey, ...options, seekToIntentMs: fallbackIntentMs });
    },
    forceFetchInfo: (options = {}) => {
      fetchVideoInfoRef.current?.({ reason: 'manual', meta, waitKey, ...options });
      setLastFetchAt(Date.now());
    },
    applyConfigPatch: (patch = {}) => {
      setRuntimeOverrides((prev) => mergeConfigs(prev || {}, patch));
    },
    getState: () => stateRef.current,
    setPauseOverlayVisible: (value) => {
      const next = value ?? true;
      pauseOverlayPreference = next;
      setShowPauseOverlay(next);
    },
    markHealthy,
    togglePauseOverlay,
    recordSeekIntentSeconds,
    recordSeekIntentMs,
    getSeekIntentMs: () => resolveSeekIntentMs()
  }), [
    fetchVideoInfoRef,
    markHealthy,
    meta,
    overlayConfig.revealDelayMs,
    onReloadRef,
    recordSeekIntentMs,
    recordSeekIntentSeconds,
    resetDetectionState,
    togglePauseOverlay,
    triggerRecovery,
    resolveSeekIntentMs,
    waitKey,
    stateRef,
    resilienceActions
  ]);

  useEffect(() => {
    if (!controllerRef) return () => {};
    controllerRef.current = controller;
    return () => {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [controller, controllerRef]);

  const resolvedPlexId = plexId || meta?.media_key || meta?.key || meta?.plex || null;
  const intentMsForDisplay = resolveSeekIntentMs();
  const intentSecondsForDisplay = Number.isFinite(intentMsForDisplay) ? intentMsForDisplay / 1000 : null;
  const playerPositionDisplay = formatTime(Math.max(0, seconds));
  const intentPositionDisplay = Number.isFinite(intentSecondsForDisplay)
    ? formatTime(Math.max(0, intentSecondsForDisplay))
    : null;
  const overlayProps = createOverlayProps({
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
    lastProgressTs: lastProgressTsRef.current,
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
    playbackHealth,
    mediaDetails
  });

  const heartbeatProgressToken = playbackHealth?.progressToken ?? null;
  const heartbeatProgressSource = playbackHealth?.lastProgressSource ?? null;
  const heartbeatProgressDetails = playbackHealth?.progressDetails ?? null;
  const heartbeatProgressSeconds = playbackHealth?.lastProgressSeconds ?? null;
  const heartbeatIsWaiting = playbackHealth?.isWaiting ?? false;
  const heartbeatIsStalled = playbackHealth?.isStalledEvent ?? false;
  const heartbeatElementPlaying = Boolean(playbackHealth?.elementSignals?.playing);

  useEffect(() => {
    if (!playbackHealth) return;
    const snapshot = {
      waitKey: logWaitKey,
      status,
      progressToken: heartbeatProgressToken,
      lastProgressSource: heartbeatProgressSource,
      lastProgressDetails: heartbeatProgressDetails,
      lastProgressSeconds: formatSecondsForLog(heartbeatProgressSeconds),
      seconds: formatSecondsForLog(seconds),
      isWaiting: heartbeatIsWaiting,
      isStalledEvent: heartbeatIsStalled,
      elementPlayingSignal: heartbeatElementPlaying
    };
    const serialized = JSON.stringify(snapshot);
    if (playbackHeartbeatRef.current === serialized) return;
    playbackHeartbeatRef.current = serialized;
    playbackLog('playback-heartbeat', snapshot);
  }, [
    playbackHealth,
    heartbeatProgressToken,
    heartbeatProgressSource,
    heartbeatProgressDetails,
    heartbeatProgressSeconds,
    heartbeatIsWaiting,
    heartbeatIsStalled,
    heartbeatElementPlaying,
    seconds,
    logWaitKey,
    status
  ]);

  return { overlayProps, controller, state };
}

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
  playbackHealth,
  mediaDetails
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
    playbackHealth,
    mediaDetails
  };
}
