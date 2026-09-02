import React, { useRef, useCallback, useState, useEffect, useMemo, forwardRef, useImperativeHandle } from 'react';
import PropTypes from 'prop-types';
import './styles/Player.scss';
import { useQueueController } from './hooks/useQueueController.js';
import { SinglePlayer } from './components/SinglePlayer.jsx';
import { AudioLayer } from './components/AudioLayer.jsx';
import { AmbientLayer } from './components/AmbientLayer.jsx';
import { PlayerOverlayLoading } from './components/PlayerOverlayLoading.jsx';
import { PlayerOverlayPaused } from './components/PlayerOverlayPaused.jsx';
import { PlayerOverlayStateDebug } from './components/PlayerOverlayStateDebug.jsx';
import { PlayerOverlayAutoplayBlocked } from './components/PlayerOverlayAutoplayBlocked.jsx';
import { useMediaResilience, mergeMediaResilienceConfig, RESILIENCE_STATUS } from './hooks/useMediaResilience.js';
import { useMediaErrorReporter } from './hooks/useMediaErrorReporter.js';
import { usePlaybackSession } from './hooks/usePlaybackSession.js';
import { resolveCollectionKey } from './utils/collectionKey.js';
import { nextPlaybackRate } from './utils/playbackRateCycle.js';
import { guid } from './lib/helpers.js';
import { playbackLog } from './lib/playbackLogger.js';
import { resolveMediaIdentity, resolveSourceContentKey } from './utils/mediaIdentity.js';
import { getLogWaitKey, describeWaitKey } from './lib/waitKeyLabel.js';
import { useMediaTransportAdapter } from './hooks/transport/useMediaTransportAdapter.js';
import { shouldSkipResilienceReload } from './lib/shouldSkipResilienceReload.js';
import { createRemountStormGuard } from './lib/remountStormGuard.js';
import { shouldSkipScheduledRemount } from './lib/scheduledRemountGuard.js';
import { changedKeyComponent } from './lib/keyChange.js';
import { createIdentityChurnCounter } from './lib/identityChurn.js';
import { getLogger } from '../../lib/logging/Logger.js';
import { OnDeckCard } from './components/OnDeckCard.jsx';
import { getPlayerQueueOpRegistry } from './lib/queueOpRegistry.js';
import { usePlayerConfig } from './hooks/usePlayerConfig.js';
import { REVIEW_ACTIVE } from '../../lib/Player/reviewParams.js';
import { DaylightAPI } from '../../lib/api.mjs';

const REMOUNT_BACKOFF_BASE_MS = 1000;
const REMOUNT_BACKOFF_FACTOR = 1.5;
const REMOUNT_BACKOFF_MAX_MS = 45000;

// Circuit breaker on player-key churn. The cap has to clear the legitimate worst
// case: one initial mount plus the five-attempt recovery ladder is six key changes
// inside about eight seconds, and a viewer who then picks something else must not
// be turned away. Ten in thirty seconds leaves that headroom while capping a
// runaway at 20 remounts per minute — the 2026-08-16 storm ran about 124.
//
// The one reachable false trip is rapid manual skipping: eleven "next" presses in
// thirty seconds, which a child with a remote can produce. The consequence is mild —
// content still swaps in place (only the media element's key is frozen), and mountId
// is resolvedWaitKey, which the guard does not gate, so per-item recovery budgets
// still reset per item. The guard re-arms one window after the skipping stops.
const REMOUNT_STORM_MAX_MOUNTS = 10;
const REMOUNT_STORM_WINDOW_MS = 30000;

// Shader aliases must match useQueueController's map. Hoisted to module scope
// so identity is stable across renders (useEffect deps).
const SHADER_ALIASES = { dark: 'blackout', minimal: 'focused', regular: 'default', screensaver: 'focused' };

const entryGuidCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
const ensureEntryGuid = (source) => {
  if (!source) return null;
  if (source.guid) return source.guid;
  // Content-derived and deterministic: an equivalent-but-new source object must
  // NOT mint a new identity (that remounts the video — see 2026-08-16 storm).
  // Hashed, not raw, so the token keeps the opaque short shape that
  // plexClientSession and the logs expect.
  const contentKey = resolveSourceContentKey(source);
  // NOTE: this is the one caller of getLogWaitKey that MINTS AN IDENTITY rather
  // than labelling a log line. Its digest for a non-empty input must stay
  // byte-identical or every entry guid in the fleet moves. (The absence
  // sentinels added in 2026-08-16 Task 4.3 are unreachable here — `contentKey`
  // is truthy on this branch.)
  if (contentKey) return getLogWaitKey(contentKey);
  // Unidentifiable source: fall back to the old per-object random identity.
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
  fetchVideoInfo: null
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
    plexClientSession: externalPlexClientSession,
    onPlaybackCompleted,
    onError,
    mediaLoadTimeoutMs,
    forceShader
  } = props || {};

  // Override playback rate if passed in via menu selection
  if (playbackrate && play) play['playbackRate'] = playbackrate;

  // Gate for activeSource transition: see comment near `activeSource` below.
  const [queueHasAdvanced, setQueueHasAdvanced] = useState(false);

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
    advance: rawAdvance,
    queueAudio,
    queueSessionId,
    jumpTo: rawJumpTo,
    onDeck,
    onDeckFlashKey,
    pushOnDeck,
    flashOnDeck,
    playNow,
    setShaderUserCycled,
  } = useQueueController({
    play,
    queue,
    clear,
    shuffle: props?.shuffle,
    onError,
    queueFetchTimeoutMs: 10_000,
  });

  // Gated advance: marks the queue as advanced so activeSource starts following
  // playQueue[0] instead of the original `play` prop.
  const advance = useCallback((...args) => {
    setQueueHasAdvanced(true);
    return rawAdvance(...args);
  }, [rawAdvance]);
  const { onDeck: onDeckCfg } = usePlayerConfig();

  const hasNextQueueItem = useMemo(() => (
    isQueue
    && Array.isArray(playQueue)
    && playQueue.length > 1
  ), [isQueue, playQueue]);

  // Single-play inputs (`play: {contentId: ...}`) hand SinglePlayer the input
  // object so it can render immediately while useQueueController fetches the
  // queue in parallel. Switching activeSource to playQueue[0] the moment the
  // queue resolves would force a redundant remount + re-fetch of the same
  // first item. Defer the switch until the user actually advances.
  const inputIsExplicitQueue = !!queue
    || (play && (play.playlist || play.queue))
    || Array.isArray(play);

  const activeSource = useMemo(() => {
    const playQueueHead = Array.isArray(playQueue) && playQueue.length > 0 ? playQueue[0] : null;
    if (playQueueHead?.mediaType === 'trigger/side-effect') return null;

    if (inputIsExplicitQueue) {
      return playQueueHead;
    }
    if (queueHasAdvanced && playQueueHead) {
      return playQueueHead;
    }
    if (play && !Array.isArray(play)) {
      return play;
    }
    return null;
  }, [inputIsExplicitQueue, queueHasAdvanced, playQueue, play]);

  // Reset the advance gate when a new queue is loaded (different contentRef).
  useEffect(() => {
    setQueueHasAdvanced(false);
  }, [queueSessionId]);

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
  // What the armed timer is FOR. Held beside remountTimerRef (never without it)
  // so `player-remount-cancelled` can be joined to the `player-remount-scheduled`
  // line it cancelled, and so the cancel branch can tell a user-initiated retry
  // from an automatic recovery attempt.
  const pendingRemountRef = useRef(null);

  useEffect(() => {
    remountInfoRef.current = remountState;
  }, [remountState]);

  // Fire-time view of playbackMetrics, mirroring remountInfoRef above.
  //
  // The remount backoff runs up to REMOUNT_BACKOFF_MAX_MS (45s), and a setTimeout closes
  // over whatever `forceSinglePlayerRemount` identity existed when it was SCHEDULED — so
  // the pause state it carried into `wasPaused` was up to 45s stale. Both directions are
  // live regressions on remote-only surfaces (living-room TV, karaoke): a stale `false`
  // makes the rebuilt element autoplay over a pause the viewer deliberately made during
  // the backoff, and a stale `true` rebuilds with autoplay off after the viewer pressed
  // play, completing "recovery" into a frozen, silently-paused player. Reading through a
  // ref makes the value current at FIRE time regardless of when the timer was armed.
  const playbackMetricsRef = useRef(playbackMetrics);
  useEffect(() => {
    playbackMetricsRef.current = playbackMetrics;
  }, [playbackMetrics]);

  const clearRemountTimer = useCallback(() => {
    if (remountTimerRef.current) {
      clearTimeout(remountTimerRef.current);
      remountTimerRef.current = null;
    }
    pendingRemountRef.current = null;
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
    // Keep the ref in lockstep with the state — handleResilienceReload reads
    // mediaAccessRef.current, and a stale hardReset on a dead renderer would
    // short-circuit the remount and burn recovery attempts.
    mediaAccessRef.current = createDefaultMediaAccess();
    setMediaAccess(mediaAccessRef.current);
    setPlaybackMetrics(createDefaultPlaybackMetrics());
    setRemountState((prev) => (prev.guid === currentMediaGuid ? prev : { guid: currentMediaGuid || null, nonce: 0, context: null }));
    clearRemountTimer();
  }, [currentMediaGuid, clearRemountTimer]);

  const effectiveMeta = resolvedMeta || singlePlayerProps || null;
  const plexId = queue?.plex || play?.plex || effectiveMeta?.plex || effectiveMeta?.assetId || null;

  // Live now-playing mirror for external session bridges (screen-framework
  // fleet state). Ref-only render mirror (same pattern as
  // sessionPlaybackRateRef): read via the imperative handle's getNowPlaying,
  // never from a closure, so it stays fresh without dep churn.
  const nowPlayingRef = useRef(null);
  nowPlayingRef.current = {
    item: effectiveMeta,
    isQueue,
    queuePosition: Number.isInteger(queuePosition) ? queuePosition : null,
    queueLength: isQueue ? (playQueue?.length ?? 0) : (effectiveMeta ? 1 : 0),
  };

  const mediaIdentity = useMemo(
    () => resolveMediaIdentity(effectiveMeta) || resolveMediaIdentity(singlePlayerProps) || resolveMediaIdentity(play) || resolveMediaIdentity(queue),
    [effectiveMeta, singlePlayerProps, play, queue]
  );

  // One id per mounted Player, minted once and never recomputed.
  //
  // Media identity is derived from CONTENT since 2026-08-16, which is what keeps
  // singlePlayerKey stable when a caller re-creates an equivalent `play` literal.
  // The cost is that two Players showing the same content now compute the same
  // identity, and two Players CAN be mounted at once: a menu selection mounts one
  // on the nav stack (MenuWidget is a layout widget, so it renders inside the
  // overlay provider's children) while a media:play action mounts a second in the
  // fullscreen slot, whose dismissOverlay clears only the overlay slot. Sharing the
  // ITEM session key below would mean one Player consuming the other's resume seek and
  // either one's unmount wiping the survivor's recovery-attempt budget. (The prefs key
  // is deliberately NOT per-instance — see the note on it.)
  //
  // A ref is the right home for this: a remount happens BELOW this component (React
  // rebuilds SinglePlayer when singlePlayerKey changes), so the id — and with it the
  // ledger's five-attempt cap — survives every remount and dies only with the Player.
  const playerInstanceIdRef = useRef(null);
  if (!playerInstanceIdRef.current) playerInstanceIdRef.current = guid();
  const playerInstanceId = playerInstanceIdRef.current;

  // Two sessions: preferences (volume/rate) live at queue scope so they survive
  // item swaps; seek intent lives at item scope so resume-position never crosses items.
  //
  // Only ONE of them carries the instance id, and which one is not arbitrary. Both
  // hazards in the note above are item-scoped: the resume seek is `targetTimeSeconds`
  // on `itemSessionKey`, and the recovery-attempt budget is the ledger keyed on
  // `resilienceSessionKey`, which is `itemSessionKey`. So `itemSessionKey` is the key
  // that has to be per-instance.
  //
  // `prefsSessionKey` carries only volume (and rate, when there's no collection to
  // scope it to), which is a user preference that is SUPPOSED to be shared — leave a
  // lecture and come back inside the same page session and the volume you chose is
  // still there. There is no wipe hazard on this key either: usePlaybackSession has
  // no delete path, so an unmount takes nothing with it. Adding the instance id here
  // would mint a fresh entry per mount and drop every override back to the default.
  const prefsSessionKey = useMemo(() => {
    if (queueSessionId && isQueue) {
      return `player-session:queue:${queueSessionId}`;
    }
    const identifier = currentMediaGuid ?? mediaIdentity;
    return identifier
      ? `player-session:${identifier}`
      : 'player-session:idle';
  }, [queueSessionId, isQueue, currentMediaGuid, mediaIdentity]);

  const itemSessionKey = useMemo(() => {
    const identifier = currentMediaGuid ?? mediaIdentity;
    return identifier
      ? `player-item:${identifier}#${playerInstanceId}`
      : `player-item:idle#${playerInstanceId}`;
  }, [currentMediaGuid, mediaIdentity, playerInstanceId]);

  // Rate persists per show/album/artist (in-memory, per session). Falls back to the
  // prefs (queue/item) scope when there's no collection metadata.
  const rateSessionKey = useMemo(() => {
    const collection = resolveCollectionKey(effectiveMeta);
    return collection ? `player-rate:${collection}` : prefsSessionKey;
  }, [effectiveMeta, prefsSessionKey]);

  // A surgical review seek (?goto/?cue) suppresses the saved resume position (Plex
  // viewOffset in meta.seconds) so the review target is authoritative — otherwise the
  // resilience layer reasserts resume after VideoPlayer re-mints at the target.
  // An explicit `seconds` on the ROOT play prop is authoritative and overrides the
  // Plex-viewOffset resume that arrives later in resolvedMeta.seconds — so a caller
  // (e.g. karaoke / play-along) can pass `play={{ seconds: 0 }}` to ALWAYS start
  // fresh. Falls back to effectiveMeta.seconds (normal resume) when the play prop
  // carries no explicit start, so lecture resume is unchanged.
  const rootPlayObj = (play && typeof play === 'object' && !Array.isArray(play)) ? play : null;
  const explicitStartSource = (rootPlayObj && Object.prototype.hasOwnProperty.call(rootPlayObj, 'seconds'))
    ? rootPlayObj
    : effectiveMeta;
  const explicitStartProvided = !REVIEW_ACTIVE
    && explicitStartSource && Object.prototype.hasOwnProperty.call(explicitStartSource, 'seconds');
  const explicitStartSeconds = explicitStartProvided
    ? Math.max(0, Number(explicitStartSource.seconds) || 0)
    : null;

  const {
    volume: sessionVolume,
    setVolume: setSessionVolume
  } = usePlaybackSession({ sessionKey: prefsSessionKey });

  // Rate lives on its own collection-scoped session so it persists across show/album/
  // artist advances without changing how volume is scoped.
  const {
    playbackRate: sessionPlaybackRate,
    setPlaybackRate: setSessionPlaybackRate
  } = usePlaybackSession({ sessionKey: rateSessionKey });

  // The rate button (ScreenActionHandler) dispatches `player:cycle-playback-rate`
  // rather than poking the DOM — DOM pokes can't reach the dash-video shadow <video>
  // and get re-asserted by the controlled rate. Cycle the session rate here; the
  // controlled apply (useCommonMediaController) handles the shadow element.
  const sessionPlaybackRateRef = useRef(sessionPlaybackRate);
  sessionPlaybackRateRef.current = sessionPlaybackRate;
  useEffect(() => {
    const onCycle = () => setSessionPlaybackRate(nextPlaybackRate(sessionPlaybackRateRef.current));
    window.addEventListener('player:cycle-playback-rate', onCycle);
    return () => window.removeEventListener('player:cycle-playback-rate', onCycle);
  }, [setSessionPlaybackRate]);

  const {
    targetTimeSeconds,
    setTargetTimeSeconds,
    consumeTargetTimeSeconds
  } = usePlaybackSession({ sessionKey: itemSessionKey, defaults: { targetTimeSeconds: explicitStartSeconds } });

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
      autoplayBlocked: !!access.autoplayBlocked,
      onAutoplayResolved: typeof access.onAutoplayResolved === 'function' ? access.onAutoplayResolved : null
    };
    setMediaAccess((prev) => {
      const unchanged = Boolean(prev)
        && prev.getMediaEl === newMediaAccess.getMediaEl
        && prev.hardReset === newMediaAccess.hardReset
        && prev.fetchVideoInfo === newMediaAccess.fetchVideoInfo
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

  // Raw key plus its hash on every line this file writes, so a Player line and a
  // (formerly hash-only) resilience/health line can be joined either way. Same
  // two field names everywhere: `waitKey` raw, `waitKeyHash` digest.
  const resolvedWaitKeyFields = useMemo(() => describeWaitKey(resolvedWaitKey), [resolvedWaitKey]);

  // Identity churn detector. 480 distinct waitKeys appeared in three minutes on
  // 2026-08-16 and nothing counted them; the number had to be uniq'd out of a log
  // by hand afterwards. One counter per mounted Player — deliberately NOT one per
  // guid, because the guid is one of the things that churns, and per-guid buckets
  // would each have held a single value while the fleet melted.
  const churnCounterRef = useRef(null);
  if (!churnCounterRef.current) {
    churnCounterRef.current = createIdentityChurnCounter();
  }
  const churnLogger = useMemo(() => getLogger().child({ component: 'player-identity-churn' }), []);
  const hasEffectiveMeta = Boolean(effectiveMeta);

  // In an EFFECT, not in the key memo above: that memo already logs during
  // render and carries a StrictMode caveat, and a fourth ref write there would
  // consume a stamp on a discarded render. An effect commits once per real
  // change, and `record` is idempotent for a repeated value — so a double
  // invocation cannot inflate a distinct count. The emit is bounded by the
  // episode latch inside the counter (one line per burst, not one per value),
  // which is the rate limit; adding a sampler on top would only hide the alert.
  useEffect(() => {
    if (!hasEffectiveMeta) return;
    const report = churnCounterRef.current.record({
      waitKey: resolvedWaitKey,
      guid: currentMediaGuid
    });
    if (!report) return;
    churnLogger.warn('playback.identity-churn', {
      ...report,
      playerType: playerType || null,
      isQueue
    });
  }, [hasEffectiveMeta, resolvedWaitKey, currentMediaGuid, churnLogger, playerType, isQueue]);

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
      attempt,
      // Carried so the rebuilt element does not autoplay over a deliberate pause. Read
      // through the ref, not the render closure: this callback is routinely invoked from
      // a backoff timer armed up to 45s earlier (see playbackMetricsRef).
      wasPaused: playbackMetricsRef.current?.isPaused === true
    };

    playbackLog('player-remount', {
      ...resolvedWaitKeyFields,
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
      playbackSeconds: playbackMetricsRef.current?.seconds ?? null,
      isPaused: playbackMetricsRef.current?.isPaused ?? null,
      isSeeking: playbackMetricsRef.current?.isSeeking ?? null,
      trigger,
      conditions
    });

    setTargetTimeSeconds(normalized);
    // Keep the ref in lockstep with the state (see note at the other reset site).
    mediaAccessRef.current = createDefaultMediaAccess();
    setMediaAccess(mediaAccessRef.current);
    setPlaybackMetrics(createDefaultPlaybackMetrics());
    setRemountState((prev) => {
      if (prev.guid !== currentMediaGuid) {
        return { guid: currentMediaGuid || null, nonce: 0, context: diagnostics };
      }
      return { guid: prev.guid, nonce: prev.nonce + 1, context: diagnostics };
    });
    // playbackMetrics is deliberately NOT a dependency: it is read through
    // playbackMetricsRef so this callback stays stable and a timer-captured copy still
    // observes the CURRENT pause state when it fires.
  }, [currentMediaGuid, isQueue, mediaIdentity, playerType, resolvedWaitKey, resolvedWaitKeyFields, setTargetTimeSeconds]);

  const scheduleSinglePlayerRemount = useCallback((input = null) => {
    const attempt = (remountInfoRef.current?.nonce ?? 0) + 1;
    const backoffMs = computeRemountDelayMs(attempt);
    // The viewer pressed retry. Neither of the "playback looks fine now" brakes
    // below may discard this: by the time recovery is exhausted the nonce is
    // high, so the backoff can run to REMOUNT_BACKOFF_MAX_MS, and inside that
    // window a stray `playing` or 100ms of clock movement would swallow an
    // explicit request — along with the exact position the user picked
    // (seekToIntentMs). A user-initiated retry also needs a REAL remount for the
    // reason given at the hardReset short-circuit below: in-place reattach on a
    // reaped Plex transcode session leaves the <video> wedged at readyState=0.
    const userInitiated = input?.userInitiated === true;

    clearRemountTimer();

    playbackLog('player-remount-scheduled', {
      ...resolvedWaitKeyFields,
      attempt,
      backoffMs,
      guid: currentMediaGuid,
      playerType: playerType || null,
      isQueue,
      userInitiated,
      playbackSeconds: playbackMetricsRef.current?.seconds ?? null
    }, { level: backoffMs > 0 ? 'info' : 'debug' });

    if (!Number.isFinite(backoffMs) || backoffMs <= 0) {
      forceSinglePlayerRemount(input, { scheduledDelayMs: 0, attempt });
      return;
    }

    // Where the playhead sat when the timer was armed. Compared against the live
    // value at fire time so a remount armed against a stall does not tear down an
    // element that has since started playing (2026-09-01, story time).
    const armedAtSeconds = playbackMetricsRef.current?.seconds ?? null;
    pendingRemountRef.current = { attempt, backoffMs, armedAtSeconds, userInitiated };
    remountTimerRef.current = setTimeout(() => {
      remountTimerRef.current = null;
      pendingRemountRef.current = null;
      const currentSeconds = playbackMetricsRef.current?.seconds ?? null;
      const verdict = userInitiated
        ? { skip: false, reason: null, advancedSeconds: null }
        : shouldSkipScheduledRemount({
          armedAtSeconds,
          currentSeconds,
          stalled: playbackMetricsRef.current?.stalled === true,
          // A wedged forward seek advances the clock without playing anything;
          // see the guard's docblock.
          isSeeking: playbackMetricsRef.current?.isSeeking === true
        });
      if (verdict.skip) {
        playbackLog('player-remount-skipped', {
          ...resolvedWaitKeyFields,
          attempt,
          backoffMs,
          reason: verdict.reason,
          armedAtSeconds,
          playbackSeconds: currentSeconds,
          advancedSeconds: verdict.advancedSeconds,
          guid: currentMediaGuid
        }, { level: 'info' });
        return;
      }
      forceSinglePlayerRemount(input, { scheduledDelayMs: backoffMs, attempt });
    }, backoffMs);
    // See forceSinglePlayerRemount: playbackMetrics is read via ref, not closed over.
  }, [currentMediaGuid, clearRemountTimer, computeRemountDelayMs, forceSinglePlayerRemount, isQueue, playerType, resolvedWaitKeyFields]);

  // Storm brake for the key below. It belongs on the KEY, not on the explicit
  // remount path: during the 2026-08-16 storm only three of roughly three hundred
  // teardowns came through forceSinglePlayerRemount — the rest were React
  // reconciliation reacting to a key that kept changing.
  const stormGuardRef = useRef(null);
  if (!stormGuardRef.current) {
    stormGuardRef.current = createRemountStormGuard({
      maxMounts: REMOUNT_STORM_MAX_MOUNTS,
      windowMs: REMOUNT_STORM_WINDOW_MS
    });
  }
  const lastAdmittedKeyRef = useRef('player-idle');
  const stormLoggedRef = useRef(false);
  const stormTrippedAtRef = useRef(0);

  // The inputs behind the last ADMITTED key, so a change can name which one moved.
  // Held separately from lastAdmittedKeyRef because the composite key cannot be
  // split back apart — a compound plex guid contains the ':' separator itself.
  const lastAdmittedKeyInputsRef = useRef(null);
  const keyLogger = useMemo(() => getLogger().child({ component: 'player-key' }), []);

  // StrictMode landmine, noted deliberately: this memo reads Date.now(), writes three
  // refs and logs during render. It is safe today — nothing under frontend/src mounts a
  // <React.StrictMode>, and re-admitting an already-admitted key costs nothing, so a
  // double invocation is idempotent. The day StrictMode or a concurrent feature is
  // switched on, a discarded render would still consume a stamp from the window.
  const singlePlayerKey = useMemo(() => {
    const candidate = !singlePlayerProps
      ? 'player-idle'
      : activeSource?.mediaType === 'image'
        // Stable key for image→image transitions so ImageFrame persists (cross-dissolve)
        ? `image-slideshow:${remountState.nonce}`
        : `${currentMediaGuid || 'entry'}:${remountState.nonce}`;

    const guard = stormGuardRef.current;
    const now = Date.now();

    // Re-arm one window after a trip. A tripped guard is NOT re-armed by a content
    // change, tempting as that is: in the storm the guid changed on every pass, so
    // forgiving content changes would clear the counter before it could ever count
    // past one. Waiting out the window instead means the brake holds while churn is
    // in flight and lets go once it stops, so a viewer who picks something else is
    // never stranded on the frozen key for longer than the window.
    if (guard.tripped() && now - stormTrippedAtRef.current >= REMOUNT_STORM_WINDOW_MS) {
      guard.reset();
      stormLoggedRef.current = false;
      playbackLog('player-remount-storm-rearmed', {
        frozenKey: lastAdmittedKeyRef.current,
        nextKey: candidate,
        guid: currentMediaGuid,
        windowMs: REMOUNT_STORM_WINDOW_MS
      }, { level: 'warn' });
    }

    // If key churn outruns the cap, freeze on the last admitted key. Remounting
    // faster than media can start never recovers — it only opens transcode
    // sessions and stacks overlapping audio.
    if (!guard.admit(candidate, now)) {
      if (!stormLoggedRef.current) {
        stormLoggedRef.current = true;
        stormTrippedAtRef.current = now;
        playbackLog('player-remount-storm', {
          frozenKey: lastAdmittedKeyRef.current,
          rejectedKey: candidate,
          guid: currentMediaGuid,
          // Same triage fields its neighbours (player-remount, -scheduled) carry. On a
          // multi-surface fleet playerType is what says whether the piano kiosk or the
          // garage display stormed.
          playerType: playerType || null,
          ...resolvedWaitKeyFields,
          isQueue,
          maxMounts: REMOUNT_STORM_MAX_MOUNTS,
          windowMs: REMOUNT_STORM_WINDOW_MS
        }, { level: 'error' });
      }
      return lastAdmittedKeyRef.current;
    }

    // Report the admitted transition. This sits AFTER admit() on purpose: a
    // rejected key is already reported by `player-remount-storm` above, and
    // reporting it here as well would inflate the very count a diagnostician
    // came for. Only the idle placeholder is skipped, by starting the baseline
    // at null — the first key of a run is a mount, not a change, and giving it
    // a `from` would put a fabricated value in the log.
    //
    // Sampled because a key change IS the remount, and the failure mode being
    // instrumented is a storm of them. The budget of 20/min is the storm
    // guard's own ceiling (10 admitted keys per 30s window), so under a working
    // brake every transition is recorded in full; if the brake is ever loosened
    // or bypassed the aggregate still carries the count, which on 2026-08-16
    // was the whole diagnosis and had to be read out of Plex's log instead.
    const keyInputs = !singlePlayerProps ? null : {
      // The identity half of the key. Image slideshows deliberately use a fixed
      // token here so image→image transitions keep one ImageFrame alive.
      guid: activeSource?.mediaType === 'image' ? 'image-slideshow' : (currentMediaGuid || 'entry'),
      nonce: remountState.nonce
    };
    const changedComponent = changedKeyComponent(lastAdmittedKeyInputsRef.current, keyInputs);
    if (changedComponent) {
      keyLogger.sampled('playback.player-key-changed', {
        from: lastAdmittedKeyRef.current,
        to: candidate,
        // Which input moved: `guid` is a content change, `nonce` is a deliberate
        // remount, `guid+nonce` is both at once. In the storm it was the guid —
        // the half nothing logged, because `player-remount` only ever covered
        // the nonce.
        changedComponent,
        guid: currentMediaGuid || null,
        playerType: playerType || null,
        isQueue
      }, { maxPerMinute: 20, aggregate: true });
    }
    lastAdmittedKeyInputsRef.current = keyInputs;

    lastAdmittedKeyRef.current = candidate;
    return candidate;
  }, [singlePlayerProps, currentMediaGuid, remountState.nonce, activeSource?.mediaType, playerType, resolvedWaitKeyFields, isQueue, keyLogger]);

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

  // Pass the bridge REF (not .current) — the adapter reads it at call time.
  // Passing the value both went stale between renders and (pre-2026-07-21 fix)
  // minted per-render closures that chained every generation into a leak.
  const transportAdapter = useMediaTransportAdapter({ controllerRef, mediaAccess, resilienceBridgeRef });

  useMediaErrorReporter({
    getMediaEl: transportAdapter.getMediaEl,
    mediaKey: currentMediaGuid,
    onError,
    mediaLoadTimeoutMs: mediaLoadTimeoutMs ?? null,
    // The transport callbacks are identity-stable now, so this is what tells the
    // reporter an element has actually appeared. `mediaAccess` identity changes
    // only on a real renderer registration (field-compared in
    // handleRegisterMediaAccess), so it re-attaches without churning.
    registrationSignal: mediaAccess,
  });

  const resolvedResilienceOnState = resolvedResilience.onStateChange;

  const compositeAwareOnState = useCallback((state) => {
    // A pending backoff remount exists because playback was not progressing.
    // The hook saying "playing" means that reason is gone; a timer that fires
    // now would tear down a working element (2026-09-01, story time).
    const pending = pendingRemountRef.current;
    if (
      state?.status === RESILIENCE_STATUS.playing
      && remountTimerRef.current
      && pending?.userInitiated !== true
    ) {
      playbackLog('player-remount-cancelled', {
        ...resolvedWaitKeyFields,
        reason: 'playback-resumed',
        attempt: pending?.attempt ?? null,
        backoffMs: pending?.backoffMs ?? null,
        armedAtSeconds: pending?.armedAtSeconds ?? null,
        playbackSeconds: playbackMetricsRef.current?.seconds ?? null,
        guid: currentMediaGuid
      }, { level: 'info' });
      clearRemountTimer();
    }
    if (typeof resolvedResilienceOnState === 'function') {
      resolvedResilienceOnState(state);
    }
  }, [resolvedResilienceOnState, clearRemountTimer, resolvedWaitKeyFields, currentMediaGuid]);

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
      forceRemount,
      userInitiated,
      seekToIntentMs,
      refreshUrl,
      ...rest
    } = options || {};

    const seekSeconds = Number.isFinite(seekToIntentMs) ? Math.max(0, seekToIntentMs / 1000) : null;

    // Read via mediaAccessRef (kept in sync by setMediaAccess) — having the
    // mediaAccess STATE as a dep rebuilt this callback on every registration,
    // which cascaded through triggerRecovery -> requestRecovery -> the
    // SinglePlayer bridge memo -> renderer re-registration -> setMediaAccess:
    // the render/setState feedback loop behind the 2026-07-21 fitness leak.
    const currentMediaAccess = mediaAccessRef.current;
    let hardResetInvoked = false;
    let hardResetErrored = false;
    if (typeof currentMediaAccess?.hardReset === 'function') {
      hardResetInvoked = true;
      try {
        currentMediaAccess.hardReset({ seekToSeconds: seekSeconds, refreshUrl: Boolean(refreshUrl) });
      } catch (error) {
        hardResetErrored = true;
      }
    }

    const rawTrigger = {
      ...rest,
      seekToIntentMs
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
    //
    // EXCEPTION: forceRemount (user-initiated retry after stall exhaustion).
    // In-place reattach on a reaped Plex transcode session leaves the <video>
    // wedged at readyState=0 — only a real React remount (fresh plexClientSession)
    // recovers. Skip the in-place short-circuit and escalate to a remount.
    if (hardResetInvoked && !hardResetErrored && !forceRemount) {
      playbackLog('player-remount', {
        payload: {
          ...resolvedWaitKeyFields,
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
      // Only the hook's retry-from-exhausted path (useMediaResilience.js:320)
      // sets this, and only a viewer drives that path. Deliberately NOT derived
      // from forceRemount: that flag is about MECHANISM ("an in-place hardReset
      // won't do"), and the stall-jolt ladder raises it automatically on rung 1
      // (stallJolt.js:33) ~9.5s into any mid-playback stall. Reading it as
      // consent would bypass both brakes on the commonest recovery path there
      // is — reopening the 2026-09-01 incident rather than closing it.
      userInitiated: Boolean(userInitiated),
      reason: rest?.reason || 'resilience',
      source: rest?.source || 'resilience',
      trigger: triggerDetails,
      conditions
    });
  }, [scheduleSinglePlayerRemount, transportAdapter, playerType, currentMediaGuid, resolvedWaitKeyFields, activeSource, resolvedMeta]);

  const handleResilienceExhausted = useCallback(({ reason, attempts, waitKey: exhaustedWaitKey }) => {
    if (isQueue && hasNextQueueItem) {
      playbackLog('resilience-exhausted-auto-skip', {
        reason,
        attempts,
        ...describeWaitKey(exhaustedWaitKey),
        action: 'advance',
        queueRemaining: playQueue?.length ?? 0
      }, { level: 'warn' });
      advance();
    } else {
      playbackLog('resilience-exhausted-dismiss', {
        reason,
        attempts,
        ...describeWaitKey(exhaustedWaitKey),
        action: isQueue ? 'queue-end' : 'clear',
        queueRemaining: playQueue?.length ?? 0
      }, { level: 'warn' });
      clear();
    }
  }, [isQueue, hasNextQueueItem, advance, clear, playQueue]);

  // Self-contained formats (titlecard, etc.) have no media element —
  // suppress the resilience overlay which would never exit startup.
  const isSelfContainedFormat = effectiveMeta?.format === 'titlecard';

  const { overlayProps, cancelDeadline, requestRecovery } = useMediaResilience({
    getMediaEl: transportAdapter.getMediaEl,
    registrationSignal: mediaAccess,
    meta: effectiveMeta,
    seconds: effectiveMeta ? playbackMetrics.seconds : 0,
    isPaused: effectiveMeta ? playbackMetrics.isPaused : false,
    isSeeking: effectiveMeta ? playbackMetrics.isSeeking : false,
    pauseIntent: effectiveMeta ? playbackMetrics.pauseIntent : null,
    initialStart: explicitStartSeconds ?? 0,
    waitKey: resolvedWaitKey,
    onStateChange: compositeAwareOnState,
    onReload: handleResilienceReload,
    onExhausted: handleResilienceExhausted,
    configOverrides: resolvedResilience.config,
    controllerRef: resilienceControllerRef,
    plexId,
    playbackSessionKey: itemSessionKey,
    debugContext: { scope: 'player', mediaGuid: currentMediaGuid || null },
    // Stalled flag from useCommonMediaController to avoid duplicate detection
    externalStalled: effectiveMeta ? playbackMetrics.stalled : null,
    // Self-contained formats (titlecard) have no media element — disable resilience monitoring
    disabled: isSelfContainedFormat
  });

  // Cancel stale resilience deadline when media guid changes.
  // Must be after useMediaResilience (source of cancelDeadline) to avoid TDZ in Firefox.
  useEffect(() => {
    cancelDeadline();
  }, [currentMediaGuid, cancelDeadline]);

  // Precedence: session (user override, queue-wide) > current item > queue defaults > 1.
  // External values seed the session on first encounter; once user overrides, they win.
  const currentItemPlaybackRate = effectiveMeta?.playbackRate || effectiveMeta?.playbackrate;
  const effectivePlaybackRate = (
    sessionPlaybackRate
    ?? currentItemPlaybackRate
    ?? queuePlaybackRate
    ?? 1
  );

  const currentItemVolume = effectiveMeta?.volume;
  const effectiveVolume = (
    sessionVolume ?? currentItemVolume ?? queueVolume ?? 1
  );

  const hasExternalVolume = currentItemVolume != null || queueVolume != null;
  const hasExternalPlaybackRate = currentItemPlaybackRate != null || queuePlaybackRate != null;

  useEffect(() => {
    if (!hasExternalVolume) return;
    if (sessionVolume != null) return; // user override already set
    const seed = currentItemVolume ?? queueVolume;
    if (!Number.isFinite(seed)) return;
    setSessionVolume(seed);
  }, [hasExternalVolume, sessionVolume, currentItemVolume, queueVolume, setSessionVolume]);

  useEffect(() => {
    if (!hasExternalPlaybackRate) return;
    if (sessionPlaybackRate != null) return;
    const seed = currentItemPlaybackRate ?? queuePlaybackRate;
    if (!Number.isFinite(seed)) return;
    setSessionPlaybackRate(seed);
  }, [hasExternalPlaybackRate, sessionPlaybackRate, currentItemPlaybackRate, queuePlaybackRate, setSessionPlaybackRate]);

  // Get shader from the current item, falling back to queue/play level, then default
  // Shader aliases: legacy names map to canonical shader classes (must match useQueueController)
  const currentItemShader = effectiveMeta?.shader;
  const rawExplicitShader = play?.shader || queue?.shader || currentItemShader;
  const explicitShader = SHADER_ALIASES[rawExplicitShader] ?? rawExplicitShader;
  // willLoop drives the "hide progress bar" shader fallback. It must reflect
  // *actual* loop intent (continuous flag), not "queue happens to be 1 item" —
  // every NFC/voice/button launch produces a single-item queue and the user
  // expects those to render with the default shader and play once.
  const willLoop = (isQueue && playQueue?.length === 1 && (queue?.continuous || play?.continuous)) ||
                   (!isQueue && singlePlayerProps?.continuous);
  // Once the user manually cycles the shader (ArrowUp/ArrowDown), their choice takes
  // precedence over item-level and queue-level metadata until the queue resets.
  //
  // `forceShader` sits above all of that: it is how SurroundHost enforces "an
  // enriched item always plays focused" — the frame owns the chrome, so it wins
  // over an explicit dispatch, the queue/item metadata AND a manual shader
  // cycle. Nothing inside Player can opt back out of it; only the surround seam
  // decides when it applies (see SurroundHost.jsx).
  const effectiveShader = forceShader
    || (shaderUserCycled
      ? queueShader
      : explicitShader || (willLoop ? 'focused' : queueShader));

  // Create appropriate advance function for single continuous items
  const singleAdvance = useCallback(() => {
    // Where a NON-queue item goes when it ends: either it loops, or the Player
    // clears itself. Both were silent, so "the story finished and the Player
    // vanished" produced no log line naming which of the two happened or why —
    // and a consumer that observes `clear` (the school reading session uses it
    // only for dismissal cleanup) had no way to tell a missing call from a
    // no-op one. See docs/_wip/bugs/2026-08-28-story-time-portal-launch-*.
    playbackLog('single-item-ended', {
      action: singlePlayerProps?.continuous ? 'loop' : 'clear',
      assetId: singlePlayerProps?.assetId ?? null,
    });
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

  // Completion is a PLAYER fact, not a DOM-listener race. Renderers call the
  // `advance` handed down below only for a natural terminal condition (native
  // `ended`, segment end, or the at-duration watchdog). Imperative skip/back,
  // resilience exhaustion, load failure and explicit clear keep using the raw
  // transition callbacks and never pass through here.
  //
  // The guard also closes the native-ended/watchdog race. Without it, two
  // terminal notifications could advance a queue twice and dispatch two
  // completion callbacks for one asset.
  const completedMediaKeyRef = useRef(null);
  const completionAssetId = singlePlayerProps?.assetId
    ?? singlePlayerProps?.contentId
    ?? singlePlayerProps?.id
    ?? singlePlayerProps?.plex
    ?? effectiveMeta?.assetId
    ?? effectiveMeta?.contentId
    ?? effectiveMeta?.id
    ?? effectiveMeta?.plex
    ?? null;
  const naturalAdvance = useCallback(() => {
    const identity = currentMediaGuid ?? completionAssetId ?? 'player-media-unknown';
    // Queue position distinguishes two adjacent entries that intentionally point
    // at the same asset. Returning to the asset after another queue item also
    // remains a fresh natural completion, while duplicate native/watchdog signals
    // for this exact item collapse here.
    const mediaKey = isQueue ? `${identity}@${queuePosition ?? 'unknown'}` : identity;
    if (completedMediaKeyRef.current === mediaKey) {
      playbackLog('completion-dispatch-duplicate', {
        assetId: completionAssetId,
        consumerRegistered: typeof onPlaybackCompleted === 'function',
      }, { level: 'warn' });
      return;
    }
    completedMediaKeyRef.current = mediaKey;

    const info = { reason: 'natural-end', assetId: completionAssetId };
    const consumerRegistered = typeof onPlaybackCompleted === 'function';
    playbackLog('completion-dispatch', { assetId: completionAssetId, consumerRegistered }, { level: 'info' });
    if (consumerRegistered) {
      try {
        const pending = onPlaybackCompleted(info);
        if (pending && typeof pending.catch === 'function') {
          pending.catch((error) => {
            playbackLog('completion-consumer-failed', {
              assetId: completionAssetId,
              error: error?.message ?? String(error),
            }, { level: 'warn' });
          });
        }
      } catch (error) {
        playbackLog('completion-consumer-failed', {
          assetId: completionAssetId,
          error: error?.message ?? String(error),
        }, { level: 'warn' });
      }
    }

    if (isQueue) advance();
    else singleAdvance();
  }, [advance, completionAssetId, currentMediaGuid, isQueue, onPlaybackCompleted, queuePosition, singleAdvance]);

  // Renderers use this only for user-driven navigation and non-completion
  // failures. Keeping it separate from `naturalAdvance` is the contract that
  // makes skip/back/load-failure incapable of earning completion.
  const manualAdvance = isQueue ? advance : singleAdvance;

  // Compose onMediaRef so we keep existing external callback semantics
  const handleMediaRef = useCallback((el) => {
    exposedMediaRef.current = el;
    if (props.onMediaRef) props.onMediaRef(el);
    // ESLint's own message says the fix is to destructure specific props, which this already does — do not add `props`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.onMediaRef]);

  const handleController = useCallback((controller) => {
    controllerRef.current = controller;
    if (props.onController) props.onController(controller);
    // ESLint's own message says the fix is to destructure specific props, which this already does — do not add `props`
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setVolume: (value) => setSessionVolume(value),
    setPlaybackRate: (value) => setSessionPlaybackRate(value),
    getVolume: () => sessionVolume,
    getPlaybackRate: () => sessionPlaybackRate,
    getMediaElement: _getMediaElFallback,
    // Read-only now-playing metadata (current item meta + queue coordinates)
    // for external session bridges. Reads a render-mirrored ref — always fresh.
    getNowPlaying: () => nowPlayingRef.current,
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
    },
    seekToItem: (targetContentId, seconds) => {
      if (!isQueue || !targetContentId) return;
      const jumped = rawJumpTo(targetContentId, seconds);
      if (!jumped) return;
      setQueueHasAdvanced(true);
      playbackLog('seek-to-item', {
        targetContentId,
        seekSeconds: Number.isFinite(seconds) ? seconds : null,
        fromContentId: effectiveMeta?.contentId ?? effectiveMeta?.assetId ?? null,
      }, { level: 'info' });
    },
  }), [isQueue, advance, singleAdvance, rawJumpTo, sessionVolume, sessionPlaybackRate, setSessionVolume, setSessionPlaybackRate, effectiveMeta?.assetId, effectiveMeta?.contentId, resilienceControllerRef, withTransport]);

  useEffect(() => () => clearRemountTimer(), [clearRemountTimer]);

  // --- On-deck: handle the one queue op this Player owns ---
  const handleQueueOp = useCallback(async (payload = {}) => {
    const { op, contentId, shader: requestedShader } = payload;
    if (!contentId) return;
    if (op !== 'play-now' && op !== 'play-next') return;

    let info;
    try {
      info = await DaylightAPI(`api/v1/play/${contentId}`);
    } catch {
      // Without a mediaUrl we can't safely play. Bail out rather than push
      // a half-built item that will fail at the renderer.
      return;
    }
    const item = {
      ...info,
      id: info.id || info.contentId || contentId,
      contentId,
      thumbnail: info.thumbnail || `/api/v1/display/${contentId}`,
      title: info.title || contentId,
    };

    // External queue ops (NFC, voice, button) reset the shader to either the
    // request's override or 'default'. Without this, the shader sticks to
    // whatever the original session was launched with (e.g. a kitchen button
    // that set shader=minimal), which is surprising for users who expect each
    // NFC scan to behave like a fresh launch.
    const aliased = SHADER_ALIASES[requestedShader] ?? requestedShader;
    const targetShader = (aliased && classes.includes(aliased)) ? aliased : 'default';
    if (targetShader !== queueShader) {
      setShader(targetShader);
    }
    // Mark as override so it beats explicitShader in the effectiveShader
    // resolution (otherwise play?.shader from the original launch wins).
    setShaderUserCycled(true);

    if (op === 'play-now') {
      playNow(item);
      return;
    }

    // op === 'play-next' below

    // Dedup: same content as currently-playing → flash, no replace
    const current = playQueue[0];
    if (current && (current.contentId === contentId || current.id === contentId)) {
      flashOnDeck();
      return;
    }
    // Dedup: same content as on-deck → flash, no replace
    if (onDeck && (onDeck.contentId === contentId || onDeck.id === contentId)) {
      flashOnDeck();
      return;
    }
    // Preempt window: if current item just started, replace it in-place.
    // Going through pushOnDeck + advance() races on React state — advance()
    // reads onDeck from a stale closure and ends up walking the underlying
    // queue (e.g. the next track of a multi-track album) instead of jumping
    // to the just-pushed item.
    const el = exposedMediaRef.current;
    const elapsed = el?.currentTime ?? 0;
    if (Number.isFinite(elapsed) && elapsed < (onDeckCfg?.preempt_seconds || 0)) {
      playNow(item);
      return;
    }

    pushOnDeck(item, { displaceToQueue: !!onDeckCfg?.displace_to_queue });
  }, [playQueue, onDeck, onDeckCfg, pushOnDeck, flashOnDeck, playNow, queueShader, classes, setShader, setShaderUserCycled]);

  // Register once in mount order while the ref supplies the latest stateful
  // callback. Re-registering on every queue change would let a background
  // Player steal ownership merely because it advanced a track.
  const queueOpHandlerRef = useRef(handleQueueOp);
  queueOpHandlerRef.current = handleQueueOp;
  useEffect(() => getPlayerQueueOpRegistry().register(
    (payload) => queueOpHandlerRef.current?.(payload)
  ), []);

  const suppressOverlaysForBlackout = effectiveShader === 'blackout';

  const overlayElements = (overlayProps && !isSelfContainedFormat) ? (
    <>
      <PlayerOverlayLoading
        {...overlayProps}
        effectiveMetaIsNull={!effectiveMeta}
        suppressForBlackout={suppressOverlaysForBlackout}
      />
      <PlayerOverlayPaused
        {...overlayProps}
        suppressForBlackout={suppressOverlaysForBlackout}
        suppressPauseOverlay={props.suppressPauseOverlay}
      />
      <PlayerOverlayStateDebug {...overlayProps} />
      <PlayerOverlayAutoplayBlocked
        autoplayBlocked={mediaAccess.autoplayBlocked}
        onAutoplayResolved={mediaAccess.onAutoplayResolved}
        suppressForBlackout={suppressOverlaysForBlackout}
      />
    </>
  ) : null;

  const handleRequestRecovery = useCallback((payload = {}) => {
    if (typeof requestRecovery === 'function') {
      requestRecovery(payload?.reason);
    }
  }, [requestRecovery]);

  const playerProps = {
    advance: naturalAdvance,
    manualAdvance,
    clear,
    shader: effectiveShader,
    volume: effectiveVolume,
    setVolume: setSessionVolume,
    setShader,
    cycleThroughClasses,
    classes,
    playbackRate: effectivePlaybackRate,
    setPlaybackRate: setSessionPlaybackRate,
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
    onRequestRecovery: handleRequestRecovery,
    seekToIntentSeconds: targetTimeSeconds,
    onSeekRequestConsumed: handleSeekRequestConsumed,
    remountDiagnostics: remountState.context,
    // Recovery-ledger session scope: the SAME key useMediaResilience passes to
    // the ledger, so renderer-level recoveries (dash-error) share its caps.
    resilienceSessionKey: itemSessionKey,
    wrapWithContainer: false,
    suppressLocalOverlay: !!overlayElements,
    // Use external session if provided (for multi-player isolation) — that value is
    // the caller's own scheme (FitnessMusicPlayer) and passes through untouched.
    // Otherwise: the ADMITTED player key plus this Player's instance id.
    //
    // Derived from `singlePlayerKey` and not from the raw guid so the storm brake
    // covers this value too. `plexClientSession` is a dep of SinglePlayer's
    // fetchVideoInfoCallback, so a value that keeps moving keeps re-running the
    // metadata fetch — one live /api/v1/play/<id> against Plex per pass — even while
    // the frozen key is holding the <dash-video> still. Reading the admitted key
    // instead means the fetch stops when the remounts do. The key still embeds the
    // remount nonce, so a deliberate recovery remount still mints a fresh session.
    // (Image slideshows hold one key across image→image so ImageFrame can dissolve,
    // and therefore one session value — harmless: they carry no transcode, and their
    // metadata fetch is driven by effectiveContentId, which still moves.)
    //
    // The instance id matters even though nothing reads it yet. The backend ignores
    // `?session=` today (PlexAdapter mints its own identifiers), so a shared value is
    // inert server-side — but the GUID has been content-derived since 2026-08-16, and
    // threading this id end-to-end for observability is a known next step. The day
    // someone wires it, a content-derived value stops being a two-Players-on-one-screen
    // problem and becomes a cross-device one: two browsers playing the same title would
    // compute an identical `<hash>-r0` and hand Plex one session identifier for two
    // independent streams. Cheap to keep per-instance now, expensive to discover later.
    plexClientSession: externalPlexClientSession
      || (currentMediaGuid ? `${singlePlayerKey}#${playerInstanceId}` : null)
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
        effectiveMetaIsNull={true}
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

  // Per-item ambient hoisted above the SinglePlayer remount boundary so it can
  // crossfade between items rather than hard-cut on track change.
  const ambientUrl = effectiveMeta?.ambientUrl || null;
  const ambientVolumeFromMeta = Number.isFinite(effectiveMeta?.ambientVolume)
    ? effectiveMeta.ambientVolume
    : 0.1;

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
      <AmbientLayer ambientUrl={ambientUrl} ambientVolume={ambientVolumeFromMeta} />
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
      <OnDeckCard key={onDeckFlashKey} item={onDeck} flashKey={onDeckFlashKey} />
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
  /** Synchronous semantic notification before natural advance/clear. */
  onPlaybackCompleted: PropTypes.func,
  maxVideoBitrate: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  maxResolution: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  /** External Plex client session ID for multi-player isolation */
  plexClientSession: PropTypes.string,
  /**
   * Highest-priority shader override. Set by SurroundHost (via cloneElement)
   * while the surround frame is active for the current item — it beats an
   * explicit dispatch, queue/item metadata, and a manual shader cycle. Not
   * meant to be set by any other caller.
   */
  forceShader: PropTypes.string
};

export default Player;

// Export components for external use
export { PlayerOverlayLoading } from './components/PlayerOverlayLoading.jsx';
export { PlayerOverlayPaused } from './components/PlayerOverlayPaused.jsx';
export { SinglePlayer } from './components/SinglePlayer.jsx';
export { AudioPlayer } from './renderers/AudioPlayer.jsx';
export { VideoPlayer } from './renderers/VideoPlayer.jsx';
