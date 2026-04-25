import React, { useRef, useCallback, useState, useEffect, useMemo, forwardRef, useImperativeHandle } from 'react';
import PropTypes from 'prop-types';
import './styles/Player.scss';
import { useQueueController } from './hooks/useQueueController.js';
import { SinglePlayer } from './components/SinglePlayer.jsx';
import { AudioLayer } from './components/AudioLayer.jsx';
import { PlayerOverlayLoading } from './components/PlayerOverlayLoading.jsx';
import { PlayerOverlayPaused } from './components/PlayerOverlayPaused.jsx';
import { PlayerOverlayStateDebug } from './components/PlayerOverlayStateDebug.jsx';
import { PlayerOverlayAutoplayBlocked } from './components/PlayerOverlayAutoplayBlocked.jsx';
import { useMediaResilience, mergeMediaResilienceConfig } from './hooks/useMediaResilience.js';
import { usePlaybackSession } from './hooks/usePlaybackSession.js';
import { guid } from './lib/helpers.js';
import { playbackLog } from './lib/playbackLogger.js';
import { resolveMediaIdentity } from './utils/mediaIdentity.js';
import { useMediaTransportAdapter } from './hooks/transport/useMediaTransportAdapter.js';
import { guardedReload } from '../../lib/reloadGuard.js';
import { shouldSkipResilienceReload } from './lib/shouldSkipResilienceReload.js';

const REMOUNT_BACKOFF_BASE_MS = 1000;
const REMOUNT_BACKOFF_FACTOR = 1.5;
const REMOUNT_BACKOFF_MAX_MS = 45000;

const reloadDocument = (reason = 'player-resilience') => {
  guardedReload({
    reason,
    fallbackAction: () => {
      // When reloads are blocked, set a state flag instead
      // This allows the UI to show a "please refresh manually" message
      if (typeof window !== 'undefined') {
        window.__playerReloadBlocked = true;
        // Dispatch event for any listeners
        window.dispatchEvent(new CustomEvent('player:reload-blocked', {
          detail: { reason, timestamp: Date.now() }
        }));
      }
    }
  });
};

const entryGuidCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
const ensureEntryGuid = (source) => {
  if (!source) return null;
  if (source.guid) return source.guid;
  if (typeof source !== 'object') return guid();  // primitives can't be WeakMap keys
  if (!entryGuidCache) return guid();
  if (entryGuidCache.has(source)) {
    return entryGuidCache.get(source);
  }
  const value = guid();
  entryGuidCache.set(source, value);
  return value;
};

const createDefaultMediaAccess = () => ({
  getMediaEl: null,
  hardReset: null,
  fetchVideoInfo: null,
  nudgePlayback: null,
  getTroubleDiagnostics: null
});

const createDefaultPlaybackMetrics = () => ({
  seconds: 0,
  isPaused: false,
  isSeeking: false,
  pauseIntent: null,
  diagnostics: null,
  diagnosticsVersion: 0,
  stalled: false,
  stallState: null
});

/**
 * Main Player component
 * Handles both single media playback and queue/playlist management
 * Supports composite overlays (video with audio background)
 */
const Player = forwardRef(function Player(props, ref) {
  const noop = useMemo(() => () => {}, []);

  let {
    play,
    queue,
    clear = noop,
    playbackrate,
    playbackKeys,
    playerType,
    ignoreKeys,
    keyboardOverrides,
    resilience,
    mediaResilienceConfig,
    onResilienceState,
    mediaResilienceRef,
    maxVideoBitrate,
    maxResolution,
    pauseDecision,
    plexClientSession: externalPlexClientSession
  } = props || {};

  // Override playback rate if passed in via menu selection
  if (playbackrate && play) play['playbackRate'] = playbackrate;

  const {
    classes,
    cycleThroughClasses,
    shader: queueShader,
    shaderUserCycled,
    setShader,
    isQueue,
    volume: queueVolume,
    queuePosition,
    playbackRate: queuePlaybackRate,
    playQueue,
    advance,
    queueAudio
  } = useQueueController({ play, queue, clear, shuffle: props?.shuffle });

  const hasNextQueueItem = useMemo(() => (
    isQueue
    && Array.isArray(playQueue)
    && playQueue.length > 1
  ), [isQueue, playQueue]);

  const activeSource = useMemo(() => {
    if (isQueue && playQueue?.length > 0) {
      return playQueue[0];
    }
    if (play && !Array.isArray(play)) {
      return play;
    }
    return null;
  }, [isQueue, playQueue, play]);

  // Auto-dismiss if no playable source materializes within 30s
  // Catches garbage queues, failed resolutions, and missing content
  useEffect(() => {
    if (activeSource) return;
    const timeout = setTimeout(() => {
      playbackLog('player-no-source-timeout', {
        isQueue,
        queueLength: playQueue?.length ?? 0,
        hasPlay: !!play,
      }, { level: 'error' });
      clear?.();
    }, 30000);
    return () => clearTimeout(timeout);
  }, [activeSource, isQueue, playQueue, play, clear]);

  const currentMediaGuid = useMemo(() => {
    if (!activeSource) return null;
    if (activeSource.guid) return activeSource.guid;
    return ensureEntryGuid(activeSource);
  }, [activeSource]);

  const singlePlayerProps = useMemo(() => {
    if (!activeSource) return null;
    const cloned = { ...activeSource };
    if (!cloned.guid && currentMediaGuid) {
      cloned.guid = currentMediaGuid;
    }

    // Ensure plex ID is a string (fix prop type error)
    if (cloned.plex != null) {
      cloned.plex = String(cloned.plex);
    }

    const rootPlay = (play && typeof play === 'object' && !Array.isArray(play)) ? play : null;
    const rootQueue = (queue && typeof queue === 'object' && !Array.isArray(queue)) ? queue : null;
    const resolvedMaxVideoBitrate =
      cloned.maxVideoBitrate
      ?? maxVideoBitrate
      ?? rootPlay?.maxVideoBitrate
      ?? rootQueue?.maxVideoBitrate
      ?? null;
    if (resolvedMaxVideoBitrate != null && cloned.maxVideoBitrate == null) {
      cloned.maxVideoBitrate = resolvedMaxVideoBitrate;
    }

    const resolvedMaxResolution =
      cloned.maxResolution
      ?? maxResolution
      ?? rootPlay?.maxResolution
      ?? rootQueue?.maxResolution
      ?? null;
    if (resolvedMaxResolution != null && cloned.maxResolution == null) {
      cloned.maxResolution = resolvedMaxResolution;
    }

    // Resolve upscaleEffects from item, play, or queue level
    const resolvedUpscaleEffects =
      cloned.upscaleEffects
      ?? rootPlay?.upscaleEffects
      ?? rootQueue?.upscaleEffects
      ?? 'auto';
    cloned.upscaleEffects = resolvedUpscaleEffects;

    return cloned;
  }, [activeSource, currentMediaGuid, play, queue, maxVideoBitrate, maxResolution]);

  const [resolvedMeta, setResolvedMeta] = useState(null);
  const [mediaAccess, setMediaAccess] = useState(() => createDefaultMediaAccess());
  const [playbackMetrics, setPlaybackMetrics] = useState(() => createDefaultPlaybackMetrics());
  const [remountState, setRemountState] = useState(() => ({ guid: currentMediaGuid || null, nonce: 0, context: null }));
  const resilienceBridgeRef = useRef(null);
  const remountInfoRef = useRef(remountState);
  const remountTimerRef = useRef(null);

  useEffect(() => {
    remountInfoRef.current = remountState;
  }, [remountState]);

  const clearRemountTimer = useCallback(() => {
    if (remountTimerRef.current) {
      clearTimeout(remountTimerRef.current);
      remountTimerRef.current = null;
    }
  }, []);

  const computeRemountDelayMs = useCallback((attempt = 1) => {
    const normalizedAttempt = Math.max(1, attempt);
    if (normalizedAttempt <= 1) return 0;
    const exponent = Math.max(0, normalizedAttempt - 2);
    const delay = REMOUNT_BACKOFF_BASE_MS * (REMOUNT_BACKOFF_FACTOR ** exponent);
    return Math.min(Math.round(delay), REMOUNT_BACKOFF_MAX_MS);
  }, []);

  useEffect(() => {
    setResolvedMeta(null);
    setMediaAccess(createDefaultMediaAccess());
    setPlaybackMetrics(createDefaultPlaybackMetrics());
    setRemountState((prev) => (prev.guid === currentMediaGuid ? prev : { guid: currentMediaGuid || null, nonce: 0, context: null }));
    clearRemountTimer();
  }, [currentMediaGuid, clearRemountTimer]);

  const effectiveMeta = resolvedMeta || singlePlayerProps || null;
  const plexId = queue?.plex || play?.plex || effectiveMeta?.plex || effectiveMeta?.assetId || null;

  const mediaIdentity = useMemo(
    () => resolveMediaIdentity(effectiveMeta) || resolveMediaIdentity(singlePlayerProps) || resolveMediaIdentity(play) || resolveMediaIdentity(queue),
    [effectiveMeta, singlePlayerProps, play, queue]
  );

  const playbackSessionKey = useMemo(() => {
    const identifier = currentMediaGuid ?? mediaIdentity;
    return identifier ? `player-session:${identifier}` : 'player-session:idle';
  }, [currentMediaGuid, mediaIdentity]);

  const explicitStartProvided = effectiveMeta && Object.prototype.hasOwnProperty.call(effectiveMeta, 'seconds');
  const explicitStartSeconds = explicitStartProvided
    ? Math.max(0, Number(effectiveMeta.seconds) || 0)
    : null;

  const {
    targetTimeSeconds,
    setTargetTimeSeconds,
    consumeTargetTimeSeconds,
    volume: sessionVolume,
    playbackRate: sessionPlaybackRate,
    setVolume: setSessionVolume,
    setPlaybackRate: setSessionPlaybackRate
  } = usePlaybackSession({ sessionKey: playbackSessionKey, defaults: { targetTimeSeconds: explicitStartSeconds } });

  const handleResolvedMeta = useCallback((meta) => {
    if (!meta) {
      return;
    }
    setResolvedMeta(meta);
  }, []);

  const handlePlaybackMetrics = useCallback((metrics = {}) => {
    setPlaybackMetrics((prev) => {
      const nextPauseIntent = Object.prototype.hasOwnProperty.call(metrics, 'pauseIntent')
        ? (metrics.pauseIntent === 'user' || metrics.pauseIntent === 'system' || metrics.pauseIntent === null
          ? metrics.pauseIntent
          : prev.pauseIntent)
        : prev.pauseIntent;
      const diagnosticsProvided = Object.prototype.hasOwnProperty.call(metrics, 'diagnostics');
      const nextDiagnostics = diagnosticsProvided ? (metrics.diagnostics || null) : prev.diagnostics;
      const nextDiagnosticsVersion = Number.isFinite(metrics.diagnosticsVersion)
        ? metrics.diagnosticsVersion
        : (diagnosticsProvided && nextDiagnostics !== prev.diagnostics
          ? prev.diagnosticsVersion + 1
          : prev.diagnosticsVersion);
      const next = {
        seconds: Number.isFinite(metrics.seconds) ? metrics.seconds : prev.seconds,
        isPaused: typeof metrics.isPaused === 'boolean' ? metrics.isPaused : prev.isPaused,
        isSeeking: typeof metrics.isSeeking === 'boolean' ? metrics.isSeeking : prev.isSeeking,
        pauseIntent: nextPauseIntent,
        diagnostics: nextDiagnostics,
        diagnosticsVersion: nextDiagnosticsVersion,
        stalled: typeof metrics.stalled === 'boolean' ? metrics.stalled : prev.stalled,
        stallState: metrics.stallState !== undefined ? metrics.stallState : prev.stallState
      };
      // Test hook for contract tests
      if (typeof window !== 'undefined' && window.__TEST_CAPTURE_METRICS__) {
        window.__TEST_LAST_METRICS__ = next;
      }
      if (
        prev.seconds === next.seconds
        && prev.isPaused === next.isPaused
        && prev.isSeeking === next.isSeeking
        && prev.pauseIntent === next.pauseIntent
        && prev.diagnostics === next.diagnostics
        && prev.diagnosticsVersion === next.diagnosticsVersion
        && prev.stalled === next.stalled
        && prev.stallState === next.stallState
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  const handleRegisterMediaAccess = useCallback((access = {}) => {
    const newMediaAccess = {
      getMediaEl: typeof access.getMediaEl === 'function' ? access.getMediaEl : null,
      hardReset: typeof access.hardReset === 'function' ? access.hardReset : null,
      fetchVideoInfo: typeof access.fetchVideoInfo === 'function' ? access.fetchVideoInfo : null,
      nudgePlayback: typeof access.nudgePlayback === 'function' ? access.nudgePlayback : null,
      getTroubleDiagnostics: typeof access.getTroubleDiagnostics === 'function' ? access.getTroubleDiagnostics : null,
      autoplayBlocked: !!access.autoplayBlocked,
      onAutoplayResolved: typeof access.onAutoplayResolved === 'function' ? access.onAutoplayResolved : null
    };
    setMediaAccess((prev) => {
      const unchanged = Boolean(prev)
        && prev.getMediaEl === newMediaAccess.getMediaEl
        && prev.hardReset === newMediaAccess.hardReset
        && prev.fetchVideoInfo === newMediaAccess.fetchVideoInfo
        && prev.nudgePlayback === newMediaAccess.nudgePlayback
        && prev.getTroubleDiagnostics === newMediaAccess.getTroubleDiagnostics
        && prev.autoplayBlocked === newMediaAccess.autoplayBlocked
        && prev.onAutoplayResolved === newMediaAccess.onAutoplayResolved;

      const resolved = unchanged ? prev : newMediaAccess;
      mediaAccessRef.current = resolved;
      // Test hook for contract tests
      if (typeof window !== 'undefined' && window.__TEST_CAPTURE_METRICS__) {
        window.__TEST_MEDIA_ACCESS__ = resolved;
      }
      return resolved;
    });
  }, []);

  const handleRegisterResilienceBridge = useCallback((bridge) => {
    resilienceBridgeRef.current = bridge || null;
  }, []);

  const handleSeekRequestConsumed = useCallback(() => {
    consumeTargetTimeSeconds();
  }, [consumeTargetTimeSeconds]);

  const resolvedWaitKey = useMemo(() => {
    if (!effectiveMeta) return 'player-idle';
    const fallback = mediaIdentity || effectiveMeta.waitKey || 'player-entry';
    return `${fallback}:${remountState.nonce}`;
  }, [effectiveMeta, mediaIdentity, remountState.nonce]);

  const forceSinglePlayerRemount = useCallback((input = null, meta = {}) => {
    const options = (input && typeof input === 'object' && !Array.isArray(input))
      ? input
      : { seekSeconds: input };
    const {
      seekSeconds = null,
      reason = 'unspecified',
      source = 'player',
      trigger = undefined,
      conditions = undefined
    } = options || {};

    const { scheduledDelayMs = 0, attempt: attemptOverride = null } = meta || {};

    const normalized = Number.isFinite(seekSeconds) ? Math.max(0, seekSeconds) : null;
    const metaKey = mediaIdentity;
    const currentRemountNonce = remountInfoRef.current?.nonce ?? 0;
    const attempt = Number.isFinite(attemptOverride)
      ? attemptOverride
      : currentRemountNonce + 1;
    const diagnostics = {
      reason,
      source,
      seekSeconds: normalized,
      trigger,
      conditions,
      waitKey: resolvedWaitKey,
      remountNonce: currentRemountNonce + 1,
      timestamp: Date.now(),
      scheduledDelayMs,
      attempt
    };

    playbackLog('player-remount', {
      waitKey: resolvedWaitKey,
      reason,
      source,
      seekSeconds: normalized,
      guid: currentMediaGuid,
      remountNonce: currentRemountNonce,
      attempt,
      backoffMs: scheduledDelayMs,
      playerType: playerType || null,
      isQueue,
      metaKey,
      playbackSeconds: playbackMetrics?.seconds ?? null,
      isPaused: playbackMetrics?.isPaused ?? null,
      isSeeking: playbackMetrics?.isSeeking ?? null,
      trigger,
      conditions
    });

    setTargetTimeSeconds(normalized);
    setMediaAccess(createDefaultMediaAccess());
    setPlaybackMetrics(createDefaultPlaybackMetrics());
    setRemountState((prev) => {
      if (prev.guid !== currentMediaGuid) {
        return { guid: currentMediaGuid || null, nonce: 0, context: diagnostics };
      }
      return { guid: prev.guid, nonce: prev.nonce + 1, context: diagnostics };
    });
  }, [currentMediaGuid, effectiveMeta, isQueue, playerType, playbackMetrics, resolvedWaitKey, setTargetTimeSeconds]);

  const scheduleSinglePlayerRemount = useCallback((input = null) => {
    const attempt = (remountInfoRef.current?.nonce ?? 0) + 1;
    const backoffMs = computeRemountDelayMs(attempt);

    clearRemountTimer();

    playbackLog('player-remount-scheduled', {
      waitKey: resolvedWaitKey,
      attempt,
      backoffMs,
      guid: currentMediaGuid,
      playerType: playerType || null,
      isQueue,
      playbackSeconds: playbackMetrics?.seconds ?? null
    }, { level: backoffMs > 0 ? 'info' : 'debug' });

    if (!Number.isFinite(backoffMs) || backoffMs <= 0) {
      forceSinglePlayerRemount(input, { scheduledDelayMs: 0, attempt });
      return;
    }

    remountTimerRef.current = setTimeout(() => {
      remountTimerRef.current = null;
      forceSinglePlayerRemount(input, { scheduledDelayMs: backoffMs, attempt });
    }, backoffMs);
  }, [currentMediaGuid, clearRemountTimer, computeRemountDelayMs, forceSinglePlayerRemount, isQueue, playbackMetrics, playerType, resolvedWaitKey]);

  const singlePlayerKey = useMemo(() => {
    if (!singlePlayerProps) return 'player-idle';
    // Stable key for image→image transitions so ImageFrame persists (cross-dissolve)
    if (activeSource?.mediaType === 'image') {
      return `image-slideshow:${remountState.nonce}`;
    }
    return `${currentMediaGuid || 'entry'}:${remountState.nonce}`;
  }, [singlePlayerProps, currentMediaGuid, remountState.nonce, activeSource?.mediaType]);

  const exposedMediaRef = useRef(null);
  const controllerRef = useRef(null);
  const fallbackResilienceRef = useRef(null);
  // Mirror mediaAccess state as a ref so the imperative handle can read the
  // latest getMediaEl without needing mediaAccess in its dependency array.
  // This is the key bridge for content renderers (ReadalongScroller, etc.)
  // that register their <audio> element via onRegisterMediaAccess but don't
  // set controllerRef or exposedMediaRef.
  const mediaAccessRef = useRef(null);

  const {
    sanitizedSinglePlayerProps,
    inlineItemResilience,
    deprecatedItemConfig,
    deprecatedItemOnState,
    deprecatedItemControllerRef
  } = useMemo(() => {
    if (!singlePlayerProps) {
      return {
        sanitizedSinglePlayerProps: null,
        inlineItemResilience: null,
        deprecatedItemConfig: null,
        deprecatedItemOnState: null,
        deprecatedItemControllerRef: null
      };
    }
    const {
      resilience: inlineResilience,
      mediaResilienceConfig: legacyConfig,
      onResilienceState: legacyOnState,
      mediaResilienceRef: legacyControllerRef,
      key: _unusedKey,
      ...rest
    } = singlePlayerProps;
    return {
      sanitizedSinglePlayerProps: rest,
      inlineItemResilience: inlineResilience,
      deprecatedItemConfig: legacyConfig,
      deprecatedItemOnState: legacyOnState,
      deprecatedItemControllerRef: legacyControllerRef
    };
  }, [singlePlayerProps]);

  const legacyItemResilience = singlePlayerProps
    ? {
        config: deprecatedItemConfig,
        onStateChange: deprecatedItemOnState,
        controllerRef: deprecatedItemControllerRef
      }
    : null;

  const itemResilience = inlineItemResilience || legacyItemResilience || null;

  const baseResilienceConfig = resilience?.config ?? mediaResilienceConfig;
  const baseResilienceOnState = resilience?.onStateChange ?? onResilienceState;
  const baseResilienceControllerRef = resilience?.controllerRef ?? mediaResilienceRef ?? null;

  const resolvedResilience = {
    config: mergeMediaResilienceConfig(baseResilienceConfig, itemResilience?.config),
    onStateChange: itemResilience?.onStateChange ?? baseResilienceOnState,
    controllerRef: itemResilience?.controllerRef ?? baseResilienceControllerRef ?? fallbackResilienceRef
  };

  const resilienceControllerRef = resolvedResilience.controllerRef;

  const transportAdapter = useMediaTransportAdapter({ controllerRef, mediaAccess, resilienceBridge: resilienceBridgeRef.current });

  const resolvedResilienceOnState = resolvedResilience.onStateChange;

  const compositeAwareOnState = useCallback((state) => {
    if (typeof resolvedResilienceOnState === 'function') {
      resolvedResilienceOnState(state);
    }
  }, [resolvedResilienceOnState]);

  const handleResilienceReload = useCallback((options = {}) => {
    // Guard: skip recovery for phantom/unresolvable entries
    if (shouldSkipResilienceReload({ activeSource, playerType, resolvedMeta })) {
      playbackLog('resilience-reload-skipped-phantom', {
        guid: currentMediaGuid,
        hasActiveSource: !!activeSource,
        playerType: playerType || null,
        hasResolvedMeta: !!resolvedMeta,
        reason: options?.reason
      }, { level: 'warn' });
      return;
    }

    const {
      forceDocumentReload: forceDocReload,
      forceFullReload,
      seekToIntentMs,
      refreshUrl,
      meta: _ignoredMeta,
      ...rest
    } = options || {};

    if ((forceDocReload || forceFullReload) && playerType !== 'overlay') {
      reloadDocument();
      return;
    }

    const seekSeconds = Number.isFinite(seekToIntentMs) ? Math.max(0, seekToIntentMs / 1000) : null;

    let hardResetInvoked = false;
    let hardResetErrored = false;
    if (typeof mediaAccess.hardReset === 'function') {
      hardResetInvoked = true;
      try {
        mediaAccess.hardReset({ seekToSeconds: seekSeconds, refreshUrl: Boolean(refreshUrl) });
      } catch (error) {
        hardResetErrored = true;
      }
    }

    const rawTrigger = {
      ...rest,
      seekToIntentMs,
      forceDocumentReload: forceDocReload,
      forceFullReload
    };
    const triggerDetails = Object.fromEntries(
      Object.entries(rawTrigger)
        .filter(([, value]) => typeof value !== 'function' && value !== undefined)
    );

    const conditions = {
      hardResetInvoked,
      hardResetErrored,
      mediaElementPresent: Boolean(transportAdapter.getMediaEl()),
      pendingSeekSeconds: seekSeconds
    };

    // If hardReset succeeded in-place, give it a chance to recover without
    // a full React remount. Remounting via setTimeout breaks the user gesture
    // chain, causing Firefox to block autoplay after 3-4 cycles.
    // The startup deadline timer (15s) in useMediaResilience will trigger
    // another recovery attempt if hardReset fails silently.
    if (hardResetInvoked && !hardResetErrored) {
      playbackLog('player-remount', {
        payload: {
          waitKey: resolvedWaitKey,
          reason: rest?.reason || 'resilience',
          source: 'hard-reset-accepted',
          seekSeconds,
          guid: currentMediaGuid,
          remountNonce: remountInfoRef.current?.nonce ?? 0,
          refreshUrl: Boolean(refreshUrl),
          ...conditions
        }
      });
      return;
    }

    scheduleSinglePlayerRemount({
      seekSeconds,
      reason: rest?.reason || 'resilience',
      source: rest?.source || 'resilience',
      trigger: triggerDetails,
      conditions
    });
  }, [scheduleSinglePlayerRemount, mediaAccess, transportAdapter, playerType, isQueue, advance, clear, currentMediaGuid, resolvedWaitKey, activeSource, resolvedMeta]);

  const handleResilienceExhausted = useCallback(({ reason, attempts, waitKey: exhaustedWaitKey }) => {
    if (isQueue && hasNextQueueItem) {
      playbackLog('resilience-exhausted-auto-skip', {
        reason,
        attempts,
        waitKey: exhaustedWaitKey,
        action: 'advance',
        queueRemaining: playQueue?.length ?? 0
      }, { level: 'warn' });
      advance();
    } else {
      playbackLog('resilience-exhausted-dismiss', {
        reason,
        attempts,
        waitKey: exhaustedWaitKey,
        action: isQueue ? 'queue-end' : 'clear',
        queueRemaining: playQueue?.length ?? 0
      }, { level: 'warn' });
      clear();
    }
  }, [isQueue, hasNextQueueItem, advance, clear, playQueue]);

  // Self-contained formats (titlecard, etc.) have no media element —
  // suppress the resilience overlay which would never exit startup.
  const isSelfContainedFormat = effectiveMeta?.format === 'titlecard';

  const { overlayProps, state: resilienceState, onStartupSignal, cancelDeadline, requestRecovery } = useMediaResilience({
    getMediaEl: transportAdapter.getMediaEl,
    meta: effectiveMeta,
    maxVideoBitrate: effectiveMeta?.maxVideoBitrate
      ?? singlePlayerProps?.maxVideoBitrate
      ?? maxVideoBitrate
      ?? null,
    seconds: effectiveMeta ? playbackMetrics.seconds : 0,
    isPaused: effectiveMeta ? playbackMetrics.isPaused : false,
    isSeeking: effectiveMeta ? playbackMetrics.isSeeking : false,
    pauseIntent: effectiveMeta ? playbackMetrics.pauseIntent : null,
    playbackDiagnostics: effectiveMeta ? playbackMetrics.diagnostics : null,
    initialStart: explicitStartSeconds ?? 0,
    explicitStartProvided,
    waitKey: resolvedWaitKey,
    fetchVideoInfo: mediaAccess.fetchVideoInfo,
    nudgePlayback: transportAdapter.nudge,
    diagnosticsProvider: transportAdapter.readDiagnostics,
    onStateChange: compositeAwareOnState,
    onReload: handleResilienceReload,
    onExhausted: handleResilienceExhausted,
    configOverrides: resolvedResilience.config,
    controllerRef: resilienceControllerRef,
    plexId,
    playbackSessionKey,
    debugContext: { scope: 'player', mediaGuid: currentMediaGuid || null },
    externalPauseReason: pauseDecision?.reason,
    externalPauseActive: pauseDecision?.paused,
    // Pass stall state from useCommonMediaController to avoid duplicate detection
    externalStalled: effectiveMeta ? playbackMetrics.stalled : null,
    externalStallState: effectiveMeta ? playbackMetrics.stallState : null,
    // Self-contained formats (titlecard) have no media element — disable resilience monitoring
    disabled: isSelfContainedFormat
  });

  // Cancel stale resilience deadline when media guid changes.
  // Must be after useMediaResilience (source of cancelDeadline) to avoid TDZ in Firefox.
  useEffect(() => {
    cancelDeadline();
  }, [currentMediaGuid, cancelDeadline]);

  // Get playback rate from the current item, falling back to queue/play level, then default
  const currentItemPlaybackRate = effectiveMeta?.playbackRate || effectiveMeta?.playbackrate;
  const effectivePlaybackRate = (
    currentItemPlaybackRate
    ?? queuePlaybackRate
    ?? sessionPlaybackRate
    ?? 1
  );

  // Get volume from the current item, falling back to queue/play level, then default
  const currentItemVolume = effectiveMeta?.volume;
  const effectiveVolume = (
    currentItemVolume ?? queueVolume ?? sessionVolume ?? 1
  );

  const hasExternalVolume = currentItemVolume != null || queueVolume != null;
  const hasExternalPlaybackRate = currentItemPlaybackRate != null || queuePlaybackRate != null;

  useEffect(() => {
    if (!hasExternalVolume || !Number.isFinite(effectiveVolume)) {
      return;
    }
    if (sessionVolume === effectiveVolume) {
      return;
    }
    setSessionVolume(effectiveVolume);
  }, [effectiveVolume, hasExternalVolume, sessionVolume, setSessionVolume]);

  useEffect(() => {
    if (!hasExternalPlaybackRate || !Number.isFinite(effectivePlaybackRate)) {
      return;
    }
    if (sessionPlaybackRate === effectivePlaybackRate) {
      return;
    }
    setSessionPlaybackRate(effectivePlaybackRate);
  }, [effectivePlaybackRate, hasExternalPlaybackRate, sessionPlaybackRate, setSessionPlaybackRate]);

  // Get shader from the current item, falling back to queue/play level, then default
  // Looped videos default to 'focused' shader (hides progress bar) unless explicitly set
  // Loop conditions: single-item queue or continuous flag
  // Note: short videos (<20s) loop automatically but we can't determine duration at render time
  // Use continuous=true in URL params for short clips that should hide progress bar
  // Shader aliases: legacy names map to canonical shader classes (must match useQueueController)
  const shaderAliases = { dark: 'blackout', minimal: 'focused', regular: 'default', screensaver: 'focused' };
  const currentItemShader = effectiveMeta?.shader;
  const rawExplicitShader = play?.shader || queue?.shader || currentItemShader;
  const explicitShader = shaderAliases[rawExplicitShader] ?? rawExplicitShader;
  const willLoop = (isQueue && playQueue?.length === 1) ||
                   (!isQueue && singlePlayerProps?.continuous);
  // Once the user manually cycles the shader (ArrowUp/ArrowDown), their choice takes
  // precedence over item-level and queue-level metadata until the queue resets.
  const effectiveShader = shaderUserCycled
    ? queueShader
    : explicitShader || (willLoop ? 'focused' : queueShader);

  // Create appropriate advance function for single continuous items
  const singleAdvance = useCallback(() => {
    if (singlePlayerProps?.continuous) {
      // For continuous single items, check if native loop is already handling it
      const mediaEl = document.querySelector(`[data-key="${singlePlayerProps.assetId || singlePlayerProps.plex}"]`);
      if (mediaEl && !mediaEl.loop) {
        // If not using native loop, manually restart
        mediaEl.currentTime = 0;
        mediaEl.play();
      }
      // If using native loop (mediaEl.loop = true), the browser handles it automatically
    } else {
      clear();
    }
  }, [singlePlayerProps?.continuous, singlePlayerProps?.assetId, singlePlayerProps?.plex, clear]);

  // Compose onMediaRef so we keep existing external callback semantics
  const handleMediaRef = useCallback((el) => {
    exposedMediaRef.current = el;
    if (props.onMediaRef) props.onMediaRef(el);
  }, [props.onMediaRef]);

  const handleController = useCallback((controller) => {
    controllerRef.current = controller;
    if (props.onController) props.onController(controller);
  }, [props.onController]);

  const withTransport = useCallback((handler, fallback) => {
    const controller = controllerRef.current;
    if (!controller) {
      return typeof fallback === 'function' ? fallback() : null;
    }
    const api = controller.transport || controller;
    if (!api) {
      return typeof fallback === 'function' ? fallback() : null;
    }
    try {
      return handler(api);
    } catch (_) {
      return null;
    }
  }, []);

  const isValidImperativeRef = typeof ref === 'function' || (ref && typeof ref === 'object' && 'current' in ref);
  // Fallback media element lookup for content renderers (ReadalongScroller, etc.)
  // that register via onRegisterMediaAccess but don't set controllerRef.
  // Uses only refs so the imperative handle closure stays fresh without deps.
  const _getMediaElFallback = () =>
    controllerRef.current?.transport?.getMediaEl?.()
    || exposedMediaRef.current
    || mediaAccessRef.current?.getMediaEl?.()
    || null;

  useImperativeHandle(isValidImperativeRef ? ref : null, () => ({
    seek: (t) => {
      if (!Number.isFinite(t)) return;
      withTransport(
        (api) => api.seek?.(t),
        () => { const el = _getMediaElFallback(); if (el) el.currentTime = t; }
      );
    },
    play: () => {
      withTransport(
        (api) => api.play?.(),
        () => _getMediaElFallback()?.play?.()
      );
    },
    pause: () => {
      withTransport(
        (api) => api.pause?.(),
        () => _getMediaElFallback()?.pause?.()
      );
    },
    toggle: () => {
      withTransport(
        (api) => api.toggle?.(),
        () => {
          const el = _getMediaElFallback();
          if (el) el.paused ? el.play() : el.pause();
        }
      );
    },
    // Fix 1 (bugbash 3A): Expose advance() for external track skip control
    advance: (count = 1) => {
      const advanceFn = isQueue ? advance : singleAdvance;
      if (typeof advanceFn === 'function') {
        for (let i = 0; i < Math.max(1, count); i++) advanceFn();
      }
    },
    getCurrentTime: () => {
      const t = withTransport((api) => api.getCurrentTime?.());
      if (Number.isFinite(t)) return t;
      const el = _getMediaElFallback();
      return (el && Number.isFinite(el.currentTime)) ? el.currentTime : 0;
    },
    getDuration: () => {
      const d = withTransport((api) => api.getDuration?.());
      if (Number.isFinite(d)) return d;
      const el = _getMediaElFallback();
      return (el && Number.isFinite(el.duration)) ? el.duration : 0;
    },
    getMediaElement: _getMediaElFallback,
    getMediaController: () => controllerRef.current,
    getMediaResilienceController: () => resilienceControllerRef.current,
    getMediaResilienceState: () => resilienceControllerRef.current?.getState?.() || null,
    resetMediaResilience: () => resilienceControllerRef.current?.reset?.(),
    forceMediaReload: (opts) => resilienceControllerRef.current?.forceReload?.(opts),
    forceMediaInfoFetch: (opts) => resilienceControllerRef.current?.forceFetchInfo?.(opts),
    getPlaybackState: () => controllerRef.current?.getPlaybackState?.() || controllerRef.current?.transport?.getPlaybackState?.() || null,
    // BUG-06 fix: Clear stale seek state after zoom operations
    clearPendingAutoSeek: () => {
      controllerRef.current?.transport?.clearPendingAutoSeek?.();
    },
    clearSeekIntent: (reason) => {
      resilienceControllerRef.current?.clearSeekIntent?.(reason);
    }
  }), [isQueue, advance, singleAdvance]);

  useEffect(() => () => clearRemountTimer(), [clearRemountTimer]);

  const suppressOverlaysForBlackout = effectiveShader === 'blackout';

  const overlayElements = (overlayProps && !isSelfContainedFormat) ? (
    <>
      <PlayerOverlayLoading {...overlayProps} suppressForBlackout={suppressOverlaysForBlackout} />
      <PlayerOverlayPaused {...overlayProps} suppressForBlackout={suppressOverlaysForBlackout} />
      <PlayerOverlayStateDebug {...overlayProps} />
      <PlayerOverlayAutoplayBlocked
        autoplayBlocked={mediaAccess.autoplayBlocked}
        onAutoplayResolved={mediaAccess.onAutoplayResolved}
        suppressForBlackout={suppressOverlaysForBlackout}
      />
    </>
  ) : null;

  const playerProps = {
    advance: isQueue ? advance : singleAdvance,
    clear,
    shader: effectiveShader,
    volume: effectiveVolume,
    setShader,
    cycleThroughClasses,
    classes,
    playbackRate: effectivePlaybackRate,
    playbackKeys,
    playerType,
    queuePosition,
    queueLength: isQueue ? playQueue?.length ?? 0 : 0,
    ignoreKeys,
    keyboardOverrides,
    onProgress: props.onProgress,
    onMediaRef: handleMediaRef,
    onController: handleController,
    onResolvedMeta: handleResolvedMeta,
    onPlaybackMetrics: handlePlaybackMetrics,
    onRegisterMediaAccess: handleRegisterMediaAccess,
    onRegisterResilienceBridge: handleRegisterResilienceBridge,
    onStartupSignal,
    onRequestRecovery: (payload) => {
      if (typeof requestRecovery === 'function') {
        requestRecovery(payload?.reason);
      }
    },
    seekToIntentSeconds: targetTimeSeconds,
    onSeekRequestConsumed: handleSeekRequestConsumed,
    remountDiagnostics: remountState.context,
    wrapWithContainer: false,
    suppressLocalOverlay: !!overlayElements,
    // Use external session if provided (for multi-player isolation),
    // otherwise generate based on current media GUID and remount nonce
    plexClientSession: externalPlexClientSession || (currentMediaGuid ? `${currentMediaGuid}-r${remountState.nonce}` : null)
  };

  const playerShellClass = ['player', effectiveShader, props.playerType || '']
    .filter(Boolean)
    .join(' ');

  const fallbackContent = overlayElements ? (
    <div className="player-idle-state" />
  ) : (
    <div className="player-idle-state">
      <PlayerOverlayLoading
        shouldRender
        isVisible
        isPaused={false}
        seconds={0}
        stalled={false}
        waitingToPlay
        showPauseOverlay={false}
        showDebug={false}
        togglePauseOverlay={() => {}}
        plexId={plexId}
        debugContext={{ scope: 'idle' }}
        suppressForBlackout={suppressOverlaysForBlackout}
      />
      <PlayerOverlayPaused
        shouldRender
        isVisible
        pauseOverlayActive
        seconds={0}
        stalled={false}
        waitingToPlay
        togglePauseOverlay={() => {}}
        suppressForBlackout={suppressOverlaysForBlackout}
      />
    </div>
  );

  const audioConfig = play?.audio || queue?.audio || queueAudio || activeSource?.audio || null;
  const currentItemMediaType = activeSource?.mediaType || null;
  const nextMedia = useMemo(() => (
    isQueue && Array.isArray(playQueue) && playQueue.length > 1 ? playQueue[1] : null
  ), [isQueue, playQueue]);

  const mainContent = sanitizedSinglePlayerProps ? (
    <SinglePlayer
      key={singlePlayerKey}
      {...sanitizedSinglePlayerProps}
      {...playerProps}
      nextMedia={nextMedia}
    />
  ) : fallbackContent;

  return (
    <div className={playerShellClass}>
      {audioConfig && (
        <AudioLayer
          contentId={audioConfig.contentId}
          behavior={audioConfig.behavior || 'pause'}
          mode={audioConfig.mode || 'hidden'}
          duckLevel={audioConfig.duckLevel}
          currentItemMediaType={currentItemMediaType}
          Player={Player}
          ignoreKeys={ignoreKeys}
        />
      )}
      {overlayElements}
      {mainContent}
    </div>
  );
});

Player.propTypes = {
  play: PropTypes.oneOfType([PropTypes.object, PropTypes.array]),
  queue: PropTypes.oneOfType([PropTypes.object, PropTypes.array]),
  clear: PropTypes.func,
  playbackrate: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  playbackKeys: PropTypes.oneOfType([
    PropTypes.arrayOf(PropTypes.string),
    PropTypes.objectOf(PropTypes.arrayOf(PropTypes.string))
  ]),
  playerType: PropTypes.string,
  ignoreKeys: PropTypes.bool,
  keyboardOverrides: PropTypes.object,
  resilience: PropTypes.shape({
    config: PropTypes.object,
    onStateChange: PropTypes.func,
    controllerRef: PropTypes.shape({ current: PropTypes.any })
  }),
  mediaResilienceConfig: PropTypes.object,
  onResilienceState: PropTypes.func,
  mediaResilienceRef: PropTypes.shape({ current: PropTypes.any }),
  onProgress: PropTypes.func,
  onMediaRef: PropTypes.func,
  onController: PropTypes.func,
  maxVideoBitrate: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  maxResolution: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  /** External Plex client session ID for multi-player isolation */
  plexClientSession: PropTypes.string
};

export default Player;

// Export components for external use
export { PlayerOverlayLoading } from './components/PlayerOverlayLoading.jsx';
export { PlayerOverlayPaused } from './components/PlayerOverlayPaused.jsx';
export { SinglePlayer } from './components/SinglePlayer.jsx';
export { AudioPlayer } from './renderers/AudioPlayer.jsx';
export { VideoPlayer } from './renderers/VideoPlayer.jsx';
