import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { playbackLog } from '../lib/playbackLogger.js';
import { getLogWaitKey } from '../lib/waitKeyLabel.js';
import { usePlaybackHealth } from './usePlaybackHealth.js';
import { useResilienceConfig } from './useResilienceConfig.js';
import { useResilienceState, RESILIENCE_STATUS } from './useResilienceState.js';
import { useResilienceRecovery } from './useResilienceRecovery.js';
import { usePlaybackSession } from './usePlaybackSession.js';
import { resolveMediaIdentity } from '../utils/mediaIdentity.js';
import { useResiliencePolicy } from './policy/useResiliencePolicy.js';
import { useResiliencePresentation } from './presentation/useResiliencePresentation.js';

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

const DECODER_NUDGE_MIN_BUFFER_MS = 8000;
const DECODER_NUDGE_COOLDOWN_MS = 3000;
// Default: allow Shaka a longer startup window before we consider nudging the decoder
const DECODER_NUDGE_GRACE_MS = 8000;
const RECOVERY_WATCHDOG_FACTOR = 1.5;
const RECOVERY_WATCHDOG_BASE_MS = 4000;
const RECOVERY_WATCHDOG_MAX_MS = 60000;
const STARTUP_WATCHDOG_TIERS = [
  { atMs: 8000, action: 'warn' },
  { atMs: 20000, action: 'remount' },
  { atMs: 30000, action: 'hard-reload' }
];

const shallowEqualObjects = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i += 1) {
    const key = aKeys[i];
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (a[key] !== b[key]) return false;
  }
  return true;
};

// Prevents re-entrant onStateChange cascades in the same tick
const createReentryGuard = () => {
  let active = false;
  return {
    enter() {
      if (active) return false;
      active = true;
      return true;
    },
    exit() {
      active = false;
    }
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
  seconds = 0,
  isPaused = false,
  isSeeking = false,
  pauseIntent = null,
  playbackDiagnostics = null,
  initialStart = 0,
  explicitStartProvided = false,
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
  diagnosticsProvider = null,
  externalPauseReason = null,
  externalPauseActive = false
}) {
  const [runtimeOverrides, setRuntimeOverrides] = useState(null);
  const explicitStartMs = useMemo(() => (
    explicitStartProvided && Number.isFinite(initialStart)
      ? Math.max(0, initialStart * 1000)
      : null
  ), [explicitStartProvided, initialStart]);
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
    startupMaxAttempts,
    decoderNudgeGraceMs: decoderNudgeGraceMsConfig,
    startupWatchdogTiers: startupWatchdogTiersConfig
  } = monitorSettings;

  const decoderNudgeGraceMs = Number.isFinite(decoderNudgeGraceMsConfig)
    ? decoderNudgeGraceMsConfig
    : DECODER_NUDGE_GRACE_MS;
  const startupWatchdogTiers = Array.isArray(startupWatchdogTiersConfig) && startupWatchdogTiersConfig.length
    ? startupWatchdogTiersConfig
    : STARTUP_WATCHDOG_TIERS;

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


  const fetchVideoInfoRef = useLatest(fetchVideoInfo);
  const onReloadRef = useLatest(onReload);
  const nudgePlaybackRef = useLatest(typeof nudgePlayback === 'function' ? nudgePlayback : null);
  const playbackDiagnosticsRef = useLatest(playbackDiagnostics);
  const diagnosticsProviderRef = useLatest(typeof diagnosticsProvider === 'function' ? diagnosticsProvider : null);

  const readPolicyDiagnostics = useCallback(() => {
    const diagnostics = playbackDiagnosticsRef.current
      || (typeof diagnosticsProviderRef.current === 'function'
        ? diagnosticsProviderRef.current()
        : null);
    return diagnostics || null;
  }, [playbackDiagnosticsRef, diagnosticsProviderRef]);
  const lastProgressTsRef = useRef(null);
  const lastProgressSecondsRef = useRef(null);
  const lastLoggedProgressRef = useRef(0);
  const lastKnownSeekIntentMsRef = useRef(Number.isFinite(initialStart) && initialStart >= 0
    ? Math.max(0, initialStart * 1000)
    : null);
  const stallTimerRef = useRef(null);
  const reloadTimerRef = useRef(null);
  const hardRecoveryTimerRef = useRef(null);
  const recoveryOutcomeTimerRef = useRef(null);
  const loadingRecoveryTimerRef = useRef(null);
  const startupTimeoutRef = useRef(null);
  const startupTierTimersRef = useRef([]);
  const startupWatchdogStartRef = useRef(null);
  const startupArmedKeyRef = useRef(null);
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
  const mediaIdentity = resolveMediaIdentity(meta);
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
  const stallSequenceRef = useRef(0);
  const stallStateRef = useRef({ id: null, token: null, startedAt: null });
  const lastLoggedIntentRef = useRef(userIntent);
  const mountWatchdogTimerRef = useRef(null);
  const mountWatchdogStartRef = useRef(null);
  const mountWatchdogReasonRef = useRef(null);
  const mountWatchdogAttemptsRef = useRef(0);
  const statusTransitionRef = useRef(status);
  const decoderNudgeStateRef = useRef({ lastRequestedAt: 0, inflight: false, graceUntil: 0 });
  const metricRateOverridesRef = useRef({
    progressTickSampleRate: Number.isFinite(debugConfig?.progressTickSampleRate)
      ? debugConfig.progressTickSampleRate
      : 0.2,
    overlaySummarySampleRate: Number.isFinite(debugConfig?.overlaySummarySampleRate)
      ? debugConfig.overlaySummarySampleRate
      : 0.25
  });
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
    const stallSnapshot = stallStateRef.current || {};
    const { level: detailLevel, tags: detailTags, severity: detailSeverity, ...restDetails } = details || {};
    const resolvedOptions = typeof options === 'object' && options !== null ? options : {};
    const resolvedLevel = (resolvedOptions.level || detailLevel || 'debug').toLowerCase();
    const resolvedSeverity = (resolvedOptions.severity || detailSeverity || resolvedLevel || 'info').toLowerCase();
    const resolvedStallId = restDetails.stallId ?? stallSnapshot.id ?? null;
    const resolvedStallToken = restDetails.stallToken ?? stallSnapshot.token ?? null;
    const resolvedStallStartedAt = restDetails.stallStartedAt ?? stallSnapshot.startedAt ?? null;
    const eventKey = String(event || '').toLowerCase();
    const defaultTags = [];
    if (eventKey.includes('stall')) defaultTags.push('stall');
    if (eventKey.includes('overlay')) defaultTags.push('overlay');
    if (eventKey.includes('startup')) defaultTags.push('startup');
    if (eventKey.includes('recovery') || eventKey.includes('reset')) defaultTags.push('recovery');
    const incomingTags = Array.isArray(detailTags || resolvedOptions.tags)
      ? (detailTags || resolvedOptions.tags)
      : (detailTags || resolvedOptions.tags ? [detailTags || resolvedOptions.tags] : []);
    const tags = Array.from(new Set([...defaultTags, ...incomingTags].filter(Boolean)));

    playbackLog('media-resilience', {
      event,
      severity: resolvedSeverity,
      ...context,
      stallId: resolvedStallId,
      stallToken: resolvedStallToken,
      stallStartedAt: resolvedStallStartedAt,
      ...restDetails
    }, {
      ...resolvedOptions,
      level: resolvedLevel,
      tags,
      context: {
        ...context,
        stallId: resolvedStallId,
        stallToken: resolvedStallToken,
        severity: resolvedSeverity,
        ...(resolvedOptions.context || {})
      }
    });
  }, [logContextRef, stallStateRef]);

  const logMetric = useCallback((name, payload = {}, options = {}) => {
    const context = logContextRef.current || {};
    playbackLog('media-metric', {
      metric: name,
      ...context,
      ...payload
    }, {
      level: options.level || 'info',
      sampleRate: options.sampleRate,
      context: {
        ...context,
        ...(options.context || {})
      },
      tags: options.tags || ['metric']
    });
  }, [logContextRef]);

  const metricsRef = useRef({
    stallCount: 0,
    stallDurationMs: 0,
    recoveryAttempts: 0,
    decoderNudges: 0,
    startupInterventions: 0
  });

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
    state.graceUntil = now + decoderNudgeGraceMs;

    metricsRef.current.decoderNudges += 1;
    logMetric('decoder_nudge', {
      reason,
      decoderNudges: metricsRef.current.decoderNudges
    }, { level: 'info', tags: ['metric', 'decoder'] });
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
  const normalizedSeconds = useMemo(() => {
    if (!Number.isFinite(seconds)) return 0;
    return Math.max(0, seconds);
  }, [seconds]);

  useEffect(() => {
    progressTokenRef.current = 0;
    lastProgressSecondsRef.current = null;
    lastProgressTsRef.current = null;
    statusTransitionRef.current = STATUS.pending;
    lastSecondsRef.current = 0;
    stallSequenceRef.current = 0;
    stallStateRef.current = { id: null, token: null, startedAt: null };
    metricsRef.current = {
      stallCount: 0,
      stallDurationMs: 0,
      recoveryAttempts: 0,
      decoderNudges: 0,
      bitrateOverrides: 0
    };
    lastKnownSeekIntentMsRef.current = Number.isFinite(initialStart) && initialStart >= 0
      ? Math.max(0, initialStart * 1000)
      : null;
    markLoadingIntentActive();
  }, [waitKey, markLoadingIntentActive]);

  useEffect(() => {
    decoderNudgeStateRef.current = { lastRequestedAt: 0, inflight: false, graceUntil: 0 };
  }, [waitKey]);

  useEffect(() => {
    if (!Number.isFinite(initialStart) || initialStart < 0) return;
    lastKnownSeekIntentMsRef.current = Math.max(0, initialStart * 1000);
  }, [initialStart]);

  const shouldApplyPausedIntent = resolvedIsPaused && pauseIntent !== 'system';

  useEffect(() => {
    if (isSeeking) {
      setUserIntent(USER_INTENT.seeking);
      return;
    }
    if (shouldApplyPausedIntent) {
      // If we are already tracking a stall or recovery, or if the media element reports it is waiting/stalled,
      // and the pause signal is not explicitly marked as user-initiated, assume it's a system pause
      // (e.g. buffer underrun) and keep 'playing' intent so the stall overlay remains visible.
      const isResilienceState = status === STATUS.stalling || status === STATUS.recovering;
      const isSystemStallSignal = playbackHealth.isWaiting || playbackHealth.isStalledEvent;

      if ((isResilienceState || isSystemStallSignal) && pauseIntent !== 'user') {
        if (userIntentRef.current !== USER_INTENT.playing) {
          logResilienceEvent('pause-intent-overridden', {
            reason: pauseIntent || 'system',
            status,
            stallId: stallStateRef.current?.id || null,
            stallToken: stallStateRef.current?.token || playbackHealth.progressToken || null
          }, { level: 'debug', rateLimit: { key: `pause-override-${logWaitKey}`, interval: 2000 } });
        }
        setUserIntent(USER_INTENT.playing);
        return;
      }
      setUserIntent(USER_INTENT.paused);
      return;
    }
    setUserIntent(USER_INTENT.playing);
  }, [isSeeking, shouldApplyPausedIntent, status, pauseIntent, logResilienceEvent, playbackHealth.isStalledEvent, playbackHealth.isWaiting, logWaitKey, userIntentRef]);

  useEffect(() => {
    const previous = lastLoggedIntentRef.current;
    if (previous === userIntent) return;

    if (userIntent === USER_INTENT.paused) {
      const reason = pauseIntent || externalPauseReason || 'unknown';
      logResilienceEvent('pause-intent', {
        reason,
        pauseIntent: pauseIntent || null,
        externalPauseReason: externalPauseReason || null,
        status,
        isSeeking,
        resolvedIsPaused
      }, {
        level: 'info',
        rateLimit: { key: `pause-intent-${logWaitKey}`, interval: 2000 }
      });
    } else if (previous === USER_INTENT.paused && userIntent !== USER_INTENT.paused) {
      logResilienceEvent('resume-intent', {
        from: previous,
        to: userIntent,
        reason: pauseIntent || externalPauseReason || 'resume',
        status
      }, {
        level: 'info',
        rateLimit: { key: `resume-intent-${logWaitKey}`, interval: 2000 }
      });
    }

    lastLoggedIntentRef.current = userIntent;
  }, [externalPauseReason, isSeeking, logResilienceEvent, logWaitKey, pauseIntent, resolvedIsPaused, status, userIntent]);

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
    if (startupTierTimersRef.current?.length) {
      startupTierTimersRef.current.forEach((id) => clearTimeout(id));
      startupTierTimersRef.current = [];
    }
  }, []);

  useEffect(() => {
    if (startupTimeoutRef.current) {
      const elapsedMs = startupWatchdogStartRef.current
        ? Math.max(0, Date.now() - startupWatchdogStartRef.current)
        : null;
      logResilienceEvent('startup-watchdog-cleared', {
        reason: 'waitKey-changed',
        attempts: startupAttemptsRef.current,
        elapsedMs
      }, { level: 'debug' });
      clearStartupTimeout();
    }
    startupAttemptsRef.current = 0;
    startupWatchdogStartRef.current = null;
    startupArmedKeyRef.current = null;
  }, [waitKey, clearStartupTimeout, logResilienceEvent]);

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
      }, {
        level: 'debug',
        sampleRate: type === 'progress-tick'
          ? metricRateOverridesRef.current.progressTickSampleRate
          : undefined
      });
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
      default:
        break;
    }
    startupSignalsRef.current = snapshot;
    setStartupSignalVersion((token) => token + 1);
  }, [logResilienceEvent]);

  const createStallId = useCallback((stallToken) => {
    stallSequenceRef.current += 1;
    const seq = String(stallSequenceRef.current).padStart(2, '0');
    const tokenPart = Number.isFinite(stallToken) ? stallToken : 'na';
    return `${logWaitKey || waitKey || 'playback'}-stall-${seq}-${tokenPart}`;
  }, [logWaitKey, waitKey]);

  const resolveStallContext = useCallback(() => {
    const now = Date.now();
    const bufferRunwayMs = Number.isFinite(playbackHealth?.bufferRunwayMs)
      ? Math.max(0, Math.round(playbackHealth.bufferRunwayMs))
      : null;
    const readyState = Number.isFinite(playbackHealth?.elementSignals?.readyState)
      ? playbackHealth.elementSignals.readyState
      : null;
    const networkState = Number.isFinite(playbackHealth?.elementSignals?.networkState)
      ? playbackHealth.elementSignals.networkState
      : null;
    const frameInfo = playbackHealth?.frameInfo;
    const frame = frameInfo?.supported
      ? {
        advancing: Boolean(frameInfo.advancing),
        total: Number.isFinite(frameInfo.total) ? frameInfo.total : null,
        dropped: Number.isFinite(frameInfo.dropped) ? frameInfo.dropped : null,
        corrupted: Number.isFinite(frameInfo.corrupted) ? frameInfo.corrupted : null
      }
      : null;
    const decoderGraceActive = (decoderNudgeStateRef.current?.graceUntil || 0) > now;

    const metrics = metricsRef.current || {};

    // Pull full diagnostics including Shaka stats when available
    let fullDiagnostics = null;
    try {
      fullDiagnostics = readPolicyDiagnostics();
    } catch (_) {
      // ignore diagnostics read errors
    }

    return {
      bufferRunwayMs,
      readyState,
      networkState,
      progressToken: playbackHealth?.progressToken ?? null,
      lastProgressSeconds: Number.isFinite(lastProgressSecondsRef.current)
        ? lastProgressSecondsRef.current
        : null,
      frame,
      decoderGraceActive,
      stallCount: metrics.stallCount,
      totalStallDurationMs: metrics.stallDurationMs,
      decoderNudges: metrics.decoderNudges,
      recoveryAttempts: metrics.recoveryAttempts,
      // Include Shaka player diagnostics for DASH streams
      shaka: fullDiagnostics?.shaka ?? null,
      buffer: fullDiagnostics?.buffer ?? null
    };
  }, [playbackHealth, readPolicyDiagnostics]);

  const beginStallLifecycle = useCallback((stallToken) => {
    const nextId = createStallId(stallToken);
    stallStateRef.current = {
      id: nextId,
      token: stallToken ?? null,
      startedAt: Date.now()
    };
    metricsRef.current.stallCount += 1;
    logMetric('stall_count', {
      stallId: nextId,
      stallToken,
      stallCount: metricsRef.current.stallCount
    }, { level: 'info', tags: ['stall', 'metric'] });
    logResilienceEvent('stall-lifecycle-start', {
      stallId: nextId,
      stallToken,
      stallStartedAt: stallStateRef.current.startedAt,
      ...resolveStallContext()
    }, { level: 'info' });
    return stallStateRef.current;
  }, [createStallId, logResilienceEvent, logMetric, resolveStallContext]);

  const resolveStallLifecycle = useCallback((reason = 'recovered', meta = {}) => {
    const snapshot = stallStateRef.current;
    if (!snapshot?.id) {
      return null;
    }
    const resolvedAt = Date.now();
    const stallDurationMs = snapshot.startedAt ? resolvedAt - snapshot.startedAt : null;
    if (Number.isFinite(stallDurationMs)) {
      metricsRef.current.stallDurationMs += stallDurationMs;
      const bucket = (() => {
        if (stallDurationMs <= 500) return '<=500ms';
        if (stallDurationMs <= 2000) return '<=2000ms';
        if (stallDurationMs <= 5000) return '<=5000ms';
        if (stallDurationMs <= 10000) return '<=10000ms';
        return '>10000ms';
      })();
      logMetric('stall_duration_ms', {
        stallId: snapshot.id,
        stallToken: snapshot.token,
        durationMs: stallDurationMs,
        bucket,
        stallCount: metricsRef.current.stallCount,
        totalStallDurationMs: metricsRef.current.stallDurationMs
      }, { level: 'info', tags: ['stall', 'metric'] });
    }
    logResilienceEvent('stall-lifecycle-resolved', {
      stallId: snapshot.id,
      stallToken: snapshot.token,
      stallDurationMs,
      reason,
      ...resolveStallContext(),
      ...meta
    }, { level: 'info' });
    stallStateRef.current = { id: null, token: null, startedAt: null };
    return stallDurationMs;
  }, [logResilienceEvent, logMetric, resolveStallContext]);

  const enterStallingState = useCallback((options = {}) => {
    const stallToken = options.stallToken ?? playbackHealth?.progressToken ?? stallStateRef.current?.token ?? progressTokenRef.current ?? null;
    if (!stallStateRef.current?.id) {
      beginStallLifecycle(stallToken);
    }
    if (statusRef.current === STATUS.stalling) {
      return;
    }
    resilienceActions.setStatus(STATUS.stalling, {
      stallToken: stallToken ?? stallStateRef.current?.token ?? null,
      clearRecoveryGuard: true
    });
  }, [beginStallLifecycle, playbackHealth?.progressToken, resilienceActions, progressTokenRef, statusRef]);

  const invalidatePendingStallDetection = useCallback((reason = 'seek-intent') => {
    const hadPendingTimers = Boolean(stallTimerRef.current || hardRecoveryTimerRef.current);
    const wasStalling = statusRef.current === STATUS.stalling;

    clearTimer(stallTimerRef);
    clearTimer(hardRecoveryTimerRef);
    clearTimer(loadingRecoveryTimerRef);

    if (resilienceState.lastStallToken != null) {
      resilienceActions.setStatus(statusRef.current, { clearStallToken: true });
    }

    if (stallStateRef.current?.id) {
      stallStateRef.current = { id: null, token: null, startedAt: null };
    }

    if (wasStalling && statusRef.current !== STATUS.recovering) {
      resilienceActions.setStatus(STATUS.pending, { clearRecoveryGuard: true });
    }

    if (hadPendingTimers || wasStalling) {
      logResilienceEvent('stall-invalidated', { reason }, { level: 'debug' });
    }
  }, [clearTimer, logResilienceEvent, resilienceActions, resilienceState.lastStallToken, statusRef]);

  useEffect(() => {
    if (externalPauseReason === 'PAUSED_GOVERNANCE') {
      invalidatePendingStallDetection('governance-pause');
    }
  }, [externalPauseReason, invalidatePendingStallDetection]);

  const resetDetectionState = useCallback(() => {
    clearTimer(stallTimerRef);
    clearTimer(reloadTimerRef);
    clearTimer(hardRecoveryTimerRef);
    clearTimer(loadingRecoveryTimerRef);
    lastProgressTsRef.current = null;
    lastProgressSecondsRef.current = null;
    stallStateRef.current = { id: null, token: null, startedAt: null };
  }, [clearTimer]);

  useEffect(() => {
    resetDetectionState();
    resilienceActions.reset({
      nextStatus: resilienceState.carryRecovery ? STATUS.recovering : STATUS.pending
    });
  }, [waitKey, resetDetectionState, resilienceActions, resilienceState.carryRecovery]);

  useEffect(() => {
    updateExplicitPauseState(false);
  }, [waitKey, updateExplicitPauseState]);

  useEffect(() => {
    resilienceActions.setStatus(STATUS.pending);
  }, [mediaIdentity, resilienceActions]);

  useEffect(() => {
    setHardResetLoopCount(0);
  }, [mediaIdentity, playbackSessionKey, setHardResetLoopCount]);

  const persistSeekIntentMs = useCallback((valueMs) => {
    if (!Number.isFinite(valueMs) || valueMs < 0) return;
    const normalizedSeconds = Math.max(0, valueMs / 1000);
    updateSessionTargetTimeSeconds(normalizedSeconds);
  }, [updateSessionTargetTimeSeconds]);

  const handleHardResetCycle = useCallback((payload = {}) => {
    setHardResetLoopCount((count) => count + 1);
  }, []);

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
      if (!explicitStartProvided) {
        lastKnownSeekIntentMsRef.current = Math.max(0, sessionTargetTimeSeconds * 1000);
      }
    }
  }, [sessionTargetTimeSeconds, explicitStartProvided]);

  const resolveSeekIntentMs = useCallback((overrideMs = null) => {
    if (explicitStartMs != null) {
      return explicitStartMs;
    }
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
  }, [explicitStartMs, sessionTargetTimeSeconds]);

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
    logMetric,
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
    recoveryAttempts: resilienceState.recoveryAttempts,
    onHardResetCycle: handleHardResetCycle,
    onRecoveryAttempt: ({ reason, attempts }) => {
      metricsRef.current.recoveryAttempts = attempts;
      logMetric('recovery_attempt', {
        reason,
        attempts
      }, { level: 'info', tags: ['metric', 'recovery'] });
    }
  });

  const scheduleStallCheck = useCallback((delayMs, options = {}) => {
    const restart = options.restart !== false;
    if (restart) {
      clearTimer(stallTimerRef);
    } else if (stallTimerRef.current) {
      return stallTimerRef.current;
    }

    if (!Number.isFinite(delayMs) || delayMs <= 0) {
      return null;
    }

    const timer = setTimeout(() => {
      enterStallingState();
      scheduleHardRecovery();
    }, delayMs);
    stallTimerRef.current = timer;
    return timer;
  }, [clearTimer, enterStallingState, scheduleHardRecovery]);

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
        logResilienceEvent('mount-watchdog-read-error', {
          error: error?.message || String(error),
          reason
        }, { level: 'warn' });
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
        logResilienceEvent('mount-watchdog-fired', {
          attempts,
          reason
        }, { level: 'warn' });
        if (mountMaxAttempts && attempts > mountMaxAttempts) {
          logResilienceEvent('mount-watchdog-max-attempts', {
            attempts,
            reason
          }, { level: 'error' });
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

  useEffect(() => {
    const previous = statusTransitionRef.current;
    if (previous === status) return;

    const stallSnapshot = stallStateRef.current || {};
    const stallContext = resolveStallContext();
    const stallDurationMs = stallSnapshot?.startedAt
      ? Math.max(0, Date.now() - stallSnapshot.startedAt)
      : null;

    logResilienceEvent('status-transition', {
      from: previous,
      to: status,
      seconds: normalizedSeconds,
      progressToken: playbackHealth.progressToken,
      stallId: stallSnapshot?.id || null,
      stallToken: stallSnapshot?.token || null,
      stallDurationMs,
      ...stallContext
    }, { level: 'debug' });

    if (status === STATUS.stalling && previous !== STATUS.recovering) {
      logResilienceEvent('stall-detected', {
        seconds: normalizedSeconds,
        lastProgressSeconds: lastProgressSecondsRef.current,
        progressToken: playbackHealth.progressToken,
        stallId: stallSnapshot?.id || null,
        stallToken: stallSnapshot?.token || null,
        stallStartedAt: stallSnapshot?.startedAt || Date.now(),
        ...stallContext
      }, { level: 'warn' });
    } else if (status === STATUS.playing && (previous === STATUS.stalling || previous === STATUS.recovering)) {
      logResilienceEvent('stall-recovered', {
        seconds: normalizedSeconds,
        lastProgressSeconds: lastProgressSecondsRef.current,
        progressToken: playbackHealth.progressToken,
        stallId: stallSnapshot?.id || null,
        stallToken: stallSnapshot?.token || null,
        stallDurationMs,
        ...stallContext
      }, { level: 'info' });
      resolveStallLifecycle('recovered', { stallDurationMs });
    } else if (status === STATUS.recovering && previous !== STATUS.recovering) {
      logResilienceEvent('stall-recovering', {
        seconds: normalizedSeconds,
        attempts: resilienceState.recoveryAttempts,
        reason: mountWatchdogReasonRef.current || 'auto',
        stallId: stallSnapshot?.id || null,
        stallToken: stallSnapshot?.token || null,
        stallDurationMs,
        ...stallContext
      }, { level: 'info' });
    }

    statusTransitionRef.current = status;
  }, [status, logResilienceEvent, normalizedSeconds, playbackHealth.progressToken, logWaitKey, resilienceState.recoveryAttempts, resolveStallLifecycle, resolveStallContext]);

  const monitorSuspended = userIntent === USER_INTENT.paused;

  const { policyState, stallClassification } = useResiliencePolicy({
    status,
    externalPauseReason,
    monitorSuspended,
    playbackHealth,
    isStartupPhase: status === STATUS.startup || status === STATUS.pending,
    readDiagnostics: readPolicyDiagnostics,
    requestDecoderNudge,
    logResilienceEvent
  });

  const bufferRunwayMs = Number.isFinite(playbackHealth?.bufferRunwayMs)
    ? playbackHealth.bufferRunwayMs
    : null;
  const elementWaiting = Boolean(playbackHealth?.elementSignals?.waiting);
  const elementBuffering = Boolean(playbackHealth?.elementSignals?.buffering);

  const computeRecoveryWatchdogMs = useCallback((attempts = 1) => {
    const baseCandidates = [RECOVERY_WATCHDOG_BASE_MS];
    if (Number.isFinite(effectiveHardRecoverAfterStalledForMs)) {
      baseCandidates.push(effectiveHardRecoverAfterStalledForMs);
    }
    if (Number.isFinite(effectiveLoadingGraceMs)) {
      baseCandidates.push(effectiveLoadingGraceMs);
    }
    if (Number.isFinite(stallDetectionThresholdMs)) {
      baseCandidates.push(stallDetectionThresholdMs * 2);
    }

    const base = Math.max(...baseCandidates.filter((value) => Number.isFinite(value) && value > 0));
    const normalizedAttempts = Math.max(1, attempts);
    const exponent = Math.max(0, normalizedAttempts - 1);
    const delay = base * (RECOVERY_WATCHDOG_FACTOR ** exponent);
    return Math.min(Math.round(delay), RECOVERY_WATCHDOG_MAX_MS);
  }, [effectiveHardRecoverAfterStalledForMs, effectiveLoadingGraceMs, stallDetectionThresholdMs]);

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
    if (userIntent === USER_INTENT.paused) {
      if (stallStateRef.current?.id) {
        resolveStallLifecycle('paused-intent');
      }
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
  }, [userIntent, status, resilienceActions, resolveStallLifecycle]);

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
    if (status === STATUS.playing || status === STATUS.paused) {
      if (recoveryOutcomeTimerRef.current) {
        logResilienceEvent('stall-recovery-watchdog-cleared', {
          reason: 'playback-progress',
          status,
          attempts: resilienceState.recoveryAttempts
        }, { level: 'debug', tags: ['recovery', 'watchdog'] });
      }
      clearTimer(recoveryOutcomeTimerRef);
      return;
    }

    if (status !== STATUS.recovering && status !== STATUS.stalling) {
      clearTimer(recoveryOutcomeTimerRef);
      return;
    }

    const attempts = resilienceState.recoveryAttempts || 0;
    const timeoutMs = computeRecoveryWatchdogMs(attempts || 1);
    const stallSnapshot = stallStateRef.current || {};

    clearTimer(recoveryOutcomeTimerRef);
    recoveryOutcomeTimerRef.current = setTimeout(() => {
      logResilienceEvent('stall-recovery-watchdog-timeout', {
        attempts,
        timeoutMs,
        status: statusRef.current,
        stallId: stallSnapshot.id || null,
        stallToken: stallSnapshot.token || null,
        stallStartedAt: stallSnapshot.startedAt || null,
        stallDurationMs: stallSnapshot.startedAt ? Math.max(0, Date.now() - stallSnapshot.startedAt) : null,
        bufferRunwayMs,
        classification: stallClassification?.type || null
      }, { level: 'error', tags: ['stall', 'recovery', 'watchdog'] });
    }, timeoutMs);

    return () => clearTimer(recoveryOutcomeTimerRef);
  }, [
    bufferRunwayMs,
    clearTimer,
    computeRecoveryWatchdogMs,
    logResilienceEvent,
    resilienceState.recoveryAttempts,
    stallClassification,
    status,
    statusRef
  ]);

  useEffect(() => {
    if (!startupTimeoutMs || startupTimeoutMs <= 0) {
      clearStartupTimeout();
      publishStartupWatchdogState({ active: false, state: 'idle', reason: 'disabled' });
      startupAttemptsRef.current = 0;
      return;
    }
    const waitingState = status === STATUS.pending || status === STATUS.recovering;
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
          attempts: startupAttemptsRef.current,
          elapsedMs: startupWatchdogStartRef.current
            ? Math.max(0, Date.now() - startupWatchdogStartRef.current)
            : null
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
      startupWatchdogStartRef.current = null;
      startupArmedKeyRef.current = null;
      return;
    }

    if (hasProgressSignal) {
      if (startupTimeoutRef.current) {
        logResilienceEvent('startup-watchdog-cleared', {
          reason: 'progress-detected',
          attempts: startupAttemptsRef.current,
          elapsedMs: startupWatchdogStartRef.current
            ? Math.max(0, Date.now() - startupWatchdogStartRef.current)
            : null
        }, { level: 'debug' });
      }
      const startupStartTs = startupWatchdogStartRef.current;
      if (startupStartTs) {
        const durationMs = Math.max(0, Date.now() - startupStartTs);
        logMetric('startup_duration_ms', {
          durationMs,
          attempts: startupAttemptsRef.current
        }, { level: 'info', tags: ['metric', 'startup'] });
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
      startupWatchdogStartRef.current = null;
      startupArmedKeyRef.current = null;
      return;
    }

    if (startupTimeoutRef.current) {
      return;
    }

    if (startupArmedKeyRef.current !== waitKey) {
      logResilienceEvent('startup-watchdog-armed', {
        timeoutMs: startupTimeoutMs,
        attempts: startupAttemptsRef.current,
        reporterAttachmentActive,
        reporterProgressSignal,
        reporterPlayingSignal
      }, { level: 'debug' });
    }
    publishStartupWatchdogState({
      active: true,
      state: 'armed',
      reason: reporterAttachmentActive ? 'media-el-attached' : 'waiting-for-attachment',
      attempts: startupAttemptsRef.current,
      timestamp: Date.now()
    });
    startupWatchdogStartRef.current = Date.now();
    startupArmedKeyRef.current = waitKey;

    // Arm tiered startup watchdog actions
    const tierTimers = [];
    startupWatchdogTiers.forEach((tier) => {
      const { atMs, action } = tier || {};
      if (!Number.isFinite(atMs) || atMs <= 0) return;
      tierTimers.push(setTimeout(() => {
        if (action === 'warn') {
          logResilienceEvent('startup-watchdog-warning', {
            atMs,
            attempts: startupAttemptsRef.current
          }, { level: 'warn' });
          metricsRef.current.startupInterventions += 1;
          logMetric('startup_intervention_count', {
            count: metricsRef.current.startupInterventions,
            action
          }, { level: 'info', tags: ['metric', 'startup'] });
          return;
        }

        if (action === 'remount') {
          logResilienceEvent('startup-timeout', {
            attempt: startupAttemptsRef.current + 1,
            maxAttempts: startupMaxAttempts,
            timeoutMs: atMs
          }, { level: 'warn' });
          startupAttemptsRef.current += 1;
          const maxAttempts = Number.isFinite(startupMaxAttempts) ? startupMaxAttempts : null;
          const reachedMax = maxAttempts != null && startupAttemptsRef.current >= maxAttempts;
          publishStartupWatchdogState({
            active: !reachedMax,
            state: reachedMax ? 'aborted' : 'timeout',
            reason: 'startup-timeout',
            attempts: startupAttemptsRef.current,
            timestamp: Date.now()
          });
          metricsRef.current.startupInterventions += 1;
          logMetric('startup_intervention_count', {
            count: metricsRef.current.startupInterventions,
            action
          }, { level: 'info', tags: ['metric', 'startup'] });

          if (reachedMax) {
            forcePlayerRemount('startup-timeout-max', {
              seekToIntentMs: resolveSeekIntentMs()
            });
          } else {
            triggerRecovery('startup-timeout', {
              ignorePaused: true,
              force: true,
              seekToIntentMs: resolveSeekIntentMs()
            });
          }
          return;
        }

        if (action === 'hard-reload') {
          logResilienceEvent('startup-hard-timeout', {
            attempts: startupAttemptsRef.current,
            timeoutMs: atMs
          }, { level: 'error' });
          metricsRef.current.startupInterventions += 1;
          logMetric('startup_intervention_count', {
            count: metricsRef.current.startupInterventions,
            action
          }, { level: 'warn', tags: ['metric', 'startup'] });
          publishStartupWatchdogState({
            active: false,
            state: 'aborted',
            reason: 'startup-hard-timeout',
            attempts: startupAttemptsRef.current,
            timestamp: Date.now()
          });
          triggerRecovery('startup-hard-timeout', {
            ignorePaused: true,
            force: true,
            seekToIntentMs: resolveSeekIntentMs()
          });
        }
      }, atMs));
    });

    startupTierTimersRef.current = tierTimers;

    // Preserve existing max-attempts guard using the primary timeout (remount tier)
    startupTimeoutRef.current = tierTimers.find(Boolean) || null;
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
    if (!loadingIntentActive || monitorSuspended || status === STATUS.recovering) {
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
  }, [clearTimer, clearMountWatchdog, clearStartupTimeout]);


  const startupWatchdogState = internalStartupWatchdogState;
  const isStartupPhase = status === RESILIENCE_STATUS.startup;
  const waitingToPlay = isStartupPhase || status === STATUS.recovering;
  const baseSystemHealth = (() => {
    if (userIntent === USER_INTENT.paused) {
      return SYSTEM_HEALTH.ok;
    }
    // Governance-paused video is not stalled - it's intentionally stopped
    if (externalPauseReason === 'PAUSED_GOVERNANCE') {
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
    if (typeof stalledOverride === 'boolean') {
      return stalledOverride ? SYSTEM_HEALTH.stalled : SYSTEM_HEALTH.ok;
    }
    return baseSystemHealth;
  })();
  const computedStalled = userIntent !== USER_INTENT.paused
    && (systemHealth === SYSTEM_HEALTH.stalled || status === STATUS.recovering);
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

  const resolvedPlexId = plexId || meta?.media_key || meta?.key || meta?.plex || null;
  const intentMsForDisplay = resolveSeekIntentMs();

  const presentation = useResiliencePresentation({
    overlayConfig,
    debugRevealDelayMs: debugConfig.revealDelayMs,
    waitKey,
    logWaitKey,
    status,
    explicitShow,
    isSeeking,
    getMediaEl,
    meta,
    hardRecoverAfterStalledForMs: effectiveHardRecoverAfterStalledForMs,
    loadingGraceMs: effectiveLoadingGraceMs,
    triggerRecovery,
    stallOverlayActive,
    waitingToPlay,
    playbackHasProgress,
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
    lastProgressTs: lastProgressTsRef.current,
    requestOverlayHardReset,
    systemHealth,
    startupWatchdogState: internalStartupWatchdogState,
    intentMsForDisplay
  });

  const { overlayProps, presentationState, controls: presentationControls } = presentation;
  const {
    isOverlayVisible,
    showPauseOverlay,
    shouldRenderOverlay,
    pauseOverlayActive,
    showDebug
  } = presentationState;
  const {
    togglePauseOverlay,
    setOverlayPausePreference,
    resetOverlayState
  } = presentationControls;

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
    clearTimer(stallTimerRef);
    clearTimer(reloadTimerRef);
    resilienceActions.setStatus(STATUS.playing, {
      clearStallToken: true,
      clearRecoveryGuard: true,
      resetAttempts: true
    });
    setHardResetLoopCount(0);
    resolveLoadingIntent();
  }, [clearTimer, resilienceActions, setHardResetLoopCount, resolveLoadingIntent]);

  const state = useMemo(() => ({
    status,
    policyState,
    waitingToPlay,
    waitingForPlayback: waitingToPlay,
    graceElapsed: !waitingToPlay,
    loadingIntentActive,
    isOverlayVisible,
    showPauseOverlay,
    showDebug,
    stalled: computedStalled,
    stallClassification,
    seconds,
    isPaused: resolvedIsPaused,
    isSeeking,
    userIntent,
    systemHealth,
    meta,
    waitKey,
    lastFetchAt,
    shouldRenderOverlay,
    playbackHealth,
    hardRecoverAfterStalledForMs: effectiveHardRecoverAfterStalledForMs,
    hardRecoverLoadingGraceMs: effectiveLoadingGraceMs
  }), [
    status,
    policyState,
    waitingToPlay,
    loadingIntentActive,
    isOverlayVisible,
    showPauseOverlay,
    showDebug,
    computedStalled,
    stallClassification,
    systemHealth,
    seconds,
    resolvedIsPaused,
    isSeeking,
    userIntent,
    meta,
    waitKey,
    lastFetchAt,
    shouldRenderOverlay,
    playbackHealth,
    effectiveHardRecoverAfterStalledForMs,
    effectiveLoadingGraceMs
  ]);
  const stateRef = useLatest(state);

  const stateNotifySignature = useMemo(() => ({
    status,
    systemHealth,
    userIntent,
    computedStalled,
    waitKey,
    isPaused: resolvedIsPaused,
    isSeeking,
    seconds: Math.round(normalizedSeconds * 10) / 10,
    waitingToPlay,
    stallClassification,
    recoveryAttempts: resilienceState.recoveryAttempts,
    startupWatchdogState: internalStartupWatchdogState.state,
    startupWatchdogActive: internalStartupWatchdogState.active,
    startupWatchdogAttempts: internalStartupWatchdogState.attempts
  }), [
    status,
    systemHealth,
    userIntent,
    computedStalled,
    waitKey,
    resolvedIsPaused,
    isSeeking,
    normalizedSeconds,
    waitingToPlay,
    stallClassification,
    resilienceState.recoveryAttempts,
    internalStartupWatchdogState.state,
    internalStartupWatchdogState.active,
    internalStartupWatchdogState.attempts
  ]);

  const lastNotifiedSignatureRef = useRef(null);
  const notifyGuardRef = useRef(createReentryGuard());
  const pendingNotifyTimerRef = useRef(null);
  const pendingNotifySignatureRef = useRef(null);

  const debugStateSnapshotRef = useRef({
    userIntent,
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
    if (typeof onStateChange !== 'function') return;
    if (typeof onStateChange !== 'function') return;
    const prev = lastNotifiedSignatureRef.current;
    const next = stateNotifySignature;
    if (prev && shallowEqualObjects(prev, next)) {
      return;
    }

    // Batch notifications to the next tick to avoid synchronous update cascades
    pendingNotifySignatureRef.current = next;
    if (pendingNotifyTimerRef.current) return;

    pendingNotifyTimerRef.current = setTimeout(() => {
      pendingNotifyTimerRef.current = null;
      const guard = notifyGuardRef.current;
      if (!guard.enter()) {
        return;
      }
      try {
        const signature = pendingNotifySignatureRef.current;
        pendingNotifySignatureRef.current = null;
        lastNotifiedSignatureRef.current = signature;
        onStateChange(stateRef.current);
      } finally {
        guard.exit();
      }
    }, 0);

    return () => {
      if (pendingNotifyTimerRef.current) {
        clearTimeout(pendingNotifyTimerRef.current);
        pendingNotifyTimerRef.current = null;
        pendingNotifySignatureRef.current = null;
      }
    };
  }, [onStateChange, stateNotifySignature, stateRef]);

  const controller = useMemo(() => ({
    reset: () => {
      resetDetectionState();
      resilienceActions.reset({ nextStatus: STATUS.pending, clearCarry: true });
      resetOverlayState();
      setHardResetLoopCount(0);
      markLoadingIntentActive();
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
    setOverlayPausePreference,
    setHardResetLoopCount,
    markLoadingIntentActive
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

  return { overlayProps, controller, state, onStartupSignal: handleStartupSignal };
}
