import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { formatTime } from '../lib/helpers.js';

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
  pending: 'pending',
  playing: 'playing',
  paused: 'paused',
  stalling: 'stalling',
  recovering: 'recovering'
};

let pauseOverlayPreference = true;

export const DEFAULT_MEDIA_RESILIENCE_CONFIG = {
  overlay: {
    revealDelayMs: 300, // fade-in delay before showing the overlay
    pauseToggleKeys: ['ArrowUp', 'ArrowDown'], // remote keys that toggle pause overlay
    showPausedOverlay: true // whether to show overlay while paused
  },
  monitor: {
    progressEpsilonSeconds: 0.25, // how many seconds of advancement count as progress
    stallDetectionThresholdMs: 500, // delay before marking stalled once progress stops
    hardRecoverAfterStalledForMs: 3000 // force reload if stall persists this long
  },
  recovery: {
    enabled: true, // master switch for recovery logic
    reloadDelayMs: 0, // delay before triggering reload when requested
    cooldownMs: 4000, // minimum time between recovery attempts
    maxAttempts: 8 // cap on automatic recovery retries
  },
  debug: {
    revealDelayMs: 5000 // delay before showing debug details on overlay
  }
};

export const MediaResilienceConfigContext = createContext(DEFAULT_MEDIA_RESILIENCE_CONFIG);

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

function mergeDeep(target, source) {
  if (!isObject(target)) return source;
  if (!isObject(source)) return target;
  const output = { ...target };
  Object.keys(source).forEach((key) => {
    const targetValue = output[key];
    const sourceValue = source[key];
    if (Array.isArray(sourceValue)) {
      output[key] = sourceValue.slice();
    } else if (isObject(sourceValue) && isObject(targetValue)) {
      output[key] = mergeDeep(targetValue, sourceValue);
    } else {
      output[key] = sourceValue;
    }
  });
  return output;
}

const mergeConfigs = (...configs) => configs
  .filter(Boolean)
  .reduce((acc, cfg) => mergeDeep(acc, cfg), {});

export const mergeMediaResilienceConfig = (...configs) => mergeConfigs(...configs);

const coerceNumber = (value, fallback) => (Number.isFinite(value) ? value : fallback);

const useResolvedMediaResilienceConfig = (contextConfig, configOverrides, runtimeOverrides) => useMemo(() => {
  const mergedConfig = mergeConfigs(
    DEFAULT_MEDIA_RESILIENCE_CONFIG,
    contextConfig,
    configOverrides,
    runtimeOverrides
  );

  const overlayConfig = mergedConfig.overlay || {};
  const debugConfig = mergedConfig.debug || {};
  const monitorConfig = mergedConfig.monitor || {};

  const legacyReload = mergedConfig.reload || {};
  const recoveryConfig = mergedConfig.recovery || {};

  return {
    overlayConfig,
    debugConfig,
    monitorSettings: {
      epsilonSeconds: coerceNumber(monitorConfig.progressEpsilonSeconds, 0.25),
      stallDetectionThresholdMs: coerceNumber(monitorConfig.stallDetectionThresholdMs, 500),
      hardRecoverAfterStalledForMs: coerceNumber(monitorConfig.hardRecoverAfterStalledForMs, 6000)
    },
    recoveryConfig: {
      enabled: recoveryConfig.enabled ?? legacyReload.enabled ?? true,
      reloadDelayMs: coerceNumber(recoveryConfig.reloadDelayMs ?? legacyReload.stallMs, 0),
      cooldownMs: coerceNumber(recoveryConfig.cooldownMs ?? legacyReload.cooldownMs, 4000),
      maxAttempts: coerceNumber(recoveryConfig.maxAttempts ?? legacyReload.maxAttempts, 2)
    }
  };
}, [contextConfig, configOverrides, runtimeOverrides]);

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
  stalled: stalledOverride
}) {
  const contextConfig = useContext(MediaResilienceConfigContext);
  const [runtimeOverrides, setRuntimeOverrides] = useState(null);
  const {
    overlayConfig,
    debugConfig,
    monitorSettings,
    recoveryConfig
  } = useResolvedMediaResilienceConfig(contextConfig, configOverrides, runtimeOverrides);

  const { epsilonSeconds, stallDetectionThresholdMs, hardRecoverAfterStalledForMs } = monitorSettings;

  const [isOverlayVisible, setOverlayVisible] = useState(() => !overlayConfig.revealDelayMs);
  const [showPauseOverlay, setShowPauseOverlay] = useState(pauseOverlayPreference);
  const [showDebug, setShowDebug] = useState(false);
  const [status, setStatus] = useState(STATUS.pending);
  const [lastFetchAt, setLastFetchAt] = useState(null);

  const fetchVideoInfoRef = useLatest(fetchVideoInfo);
  const onReloadRef = useLatest(onReload);
  const statusRef = useLatest(status);
  const isPausedRef = useRef(isPaused);
  const lastProgressTsRef = useRef(null);
  const lastProgressSecondsRef = useRef(null);
  const stallTimerRef = useRef(null);
  const reloadTimerRef = useRef(null);
  const hardRecoveryTimerRef = useRef(null);
  const lastReloadAtRef = useRef(0);
  const recoveryAttemptsRef = useRef(0);
  const mediaIdentity = meta?.media_key || meta?.key || meta?.plex || meta?.id || meta?.guid || meta?.media_url || null;
  const mediaIdentityRef = useRef(mediaIdentity);
  const seekIntentMsRef = useRef(null);
  const lastSecondsRef = useRef(Number.isFinite(seconds) ? seconds : 0);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

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

  useEffect(() => {
    if (typeof getMediaEl !== 'function') return () => {};
    const mediaEl = getMediaEl();
    if (!mediaEl) return () => {};
    const handleSeeking = () => {
      if (Number.isFinite(mediaEl.currentTime)) {
        seekIntentMsRef.current = Math.max(0, mediaEl.currentTime * 1000);
      }
    };
    mediaEl.addEventListener('seeking', handleSeeking);
    return () => {
      mediaEl.removeEventListener('seeking', handleSeeking);
    };
  }, [getMediaEl, waitKey]);

  const resetDetectionState = useCallback(() => {
    clearTimer(stallTimerRef);
    clearTimer(reloadTimerRef);
    clearTimer(hardRecoveryTimerRef);
    lastProgressTsRef.current = null;
    lastProgressSecondsRef.current = null;
    recoveryAttemptsRef.current = 0;
  }, [clearTimer]);

  useEffect(() => {
    resetDetectionState();
    setStatus(STATUS.pending);
    setShowDebug(false);
  }, [waitKey, resetDetectionState]);

  const recordSeekIntentMs = useCallback((valueMs) => {
    if (!Number.isFinite(valueMs) || valueMs < 0) return;
    seekIntentMsRef.current = valueMs;
  }, []);

  const recordSeekIntentSeconds = useCallback((valueSeconds) => {
    if (!Number.isFinite(valueSeconds)) return;
    recordSeekIntentMs(Math.max(0, valueSeconds * 1000));
  }, [recordSeekIntentMs]);

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

  const triggerRecovery = useCallback((reason, {
    ignorePaused = false,
    seekToIntentMs: overrideIntentMs = null,
    force = false
  } = {}) => {
    if (!force && !recoveryConfig.enabled) return;
    if (!force && !ignorePaused && isPausedRef.current && statusRef.current === STATUS.paused) return;
    if (!force && recoveryConfig.maxAttempts && recoveryAttemptsRef.current >= recoveryConfig.maxAttempts) return;
    const now = Date.now();
    if (!force && recoveryConfig.cooldownMs && now - (lastReloadAtRef.current || 0) < recoveryConfig.cooldownMs) return;

    const resolvedIntentMs = resolveSeekIntentMs(overrideIntentMs);

    const performReload = () => {
      lastReloadAtRef.current = Date.now();
      recoveryAttemptsRef.current += 1;
      setStatus(STATUS.recovering);
      onReloadRef.current?.({ reason, meta, waitKey, seekToIntentMs: resolvedIntentMs });
    };

    if (recoveryConfig.reloadDelayMs > 0) {
      clearTimer(reloadTimerRef);
      reloadTimerRef.current = setTimeout(performReload, recoveryConfig.reloadDelayMs);
    } else {
      performReload();
    }
  }, [meta, onReloadRef, recoveryConfig, waitKey, clearTimer, resolveSeekIntentMs, statusRef]);

  const scheduleHardRecovery = useCallback(() => {
    if (hardRecoverAfterStalledForMs <= 0) {
      triggerRecovery('stall-hard-recovery');
      return;
    }
    if (hardRecoveryTimerRef.current) return;
    hardRecoveryTimerRef.current = setTimeout(() => {
      hardRecoveryTimerRef.current = null;
      triggerRecovery('stall-hard-recovery');
    }, hardRecoverAfterStalledForMs);
  }, [hardRecoverAfterStalledForMs, triggerRecovery]);

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
      if (isPausedRef.current) return;
      setStatus((prev) => (prev === STATUS.recovering ? prev : STATUS.stalling));
      scheduleHardRecovery();
    }, timeoutMs);
  }, [clearTimer, scheduleHardRecovery]);

  useEffect(() => {
    if (status === STATUS.stalling) {
      scheduleHardRecovery();
    }
  }, [scheduleHardRecovery, status]);

  const normalizedSeconds = Number.isFinite(seconds) ? seconds : null;
  const progressDeltaThreshold = Math.max(0.01, Math.min(0.05, epsilonSeconds / 2));

  useEffect(() => {
    if (typeof stalledOverride === 'boolean') {
      if (stalledOverride) {
        setStatus(STATUS.stalling);
      } else if (status === STATUS.stalling) {
        setStatus(STATUS.playing);
      }
      return;
    }

    if (isPaused) {
      clearTimer(stallTimerRef);
      clearTimer(hardRecoveryTimerRef);
      setStatus((prev) => (prev === STATUS.recovering ? prev : STATUS.paused));
      return;
    }

    const detectionDelay = stallDetectionThresholdMs;
    const prevSeconds = lastProgressSecondsRef.current;
    const progressed = (() => {
      if (normalizedSeconds == null) {
        lastProgressSecondsRef.current = null;
        return false;
      }
      if (prevSeconds == null) {
        return normalizedSeconds > 0;
      }
      return Math.abs(normalizedSeconds - prevSeconds) >= progressDeltaThreshold;
    })();

    if (progressed) {
      lastProgressSecondsRef.current = normalizedSeconds;
      lastProgressTsRef.current = Date.now();
      recoveryAttemptsRef.current = 0;
      clearTimer(hardRecoveryTimerRef);
      setStatus(STATUS.playing);
      scheduleStallCheck(detectionDelay, { restart: true });
      return;
    }

    const hasStarted = (lastProgressSecondsRef.current ?? 0) > 0;

    if (!hasStarted) {
      setStatus(STATUS.pending);
      scheduleStallCheck(detectionDelay, { restart: !stallTimerRef.current });
      return;
    }

    if (status === STATUS.recovering) {
      scheduleStallCheck(detectionDelay, { restart: false });
      return;
    }

    if (status === STATUS.stalling) {
      return;
    }

    scheduleStallCheck(detectionDelay, { restart: false });
  }, [clearTimer, isPaused, normalizedSeconds, progressDeltaThreshold, scheduleStallCheck, stalledOverride, stallDetectionThresholdMs, status]);

  useEffect(() => () => {
    clearTimer(stallTimerRef);
    clearTimer(reloadTimerRef);
    clearTimer(hardRecoveryTimerRef);
  }, [clearTimer]);


  useEffect(() => {
    const waiting = status === STATUS.pending || status === STATUS.recovering;
    if (isPaused) {
      setShowDebug(false);
      return () => {};
    }
    if (!(explicitShow || waiting)) {
      setShowDebug(false);
      return () => {};
    }
    const timeout = setTimeout(() => setShowDebug(true), debugConfig.revealDelayMs ?? 3000);
    return () => clearTimeout(timeout);
  }, [explicitShow, isPaused, status, debugConfig.revealDelayMs]);

  const waitingToPlay = status === STATUS.pending || status === STATUS.recovering;
  const computedStalled = typeof stalledOverride === 'boolean'
    ? stalledOverride
    : (status === STATUS.stalling || status === STATUS.recovering);
  const stallOverlayActive = computedStalled;

  const pauseOverlayActive = isPaused && overlayConfig.showPausedOverlay && showPauseOverlay;
  const shouldRenderOverlay = waitingToPlay
    || stallOverlayActive
    || explicitShow
    || pauseOverlayActive;

  useEffect(() => {
    if (!shouldRenderOverlay) {
      setOverlayVisible(false);
      return () => {};
    }
    if (!overlayConfig.revealDelayMs) {
      setOverlayVisible(true);
      return () => {};
    }
    setOverlayVisible(false);
    const timeout = setTimeout(() => setOverlayVisible(true), overlayConfig.revealDelayMs);
    return () => clearTimeout(timeout);
  }, [shouldRenderOverlay, overlayConfig.revealDelayMs]);

  const overlayActive = shouldRenderOverlay && isOverlayVisible;
  const overlayTimerActive = overlayActive && !pauseOverlayActive;
  const overlayStallDeadlineMs = hardRecoverAfterStalledForMs > 0 ? hardRecoverAfterStalledForMs : 6000;
  const overlayElapsedSeconds = useOverlayTimer(overlayTimerActive, overlayStallDeadlineMs, triggerRecovery);

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
    if (status !== STATUS.playing) {
      setStatus(STATUS.playing);
    }
    recoveryAttemptsRef.current = 0;
  }, [clearTimer, status]);

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
    meta,
    waitKey,
    lastFetchAt,
    shouldRenderOverlay
  }), [status, waitingToPlay, isOverlayVisible, showPauseOverlay, showDebug, computedStalled, seconds, isPaused, isSeeking, meta, waitKey, lastFetchAt, shouldRenderOverlay]);
  const stateRef = useLatest(state);

  useEffect(() => {
    if (typeof onStateChange === 'function') {
      onStateChange(state);
    }
  }, [onStateChange, state]);

  const controller = useMemo(() => ({
    reset: () => {
      resetDetectionState();
      setStatus(STATUS.pending);
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
  }), [fetchVideoInfoRef, markHealthy, meta, overlayConfig.revealDelayMs, onReloadRef, recordSeekIntentMs, recordSeekIntentSeconds, resetDetectionState, togglePauseOverlay, triggerRecovery, resolveSeekIntentMs, waitKey, stateRef]);

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
  const countUpDisplay = String(overlayElapsedSeconds).padStart(2, '0');
  const intentMsForDisplay = resolveSeekIntentMs();
  const intentSecondsForDisplay = Number.isFinite(intentMsForDisplay) ? intentMsForDisplay / 1000 : null;
  const playerPositionDisplay = formatTime(Math.max(0, seconds));
  const intentPositionDisplay = Number.isFinite(intentSecondsForDisplay)
    ? formatTime(Math.max(0, intentSecondsForDisplay))
    : null;
  const overlayProps = {
    status,
    isVisible: isOverlayVisible && shouldRenderOverlay,
    shouldRender: shouldRenderOverlay,
    waitingToPlay,
    isPaused,
    pauseOverlayActive,
    seconds,
    stalled: computedStalled,
    showPauseOverlay,
    showDebug,
    initialStart,
    message,
    getMediaEl,
    plexId: resolvedPlexId,
    debugContext,
    lastProgressTs: lastProgressTsRef.current,
    togglePauseOverlay,
    explicitShow,
    isSeeking,
    countUpSeconds: overlayElapsedSeconds,
    countUpDisplay,
    playerPositionDisplay,
    intentPositionDisplay
  };

  return { overlayProps, controller, state };
}
