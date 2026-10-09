import { useCallback, useMemo, useSyncExternalStore } from 'react';

const DEFAULT_SESSION_KEY = 'global-playback-session';
const sessionStore = new Map();
const listenerStore = new Map();

const sanitizeSeconds = (value) => {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, parsed);
};

const sanitizeVolume = (value) => {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(1, Math.max(0, parsed));
};

const sanitizePlaybackRate = (value) => {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed > 0 ? parsed : null;
};

const ensureSession = (key, defaults = {}) => {
  const resolvedKey = key || DEFAULT_SESSION_KEY;
  if (!sessionStore.has(resolvedKey)) {
    sessionStore.set(resolvedKey, {
      targetTimeSeconds: sanitizeSeconds(defaults.targetTimeSeconds ?? null),
      volume: sanitizeVolume(defaults.volume ?? null),
      playbackRate: sanitizePlaybackRate(defaults.playbackRate ?? null),
      version: 0
    });
  }
  return sessionStore.get(resolvedKey);
};

const emit = (key) => {
  const listeners = listenerStore.get(key) || null;
  if (!listeners) return;
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (_) {}
  });
};

const subscribeToKey = (key) => {
  let listeners = listenerStore.get(key);
  if (!listeners) {
    listeners = new Set();
    listenerStore.set(key, listeners);
  }
  return (callback) => {
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
      if (!listeners.size) {
        listenerStore.delete(key);
      }
    };
  };
};

const updateSession = (key, updater, defaults = {}) => {
  const resolvedKey = key || DEFAULT_SESSION_KEY;
  const current = ensureSession(resolvedKey, defaults);
  const patch = typeof updater === 'function' ? updater(current) : updater;
  if (!patch || typeof patch !== 'object') {
    return current;
  }

  const sanitizedPatch = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'targetTimeSeconds')) {
    sanitizedPatch.targetTimeSeconds = sanitizeSeconds(patch.targetTimeSeconds);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'volume')) {
    sanitizedPatch.volume = sanitizeVolume(patch.volume);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'playbackRate')) {
    sanitizedPatch.playbackRate = sanitizePlaybackRate(patch.playbackRate);
  }

  if (!Object.keys(sanitizedPatch).length) {
    return current;
  }

  const nextCandidate = {
    targetTimeSeconds: Object.prototype.hasOwnProperty.call(sanitizedPatch, 'targetTimeSeconds')
      ? sanitizedPatch.targetTimeSeconds
      : current.targetTimeSeconds,
    volume: Object.prototype.hasOwnProperty.call(sanitizedPatch, 'volume')
      ? sanitizedPatch.volume
      : current.volume,
    playbackRate: Object.prototype.hasOwnProperty.call(sanitizedPatch, 'playbackRate')
      ? sanitizedPatch.playbackRate
      : current.playbackRate
  };

  const changed =
    nextCandidate.targetTimeSeconds !== current.targetTimeSeconds
    || nextCandidate.volume !== current.volume
    || nextCandidate.playbackRate !== current.playbackRate;

  if (!changed) {
    return current;
  }

  const nextState = {
    ...nextCandidate,
    version: (current.version || 0) + 1
  };
  sessionStore.set(resolvedKey, nextState);
  emit(resolvedKey);
  return nextState;
};

export function usePlaybackSession({ sessionKey, defaults = {} } = {}) {
  const normalizedDefaults = useMemo(() => ({
    targetTimeSeconds: sanitizeSeconds(defaults?.targetTimeSeconds ?? null),
    volume: sanitizeVolume(defaults?.volume ?? null),
    playbackRate: sanitizePlaybackRate(defaults?.playbackRate ?? null)
  }), [defaults?.targetTimeSeconds, defaults?.volume, defaults?.playbackRate]);

  const resolvedKey = useMemo(() => (
    sessionKey ? String(sessionKey) : DEFAULT_SESSION_KEY
  ), [sessionKey]);

  const subscribe = useMemo(() => {
    ensureSession(resolvedKey, normalizedDefaults);
    const attach = subscribeToKey(resolvedKey);
    return (callback) => attach(callback);
  }, [resolvedKey, normalizedDefaults]);

  const getSnapshot = useCallback(
    () => ensureSession(resolvedKey, normalizedDefaults),
    [resolvedKey, normalizedDefaults]
  );

  const session = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setTargetTimeSeconds = useCallback((value) => {
    updateSession(resolvedKey, { targetTimeSeconds: value }, normalizedDefaults);
  }, [resolvedKey, normalizedDefaults]);

  const consumeTargetTimeSeconds = useCallback(() => {
    updateSession(resolvedKey, (current) => (
      current.targetTimeSeconds == null
        ? null
        : { targetTimeSeconds: null }
    ), normalizedDefaults);
  }, [resolvedKey, normalizedDefaults]);

  const setVolume = useCallback((value) => {
    updateSession(resolvedKey, { volume: value }, normalizedDefaults);
  }, [resolvedKey, normalizedDefaults]);

  const setPlaybackRate = useCallback((value) => {
    updateSession(resolvedKey, { playbackRate: value }, normalizedDefaults);
  }, [resolvedKey, normalizedDefaults]);

  const resetSession = useCallback(() => {
    updateSession(resolvedKey, {
      targetTimeSeconds: normalizedDefaults.targetTimeSeconds ?? null,
      volume: normalizedDefaults.volume ?? null,
      playbackRate: normalizedDefaults.playbackRate ?? null
    }, normalizedDefaults);
  }, [resolvedKey, normalizedDefaults]);

  return {
    sessionKey: resolvedKey,
    targetTimeSeconds: session.targetTimeSeconds,
    volume: session.volume,
    playbackRate: session.playbackRate,
    setTargetTimeSeconds,
    consumeTargetTimeSeconds,
    setVolume,
    setPlaybackRate,
    resetSession
  };
}
