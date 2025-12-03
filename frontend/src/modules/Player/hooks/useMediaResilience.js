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
  startup: RESILIENCE_STATUS.startup,
  pending: RESILIENCE_STATUS.startup,
  playing: RESILIENCE_STATUS.playing,
  paused: RESILIENCE_STATUS.paused,
  stalling: RESILIENCE_STATUS.stalling,
  recovering: RESILIENCE_STATUS.recovering,
  fatal: RESILIENCE_STATUS.recoveringFatal
};

const USER_INTENT = Object.freeze({
  playing: 'playing',
  paused: 'paused',
  seeking: 'seeking'
});

const SYSTEM_HEALTH = Object.freeze({
  ok: 'ok',
  buffering: 'buffering',
  stalled: 'stalled',
  fatal: 'fatal'
});

const DECODER_NUDGE_MIN_BUFFER_MS = 8000;
const DECODER_NUDGE_COOLDOWN_MS = 3000;
const DECODER_NUDGE_GRACE_MS = 2000;
const BITRATE_REDUCTION_FACTOR = 0.9;
const DEFAULT_FALLBACK_MAX_VIDEO_BITRATE = 2000;
const MIN_MAX_VIDEO_BITRATE = 300;
const HARD_RESET_MAX_ATTEMPTS = 10;
const HARD_RESET_MIN_DELAY_MS = 1000;
const HARD_RESET_DELAY_MULTIPLIER = 1.5;

const deriveDroppedRatio = (decoderMetrics = null) => {
  if (!decoderMetrics) return null;
  const { droppedFrames, totalFrames } = decoderMetrics;
  if (!Number.isFinite(totalFrames) || totalFrames <= 0) {
    return null;
  }
  const dropped = Number.isFinite(droppedFrames) ? droppedFrames : 0;
  return Math.max(0, dropped) / totalFrames;
};

const summarizeDiagnosticsForLog = (diagnostics = null) => {
  if (!diagnostics) {
    return null;
  }
  const buffer = diagnostics.buffer || {};
  const decoder = diagnostics.decoder || {};
  return {
    bufferAheadSeconds: buffer.bufferAheadSeconds ?? null,
    bufferGapSeconds: buffer.bufferGapSeconds ?? null,
    nextBufferStartSeconds: buffer.nextBufferStartSeconds ?? null,
    droppedFrames: decoder.droppedFrames ?? null,
    totalFrames: decoder.totalFrames ?? null,
    readyState: diagnostics.readyState ?? null,
    networkState: diagnostics.networkState ?? null
  };
};

const useLatest = (value) => {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
};


function useUserIntentControls({ isPaused, isSeeking, pauseIntent }) {
  const computeInitialIntent = () => {
    if (isSeeking) return USER_INTENT.seeking;
    if (isPaused && pauseIntent !== 'system') return USER_INTENT.paused;
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
  maxVideoBitrate: maxVideoBitrateProp = null,
  seconds = 0,
  isPaused = false,
  isSeeking = false,
  pauseIntent = null,
  playbackDiagnostics = null,
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
  threadId = null,
  nudgePlayback = null,
  diagnosticsProvider = null
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
    hardRecoverLoadingGraceMs,
    hardRecoverAttemptBackoffMs,
    mountTimeoutMs,
    mountPollIntervalMs,
    mountMaxAttempts,
    startupTimeoutMs,
    startupMaxAttempts
  } = monitorSettings;

  const [showDebug, setShowDebug] = useState(false);
  const {
    userIntent,
    userIntentRef,
    explicitPauseActive,
    explicitPauseRef,
    updateExplicitPauseState,
    setUserIntent
  } = useUserIntentControls({ isPaused, isSeeking, pauseIntent });
  const {
    state: resilienceState,
    status,
    statusRef,
    actions: resilienceActions
  } = useResilienceState(STATUS.pending);
  const [lastFetchAt, setLastFetchAt] = useState(null);
  const [hardResetLoopCount, setHardResetLoopCount] = useState(0);
  const hardResetLoopCountRef = useLatest(hardResetLoopCount);
  const hardResetLimitLoggedRef = useRef(false);
  const [fatalErrorState, setFatalErrorState] = useState(null);
  const fatalErrorRef = useRef(null);
  const [loadingIntentState, setLoadingIntentState] = useState(() => ({ active: true, token: 0 }));
  const loadingIntentActive = loadingIntentState.active;
  const loadingIntentToken = loadingIntentState.token;
  const markLoadingIntentActive = useCallback(() => {
    setLoadingIntentState((prev) => ({
      active: true,
      token: prev.token + 1
    }));
  }, []);
  const resolveLoadingIntent = useCallback(() => {
    setLoadingIntentState((prev) => {
      if (!prev.active) return prev;
      return { ...prev, active: false };
    });
  }, []);
  const effectiveHardRecoverAfterStalledForMs = useMemo(() => {
    if (!Number.isFinite(hardRecoverAfterStalledForMs)) {
      return hardRecoverAfterStalledForMs;
    }
    const recoveryBaseMs = Math.max(0, hardRecoverAfterStalledForMs);
    const perLoopBackoffMs = Number.isFinite(hardRecoverAttemptBackoffMs)
      ? Math.max(0, hardRecoverAttemptBackoffMs)
      : 0;
    const loopsBeyondFirst = Math.max(0, hardResetLoopCount - 1);
    return recoveryBaseMs + (loopsBeyondFirst * perLoopBackoffMs);
  }, [
    hardRecoverAfterStalledForMs,
    hardRecoverAttemptBackoffMs,
    hardResetLoopCount
  ]);
  const effectiveLoadingGraceMs = useMemo(() => {
    if (!Number.isFinite(hardRecoverLoadingGraceMs)) {
      return hardRecoverLoadingGraceMs;
    }
    return Math.max(0, hardRecoverLoadingGraceMs);
  }, [hardRecoverLoadingGraceMs]);

  const resolveInitialMaxVideoBitrate = useCallback(() => {
    const explicit = Number(maxVideoBitrateProp);
    if (Number.isFinite(explicit) && explicit > 0) {
      return Math.max(MIN_MAX_VIDEO_BITRATE, Math.round(explicit));
    }
    const metaValue = Number(meta?.maxVideoBitrate);
    if (Number.isFinite(metaValue) && metaValue > 0) {
      return Math.max(MIN_MAX_VIDEO_BITRATE, Math.round(metaValue));
    }
    return Math.max(MIN_MAX_VIDEO_BITRATE, DEFAULT_FALLBACK_MAX_VIDEO_BITRATE);
  }, [maxVideoBitrateProp, meta?.maxVideoBitrate]);

  const [bitrateState, setBitrateState] = useState(() => {
    const baseline = resolveInitialMaxVideoBitrate();
    return {
      waitKeySnapshot: waitKey,
      current: baseline,
      lastSyncedBaseline: baseline,
      lastOverrideTag: null,
      lastOverrideReason: null,
      lastOverrideSource: null,
      lastOverrideAt: null
    };
  });
  const bitrateStateRef = useLatest(bitrateState);

  useEffect(() => {
    const baseline = resolveInitialMaxVideoBitrate();
    setBitrateState((prev) => {
      const waitKeyChanged = prev.waitKeySnapshot !== waitKey;
      const baselineChanged = Math.abs((prev.lastSyncedBaseline ?? baseline) - baseline) >= 1;
      if (!waitKeyChanged && !baselineChanged) {
        return prev;
      }
      return {
        waitKeySnapshot: waitKey,
        current: baseline,
        lastSyncedBaseline: baseline,
        lastOverrideTag: null,
        lastOverrideReason: null,
        lastOverrideSource: null,
        lastOverrideAt: null
      };
    });
  }, [waitKey, resolveInitialMaxVideoBitrate]);

  const fetchVideoInfoRef = useLatest(fetchVideoInfo);
  const onReloadRef = useLatest(onReload);
  const nudgePlaybackRef = useLatest(typeof nudgePlayback === 'function' ? nudgePlayback : null);
  const playbackDiagnosticsRef = useLatest(playbackDiagnostics);
  const diagnosticsProviderRef = useLatest(typeof diagnosticsProvider === 'function' ? diagnosticsProvider : null);
  const lastProgressTsRef = useRef(null);
  const lastProgressSecondsRef = useRef(null);
  const lastLoggedProgressRef = useRef(0);
  const lastKnownSeekIntentMsRef = useRef(Number.isFinite(initialStart) && initialStart > 0
    ? Math.max(0, initialStart * 1000)
    : null);
  const recoveryBudgetRef = useRef({
    key: null,
    windowStartedAt: 0,
    attempts: 0,
    lockUntil: 0,
    consecutiveAttempts: 0,
    lastAttemptAt: 0
  });
  const recoveryLockTimerRef = useRef(null);
  const stallTimerRef = useRef(null);
  const reloadTimerRef = useRef(null);
  const hardRecoveryTimerRef = useRef(null);
  const loadingRecoveryTimerRef = useRef(null);
  const startupTimeoutRef = useRef(null);
  const startupAttemptsRef = useRef(0);
  const startupSignalsRef = useRef({
    lastType: null,
    lastTimestamp: null,
    attachedAt: null,
    detachedAt: null,
    loadedMetadataAt: null,
    playingAt: null,
    progressAt: null,
    detail: null
  });
  const [startupSignalVersion, setStartupSignalVersion] = useState(0);
  const [internalStartupWatchdogState, setInternalStartupWatchdogState] = useState(() => ({
    active: false,
    state: 'idle',
    reason: null,
    attempts: 0,
    timeoutMs: startupTimeoutMs || null,
    timestamp: null
  }));
  const lastReloadAtRef = useRef(0);
  const mediaIdentity = meta?.media_key || meta?.key || meta?.plex || meta?.id || meta?.guid || meta?.media_url || null;
  const metaGuid = meta?.guid || null;
  const metaMediaKey = meta?.media_key || null;
  const metaPlex = meta?.plex || null;
  const metaId = meta?.id || null;
  const metaKey = meta?.key || null;
  const mediaIdentityRef = useRef(mediaIdentity);
  const logWaitKey = useMemo(() => getLogWaitKey(waitKey), [waitKey]);
  const recoveryIdentityKey = useMemo(() => {
    const identitySeed = mediaIdentity || metaMediaKey || metaPlex || null;
    const guidSeed = metaGuid || metaId || metaKey || playbackSessionKey || null;
    return `${identitySeed || 'media'}:${guidSeed || 'session'}`;
  }, [mediaIdentity, metaMediaKey, metaPlex, metaGuid, metaId, metaKey, playbackSessionKey]);
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
  const decoderNudgeStateRef = useRef({ lastRequestedAt: 0, inflight: false, graceUntil: 0 });
  const stallInsightsRef = useRef({ classification: 'unknown', lastLoggedAt: 0, lastMitigationAt: 0 });
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


  const getRecoveryBudgetSnapshot = useCallback(() => {
    const state = recoveryBudgetRef.current;
    if (!state) {
      return null;
    }
    const remainingMs = state.lockUntil ? Math.max(0, state.lockUntil - Date.now()) : null;
    return {
      key: state.key,
      windowStartedAt: state.windowStartedAt,
      attempts: state.attempts,
      lockUntil: state.lockUntil,
      lockRemainingMs: remainingMs,
      consecutiveAttempts: state.consecutiveAttempts,
      lastAttemptAt: state.lastAttemptAt
    };
  }, []);

  const logResilienceEvent = useCallback((event, details = {}, options = {}) => {
    const context = logContextRef.current || {};
    const { level: detailLevel, tags: detailTags, ...restDetails } = details || {};
    const resolvedOptions = typeof options === 'object' && options !== null ? options : {};
    const resolvedLevel = resolvedOptions.level || detailLevel || 'debug';
    const combinedTags = detailTags || resolvedOptions.tags;
    const snapshot = getRecoveryBudgetSnapshot();
    const payloadDetails = snapshot && !Object.prototype.hasOwnProperty.call(restDetails, 'recoveryBudgetState')
      ? { ...restDetails, recoveryBudgetState: snapshot }
      : restDetails;
    playbackLog('media-resilience', {
      event,
      ...context,
      ...payloadDetails
    }, {
      ...resolvedOptions,
      level: resolvedLevel,
      tags: combinedTags,
      context: {
        ...context,
        ...(resolvedOptions.context || {})
      }
    });
  }, [logContextRef, getRecoveryBudgetSnapshot]);

  const applyBitrateOverride = useCallback((nextValue, options = {}) => {
    if (!Number.isFinite(nextValue) || nextValue <= 0) {
      return null;
    }
    const normalized = Math.max(MIN_MAX_VIDEO_BITRATE, Math.round(nextValue));
    const {
      reason = 'resilience-bitrate-adjustment',
      source = 'resilience',
      fetchReason = reason,
      overrideTag = null
    } = options || {};

    let stateChanged = false;
    setBitrateState((prev) => {
      const nextState = {
        ...prev,
        current: normalized,
        lastOverrideTag: overrideTag || null,
        lastOverrideReason: reason || null,
        lastOverrideSource: source || null,
        lastOverrideAt: Date.now()
      };
      if (
        prev.current === nextState.current
        && prev.lastOverrideTag === nextState.lastOverrideTag
        && prev.lastOverrideReason === nextState.lastOverrideReason
        && prev.lastOverrideSource === nextState.lastOverrideSource
      ) {
        return prev;
      }
      stateChanged = true;
      return nextState;
    });

    if (stateChanged) {
      logResilienceEvent('bitrate-target-updated', {
        targetKbps: normalized,
        reason,
        source
      }, { level: 'info' });
    }

    const fetchFn = fetchVideoInfoRef.current;
    if (typeof fetchFn === 'function') {
      Promise.resolve(fetchFn({
        reason: fetchReason,
        maxVideoBitrateOverride: normalized
      }))
        .then(() => {
          setLastFetchAt(Date.now());
        })
        .catch((error) => {
          logResilienceEvent('bitrate-target-update-error', {
            reason: fetchReason,
            error: error?.message || String(error)
          }, { level: 'error' });
        });
    }

    return normalized;
  }, [fetchVideoInfoRef, logResilienceEvent, setBitrateState, setLastFetchAt]);

  const reduceBitrateAfterHardReset = useCallback((context = {}) => {
    const previous = bitrateStateRef.current;
    const currentValue = Number.isFinite(previous?.current) && previous.current > 0
      ? previous.current
      : resolveInitialMaxVideoBitrate();
    const desiredValue = Math.round(currentValue * BITRATE_REDUCTION_FACTOR);
    const reducedValue = Math.max(MIN_MAX_VIDEO_BITRATE, desiredValue);
    if (reducedValue >= currentValue) {
      return;
    }

    logResilienceEvent('bitrate-reduction-applied', {
      previousKbps: currentValue,
      nextKbps: reducedValue,
      reason: context?.reason || 'hard-reset'
    }, { level: 'info' });

    applyBitrateOverride(reducedValue, {
      reason: context?.reason || 'hard-reset',
      source: context?.source || 'resilience',
      fetchReason: 'resilience-hard-reset-bitrate',
      overrideTag: 'hard-recovery'
    });
  }, [applyBitrateOverride, bitrateStateRef, logResilienceEvent, resolveInitialMaxVideoBitrate]);

  const restoreBitrateTarget = useCallback((options = {}) => {
    const baseline = bitrateStateRef.current?.lastSyncedBaseline ?? resolveInitialMaxVideoBitrate();
    if (!Number.isFinite(baseline) || baseline <= 0) {
      return null;
    }
    const currentValue = bitrateStateRef.current?.current;
    const overrideTag = bitrateStateRef.current?.lastOverrideTag;
    if (Math.abs((currentValue ?? baseline) - baseline) < 1 && !overrideTag) {
      return baseline;
    }
    return applyBitrateOverride(baseline, {
      reason: options?.reason || 'manual-bitrate-restore',
      source: options?.source || 'ui',
      fetchReason: 'manual-bitrate-restore',
      overrideTag: null
    });
  }, [applyBitrateOverride, bitrateStateRef, resolveInitialMaxVideoBitrate]);

  const requestDecoderNudge = useCallback((reason = 'decoder-stall', extraDetails = {}) => {
    const nudgeFn = nudgePlaybackRef.current;
    if (typeof nudgeFn !== 'function') {
      return false;
    }
    const now = Date.now();
    const state = decoderNudgeStateRef.current;
    if (state.inflight) {
      return false;
    }
    if (state.lastRequestedAt && (now - state.lastRequestedAt) < DECODER_NUDGE_COOLDOWN_MS) {
      return false;
    }
    state.inflight = true;
    state.lastRequestedAt = now;
    state.graceUntil = now + DECODER_NUDGE_GRACE_MS;

    logResilienceEvent('decoder-nudge-requested', {
      reason,
      ...extraDetails
    }, { level: 'info' });

    Promise.resolve()
      .then(() => nudgeFn({ reason }))
      .then((result) => {
        logResilienceEvent('decoder-nudge-result', {
          reason,
          result: result ?? null
        }, { level: result?.ok ? 'info' : 'warn' });
      })
      .catch((error) => {
        logResilienceEvent('decoder-nudge-error', {
          reason,
          error: error?.message || String(error)
        }, { level: 'error' });
      })
      .finally(() => {
        decoderNudgeStateRef.current.inflight = false;
        decoderNudgeStateRef.current.lastRequestedAt = Date.now();
      });

    return true;
  }, [logResilienceEvent, nudgePlaybackRef]);

  const classifyStallNature = useCallback((diagnostics, playbackHealthSnapshot) => {
    if (!diagnostics) {
      return 'unknown';
    }
    const bufferAhead = diagnostics?.buffer?.bufferAheadSeconds;
    if (Number.isFinite(bufferAhead) && bufferAhead < 0.75) {
      return 'buffer-starved';
    }
    const bufferGap = diagnostics?.buffer?.bufferGapSeconds;
    if (Number.isFinite(bufferGap) && bufferGap > 0.25) {
      return 'seek-gap';
    }
    const droppedRatio = deriveDroppedRatio(diagnostics?.decoder);
    const frameInfo = playbackHealthSnapshot?.frameInfo;
    if (frameInfo?.supported && frameInfo.advancing === false) {
      return 'decoder-stall';
    }
    if (droppedRatio != null && droppedRatio > 0.2) {
      return 'decoder-stall';
    }
    return 'unknown';
  }, []);

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

  const resolvedIsPaused = Boolean(isPaused || playbackHealth?.elementSignals?.paused);

  useEffect(() => {
    progressTokenRef.current = 0;
    lastProgressSecondsRef.current = null;
    lastProgressTsRef.current = null;
    statusTransitionRef.current = STATUS.pending;
    lastSecondsRef.current = 0;
    lastKnownSeekIntentMsRef.current = Number.isFinite(initialStart) && initialStart > 0
      ? Math.max(0, initialStart * 1000)
      : null;
    markLoadingIntentActive();
  }, [waitKey, markLoadingIntentActive]);

  useEffect(() => {
    decoderNudgeStateRef.current = { lastRequestedAt: 0, inflight: false, graceUntil: 0 };
  }, [waitKey]);

  useEffect(() => {
    if (!Number.isFinite(initialStart) || initialStart <= 0) return;
    lastKnownSeekIntentMsRef.current = Math.max(0, initialStart * 1000);
  }, [initialStart]);

  const shouldApplyPausedIntent = resolvedIsPaused && pauseIntent !== 'system';

  useEffect(() => {
    if (isSeeking) {
      setUserIntent(USER_INTENT.seeking);
      return;
    }
    if (shouldApplyPausedIntent) {
      setUserIntent(USER_INTENT.paused);
      return;
    }
    setUserIntent(USER_INTENT.playing);
  }, [isSeeking, shouldApplyPausedIntent]);

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

  const clearStartupTimeout = useCallback(() => {
    if (startupTimeoutRef.current) {
      clearTimeout(startupTimeoutRef.current);
      startupTimeoutRef.current = null;
    }
  }, []);

  const publishStartupWatchdogState = useCallback((patch = {}) => {
    setInternalStartupWatchdogState((prev) => {
      const next = {
        ...prev,
        ...patch,
        timeoutMs: patch.timeoutMs ?? prev.timeoutMs ?? (startupTimeoutMs || null)
      };
      if (
        prev.active === next.active
        && prev.state === next.state
        && prev.reason === next.reason
        && prev.attempts === next.attempts
        && prev.timeoutMs === next.timeoutMs
        && prev.timestamp === next.timestamp
      ) {
        return prev;
      }
      return next;
    });
  }, [startupTimeoutMs]);

  useEffect(() => {
    publishStartupWatchdogState({ timeoutMs: startupTimeoutMs || null });
  }, [startupTimeoutMs, publishStartupWatchdogState]);

  useEffect(() => {
    const state = recoveryBudgetRef.current;
    if (state.key === recoveryIdentityKey) {
      return;
    }
    recoveryBudgetRef.current = {
      key: recoveryIdentityKey,
      windowStartedAt: 0,
      attempts: 0,
      lockUntil: 0,
      consecutiveAttempts: 0,
      lastAttemptAt: 0
    };
    clearTimer(recoveryLockTimerRef);
  }, [recoveryIdentityKey, clearTimer]);

  const clearFatalErrorState = useCallback((reason = 'manual-clear') => {
    if (!fatalErrorRef.current) {
      return null;
    }
    const snapshot = fatalErrorRef.current;
    fatalErrorRef.current = null;
    setFatalErrorState(null);
    logResilienceEvent('fatal-error-cleared', {
      reason,
      code: snapshot?.code ?? null,
      fatalReason: snapshot?.reason || null,
      waitKey: snapshot?.waitKey || logWaitKey
    }, { level: 'info' });
    return snapshot;
  }, [logResilienceEvent, logWaitKey]);

  const activateFatalErrorState = useCallback((details = {}) => {
    if (fatalErrorRef.current) {
      logResilienceEvent('fatal-error-duplicate', {
        incomingReason: details?.reason || null,
        code: details?.code ?? null,
        waitKey: logWaitKey
      }, { level: 'debug' });
      return fatalErrorRef.current;
    }
    const snapshot = {
      code: details?.code ?? null,
      category: details?.category ?? null,
      reason: details?.reason || 'player-error',
      source: details?.source || 'player',
      message: details?.message ?? null,
      data: details?.data ?? null,
      detail: details?.detail ?? null,
      diagnostics: summarizeDiagnosticsForLog(details?.diagnostics) || null,
      occurredAt: Date.now(),
      waitKey: logWaitKey,
      mediaIdentity
    };
    fatalErrorRef.current = snapshot;
    setFatalErrorState(snapshot);
    clearTimer(stallTimerRef);
    clearTimer(reloadTimerRef);
    clearTimer(hardRecoveryTimerRef);
    clearTimer(loadingRecoveryTimerRef);
    clearMountWatchdog();
    clearStartupTimeout();
    decoderNudgeStateRef.current = { lastRequestedAt: 0, inflight: false, graceUntil: 0 };
    resolveLoadingIntent();
    resilienceActions.setStatus(RESILIENCE_STATUS.recoveringFatal, {
      clearStallToken: true,
      clearRecoveryGuard: true,
      resetAttempts: true,
      carryRecovery: false
    });
    logResilienceEvent('fatal-error', snapshot, { level: 'error' });
    return snapshot;
  }, [
    clearMountWatchdog,
    clearStartupTimeout,
    clearTimer,
    logResilienceEvent,
    logWaitKey,
    mediaIdentity,
    resolveLoadingIntent,
    resilienceActions
  ]);

  const handleStartupSignal = useCallback((signal) => {
    if (!signal || typeof signal !== 'object') {
      return;
    }
    const { type } = signal;
    if (!type) return;
    const timestamp = Number.isFinite(signal.timestamp) ? signal.timestamp : Date.now();
    
    let shouldLog = true;
    if (type === 'progress-tick') {
      const now = Date.now();
      if (now - lastLoggedProgressRef.current < 15000) {
        shouldLog = false;
      } else {
        lastLoggedProgressRef.current = now;
      }
    }

    if (shouldLog) {
      logResilienceEvent('startup-signal', {
        type,
        timestamp,
        detail: signal
      }, { level: 'debug' });
    }

    const snapshot = {
      ...startupSignalsRef.current,
      lastType: type,
      lastTimestamp: timestamp,
      detail: signal
    };
    switch (type) {
      case 'media-el-attached':
        snapshot.attachedAt = timestamp;
        snapshot.detachedAt = null;
        break;
      case 'media-el-detached':
        snapshot.detachedAt = timestamp;
        break;
      case 'loadedmetadata':
        snapshot.loadedMetadataAt = timestamp;
        break;
      case 'playing':
        snapshot.playingAt = timestamp;
        break;
      case 'progress-tick':
        snapshot.progressAt = timestamp;
        if (Number.isFinite(signal.seconds)) {
          lastProgressSecondsRef.current = signal.seconds;
        }
        lastProgressTsRef.current = timestamp;
        break;
      case 'hard-reset-triggered':
        reduceBitrateAfterHardReset({ reason: 'hard-reset-triggered', source: 'video-player' });
        break;
      default:
        break;
    }
    startupSignalsRef.current = snapshot;
    setStartupSignalVersion((token) => token + 1);
  }, [logResilienceEvent]);

  const handlePlayerErrorEvent = useCallback((details = {}) => {
    const payload = typeof details === 'object' && details !== null ? details : {};
    const fatal = Boolean(payload.fatal ?? payload.isFatal);
    logResilienceEvent('player-error', {
      ...payload,
      fatal
    }, { level: fatal ? 'error' : 'warn' });

    if (fatal) {
      activateFatalErrorState({
        reason: payload.reason || payload.fatalReason || payload.category || 'player-error',
        source: payload.source || payload.origin || 'player',
        code: payload.code ?? payload.errorCode ?? null,
        category: payload.category || null,
        message: payload.message || payload.detail?.message || null,
        detail: payload.detail || null,
        data: payload.data || null,
        diagnostics: payload.diagnostics || null
      });
    }
  }, [activateFatalErrorState, logResilienceEvent]);

  const invalidatePendingStallDetection = useCallback((reason = 'seek-intent') => {
    const hadPendingTimers = Boolean(stallTimerRef.current || hardRecoveryTimerRef.current);
    const wasStalling = statusRef.current === STATUS.stalling;

    clearTimer(stallTimerRef);
    clearTimer(hardRecoveryTimerRef);
    clearTimer(loadingRecoveryTimerRef);

    if (resilienceState.lastStallToken != null) {
      resilienceActions.setStatus(statusRef.current, { clearStallToken: true });
    }

    if (
      wasStalling
      && statusRef.current !== STATUS.recovering
      && statusRef.current !== STATUS.fatal
    ) {
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
    clearTimer(loadingRecoveryTimerRef);
    lastProgressTsRef.current = null;
    lastProgressSecondsRef.current = null;
  }, [clearTimer]);

  useEffect(() => {
    resetDetectionState();
    setShowDebug(false);
    clearFatalErrorState('wait-key-change');
    resilienceActions.reset({
      nextStatus: resilienceState.carryRecovery ? STATUS.recovering : STATUS.pending
    });
  }, [waitKey, resetDetectionState, resilienceActions, resilienceState.carryRecovery, clearFatalErrorState]);

  useEffect(() => {
    updateExplicitPauseState(false);
  }, [waitKey, updateExplicitPauseState]);

  useEffect(() => {
    resilienceActions.setStatus(STATUS.pending);
    setShowDebug(false);
  }, [mediaIdentity, resilienceActions]);

  useEffect(() => {
    setHardResetLoopCount(0);
  }, [mediaIdentity, playbackSessionKey, setHardResetLoopCount]);

  useEffect(() => {
    if (hardResetLoopCount < HARD_RESET_MAX_ATTEMPTS && hardResetLimitLoggedRef.current) {
      hardResetLimitLoggedRef.current = false;
    }
  }, [hardResetLoopCount]);

  useEffect(() => {
    if (
      status !== RESILIENCE_STATUS.stalling
      && status !== RESILIENCE_STATUS.recovering
      && status !== STATUS.fatal
    ) {
      stallInsightsRef.current = { classification: 'unknown', lastLoggedAt: 0, lastMitigationAt: 0 };
      return;
    }
    const diagnostics = playbackDiagnosticsRef.current
      || (typeof diagnosticsProviderRef.current === 'function'
        ? diagnosticsProviderRef.current()
        : null);
    if (!diagnostics) {
      return;
    }
    const classification = classifyStallNature(diagnostics, playbackHealth);
    if (!classification || classification === 'unknown') {
      return;
    }
    const now = Date.now();
    const lastSnapshot = stallInsightsRef.current;
    if (classification !== lastSnapshot.classification || (now - lastSnapshot.lastLoggedAt) > 4000) {
      logResilienceEvent('stall-root-cause', {
        classification,
        diagnostics: summarizeDiagnosticsForLog(diagnostics)
      }, { level: classification === 'buffer-starved' ? 'warn' : 'info' });
      stallInsightsRef.current = {
        ...lastSnapshot,
        classification,
        lastLoggedAt: now
      };
    }
    if (classification === 'buffer-starved') {
      if ((now - lastSnapshot.lastMitigationAt) > 3000) {
        reduceBitrateAfterHardReset({ reason: 'buffer-starved', source: 'stall-guard' });
        stallInsightsRef.current = {
          ...stallInsightsRef.current,
          lastMitigationAt: now
        };
      }
      return;
    }
    if (classification === 'decoder-stall') {
      requestDecoderNudge('decoder-stall', {
        droppedRatio: deriveDroppedRatio(diagnostics?.decoder)
      });
      stallInsightsRef.current = {
        ...stallInsightsRef.current,
        lastMitigationAt: now
      };
    }
  }, [status, playbackDiagnosticsRef, diagnosticsProviderRef, classifyStallNature, playbackHealth, logResilienceEvent, reduceBitrateAfterHardReset, requestDecoderNudge]);

  const persistSeekIntentMs = useCallback((valueMs) => {
    if (!Number.isFinite(valueMs) || valueMs < 0) return;
    const normalizedSeconds = Math.max(0, valueMs / 1000);
    updateSessionTargetTimeSeconds(normalizedSeconds);
  }, [updateSessionTargetTimeSeconds]);

  const scheduleRecoveryLockRelease = useCallback((lockUntilTs) => {
    if (!Number.isFinite(lockUntilTs)) {
      return;
    }
    const delay = Math.max(0, lockUntilTs - Date.now());
    if (delay <= 0) {
      return;
    }
    clearTimer(recoveryLockTimerRef);
    recoveryLockTimerRef.current = setTimeout(() => {
      recoveryLockTimerRef.current = null;
      const state = recoveryBudgetRef.current;
      if (state.lockUntil && Date.now() >= state.lockUntil) {
        state.lockUntil = null;
        state.windowStartedAt = 0;
        state.attempts = 0;
        logResilienceEvent('recovery-rate-limit-cleared', {
          lockExpiredAt: Date.now()
        }, { level: 'info' });
        if (fatalErrorRef.current?.reason === 'recovery-rate-limit') {
          clearFatalErrorState('recovery-lock-elapsed');
          if (statusRef.current === STATUS.fatal) {
            resilienceActions.setStatus(STATUS.pending, {
              clearRecoveryGuard: true,
              clearStallToken: true
            });
          }
        }
      }
    }, delay);
  }, [clearTimer, clearFatalErrorState, logResilienceEvent, resilienceActions, statusRef]);

  const evaluateRecoveryBudget = useCallback(({ reason, force } = {}) => {
    const state = recoveryBudgetRef.current;
    if (!state) {
      return { allowed: true, extraDelayMs: 0 };
    }
    if (force) {
      state.consecutiveAttempts = 0;
      state.lastAttemptAt = Date.now();
      return { allowed: true, extraDelayMs: 0 };
    }

    const windowMs = Math.max(1000, Number.isFinite(recoveryConfig.rateLimitWindowMs)
      ? recoveryConfig.rateLimitWindowMs
      : 30000);
    const maxAttempts = Math.max(1, Number.isFinite(recoveryConfig.rateLimitMaxAttempts)
      ? recoveryConfig.rateLimitMaxAttempts
      : 3);
    const lockoutMs = Math.max(1000, Number.isFinite(recoveryConfig.rateLimitLockoutMs)
      ? recoveryConfig.rateLimitLockoutMs
      : 60000);
    const backoffBaseDelayMs = Math.max(0, Number.isFinite(recoveryConfig.backoffBaseDelayMs)
      ? recoveryConfig.backoffBaseDelayMs
      : 0);

    const now = Date.now();
    if (state.lockUntil && now < state.lockUntil) {
      return {
        allowed: false,
        blockReason: 'rate-limit-lock',
        blockDetails: { remainingMs: state.lockUntil - now }
      };
    }

    if (!state.windowStartedAt || (now - state.windowStartedAt) > windowMs) {
      state.windowStartedAt = now;
      state.attempts = 0;
    }

    const projectedAttempts = (state.attempts || 0) + 1;
    if (projectedAttempts > maxAttempts) {
      state.lockUntil = now + lockoutMs;
      state.windowStartedAt = now;
      state.attempts = 0;
      logResilienceEvent('recovery-rate-limit-triggered', {
        reason,
        lockoutMs,
        maxAttempts,
        windowMs
      }, { level: 'warn' });
      scheduleRecoveryLockRelease(state.lockUntil);
      return {
        allowed: false,
        blockReason: 'rate-limit-exceeded',
        blockDetails: { lockoutMs }
      };
    }

    state.attempts = projectedAttempts;
    state.lastAttemptAt = now;
    state.consecutiveAttempts = (state.consecutiveAttempts || 0) + 1;

    const extraDelayMs = backoffBaseDelayMs > 0
      ? Math.min(60000, Math.round(backoffBaseDelayMs * (2 ** Math.min(state.consecutiveAttempts - 1, 8))))
      : 0;

    if (extraDelayMs > 0) {
      logResilienceEvent('recovery-backoff-applied', {
        reason,
        extraDelayMs,
        consecutiveAttempts: state.consecutiveAttempts
      }, { level: extraDelayMs > 2000 ? 'warn' : 'info' });
    }

    return {
      allowed: true,
      extraDelayMs
    };
  }, [logResilienceEvent, recoveryConfig.backoffBaseDelayMs, recoveryConfig.rateLimitLockoutMs, recoveryConfig.rateLimitMaxAttempts, recoveryConfig.rateLimitWindowMs, scheduleRecoveryLockRelease]);

  const shouldAllowHardResetAttempt = useCallback(({ reason, force } = {}) => {
    if (force) {
      return { allowed: true, extraDelayMs: 0 };
    }
    const attempts = hardResetLoopCountRef.current || 0;
    if (attempts >= HARD_RESET_MAX_ATTEMPTS) {
      if (!hardResetLimitLoggedRef.current) {
        hardResetLimitLoggedRef.current = true;
        logResilienceEvent('hard-reset-attempts-exhausted', {
          reason,
          attempts,
          maxAttempts: HARD_RESET_MAX_ATTEMPTS
        }, { level: 'error' });
      }
      return { allowed: false, blockReason: 'attempts-exhausted' };
    }

    const budgetResult = evaluateRecoveryBudget({ reason, force });
    if (!budgetResult.allowed) {
      if (budgetResult.blockReason === 'rate-limit-exceeded') {
        activateFatalErrorState({
          reason: 'recovery-rate-limit',
          category: 'recovery-budget',
          message: 'Playback recoveries have been paused to allow the stream to stabilize.',
          data: {
            lockoutMs: budgetResult.blockDetails?.lockoutMs ?? null,
            waitKey,
            mediaIdentity: mediaIdentityRef.current
          }
        });
      }
      return budgetResult;
    }

    return budgetResult;
  }, [
    activateFatalErrorState,
    evaluateRecoveryBudget,
    hardResetLoopCountRef,
    logResilienceEvent,
    mediaIdentityRef,
    waitKey
  ]);

  const computeHardResetDelay = useCallback(({ attempts = 0 } = {}) => {
    const configuredBase = Number.isFinite(recoveryConfig.reloadDelayMs)
      ? recoveryConfig.reloadDelayMs
      : 0;
    const baseline = Math.max(HARD_RESET_MIN_DELAY_MS, configuredBase);
    if (baseline <= 0) {
      return 0;
    }
    const normalizedAttempts = Math.max(0, attempts);
    const multiplier = HARD_RESET_DELAY_MULTIPLIER ** normalizedAttempts;
    return Math.round(baseline * multiplier);
  }, [recoveryConfig.reloadDelayMs]);

  const handleHardResetCycle = useCallback((payload = {}) => {
    setHardResetLoopCount((count) => count + 1);
    reduceBitrateAfterHardReset(payload);
  }, [reduceBitrateAfterHardReset]);

  const recordSeekIntentMs = useCallback((valueMs, reason = 'seek-intent') => {
    if (!Number.isFinite(valueMs) || valueMs < 0) return;
    persistSeekIntentMs(valueMs);
    markLoadingIntentActive();
    invalidatePendingStallDetection(reason);
  }, [persistSeekIntentMs, invalidatePendingStallDetection, markLoadingIntentActive]);

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

  useEffect(() => {
    if (Number.isFinite(sessionTargetTimeSeconds)) {
      lastKnownSeekIntentMsRef.current = Math.max(0, sessionTargetTimeSeconds * 1000);
    }
  }, [sessionTargetTimeSeconds]);

  const resolveSeekIntentMs = useCallback((overrideMs = null) => {
    if (Number.isFinite(overrideMs)) {
      return Math.max(0, overrideMs);
    }
    if (Number.isFinite(sessionTargetTimeSeconds)) {
      return Math.max(0, sessionTargetTimeSeconds * 1000);
    }
    if (Number.isFinite(lastKnownSeekIntentMsRef.current)) {
      return Math.max(0, lastKnownSeekIntentMsRef.current);
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
    hardRecoverAfterStalledForMs: effectiveHardRecoverAfterStalledForMs,
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
    fatalStatusValue: STATUS.fatal,
    userIntentRef,
    pausedIntentValue: USER_INTENT.paused,
    recoveryAttempts: resilienceState.recoveryAttempts,
    onHardResetCycle: handleHardResetCycle,
    shouldAttemptRecovery: shouldAllowHardResetAttempt,
    computeRecoveryDelayMs: computeHardResetDelay
  });

  const handlePlayerRecoveryRequest = useCallback((input) => {
    const payload = typeof input === 'string'
      ? { reason: input }
      : (input && typeof input === 'object' ? input : {});
    const {
      reason = 'player-recovery-request',
      seekToIntentMs: overrideIntentMs = null,
      seekSeconds = null,
      ignorePaused = true,
      force = false,
      skipRecoveryNotification = false
    } = payload;

    const normalizedSeekMs = (() => {
      if (Number.isFinite(overrideIntentMs)) return Math.max(0, overrideIntentMs);
      if (Number.isFinite(seekSeconds)) return Math.max(0, seekSeconds * 1000);
      return null;
    })();

    return triggerRecovery(reason, {
      ignorePaused,
      force,
      seekToIntentMs: normalizedSeekMs,
      skipRecoveryNotification
    });
  }, [triggerRecovery]);

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
    if (statusRef.current === STATUS.recovering || statusRef.current === STATUS.fatal) {
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

    if (
      status === STATUS.stalling
      && previous !== STATUS.recovering
      && previous !== STATUS.fatal
    ) {
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
    } else if (status === STATUS.fatal && previous !== STATUS.fatal) {
      logResilienceEvent('fatal-recovery-blocked', {
        seconds: normalizedSeconds,
        fatalError: fatalErrorRef.current || fatalErrorState || null
      }, { level: 'error' });
    }

    statusTransitionRef.current = status;
  }, [
    status,
    logResilienceEvent,
    normalizedSeconds,
    playbackHealth.progressToken,
    logWaitKey,
    resilienceState.recoveryAttempts,
    fatalErrorState
  ]);

  const monitorSuspended = userIntent === USER_INTENT.paused;

  const bufferRunwayMs = Number.isFinite(playbackHealth?.bufferRunwayMs)
    ? playbackHealth.bufferRunwayMs
    : null;
  const elementWaiting = Boolean(playbackHealth?.elementSignals?.waiting);
  const elementBuffering = Boolean(playbackHealth?.elementSignals?.buffering);

  useEffect(() => {
    if (monitorSuspended) {
      return;
    }
    if (!Number.isFinite(bufferRunwayMs) || bufferRunwayMs < DECODER_NUDGE_MIN_BUFFER_MS) {
      return;
    }
    if (!(elementWaiting || elementBuffering)) {
      return;
    }
    if (status === STATUS.recovering) {
      return;
    }
    requestDecoderNudge('buffering-with-runway', { runwayMs: bufferRunwayMs });
  }, [bufferRunwayMs, elementBuffering, elementWaiting, monitorSuspended, requestDecoderNudge, status]);

  useEffect(() => {
    if (status === STATUS.fatal) {
      return;
    }
    if (userIntent === USER_INTENT.paused) {
      if (status !== STATUS.paused) {
        resilienceActions.setStatus(STATUS.paused, {
          clearStallToken: true,
          clearRecoveryGuard: true
        });
      }
      return;
    }

    if (status === STATUS.paused) {
      resilienceActions.setStatus(STATUS.pending, {
        clearStallToken: true,
        clearRecoveryGuard: true
      });
    }
  }, [userIntent, status, resilienceActions]);

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

    if (status === STATUS.fatal) {
      clearTimer(stallTimerRef);
      clearTimer(hardRecoveryTimerRef);
      clearTimer(loadingRecoveryTimerRef);
      return;
    }

    if (monitorSuspended) {
      clearTimer(stallTimerRef);
      clearTimer(hardRecoveryTimerRef);
      clearTimer(loadingRecoveryTimerRef);
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
        resolveLoadingIntent();
        resilienceActions.progressTick({ nextStatus: STATUS.playing });
        scheduleStallCheck(detectionDelay, { restart: true });
      } else {
        // Ignore early signals (e.g., "playing" events before the clock advances)
        lastProgressTsRef.current = playbackHealth.lastProgressAt ?? lastProgressTsRef.current;
        if (statusRef.current !== STATUS.recovering && statusRef.current !== STATUS.fatal) {
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
      if (
        statusRef.current !== STATUS.stalling
        && statusRef.current !== STATUS.pending
        && statusRef.current !== STATUS.fatal
      ) {
        resilienceActions.setStatus(STATUS.pending);
      }
      clearTimer(stallTimerRef);
      clearTimer(hardRecoveryTimerRef);
      return;
    }

    if (!hasObservedProgress) {
      if (
        statusRef.current !== STATUS.stalling
        && statusRef.current !== STATUS.pending
        && statusRef.current !== STATUS.fatal
      ) {
        resilienceActions.setStatus(STATUS.pending);
      }
      clearTimer(stallTimerRef);
      clearTimer(hardRecoveryTimerRef);
      return;
    }

    if (playbackHealth.isWaiting || playbackHealth.isStalledEvent) {
      const now = Date.now();
      if (decoderNudgeStateRef.current.graceUntil && now < decoderNudgeStateRef.current.graceUntil) {
        return;
      }
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
    resilienceState.recoveryGuardToken,
    resolveLoadingIntent
  ]);

  useEffect(() => {
    if (!startupTimeoutMs || startupTimeoutMs <= 0) {
      clearStartupTimeout();
      publishStartupWatchdogState({ active: false, state: 'idle', reason: 'disabled' });
      startupAttemptsRef.current = 0;
      return;
    }
    const waitingState = status === STATUS.pending || status === STATUS.recovering || status === STATUS.fatal;
    const elementPlayingSignal = Boolean(playbackHealth?.elementSignals?.playing);
    const reporterSnapshot = startupSignalsRef.current;
    const reporterProgressSignal = Boolean(reporterSnapshot.progressAt);
    const reporterPlayingSignal = Boolean(reporterSnapshot.playingAt);
    const reporterAttachmentActive = Boolean(reporterSnapshot.attachedAt && !reporterSnapshot.detachedAt);
    const hasProgressSignal = playbackHealth.progressToken > 0
      || elementPlayingSignal
      || reporterProgressSignal
      || reporterPlayingSignal
      || Number.isFinite(lastProgressSecondsRef.current);

    if (!waitingState || monitorSuspended) {
      if (startupTimeoutRef.current) {
        logResilienceEvent('startup-watchdog-cleared', {
          reason: monitorSuspended ? 'monitor-suspended' : 'status-changed',
          attempts: startupAttemptsRef.current
        }, { level: 'debug' });
      }
      publishStartupWatchdogState({
        active: false,
        state: monitorSuspended ? 'suspended' : 'idle',
        reason: monitorSuspended ? 'monitor-suspended' : 'status-changed',
        attempts: startupAttemptsRef.current,
        timestamp: Date.now()
      });
      clearStartupTimeout();
      if (!waitingState || hasProgressSignal) {
        startupAttemptsRef.current = 0;
      }
      return;
    }

    if (hasProgressSignal) {
      if (startupTimeoutRef.current) {
        logResilienceEvent('startup-watchdog-cleared', {
          reason: 'progress-detected',
          attempts: startupAttemptsRef.current
        }, { level: 'debug' });
      }
      publishStartupWatchdogState({
        active: false,
        state: 'resolved',
        reason: 'progress-detected',
        attempts: startupAttemptsRef.current,
        timestamp: Date.now()
      });
      clearStartupTimeout();
      startupAttemptsRef.current = 0;
      return;
    }

    if (startupTimeoutRef.current) {
      return;
    }

    logResilienceEvent('startup-watchdog-armed', {
      timeoutMs: startupTimeoutMs,
      attempts: startupAttemptsRef.current,
      reporterAttachmentActive,
      reporterProgressSignal,
      reporterPlayingSignal
    }, { level: 'debug' });
    publishStartupWatchdogState({
      active: true,
      state: 'armed',
      reason: reporterAttachmentActive ? 'media-el-attached' : 'waiting-for-attachment',
      attempts: startupAttemptsRef.current,
      timestamp: Date.now()
    });

    startupTimeoutRef.current = setTimeout(() => {
      startupTimeoutRef.current = null;
      startupAttemptsRef.current += 1;
      const attempt = startupAttemptsRef.current;
      const maxAttempts = Number.isFinite(startupMaxAttempts) ? startupMaxAttempts : null;
      const reachedMax = maxAttempts != null && attempt >= maxAttempts;

      logResilienceEvent('startup-timeout', {
        attempt,
        maxAttempts,
        timeoutMs: startupTimeoutMs
      }, { level: reachedMax ? 'error' : 'warn' });

      publishStartupWatchdogState({
        active: !reachedMax,
        state: reachedMax ? 'aborted' : 'timeout',
        reason: 'startup-timeout',
        attempts: attempt,
        timestamp: Date.now()
      });

      if (reachedMax) {
        forcePlayerRemount('startup-timeout-max', {
          seekToIntentMs: resolveSeekIntentMs()
        });
        return;
      }

      triggerRecovery('startup-timeout', {
        ignorePaused: true,
        force: true,
        seekToIntentMs: resolveSeekIntentMs()
      });
    }, startupTimeoutMs);
  }, [
    startupTimeoutMs,
    startupMaxAttempts,
    status,
    monitorSuspended,
    playbackHealth.progressToken,
    playbackHealth?.elementSignals?.playing,
    clearStartupTimeout,
    logResilienceEvent,
    forcePlayerRemount,
    triggerRecovery,
    resolveSeekIntentMs,
    publishStartupWatchdogState,
    startupSignalVersion
  ]);

  useEffect(() => {
    if (!loadingIntentActive || monitorSuspended || status === STATUS.recovering || status === STATUS.fatal) {
      clearTimer(loadingRecoveryTimerRef);
      return;
    }
    if (!Number.isFinite(effectiveLoadingGraceMs)) {
      return;
    }
    if (effectiveLoadingGraceMs <= 0) {
      resolveLoadingIntent();
      triggerRecovery('loading-hard-recovery', { ignorePaused: true, force: true });
      return;
    }
    clearTimer(loadingRecoveryTimerRef);
    loadingRecoveryTimerRef.current = setTimeout(() => {
      loadingRecoveryTimerRef.current = null;
      resolveLoadingIntent();
      triggerRecovery('loading-hard-recovery', { ignorePaused: true, force: true });
    }, effectiveLoadingGraceMs);
    return () => {
      clearTimer(loadingRecoveryTimerRef);
    };
  }, [
    loadingIntentActive,
    loadingIntentToken,
    monitorSuspended,
    status,
    effectiveLoadingGraceMs,
    triggerRecovery,
    resolveLoadingIntent,
    clearTimer
  ]);

  useEffect(() => () => {
    clearTimer(stallTimerRef);
    clearTimer(reloadTimerRef);
    clearTimer(hardRecoveryTimerRef);
    clearTimer(loadingRecoveryTimerRef);
    clearMountWatchdog();
    clearStartupTimeout();
    clearFatalErrorState('unmount');
  }, [clearTimer, clearMountWatchdog, clearStartupTimeout, clearFatalErrorState]);


  useEffect(() => {
    const waiting = status === STATUS.pending || status === STATUS.recovering || status === STATUS.fatal;
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

  const startupWatchdogState = internalStartupWatchdogState;
  const fatalOverlayActive = Boolean(fatalErrorState);
  const isStartupPhase = status === RESILIENCE_STATUS.startup;
  const waitingToPlay = isStartupPhase || status === STATUS.recovering || status === STATUS.fatal;
  const baseSystemHealth = (() => {
    if (fatalOverlayActive || status === STATUS.fatal) {
      return SYSTEM_HEALTH.fatal;
    }
    if (userIntent === USER_INTENT.paused) {
      return SYSTEM_HEALTH.ok;
    }
    if (status === STATUS.stalling || playbackHealth.isStalledEvent) {
      return SYSTEM_HEALTH.stalled;
    }
    if (waitingToPlay || playbackHealth.isWaiting) {
      return SYSTEM_HEALTH.buffering;
    }
    return SYSTEM_HEALTH.ok;
  })();
  const systemHealth = (() => {
    if (fatalOverlayActive) {
      return SYSTEM_HEALTH.fatal;
    }
    if (typeof stalledOverride === 'boolean') {
      return stalledOverride ? SYSTEM_HEALTH.stalled : SYSTEM_HEALTH.ok;
    }
    return baseSystemHealth;
  })();
  const computedStalled = !fatalOverlayActive
    && userIntent !== USER_INTENT.paused
    && (systemHealth === SYSTEM_HEALTH.stalled || status === STATUS.recovering);
  const stallOverlayActive = fatalOverlayActive || computedStalled;

  const telemetryHasProgress = playbackHealth.progressToken > 0
    && Number.isFinite(playbackHealth?.lastProgressSeconds);
  const observedProgressSeconds = Number.isFinite(lastProgressSecondsRef.current)
    ? lastProgressSecondsRef.current
    : (telemetryHasProgress
      ? playbackHealth.lastProgressSeconds
      : null);
  const playbackHasProgress = (status === STATUS.recovering || status === STATUS.fatal)
    ? false
    : (Number.isFinite(observedProgressSeconds) && observedProgressSeconds > epsilonSeconds);
  useEffect(() => {
    if (userIntent !== USER_INTENT.paused || !playbackHasProgress) {
      if (explicitPauseRef.current) {
        updateExplicitPauseState(false);
      }
      return;
    }
    updateExplicitPauseState(true);
  }, [
    userIntent,
    playbackHasProgress,
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
    hardRecoverAfterStalledForMs: effectiveHardRecoverAfterStalledForMs,
    loadingGraceDeadlineMs: effectiveLoadingGraceMs,
    triggerRecovery,
    stallOverlayActive,
    fatalOverlayActive,
    waitingToPlay,
    playbackHasProgress,
    userIntentIsPaused: userIntent === USER_INTENT.paused,
    explicitPauseActive,
    isPaused: resolvedIsPaused,
    computedStalled,
    playbackHealth,
    loadingIntentActive,
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
      if (hardResetLoopCount !== 0) {
        setHardResetLoopCount(0);
      }
      decoderNudgeStateRef.current.graceUntil = 0;
      decoderNudgeStateRef.current.inflight = false;
    }
  }, [status, hardResetLoopCount]);

  const markHealthy = useCallback(() => {
    clearFatalErrorState('mark-healthy');
    clearTimer(stallTimerRef);
    clearTimer(reloadTimerRef);
    resilienceActions.setStatus(STATUS.playing, {
      clearStallToken: true,
      clearRecoveryGuard: true,
      resetAttempts: true
    });
    setHardResetLoopCount(0);
    resolveLoadingIntent();
  }, [clearFatalErrorState, clearTimer, resilienceActions, setHardResetLoopCount, resolveLoadingIntent]);

  const state = useMemo(() => ({
    status,
    waitingToPlay,
    waitingForPlayback: waitingToPlay,
    graceElapsed: !waitingToPlay,
    loadingIntentActive,
    isOverlayVisible,
    showPauseOverlay,
    showDebug,
    stalled: computedStalled,
    seconds,
    isPaused: resolvedIsPaused,
    isSeeking,
    userIntent,
    systemHealth,
    fatalErrorState,
    fatalOverlayActive,
    meta,
    waitKey,
    lastFetchAt,
    shouldRenderOverlay,
    playbackHealth,
    hardRecoverAfterStalledForMs: effectiveHardRecoverAfterStalledForMs,
    hardRecoverLoadingGraceMs: effectiveLoadingGraceMs,
    currentMaxVideoBitrate: bitrateState.current ?? null,
    baselineMaxVideoBitrate: bitrateState.lastSyncedBaseline ?? null,
    bitrateOverrideTag: bitrateState.lastOverrideTag || null,
    bitrateOverrideReason: bitrateState.lastOverrideReason || null,
    bitrateOverrideSource: bitrateState.lastOverrideSource || null,
    bitrateOverrideAt: bitrateState.lastOverrideAt || null
  }), [
    status,
    waitingToPlay,
    loadingIntentActive,
    isOverlayVisible,
    showPauseOverlay,
    showDebug,
    computedStalled,
    systemHealth,
    fatalErrorState,
    seconds,
    resolvedIsPaused,
    isSeeking,
    userIntent,
    fatalOverlayActive,
    meta,
    waitKey,
    lastFetchAt,
    shouldRenderOverlay,
    playbackHealth,
    effectiveHardRecoverAfterStalledForMs,
    effectiveLoadingGraceMs,
    bitrateState.current,
    bitrateState.lastSyncedBaseline,
    bitrateState.lastOverrideTag,
    bitrateState.lastOverrideReason,
    bitrateState.lastOverrideSource,
    bitrateState.lastOverrideAt
  ]);
  const stateRef = useLatest(state);

  const debugStateSnapshotRef = useRef({
    userIntent,
    fatalErrorState,
    status,
    systemHealth
  });

  useEffect(() => {
    const prev = debugStateSnapshotRef.current;
    const changes = {};
    if (!prev || prev.userIntent !== userIntent) {
      changes.userIntent = { from: prev?.userIntent ?? null, to: userIntent };
    }
    if (!prev || prev.status !== status) {
      changes.status = { from: prev?.status ?? null, to: status };
    }
    if (!prev || prev.systemHealth !== systemHealth) {
      changes.systemHealth = { from: prev?.systemHealth ?? null, to: systemHealth };
    }
    const changedKeys = Object.keys(changes);
    if (changedKeys.length > 0) {
      logResilienceEvent('debug-state-change', {
        userIntent,
        status,
        systemHealth,
        changes
      }, { level: 'debug' });
      debugStateSnapshotRef.current = { userIntent, status, systemHealth };
    }
  }, [userIntent, status, systemHealth, logResilienceEvent]);

  useEffect(() => {
    if (typeof onStateChange === 'function') {
      onStateChange(state);
    }
  }, [onStateChange, state]);

  const controller = useMemo(() => ({
    reset: () => {
      clearFatalErrorState('controller-reset');
      resetDetectionState();
      resilienceActions.reset({ nextStatus: STATUS.pending, clearCarry: true });
      setShowDebug(false);
      resetOverlayState();
      setHardResetLoopCount(0);
      markLoadingIntentActive();
    },
    forceReload: (options = {}) => {
      clearFatalErrorState('controller-force-reload');
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
    getSeekIntentMs: () => resolveSeekIntentMs(),
    getMaxVideoBitrate: () => bitrateStateRef.current?.current ?? null,
    restoreMaxVideoBitrate: (options) => restoreBitrateTarget(options)
  }), [
    clearFatalErrorState,
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
    setOverlayPausePreference,
    setHardResetLoopCount,
    markLoadingIntentActive,
    bitrateStateRef,
    restoreBitrateTarget
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
    isPaused: resolvedIsPaused,
    userIntent,
    systemHealth,
    fatalOverlayActive,
    fatalErrorState,
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
    mediaDetails,
    startupWatchdogState
  });

  return {
    overlayProps,
    controller,
    state,
    onStartupSignal: handleStartupSignal,
    onPlayerError: handlePlayerErrorEvent,
    onRecoveryRequest: handlePlayerRecoveryRequest
  };
}

function createOverlayProps({
  status,
  isOverlayVisible,
  shouldRenderOverlay,
  waitingToPlay,
  isPaused,
  userIntent,
  systemHealth,
  fatalOverlayActive,
  fatalErrorState,
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
    fatalOverlayActive,
    fatalErrorState,
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
    mediaDetails,
    startupWatchdogState
  };
}
