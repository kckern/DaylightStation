import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatTime } from '../lib/helpers.js';
import { playbackLog } from '../lib/playbackLogger.js';
import { getLogWaitKey } from '../lib/waitKeyLabel.js';
import { usePlaybackHealth } from './usePlaybackHealth.js';
import { useResilienceConfig } from './useResilienceConfig.js';
import { useResilienceState, RESILIENCE_STATUS } from './useResilienceState.js';
import { useResilienceRecovery } from './useResilienceRecovery.js';
import { usePlaybackSession } from './usePlaybackSession.js';
import { useOverlayPresentation } from './useOverlayPresentation.js';

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


const useLatest = (value) => {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
};


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
    updateExplicitPauseState,
    setUserIntent
  };
}

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
  playbackSessionKey,
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

  const [showDebug, setShowDebug] = useState(false);
  const {
    userIntent,
    userIntentRef,
    explicitPauseActive,
    explicitPauseRef,
    updateExplicitPauseState,
    setUserIntent
  } = useUserIntentControls({ isPaused, isSeeking });
  const {
    state: resilienceState,
    status,
    statusRef,
    actions: resilienceActions
  } = useResilienceState(STATUS.pending);
  const [lastFetchAt, setLastFetchAt] = useState(null);

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
    threadId,
    sessionId: playbackSessionKey || null
  });
  const {
    targetTimeSeconds: sessionTargetTimeSeconds,
    setTargetTimeSeconds: updateSessionTargetTimeSeconds,
    consumeTargetTimeSeconds
  } = usePlaybackSession({ sessionKey: playbackSessionKey });
  const lastSecondsRef = useRef(Number.isFinite(seconds) ? seconds : 0);
  const progressTokenRef = useRef(0);
  const mountWatchdogTimerRef = useRef(null);
  const mountWatchdogStartRef = useRef(null);
  const mountWatchdogReasonRef = useRef(null);
  const mountWatchdogAttemptsRef = useRef(0);
  const statusTransitionRef = useRef(status);
  const seekIntentNoiseThresholdSeconds = useMemo(
    () => Math.max(0.5, epsilonSeconds * 2),
    [epsilonSeconds]
  );

  const hasMeaningfulSeekIntent = useCallback((targetSeconds) => {
    if (!Number.isFinite(targetSeconds)) return false;
    const baseline = Number.isFinite(lastProgressSecondsRef.current)
      ? lastProgressSecondsRef.current
      : (Number.isFinite(lastSecondsRef.current) ? lastSecondsRef.current : null);
    if (!Number.isFinite(baseline)) {
      return true;
    }
    return Math.abs(targetSeconds - baseline) >= seekIntentNoiseThresholdSeconds;
  }, [lastProgressSecondsRef, lastSecondsRef, seekIntentNoiseThresholdSeconds]);


  const logResilienceEvent = useCallback((event, details = {}, options = {}) => {
    const context = logContextRef.current || {};
    const { level: detailLevel, tags: detailTags, ...restDetails } = details || {};
    const resolvedOptions = typeof options === 'object' && options !== null ? options : {};
    const resolvedLevel = resolvedOptions.level || detailLevel || 'debug';
    const combinedTags = detailTags || resolvedOptions.tags;
    playbackLog('media-resilience', {
      event,
      ...context,
      ...restDetails
    }, {
      ...resolvedOptions,
      level: resolvedLevel,
      tags: combinedTags,
      context: {
        ...context,
        ...(resolvedOptions.context || {})
      }
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
  }, [waitKey]);

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
    if (!Number.isFinite(seconds)) return;
    lastSecondsRef.current = seconds;
    if (Number.isFinite(sessionTargetTimeSeconds)) {
      const delta = Math.abs(seconds - sessionTargetTimeSeconds);
      if (delta <= 1) {
        consumeTargetTimeSeconds();
      }
    }
  }, [seconds, sessionTargetTimeSeconds, consumeTargetTimeSeconds]);

  useEffect(() => {
    if (mediaIdentityRef.current !== mediaIdentity) {
      mediaIdentityRef.current = mediaIdentity;
      consumeTargetTimeSeconds();
    }
  }, [mediaIdentity, consumeTargetTimeSeconds]);

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
      logResilienceEvent('stall-invalidated', { reason }, { level: 'debug' });
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
    resilienceActions.reset({
      nextStatus: resilienceState.carryRecovery ? STATUS.recovering : STATUS.pending
    });
  }, [waitKey, resetDetectionState, resilienceActions, resilienceState.carryRecovery]);

  useEffect(() => {
    updateExplicitPauseState(false);
  }, [waitKey, updateExplicitPauseState]);

  useEffect(() => {
    resilienceActions.setStatus(STATUS.pending);
    setShowDebug(false);
  }, [mediaIdentity, resilienceActions]);

  const persistSeekIntentMs = useCallback((valueMs) => {
    if (!Number.isFinite(valueMs) || valueMs < 0) return;
    const normalizedSeconds = Math.max(0, valueMs / 1000);
    updateSessionTargetTimeSeconds(normalizedSeconds);
  }, [updateSessionTargetTimeSeconds]);

  const recordSeekIntentMs = useCallback((valueMs, reason = 'seek-intent') => {
    if (!Number.isFinite(valueMs) || valueMs < 0) return;
    persistSeekIntentMs(valueMs);
    invalidatePendingStallDetection(reason);
  }, [persistSeekIntentMs, invalidatePendingStallDetection]);

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
        const targetSeconds = mediaEl.currentTime;
        if (!hasMeaningfulSeekIntent(targetSeconds)) {
          return;
        }
        recordSeekIntentSeconds(targetSeconds, 'media-element-seeking');
      } else {
        invalidatePendingStallDetection('media-element-seeking');
      }
    };

    mediaEl.addEventListener('seeking', handleSeeking);
    return () => {
      mediaEl.removeEventListener('seeking', handleSeeking);
    };
  }, [
    getMediaEl,
    recordSeekIntentSeconds,
    invalidatePendingStallDetection,
    waitKey,
    hasMeaningfulSeekIntent
  ]);

  const resolveSeekIntentMs = useCallback((overrideMs = null) => {
    if (Number.isFinite(overrideMs)) {
      return Math.max(0, overrideMs);
    }
    if (Number.isFinite(sessionTargetTimeSeconds)) {
      return Math.max(0, sessionTargetTimeSeconds * 1000);
    }
    if (Number.isFinite(lastProgressSecondsRef.current)) {
      return Math.max(0, lastProgressSecondsRef.current * 1000);
    }
    if (Number.isFinite(lastSecondsRef.current)) {
      return Math.max(0, lastSecondsRef.current * 1000);
    }
    return null;
  }, [sessionTargetTimeSeconds]);

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
    persistSeekIntentMs,
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
    }, { level: 'debug' });

    if (status === STATUS.stalling && previous !== STATUS.recovering) {
      logResilienceEvent('stall-detected', {
        seconds: normalizedSeconds,
        lastProgressSeconds: lastProgressSecondsRef.current,
        progressToken: playbackHealth.progressToken
      }, { level: 'warn' });
    } else if (status === STATUS.playing && previous === STATUS.stalling) {
      logResilienceEvent('stall-recovered', {
        seconds: normalizedSeconds,
        lastProgressSeconds: lastProgressSecondsRef.current,
        progressToken: playbackHealth.progressToken
      }, { level: 'info' });
    } else if (status === STATUS.recovering && previous !== STATUS.recovering) {
      logResilienceEvent('stall-recovering', {
        seconds: normalizedSeconds,
        attempts: resilienceState.recoveryAttempts,
        reason: mountWatchdogReasonRef.current || 'auto'
      }, { level: 'info' });
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
      if (statusRef.current !== STATUS.stalling && statusRef.current !== STATUS.pending) {
        resilienceActions.setStatus(STATUS.pending);
      }
      clearTimer(stallTimerRef);
      clearTimer(hardRecoveryTimerRef);
      return;
    }

    if (!hasObservedProgress) {
      if (statusRef.current !== STATUS.stalling && statusRef.current !== STATUS.pending) {
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

  const {
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
    setPauseOverlayVisible: setOverlayPausePreference,
    resetOverlayState
  } = useOverlayPresentation({
    overlayConfig,
    waitKey,
    logWaitKey,
    status,
    explicitShow,
    isSeeking,
    getMediaEl,
    meta,
    hardRecoverAfterStalledForMs,
    triggerRecovery,
    stallOverlayActive,
    waitingToPlay,
    playbackHasProgress,
    userIntentIsPaused: userIntent === USER_INTENT.paused,
    explicitPauseActive,
    isPaused,
    computedStalled,
    playbackHealth,
    seconds
  });

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
      setShowDebug(false);
      resetOverlayState();
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
      setOverlayPausePreference(value);
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
    onReloadRef,
    recordSeekIntentMs,
    recordSeekIntentSeconds,
    resetDetectionState,
    resetOverlayState,
    togglePauseOverlay,
    triggerRecovery,
    resolveSeekIntentMs,
    waitKey,
    stateRef,
    resilienceActions,
    setOverlayPausePreference
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
