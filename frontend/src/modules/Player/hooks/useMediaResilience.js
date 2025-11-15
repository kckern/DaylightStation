import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const noop = () => {};
const defaultReload = () => {
  try {
    if (typeof window !== 'undefined' && typeof window.location?.reload === 'function') {
      window.location.reload();
    }
  } catch (_) {
    // no-op
  }
};

let pauseOverlayPreference = true;

export const DEFAULT_MEDIA_RESILIENCE_CONFIG = {
  // Visual overlay behavior such as fade-in timing and pause overlay controls.
  overlay: {
    // Delay (ms) before the spinner / pause overlay fades in to avoid flash-of-overlay.
    revealDelayMs: 300,
    // Keyboard shortcuts that toggle the persistent pause overlay visibility.
    pauseToggleKeys: ['ArrowUp', 'ArrowDown'],
    // Whether we render the pause overlay while media is paused.
    showPausedOverlay: true
  },
  // Debug info visibility timings.
  debug: {
    // Delay (ms) before we expose the diagnostic panel during stalled startup.
    revealDelayMs: 5000
  },
  // Background fetch cadence for refreshing media metadata / manifests while loading.
  fetchInfo: {
    // Interval (ms) between checks while loading.
    intervalMs: 1000,
    // Threshold (seconds) of continuous loading before triggering fetchVideoInfo.
    thresholdSeconds: 10
  },
  // Logic for waiting on playback readiness events from the media element.
  waitForPlayback: {
    // Grace window (ms) before we consider the wait a stall.
    gracePeriodMs: 500,
    // Poll interval (ms) for locating the media element if it is not yet attached.
    attachPollMs: 100,
    // DOM events that mark playback as started / healthy.
    startEvents: ['canplay', 'play', 'playing'],
    // DOM events that mark playback as failed.
    failEvents: ['error']
  },
  // Automatic reload / recovery behavior when the player appears stuck.
  reload: {
    // Master switch for automatic reloads.
    enabled: true,
    // Time (ms) before reloading once a stall is detected.
    stallMs: 5000,
    // When true we only reload during startup (seconds === 0); false allows mid-play reloads.
    onlyDuringStartup: true
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

export function useMediaResilience({
  getMediaEl,
  meta = {},
  seconds = 0,
  isPaused = false,
  isSeeking = false,
  initialStart = 0,
  waitForPlaybackStart = false,
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

  const [isOverlayVisible, setOverlayVisible] = useState(!mergedConfig.overlay?.revealDelayMs);
  const [showPauseOverlay, setShowPauseOverlay] = useState(pauseOverlayPreference);
  const [showDebug, setShowDebug] = useState(false);
  const [loadingSeconds, setLoadingSeconds] = useState(0);
  const [waitingForPlayback, setWaitingForPlayback] = useState(!!waitForPlaybackStart);
  const [graceElapsed, setGraceElapsed] = useState(!waitForPlaybackStart);
  const [lastFetchAt, setLastFetchAt] = useState(null);

  const listenerCleanupRef = useRef(noop);
  const attachIntervalRef = useRef(null);
  const reloadTimeoutRef = useRef(null);

  useEffect(() => {
    setOverlayVisible(!mergedConfig.overlay?.revealDelayMs);
    if (!mergedConfig.overlay?.revealDelayMs) return;
    const timeout = setTimeout(() => setOverlayVisible(true), mergedConfig.overlay.revealDelayMs);
    return () => clearTimeout(timeout);
  }, [waitKey, mergedConfig.overlay?.revealDelayMs]);

  useEffect(() => {
    setShowPauseOverlay(pauseOverlayPreference);
  }, [waitKey]);

  useEffect(() => {
    if (typeof window === 'undefined' || !isPaused) return () => {};
    const handleKeyDown = (event) => {
      if (!mergedConfig.overlay?.pauseToggleKeys?.length) return;
      if (mergedConfig.overlay.pauseToggleKeys.includes(event.key)) {
        event.preventDefault();
        setShowPauseOverlay((prev) => {
          const next = !prev;
          pauseOverlayPreference = next;
          return next;
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPaused, mergedConfig.overlay?.pauseToggleKeys]);

  useEffect(() => {
    setWaitingForPlayback(!!waitForPlaybackStart);
    setGraceElapsed(!waitForPlaybackStart);
  }, [waitForPlaybackStart, waitKey]);

  useEffect(() => {
    if (!waitForPlaybackStart) {
      listenerCleanupRef.current?.();
      if (attachIntervalRef.current) {
        clearInterval(attachIntervalRef.current);
        attachIntervalRef.current = null;
      }
      return () => {};
    }

    setWaitingForPlayback(true);
    setGraceElapsed(false);

    const graceTimer = setTimeout(() => setGraceElapsed(true), mergedConfig.waitForPlayback?.gracePeriodMs || 0);

    const markStarted = () => {
      setWaitingForPlayback(false);
      setGraceElapsed(true);
    };
    const markFailed = () => {
      setGraceElapsed(true);
    };

    const attachListeners = () => {
      const el = typeof getMediaEl === 'function' ? getMediaEl() : null;
      if (!el) return false;
      mergedConfig.waitForPlayback?.startEvents?.forEach((eventName) => {
        el.addEventListener(eventName, markStarted, { once: false });
      });
      mergedConfig.waitForPlayback?.failEvents?.forEach((eventName) => {
        el.addEventListener(eventName, markFailed, { once: false });
      });
      listenerCleanupRef.current = () => {
        mergedConfig.waitForPlayback?.startEvents?.forEach((eventName) => {
          el.removeEventListener(eventName, markStarted);
        });
        mergedConfig.waitForPlayback?.failEvents?.forEach((eventName) => {
          el.removeEventListener(eventName, markFailed);
        });
      };
      return true;
    };

    const attached = attachListeners();
    if (!attached) {
      const pollInterval = mergedConfig.waitForPlayback?.attachPollMs ?? 100;
      attachIntervalRef.current = setInterval(() => {
        if (attachListeners()) {
          clearInterval(attachIntervalRef.current);
          attachIntervalRef.current = null;
        }
      }, pollInterval);
    }

    return () => {
      clearTimeout(graceTimer);
      listenerCleanupRef.current?.();
      if (attachIntervalRef.current) {
        clearInterval(attachIntervalRef.current);
        attachIntervalRef.current = null;
      }
    };
  }, [waitForPlaybackStart, waitKey, getMediaEl, mergedConfig.waitForPlayback]);

  const fetchVideoInfoRef = useLatest(fetchVideoInfo);
  const onReloadRef = useLatest(onReload);
  const waitingToPlay = waitForPlaybackStart && waitingForPlayback && graceElapsed;

  useEffect(() => {
    if (!fetchVideoInfoRef.current) {
      setLoadingSeconds(0);
      return () => {};
    }
    if (isPaused) {
      setLoadingSeconds(0);
      return () => {};
    }
    const intervalMs = mergedConfig.fetchInfo?.intervalMs ?? 1000;
    const thresholdSeconds = mergedConfig.fetchInfo?.thresholdSeconds ?? 10;
    let accumulatedMs = 0;
    const interval = setInterval(() => {
      setLoadingSeconds((prev) => prev + intervalMs / 1000);
      accumulatedMs += intervalMs;
      if (accumulatedMs >= thresholdSeconds * 1000) {
        accumulatedMs = 0;
        fetchVideoInfoRef.current?.({ reason: 'loading-threshold', meta, waitKey });
        setLastFetchAt(Date.now());
        setLoadingSeconds(0);
      }
    }, intervalMs);
    return () => clearInterval(interval);
  }, [isPaused, waitKey, mergedConfig.fetchInfo?.intervalMs, mergedConfig.fetchInfo?.thresholdSeconds, fetchVideoInfoRef, meta]);

  useEffect(() => {
    if (isPaused) {
      setShowDebug(false);
      return () => {};
    }
    if (!(explicitShow || (waitForPlaybackStart && waitingForPlayback)) || seconds !== 0) {
      setShowDebug(false);
      return () => {};
    }
    const timeout = setTimeout(() => setShowDebug(true), mergedConfig.debug?.revealDelayMs ?? 3000);
    return () => clearTimeout(timeout);
  }, [explicitShow, waitForPlaybackStart, waitingForPlayback, seconds, isPaused, mergedConfig.debug?.revealDelayMs]);

  const shouldRenderOverlay = waitingToPlay || explicitShow || (isPaused && mergedConfig.overlay?.showPausedOverlay && showPauseOverlay);

  useEffect(() => {
    if (!mergedConfig.reload?.enabled) return () => {};
    const shouldSchedule = waitingToPlay && (!mergedConfig.reload?.onlyDuringStartup || seconds === 0) && !isPaused;
    if (!shouldSchedule) {
      if (reloadTimeoutRef.current) {
        clearTimeout(reloadTimeoutRef.current);
        reloadTimeoutRef.current = null;
      }
      return () => {};
    }
    reloadTimeoutRef.current = setTimeout(() => {
      onReloadRef.current?.({ reason: 'stall-timeout', meta, waitKey });
    }, mergedConfig.reload?.stallMs ?? 5000);
    return () => {
      if (reloadTimeoutRef.current) {
        clearTimeout(reloadTimeoutRef.current);
        reloadTimeoutRef.current = null;
      }
    };
  }, [waitingToPlay, seconds, isPaused, mergedConfig.reload, waitKey, meta, onReloadRef]);

  const stalled = typeof stalledOverride === 'boolean'
    ? stalledOverride
    : (waitingToPlay && (!mergedConfig.reload?.onlyDuringStartup || seconds === 0) && !isPaused);

  const togglePauseOverlay = useCallback(() => {
    setShowPauseOverlay((prev) => {
      const next = !prev;
      pauseOverlayPreference = next;
      return next;
    });
  }, []);

  const markHealthy = useCallback(() => {
    setWaitingForPlayback(false);
    setGraceElapsed(true);
    if (reloadTimeoutRef.current) {
      clearTimeout(reloadTimeoutRef.current);
      reloadTimeoutRef.current = null;
    }
  }, []);

  const state = useMemo(() => ({
    waitingToPlay,
    waitingForPlayback,
    graceElapsed,
    isOverlayVisible,
    showPauseOverlay,
    showDebug,
    loadingSeconds,
    stalled,
    seconds,
    isPaused,
    isSeeking,
    meta,
    waitKey,
    lastFetchAt,
    shouldRenderOverlay
  }), [waitingToPlay, waitingForPlayback, graceElapsed, isOverlayVisible, showPauseOverlay, showDebug, loadingSeconds, stalled, seconds, isPaused, isSeeking, meta, waitKey, lastFetchAt, shouldRenderOverlay]);

  const stateRef = useLatest(state);

  useEffect(() => {
    if (typeof onStateChange === 'function') {
      onStateChange(state);
    }
  }, [state, onStateChange]);

  const controller = useMemo(() => ({
    reset: () => {
      setWaitingForPlayback(!!waitForPlaybackStart);
      setGraceElapsed(!waitForPlaybackStart);
      setOverlayVisible(!mergedConfig.overlay?.revealDelayMs);
      setShowDebug(false);
      setLoadingSeconds(0);
    },
    forceReload: (options = {}) => {
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
  }), [waitForPlaybackStart, mergedConfig.overlay?.revealDelayMs, markHealthy, fetchVideoInfoRef, meta, waitKey, onReloadRef, stateRef]);

  useEffect(() => {
    if (!controllerRef) return () => {};
    controllerRef.current = controller;
    return () => {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [controllerRef, controller]);

  const resolvedPlexId = plexId || meta?.media_key || meta?.key || meta?.plex || null;
  const overlayProps = {
    isVisible: isOverlayVisible && shouldRenderOverlay,
    shouldRender: shouldRenderOverlay,
    waitingToPlay,
    graceElapsed,
    isPaused,
    seconds,
    stalled,
    showPauseOverlay,
    showDebug,
    initialStart,
    message,
    getMediaEl,
    plexId: resolvedPlexId,
    debugContext,
    togglePauseOverlay,
    explicitShow,
    isSeeking
  };

  return { overlayProps, controller, state };
}
