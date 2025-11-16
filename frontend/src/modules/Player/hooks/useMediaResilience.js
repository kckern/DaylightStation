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
    showPausedOverlay: true, // whether to show overlay while paused
    showMidPlayStall: true // allow overlay during mid-play stalls
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

const useLatest = (value) => {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
};

const coerceNumber = (value, fallback) => (Number.isFinite(value) ? value : fallback);

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
  const mergedConfig = useMemo(
    () => mergeConfigs(DEFAULT_MEDIA_RESILIENCE_CONFIG, contextConfig, configOverrides, runtimeOverrides),
    [contextConfig, configOverrides, runtimeOverrides]
  );

  const monitorConfig = mergedConfig.monitor || {};
  const epsilonSeconds = coerceNumber(monitorConfig.progressEpsilonSeconds, 0.25);
  const stallDetectionThresholdMs = coerceNumber(monitorConfig.stallDetectionThresholdMs, 500);
  const hardRecoverAfterStalledForMs = coerceNumber(monitorConfig.hardRecoverAfterStalledForMs, 6000);

  const recoveryConfig = useMemo(() => {
    const legacyReload = mergedConfig.reload || {};
    const cfg = mergedConfig.recovery || {};
    return {
      enabled: cfg.enabled ?? legacyReload.enabled ?? true,
      reloadDelayMs: coerceNumber(cfg.reloadDelayMs ?? legacyReload.stallMs, 0),
      cooldownMs: coerceNumber(cfg.cooldownMs ?? legacyReload.cooldownMs, 4000),
      maxAttempts: coerceNumber(cfg.maxAttempts ?? legacyReload.maxAttempts, 2)
    };
  }, [mergedConfig.recovery, mergedConfig.reload]);

  const [isOverlayVisible, setOverlayVisible] = useState(!mergedConfig.overlay?.revealDelayMs);
  const [showPauseOverlay, setShowPauseOverlay] = useState(pauseOverlayPreference);
  const [showDebug, setShowDebug] = useState(false);
  const [status, setStatus] = useState(STATUS.pending);
  const [lastFetchAt, setLastFetchAt] = useState(null);
  const [overlayElapsedMs, setOverlayElapsedMs] = useState(0);

  const fetchVideoInfoRef = useLatest(fetchVideoInfo);
  const onReloadRef = useLatest(onReload);
  const statusRef = useLatest(status);
  const isPausedRef = useRef(isPaused);
  const lastProgressTsRef = useRef(null);
  const lastProgressSecondsRef = useRef(null);
  const stallTimerRef = useRef(null);
  const reloadTimerRef = useRef(null);
  const overlayTimerRef = useRef(null);
  const hardRecoveryTimerRef = useRef(null);
  const lastReloadAtRef = useRef(0);
  const recoveryAttemptsRef = useRef(0);
  const overlayAlertedRef = useRef(false);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    setOverlayVisible(!mergedConfig.overlay?.revealDelayMs);
    if (!mergedConfig.overlay?.revealDelayMs) return;
    const timeout = setTimeout(() => setOverlayVisible(true), mergedConfig.overlay.revealDelayMs);
    return () => clearTimeout(timeout);
  }, [waitKey, mergedConfig.overlay?.revealDelayMs]);

  useEffect(() => {
    setShowPauseOverlay(pauseOverlayPreference);
  }, [waitKey]);

  const clearTimer = useCallback((ref) => {
    if (ref.current) {
      clearTimeout(ref.current);
      ref.current = null;
    }
  }, []);

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

  const triggerRecovery = useCallback((reason, { ignorePaused = false } = {}) => {
    if (!recoveryConfig.enabled) return;
    if (!ignorePaused && isPausedRef.current && statusRef.current === STATUS.paused) return;
    if (recoveryConfig.maxAttempts && recoveryAttemptsRef.current >= recoveryConfig.maxAttempts) return;
    const now = Date.now();
    if (recoveryConfig.cooldownMs && now - (lastReloadAtRef.current || 0) < recoveryConfig.cooldownMs) return;

    const performReload = () => {
      lastReloadAtRef.current = Date.now();
      recoveryAttemptsRef.current += 1;
      setStatus(STATUS.recovering);
      onReloadRef.current?.({ reason, meta, waitKey });
    };

    if (recoveryConfig.reloadDelayMs > 0) {
      clearTimer(reloadTimerRef);
      reloadTimerRef.current = setTimeout(performReload, recoveryConfig.reloadDelayMs);
    } else {
      performReload();
    }
  }, [meta, onReloadRef, recoveryConfig, waitKey, clearTimer]);

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
    const timeout = setTimeout(() => setShowDebug(true), mergedConfig.debug?.revealDelayMs ?? 3000);
    return () => clearTimeout(timeout);
  }, [explicitShow, isPaused, mergedConfig.debug?.revealDelayMs, status]);

  const waitingToPlay = status === STATUS.pending || status === STATUS.recovering;
  const hasStartedPlayback = (lastProgressSecondsRef.current ?? 0) > epsilonSeconds;
  const computedStalled = typeof stalledOverride === 'boolean'
    ? stalledOverride
    : (status === STATUS.stalling || status === STATUS.recovering);
  const midPlayStalled = computedStalled && hasStartedPlayback;
  const allowMidPlayOverlay = mergedConfig.overlay?.showMidPlayStall !== false;
  const stallOverlayActive = computedStalled && (!midPlayStalled || allowMidPlayOverlay);

  const shouldRenderOverlay = waitingToPlay
    || stallOverlayActive
    || explicitShow
    || (isPaused && mergedConfig.overlay?.showPausedOverlay && showPauseOverlay);

  const overlayActive = shouldRenderOverlay && isOverlayVisible;

  useEffect(() => {
    if (!overlayActive) {
      setOverlayElapsedMs(0);
      overlayAlertedRef.current = false;
      if (overlayTimerRef.current) {
        clearInterval(overlayTimerRef.current);
        overlayTimerRef.current = null;
      }
      return () => {};
    }

    setOverlayElapsedMs(0);
    const startTs = Date.now();
    overlayTimerRef.current = setInterval(() => {
      setOverlayElapsedMs(Date.now() - startTs);
    }, 1000);

    return () => {
      if (overlayTimerRef.current) {
        clearInterval(overlayTimerRef.current);
        overlayTimerRef.current = null;
      }
    };
  }, [overlayActive]);

  const overlayStallDeadlineMs = hardRecoverAfterStalledForMs > 0 ? hardRecoverAfterStalledForMs : 6000;

  useEffect(() => {
    if (!overlayActive) return;
    if (overlayElapsedMs >= overlayStallDeadlineMs && !overlayAlertedRef.current) {
      overlayAlertedRef.current = true;
      triggerRecovery('overlay-hard-recovery', { ignorePaused: true });
    }
  }, [overlayActive, overlayElapsedMs, overlayStallDeadlineMs, triggerRecovery]);

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
    midPlayStalled,
    seconds,
    isPaused,
    isSeeking,
    meta,
    waitKey,
    lastFetchAt,
    shouldRenderOverlay
  }), [status, waitingToPlay, isOverlayVisible, showPauseOverlay, showDebug, computedStalled, midPlayStalled, seconds, isPaused, isSeeking, meta, waitKey, lastFetchAt, shouldRenderOverlay]);
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
      setOverlayVisible(!mergedConfig.overlay?.revealDelayMs);
      setShowDebug(false);
    },
    forceReload: (options = {}) => {
      triggerRecovery('manual');
      onReloadRef.current?.({ reason: 'manual', meta, waitKey, ...options });
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
    togglePauseOverlay
  }), [fetchVideoInfoRef, markHealthy, meta, mergedConfig.overlay?.revealDelayMs, onReloadRef, resetDetectionState, togglePauseOverlay, triggerRecovery, waitKey]);

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
  const overlayElapsedSeconds = Math.max(0, Math.floor(overlayElapsedMs / 1000));
  const countUpDisplay = String(overlayElapsedSeconds).padStart(2, '0');
  const playerPositionDisplay = formatTime(Math.max(0, seconds));
  const overlayProps = {
    status,
    isVisible: isOverlayVisible && shouldRenderOverlay,
    shouldRender: shouldRenderOverlay,
    waitingToPlay,
    isPaused,
    seconds,
    stalled: computedStalled,
    midPlayStalled,
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
    playerPositionDisplay
  };

  return { overlayProps, controller, state };
}
