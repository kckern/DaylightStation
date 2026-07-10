import { useRef, useEffect, useState, useCallback } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { getProgressPercent } from '../lib/helpers.js';
import { shouldLogAtDurationStuck, buildAtDurationStuckPayload } from '../lib/atDurationStuck.js';
import { decideStallVerdict, readVideoFrames } from '../lib/stallVerdict.js';
import {
  shouldTraceSeekAtDuration,
  captureSeekStack,
  buildSeekTracePayload
} from '../lib/seekTrace.js';
import {
  tagPauseSource,
  tagPlaySource,
  readAndClearPauseSource,
  readAndClearPlaySource
} from '../lib/playbackToggleSource.js';
import { useMediaKeyboardHandler } from '../../../lib/Player/useMediaKeyboardHandler.js';
import { useScreenVolume } from '../../../lib/volume/ScreenVolumeContext.js';
import { getLogger } from '../../../lib/logging/Logger.js';
import { evaluatePlayheadProgress } from '../lib/playheadProgress.js';
import { getRecoveryLedger } from '../lib/recoveryLedger.js';

// Lazy-init child logger for media controller diagnostics
let _mcLogger;
function mcLog() {
  if (!_mcLogger) _mcLogger = getLogger().child({ component: 'media-controller' });
  return _mcLogger;
}

// Stall-detection tuning. These were nominally configurable via a `stallConfig`
// param, but no producer ever passed one, so production always ran these values.
// The configurability was deleted (audit 2026-07-09 §4.4); the constants remain.
const SOFT_STALL_MS = 1200;   // no playhead progress for this long → soft stall
export const HARD_STALL_MS = 8000;   // stalled for this long → attempt recovery (the nudge)
const STALL_CHECK_INTERVAL_MS = Math.min(500, SOFT_STALL_MS / 3);
const SOFT_REINIT_SEEKBACK_SECONDS = 2;

// Ledger mount-scope ids (same module-counter pattern as VideoPlayer's
// dash-error mount id). One id per controller mount instance.
let _controllerMountSeq = 0;

/**
 * Common media controller hook for both audio and video players
 * Handles playback state, progress tracking, stall detection, and media events
 */
export function useCommonMediaController({
  start = 0,
  playbackRate = 1,
  onEnd = () => {},
  onClear = () => {},
  isAudio = false,
  isVideo = false,
  meta,
  type,
  onShaderLevelChange = () => {},
  shader,
  volume,
  cycleThroughClasses,
  playbackKeys,
  queuePosition,
  ignoreKeys,
  onProgress,
  onMediaRef,
  onController,
  keyboardOverrides,
  // Real playback session key (Player.jsx's itemSessionKey, threaded through
  // resilienceBridge.playbackSessionKey) — scopes recovery-ledger accounting.
  // Falls back to assetId below for hosts that don't thread one.
  recoverySessionKey = null
}) {
  const DEBUG_MEDIA = false;

  // Screen-framework effective master (post-ceiling, post-curve). When this hook
  // is rendered outside a ScreenVolumeProvider (e.g., Fitness, Feed, or any
  // other host), effectiveMaster = 1 and behavior is unchanged.
  const { effectiveMaster: masterVolume } = useScreenVolume();

  // Global guards persisted across remounts (per assetId)
  if (!useCommonMediaController.__appliedStartByKey) useCommonMediaController.__appliedStartByKey = Object.create(null);
  if (!useCommonMediaController.__lastPosByKey) useCommonMediaController.__lastPosByKey = Object.create(null);
  if (!useCommonMediaController.__lastSeekByKey) useCommonMediaController.__lastSeekByKey = Object.create(null);

  const assetId = meta.assetId || meta.key || meta.guid || meta.id || meta.plex || meta.mediaUrl;

  // Ledger scope: prefer the real playback session key; assetId keeps
  // accounting coherent for hosts without the resilience bridge.
  const recoveryScopeKey = recoverySessionKey || assetId || null;
  const recoveryMountIdRef = useRef(null);
  if (!recoveryMountIdRef.current) recoveryMountIdRef.current = `controller-mount-${++_controllerMountSeq}`;

  const segment = meta.segment || null;
  const segStart = segment?.start ?? 0;
  const segEnd = segment?.end ?? null;
  const segDuration = segment ? (segment.end - segment.start) : null;

  const containerRef = useRef(null);
  const [seconds, setSeconds] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const lastLoggedTimeRef = useRef(0);
  const lastUpdatedTimeRef = useRef(0);
  // Track last known playback position from timeupdate events
  const lastPlaybackPosRef = useRef(0);
  // Track last known duration so the unmount cleanup can compute percent
  const lastDurationRef = useRef(0);
  // Tracks which assetId was naturally ended (onEnded fired) so unmount cleanup
  // can skip duplicate logging when the video completed normally
  const endedAssetRef = useRef(null);
  
  // Track if this is the initial load (for start time application)
  const isInitialLoadRef = useRef(true);
  
  // Track if we're in a stall recovery reload to prevent applying initial start time
  const isRecoveringRef = useRef(false);
  
  // Track the last seek intent (what time user tried to seek to)
  const lastSeekIntentRef = useRef(null);

  // Debounce seek logging — DASH fires multiple seeked events per seek (audio+video tracks)
  const lastSeekedLogTsRef = useRef(0);

  // Unique identity for this mount instance (used to scope the start-time guard)
  const mountIdRef = useRef(Symbol('mount'));

  // Track if playback.started has been logged for this media (one-time per track)
  const playbackStartedRef = useRef(false);

  // Stall detection refs. The controller is detection + two ledger-gated
  // actuators (nudge, softReinit); escalation bookkeeping (attempt counters,
  // strategy pipeline, terminal state) lives in the shared recoveryLedger and
  // the resilience layer (audit 2026-07-09 §3.3).
  const stallStateRef = useRef({
    lastProgressTs: 0,
    lastAdvancePos: null,
    lastObservedCurrentTime: null,  // tracks currentTime at last markProgress for stall verdict (bug 2026-05-23 §1)
    lastObservedVideoFrames: null,  // decoder frame counter at last progress — starvation-immune liveness (2026-07-09)
    stallSuspicion: null,           // armed on first stalled verdict; declared only if a re-sample confirms (2026-07-09)
    softTimer: null,
    hardTimer: null,
    isStalled: false,
    lastStrategy: null,
    hasEnded: false,
    status: 'idle',
    sinceTs: null,
    lastSuccessTs: null,
    // One-shot guard for `playback.at-duration-stuck` telemetry (audit 2026-05-23).
    atDurationStuckLogged: false
  });
  const [stallState, setStallState] = useState(() => ({
    status: 'idle',
    since: null,
    strategy: null,
    lastSuccessTs: null
  }));
  const [isStalled, setIsStalled] = useState(false);
  const recoverySnapshotRef = useRef(null);
  const [elementKey, setElementKey] = useState(0);

  // Stall monitoring is always on (formerly stallConfig.enabled; no producer
  // ever disabled it).
  useEffect(() => {
    if (stallStateRef.current.status === 'idle') {
      stallStateRef.current.status = 'monitoring';
    }
    setStallState((prev) => {
      if (prev.status === 'monitoring') return prev;
      return { ...prev, status: 'monitoring' };
    });
  }, []);

  const publishStallSnapshot = useCallback((overrides = {}) => {
    const ref = stallStateRef.current;
    const snapshot = {
      status: ref.status,
      since: ref.sinceTs,
      strategy: ref.lastStrategy,
      lastSuccessTs: ref.lastSuccessTs,
      ...overrides
    };
    setStallState((prev) => {
      if (
        prev.status === snapshot.status &&
        prev.since === snapshot.since &&
        prev.strategy === snapshot.strategy &&
        prev.lastSuccessTs === snapshot.lastSuccessTs
      ) {
        return prev;
      }
      return snapshot;
    });
    return snapshot;
  }, []);

  const readStallState = useCallback(() => {
    const ref = stallStateRef.current;
    return {
      status: ref.status,
      since: ref.sinceTs,
      strategy: ref.lastStrategy,
      lastSuccessTs: ref.lastSuccessTs
    };
  }, []);

  const getContainerEl = useCallback(() => {
    return containerRef.current;
  }, []);

  const getMediaEl = useCallback(() => {
    const container = containerRef.current;
    if (!container) return null;
    // If container has shadow DOM (dash-video), get the inner video/audio
    if (container.shadowRoot) {
      return container.shadowRoot.querySelector('video, audio');
    }
    // Otherwise container IS the media element
    return container;
  }, []);

  // Apply the controlled playbackRate to the live element the instant it changes.
  // The element-setup effect only (re)applies rate on play/seeked, so without this a
  // mid-playback rate change (e.g. the rate button) wouldn't take effect until the
  // next seek. getMediaEl() resolves the real <video> inside the dash-video shadow DOM.
  useEffect(() => {
    const el = getMediaEl();
    if (el && Number.isFinite(playbackRate) && el.playbackRate !== playbackRate) {
      el.playbackRate = playbackRate;
    }
  }, [playbackRate, getMediaEl, elementKey]);

  // Re-apply master × volume to the active media element when either changes.
  // Volume is set once on loadedmetadata; this effect propagates live master
  // changes (vol-up/down on the screen-framework numpad) to playing media.
  useEffect(() => {
    const mediaEl = getMediaEl();
    if (!mediaEl) return;
    // `?? 100` (not `|| 100`): an explicit volume of 0 means mute, not default.
    let processed = parseFloat(volume ?? 100);
    if (!Number.isFinite(processed)) processed = 100;
    if (processed > 1) processed = processed / 100;
    const adjusted = Math.min(1, Math.max(0, processed));
    try {
      mediaEl.volume = Math.min(1, Math.max(0, adjusted * masterVolume));
    } catch { /* element may not yet support volume */ }
  }, [masterVolume, volume, getMediaEl, elementKey]);

  // Use DASH for dash_video mediaType (set by adapters that serve DASH streams)
  const isDash = meta.mediaType === 'dash_video';

  // Reset per-media state on media change to prevent carryover
  useEffect(() => {
    // Log media key changes to catch unexpected resets
    try {
      if (assetId) {
        if (!useCommonMediaController.__prevKeyLog) useCommonMediaController.__prevKeyLog = assetId;
        if (useCommonMediaController.__prevKeyLog !== assetId) {
          if (DEBUG_MEDIA) console.log('[MediaKey] change detected', { from: useCommonMediaController.__prevKeyLog, to: assetId });
          useCommonMediaController.__prevKeyLog = assetId;
        }
      }
    } catch {}
    // Reset initial load flag when media changes
    isInitialLoadRef.current = true;
    // Reset playback started flag for new media
    playbackStartedRef.current = false;
  }, [assetId]);

  useEffect(() => {
    setElementKey(0);
  }, [assetId]);

  const handleProgressClick = useCallback((event) => {
    if (!duration || !containerRef.current) return;
    const mediaEl = getMediaEl();
    if (!mediaEl) return;
    mediaEl.__seekSource = 'click';
    const rect = event.currentTarget.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickPercent = clickX / rect.width;
    if (segDuration) {
      mediaEl.currentTime = segStart + (clickPercent * segDuration);
    } else {
      mediaEl.currentTime = clickPercent * duration;
    }
    mcLog().info('playback.progress-click', {
      mediaKey: assetId,
      clickPercent: Math.round(clickPercent * 1000) / 10,
      targetTime: mediaEl.currentTime,
      duration,
      segment: segment ? { start: segStart, end: segEnd } : null
    });
  }, [duration, getMediaEl, segStart, segDuration, assetId, segment, segStart, segEnd]);

  // Use centralized keyboard handler
  useMediaKeyboardHandler({
    getMediaEl,
    onEnd,
    onClear,
    cycleThroughClasses,
    playbackKeys,
    queuePosition,
    ignoreKeys,
    meta,
    type,
    assetId,
    isVideo,
    setCurrentTime: setSeconds,
    keyboardOverrides
  });

  // Clear timers utility
  const clearTimers = useCallback(() => {
    const s = stallStateRef.current;
    if (s.softTimer) { clearTimeout(s.softTimer); s.softTimer = null; }
    if (s.hardTimer) { clearTimeout(s.hardTimer); s.hardTimer = null; }
    // A pending stall suspicion is only meaningful between two consecutive
    // soft checks; any timer teardown (pause, unmount, reset) invalidates it.
    s.stallSuspicion = null;
  }, []);

  // A suspected stall turned out to be a starved main-thread clock, not frozen
  // media. Emit countable telemetry (this is the prod metric for how often the
  // page is starving) and stand down. See 2026-07-09 diagnosis.
  const dismissStallSuspicion = useCallback((source) => {
    const s = stallStateRef.current;
    const suspicion = s.stallSuspicion;
    if (!suspicion) return;
    s.stallSuspicion = null;
    const mediaEl = getMediaEl();
    getLogger().debug('playback.stall_false_positive_averted', {
      mediaKey: assetId,
      source,
      suspectedGapMs: suspicion.gapMs,
      confirmDelayMs: Date.now() - suspicion.ts,
      playheadJumpMs: mediaEl && Number.isFinite(suspicion.currentTime)
        ? Math.round((mediaEl.currentTime - suspicion.currentTime) * 1000)
        : null
    });
  }, [assetId, getMediaEl]);

  // Recovery strategies
  // Nudge: Tiny time adjustment to trigger buffer reload
  const nudgeRecovery = useCallback((_options = {}) => {
    const mediaEl = getMediaEl();
    if (!mediaEl) return false;

    try {
      const t = mediaEl.currentTime;
      const buffered = mediaEl.buffered;

      // Check if current position is within any buffered range
      let inBuffer = false;
      for (let i = 0; i < buffered.length; i++) {
        if (t >= buffered.start(i) && t <= buffered.end(i)) {
          inBuffer = true;
          break;
        }
      }

      // If not in a buffered range, nudge won't help — return false and let
      // the resilience jolt ladder handle escalation (the nudge is this
      // controller's single ledger-gated action; anything heavier is not its job)
      if (!inBuffer && buffered.length > 0) {
        if (DEBUG_MEDIA) console.log('[Stall Recovery] nudge: currentTime not in any buffered range, skipping', { t, ranges: buffered.length });
        mcLog().debug('playback.recovery-strategy', { mediaKey: assetId, strategy: 'nudge', success: false, reason: 'outside-buffered-range', currentTime: t, bufferedRanges: buffered.length });
        return false;
      }

      tagPauseSource(mediaEl, 'recovery-nudge');
      mediaEl.pause();
      mediaEl.currentTime = Math.max(0, t - 0.001);
      tagPlaySource(mediaEl, 'recovery-nudge');
      mediaEl.play().catch(() => {});
      return true;
    } catch (_) {
      return false;
    }
  }, [getMediaEl]);

  // Soft reinitialisation: rebuild dash element without tearing down React tree
  const softReinitRecovery = useCallback((options = {}) => {
    const hostEl = containerRef.current;
    const mediaEl = getMediaEl();
    if (!mediaEl && !hostEl) return false;

    const seekBackSeconds = Number.isFinite(options.seekBackSeconds) ? options.seekBackSeconds : SOFT_REINIT_SEEKBACK_SECONDS;
    const currentTime = mediaEl?.currentTime ?? lastPlaybackPosRef.current ?? 0;
    const targetTime = Math.max(0, currentTime - (seekBackSeconds || 0));

    recoverySnapshotRef.current = {
      targetTime,
      playbackRate: mediaEl?.playbackRate ?? playbackRate,
      volume: mediaEl?.volume,
      wasPaused: mediaEl?.paused ?? false,
      seekBackSeconds
    };

    isRecoveringRef.current = true;

    try {
      mediaEl?.pause?.();
    } catch (_) {}

    const destroyCandidates = ['destroy', 'reset', 'destroyPlayer', 'resetPlayer'];
    const attemptDestroy = (node) => {
      if (!node) return false;
      let performed = false;
      destroyCandidates.forEach((method) => {
        if (typeof node[method] === 'function') {
          try {
            node[method]();
            performed = true;
          } catch (err) {
            console.warn('[Stall Recovery] softReinit: error invoking', method, err);
          }
        }
      });
      if (node && node.dashjsPlayer && typeof node.dashjsPlayer.reset === 'function') {
        try {
          node.dashjsPlayer.reset();
          performed = true;
        } catch (err) {
          console.warn('[Stall Recovery] softReinit: error invoking dashjsPlayer.reset', err);
        }
      }
      return performed;
    };

    const hostDestroyed = attemptDestroy(hostEl);
    const mediaDestroyed = mediaEl && mediaEl !== hostEl ? attemptDestroy(mediaEl) : false;

    setElementKey((prev) => prev + 1);

    // Clear the start-time guard so the remounted instance re-applies start time
    delete useCommonMediaController.__appliedStartByKey[assetId];
    mcLog().debug('playback.state-mutation', { dict: 'appliedStartByKey', action: 'delete', mediaKey: assetId, reason: 'softReinit' });

    lastSeekIntentRef.current = targetTime;
    try { useCommonMediaController.__lastSeekByKey[assetId] = targetTime; } catch {}
    mcLog().debug('playback.state-mutation', { dict: 'seekIntent', action: 'set', mediaKey: assetId, value: targetTime, reason: 'softReinit' });

    if (DEBUG_MEDIA) console.log('[Stall Recovery] softReinit: triggered', { targetTime, seekBackSeconds, hostDestroyed, mediaDestroyed });

    return true;
  }, [getMediaEl, playbackRate, setElementKey, assetId]);

  // Position watchdog: verify recovery landed at the expected position
  const verifyRecoveryPosition = useCallback((expectedTime, toleranceSeconds = 30) => {
    const checkDelay = 2000; // check 2s after recovery
    setTimeout(() => {
      const mediaEl = getMediaEl();
      if (!mediaEl || !Number.isFinite(expectedTime) || expectedTime <= 0) return;
      const actual = mediaEl.currentTime;
      const drift = Math.abs(actual - expectedTime);
      if (drift > toleranceSeconds) {
        if (DEBUG_MEDIA) console.log('[Stall Recovery] position watchdog: drift detected, correcting', { expected: expectedTime, actual, drift });
        mcLog().warn('playback.position-watchdog', { mediaKey: assetId, status: 'drift-detected', expected: expectedTime, actual, drift, tolerance: toleranceSeconds, correcting: true });
        try {
          if (containerRef.current?.api?.seek) {
            containerRef.current.api.seek(expectedTime);
          } else {
            mediaEl.currentTime = expectedTime;
          }
        } catch (e) {
          if (DEBUG_MEDIA) console.log('[Stall Recovery] position watchdog: correction seek failed', e);
          mcLog().error('playback.position-watchdog', { mediaKey: assetId, status: 'correction-failed', expected: expectedTime, actual, drift });
        }
      } else {
        if (DEBUG_MEDIA) console.log('[Stall Recovery] position watchdog: position OK', { expected: expectedTime, actual, drift });
        mcLog().debug('playback.position-watchdog', { mediaKey: assetId, status: 'ok', expected: expectedTime, actual, drift });
      }
    }, checkDelay);
  }, [getMediaEl]);

  const scheduleStallDetection = useCallback(() => {
    const s = stallStateRef.current;
    if (s.hasEnded) {
      if (DEBUG_MEDIA) console.log('[Stall] schedule: skip (hasEnded=true)');
      return;
    }
    if (s.softTimer) {
      // A soft timer is already scheduled
      return;
    }
    if (s.isStalled) {
      if (DEBUG_MEDIA) console.log('[Stall] schedule: already marked stalled; awaiting recovery');
      return;
    }
    
    const mediaEl = getMediaEl();
    if (!mediaEl) {
      if (DEBUG_MEDIA) console.log('[Stall] schedule: no media element');
      return;
    }
    if (mediaEl.paused) {
      // Don't stall-check while paused
      return;
    }
    
    // Schedule a soft stall check
    if (DEBUG_MEDIA) console.log('[Stall] schedule: set softTimer', { checkInterval: STALL_CHECK_INTERVAL_MS, currentTime: mediaEl.currentTime, duration: mediaEl.duration });
    s.softTimer = setTimeout(() => {
      const mediaEl = getMediaEl();
      const s = stallStateRef.current;
      
      // If media element is gone or paused, stop checking
      if (!mediaEl || mediaEl.paused) {
        if (DEBUG_MEDIA) console.log('[Stall] softTimer: cancel (no media or paused)');
        clearTimers();
        return;
      }
      
      // Check if media has ended or is very close to end
      if (s.hasEnded || mediaEl.ended || (mediaEl.duration && mediaEl.currentTime >= mediaEl.duration - 0.5)) {
        if (DEBUG_MEDIA) console.log('[Stall] softTimer: media ended or near end; cancel timers');
        // Audit 2026-05-23 §2.2: when the guard activates due to the near-end
        // branch (not a legitimate ended event), the screens player is in the
        // stuck-at-duration failure mode. Emit a one-shot telemetry log so the
        // condition is observable in prod alongside the watchdog's eventual
        // playback.end-of-content-advance.
        if (shouldLogAtDurationStuck({
          hasEnded: s.hasEnded,
          mediaEl,
          alreadyLogged: s.atDurationStuckLogged
        })) {
          s.atDurationStuckLogged = true;
          mcLog().warn('playback.at-duration-stuck',
            buildAtDurationStuckPayload({ assetId, mediaEl }));
        }
        s.hasEnded = true;
        clearTimers();
        return;
      }
      
      if (s.lastProgressTs === 0) {
        // No progress yet, reschedule
        s.softTimer = null;
        if (DEBUG_MEDIA) console.log('[Stall] softTimer: no progress yet; reschedule');
        scheduleStallDetection();
        return;
      }
      
      const videoFrames = readVideoFrames(mediaEl);
      const verdict = decideStallVerdict({
        now: Date.now(),
        lastProgressTs: s.lastProgressTs,
        softMs: SOFT_STALL_MS,
        currentTime: mediaEl.currentTime,
        lastObservedCurrentTime: s.lastObservedCurrentTime,
        videoFrames,
        lastObservedVideoFrames: s.lastObservedVideoFrames
      });

      if (verdict.verdict === 'progressing') {
        // Bug 2026-05-23 §1: timeupdate was starved but currentTime advanced.
        // Fast-forward lastProgressTs so the next soft-timer cycle has a fresh
        // baseline; do NOT log playback.stalled.
        dismissStallSuspicion('soft-check');
        s.lastProgressTs = Date.now();
        s.lastObservedCurrentTime = mediaEl.currentTime;
        s.lastObservedVideoFrames = videoFrames;
        s.softTimer = null;
        if (DEBUG_MEDIA) console.log('[Stall] softTimer: progressing (currentTime advanced); fast-forward', { currentTime: mediaEl.currentTime });
        scheduleStallDetection();
        return;
      }

      if (verdict.verdict === 'stalled') {
        // 2026-07-09 fix: at this moment we are RUNNING main-thread JS, but the
        // element's official position is refreshed by a separate main-thread
        // task that may not have run yet after a starvation episode — every
        // false stall that session snapped forward within 30ms. Arm a suspicion
        // and re-sample one checkInterval later; only a still-frozen clock
        // (and frame counter) declares.
        if (!s.stallSuspicion) {
          s.stallSuspicion = {
            ts: Date.now(),
            currentTime: mediaEl.currentTime,
            gapMs: verdict.stallDurationMs
          };
          if (DEBUG_MEDIA) console.log('[Stall] suspected (soft); awaiting confirmation re-sample', { gapMs: verdict.stallDurationMs, currentTime: mediaEl.currentTime });
          s.softTimer = null;
          scheduleStallDetection();
          return;
        }
        s.stallSuspicion = null;
        if (DEBUG_MEDIA) console.log('[Stall] DETECTED (soft)', { diff: verdict.stallDurationMs, softMs: SOFT_STALL_MS, hardMs: HARD_STALL_MS, currentTime: mediaEl.currentTime, duration: mediaEl.duration });
        // Prod telemetry: stall detected
        const logger = getLogger();
        logger.warn('playback.stalled', {
          title: meta?.title || meta?.name,
          artist: meta?.artist,
          album: meta?.album,
          grandparentTitle: meta?.grandparentTitle,
          parentTitle: meta?.parentTitle,
          mediaKey: assetId,
          currentTime: mediaEl.currentTime,
          duration: mediaEl.duration,
          stallDurationMs: verdict.stallDurationMs
        });
        s.isStalled = true;
        if (!s.sinceTs) s.sinceTs = Date.now();
        s.status = 'stalled';
        publishStallSnapshot();
        setIsStalled(true);

        const recoveryDelay = Math.max(0, HARD_STALL_MS - SOFT_STALL_MS);
        s.hardTimer = setTimeout(() => {
          const s = stallStateRef.current;
          const mediaEl = getMediaEl();
          s.hardTimer = null;

          // Don't attempt recovery if media has ended
          if (s.hasEnded || !mediaEl || mediaEl.ended || (mediaEl.duration && mediaEl.currentTime >= mediaEl.duration - 0.5)) {
            if (DEBUG_MEDIA) console.log('[Stall] hardTimer: skip recovery (ended or invalid)');
            clearTimers();
            return;
          }

          if (!s.isStalled) {
            if (DEBUG_MEDIA) console.log('[Stall] hardTimer: not stalled anymore; abort');
            return;
          }

          const ledger = getRecoveryLedger();
          const fireStrategy = (strategy, method, gate) => {
            s.lastStrategy = strategy;
            s.status = 'recovering';
            publishStallSnapshot();
            const success = method();
            mcLog().warn('playback.recovery-strategy', {
              mediaKey: assetId,
              strategy,
              attempt: gate.attempt,
              success,
              currentTime: mediaEl.currentTime,
              duration: mediaEl.duration,
              lastSeekIntent: lastSeekIntentRef.current
            });
            return success;
          };

          // If duration is lost, escalate to softReinit immediately — a nudge
          // can't help a dead element. Gated through the ledger for session-cap
          // visibility, but with bypassCooldown so a recent jolt/resilience
          // recovery can't starve a hard element failure.
          if (!Number.isFinite(mediaEl.duration)) {
            const gate = ledger.request({
              sessionKey: recoveryScopeKey,
              mountId: recoveryMountIdRef.current,
              actor: 'controller-softreinit',
              reason: 'duration-lost',
              bypassCooldown: true
            });
            if (!gate.allowed) {
              // Session budget spent — the resilience layer owns exhaustion.
              mcLog().warn('playback.recovery-denied', {
                mediaKey: assetId,
                strategy: 'softReinit',
                reason: 'duration-lost',
                deniedBy: gate.deniedBy,
                attempt: gate.attempt
              });
              return;
            }
            if (DEBUG_MEDIA) console.log('[Stall] hardTimer: duration lost, escalating to softReinit');
            mcLog().error('playback.duration-lost', {
              mediaKey: assetId,
              currentTime: mediaEl.currentTime,
              duration: mediaEl.duration,
              lastSeekIntent: lastSeekIntentRef.current,
              stallDurationMs: s.sinceTs ? Date.now() - s.sinceTs : null,
              escalatingTo: 'softReinit'
            });
            fireStrategy('softReinit', softReinitRecovery, gate);
            return;
          }

          // One ledger-gated nudge per stall episode — and nothing else. The
          // resilience jolt ladder (armed by this same stall via
          // externalStalled/playbackHealth) owns all escalation past the nudge.
          const gate = ledger.request({
            sessionKey: recoveryScopeKey,
            mountId: recoveryMountIdRef.current,
            actor: 'controller-nudge',
            reason: 'hard-stall-nudge'
          });
          if (!gate.allowed) {
            const payload = {
              mediaKey: assetId,
              strategy: 'nudge',
              deniedBy: gate.deniedBy,
              waitMs: gate.waitMs,
              attempt: gate.attempt
            };
            // Session-cap exhaustion is terminal for this controller's own
            // actuation; cooldown denial is routine backpressure.
            if (gate.deniedBy === 'session-cap') {
              mcLog().warn('playback.recovery-denied', payload);
            } else {
              mcLog().debug('playback.recovery-denied', payload);
            }
            return;
          }
          fireStrategy('nudge', nudgeRecovery, gate);
        }, recoveryDelay);
      } else {
        // verdict 'within-window' — reschedule
        s.softTimer = null;
        if (DEBUG_MEDIA) console.log('[Stall] softTimer: no stall yet; diff < softMs; reschedule', { softMs: SOFT_STALL_MS });
        scheduleStallDetection();
      }
    }, STALL_CHECK_INTERVAL_MS);
  }, [getMediaEl, clearTimers, dismissStallSuspicion, publishStallSnapshot, nudgeRecovery, softReinitRecovery, recoveryScopeKey]);

  const markProgress = useCallback(() => {
    const s = stallStateRef.current;
    if (s.hasEnded) {
      return;
    }

    const mediaEl = getMediaEl();
    const pos = mediaEl ? mediaEl.currentTime : null;

    // Only genuine forward motion counts as progress. A `timeupdate` also fires
    // on seeks, the recovery nudge (currentTime -= 0.001), and DASH buffer pokes;
    // treating those as progress is what reset the escalation counter and let the
    // player nudge-loop forever without ever reaching `reload`.
    const { advanced, nextPos } = evaluatePlayheadProgress(pos, s.lastAdvancePos);
    s.lastAdvancePos = nextPos;
    if (!advanced) {
      return;
    }

    const wasStalled = s.isStalled;
    // Genuine forward motion refutes any pending stall suspicion (2026-07-09).
    dismissStallSuspicion('timeupdate');
    s.lastProgressTs = Date.now();
    if (Number.isFinite(pos)) {
      s.lastObservedCurrentTime = pos;
    }
    s.lastObservedVideoFrames = readVideoFrames(mediaEl);

    if (wasStalled) {
      if (DEBUG_MEDIA) console.log('[Stall] Progress resumed; clearing stalled state', { currentTime: mediaEl?.currentTime, lastStrategy: s.lastStrategy });
      mcLog().info('playback.recovery-resolved', {
        mediaKey: assetId,
        currentTime: mediaEl?.currentTime,
        duration: mediaEl?.duration,
        stallDurationMs: s.sinceTs ? Date.now() - s.sinceTs : null,
        lastStrategy: s.lastStrategy,
        lastSeekIntent: lastSeekIntentRef.current
      });
      s.isStalled = false;
      s.sinceTs = null;
      s.status = 'monitoring';
      s.lastSuccessTs = Date.now();
      // Controller-observed resume clears the shared ledger session (idempotent
      // with useMediaResilience's progress-effect recordSuccess).
      getRecoveryLedger().recordSuccess(recoveryScopeKey);
      publishStallSnapshot();
      clearTimers();
      setIsStalled(false);
      scheduleStallDetection();
    }
    // Continuous polling in scheduleStallDetection handles rescheduling
  }, [clearTimers, dismissStallSuspicion, scheduleStallDetection, getMediaEl, publishStallSnapshot, recoveryScopeKey]);

  useEffect(() => {
    const mediaEl = getMediaEl();
    if (!mediaEl) return;

    const logProgress = async () => {
      const now = Date.now();
      lastUpdatedTimeRef.current = now;
      const diff = now - lastLoggedTimeRef.current;
      const pct = getProgressPercent(mediaEl.currentTime || 0, mediaEl.duration || 0);
      if (diff > 10000 && parseFloat(pct) > 0) {
        lastLoggedTimeRef.current = now;
        const secs = mediaEl.currentTime || 0;
        if (secs > 10) {
          const title = meta.title + (meta.grandparentTitle ? ` (${meta.grandparentTitle} - ${meta.parentTitle})` : '');
          await DaylightAPI(`api/v1/play/log`, { title, type, assetId, seconds: secs, percent: pct, listId: meta?.listId || null });
        }
      }
    };

    const onTimeUpdate = () => {
      const rawTime = mediaEl.currentTime;
      setSeconds(segDuration ? Math.max(0, rawTime - segStart) : rawTime);
      // Keep a sticky record of the last known good time
      lastPlaybackPosRef.current = mediaEl.currentTime || 0;
      // Persist last position per assetId across remounts
      try { useCommonMediaController.__lastPosByKey[assetId] = lastPlaybackPosRef.current; } catch {}
      logProgress();
      markProgress();
      if (onProgress) {
        const stallSnapshot = readStallState();
        onProgress({
          currentTime: segDuration ? Math.max(0, mediaEl.currentTime - segStart) : (mediaEl.currentTime || 0),
          duration: segDuration || (mediaEl.duration || 0),
          paused: mediaEl.paused,
          media: meta,
          percent: segDuration
            ? getProgressPercent(mediaEl.currentTime - segStart, segDuration)
            : getProgressPercent(mediaEl.currentTime, mediaEl.duration),
          stalled: isStalled,
          isSeeking,
          seekIntent: lastSeekIntentRef.current,
          lastStrategy: stallSnapshot.strategy,
          stallState: stallSnapshot
        });
      }

      // Segment end detection — advance when playback reaches segment boundary
      if (segEnd && mediaEl.currentTime >= segEnd) {
        const s = stallStateRef.current;
        s.hasEnded = true;
        clearTimers();
        if (s.isStalled) {
          s.isStalled = false;
          setIsStalled(false);
        }
        logProgress();
        onEnd();
        return;
      }
    };

    const onDurationChange = () => {
      const dur = segDuration || mediaEl.duration;
      setDuration(dur);
      if (dur > 0) lastDurationRef.current = dur;
    };

    const onEnded = () => {
      const mediaEl = getMediaEl();
      const title = meta.title + (meta.grandparentTitle ? ` (${meta.grandparentTitle} - ${meta.parentTitle})` : '');

      lastLoggedTimeRef.current = 0;
      // Mark this asset as naturally ended so the unmount cleanup skips it
      endedAssetRef.current = assetId;

      // Immediately flag as ended to prevent any recovery attempts
      const s = stallStateRef.current;
      s.hasEnded = true;
      
      // Clear stall detection when track ends
      clearTimers();
      
      if (s.isStalled) {
        s.isStalled = false;
        setIsStalled(false);
      }
      
      logProgress();
      onEnd();
    };

    const onLoadedMetadata = () => {
      const duration = mediaEl.duration || 0;
      const snapshot = recoverySnapshotRef.current;
      const snapshotTarget = snapshot && Number.isFinite(snapshot.targetTime) ? snapshot.targetTime : null;
      
      // `?? 100` (not `|| 100`): an explicit volume of 0 means mute, not default.
      let processedVolume = parseFloat(volume ?? 100);
      if (!Number.isFinite(processedVolume)) processedVolume = 100;
      if (processedVolume > 1) {
        processedVolume = processedVolume / 100;
      }
      
      const adjustedVolume = Math.min(1, Math.max(0, processedVolume));
      const isVideo = ['video', 'dash_video'].includes(mediaEl.tagName.toLowerCase());

      // Only apply start time on effective initial load (first time for this assetId), not on recovery reloads
      let startTime = 0;
      const appliedByMount = useCommonMediaController.__appliedStartByKey[assetId];
      const hasAppliedThisMount = appliedByMount === mountIdRef.current;
      const isEffectiveInitial = isInitialLoadRef.current && !isRecoveringRef.current && !hasAppliedThisMount;
      if (isEffectiveInitial) {
        const shouldApplyStart = (duration > (12 * 60) || isVideo);
        startTime = shouldApplyStart ? start : 0;

        if (duration > 0 && startTime > 0 && !segment) {
          const progressPercent = (startTime / duration) * 100;
          const secondsRemaining = duration - startTime;
          if (progressPercent > 95 || secondsRemaining < 30) {
            startTime = 0;
          }
        }

        // Mark that we've completed the initial load for this key
        isInitialLoadRef.current = false;
        try { useCommonMediaController.__appliedStartByKey[assetId] = mountIdRef.current; } catch {}
        mcLog().debug('playback.state-mutation', { dict: 'appliedStartByKey', action: 'set', mediaKey: assetId, reason: 'initial-load' });
        if (DEBUG_MEDIA) console.log('[StartTime] initial load applying start', { startTime, start, isVideo, duration });
      } else {
        if (DEBUG_MEDIA) console.log('[StartTime] treating as non-initial load', {
          isRecovering: isRecoveringRef.current,
          hasAppliedForKey: hasAppliedThisMount,
          wasInitial: isInitialLoadRef.current,
          duration
        });
        if (isRecoveringRef.current) {
          if (DEBUG_MEDIA) console.log('[StartTime] skip applying start during recovery');
        }
      }

      // If an unexpected loadedmetadata occurs and we're not in recovery,
      // avoid snapping to 0 if we have a recent seek intent or a last known good position.
      if (!isRecoveringRef.current) {
        const candidates = [
          lastSeekIntentRef.current,
          useCommonMediaController.__lastSeekByKey[assetId],
          lastPlaybackPosRef.current,
          useCommonMediaController.__lastPosByKey[assetId]
        ];
        const sticky = candidates.find(v => v != null && Number.isFinite(v)) || 0;
        const nearStart = (sticky <= 1);
        const nearEnd = (duration > 0) ? (sticky >= duration - 1) : false;
        const recent = (Date.now() - (stallStateRef.current.lastProgressTs || 0)) <= 15000;
        if (startTime === 0 && !nearStart && !nearEnd && (recent || sticky > 5)) {
          const stickyTarget = Math.max(0, sticky - 1); // small cushion back
          if (DEBUG_MEDIA) console.log('[StartTime] sticky resume on unexpected metadata', { sticky, stickyTarget, duration, recent });
          startTime = stickyTarget;
        } else if (startTime === 0) {
          if (DEBUG_MEDIA) console.log('[StartTime] sticky resume skipped', { sticky, nearStart, nearEnd, recent, duration });
        }
      } else if (snapshotTarget != null) {
        startTime = snapshotTarget;
      }
      
      // Structured diagnostic: log the full start time decision
      mcLog().info('playback.start-time-decision', {
        mediaKey: assetId,
        requestedStart: start,
        effectiveStart: startTime,
        duration,
        isEffectiveInitial,
        isRecovering: isRecoveringRef.current,
        hasAppliedForKey: hasAppliedThisMount,
        hasSnapshot: !!snapshot,
        snapshotTarget,
        isDash,
        stickyUsed: startTime > 0 && !isEffectiveInitial && !snapshot,
        lastSeekIntent: lastSeekIntentRef.current,
        lastSeekByKey: useCommonMediaController.__lastSeekByKey[assetId] ?? null,
        lastPosByKey: useCommonMediaController.__lastPosByKey[assetId] ?? null
      });

      mediaEl.dataset.key = assetId;

      // DASH resume: Plex appends ?offset=<seconds> to start transcoding from the resume
      // position, but the MPD still declares the full timeline (0 to full duration).
      // Segments before the offset are empty/0-byte, so we MUST client-side seek.
      // Use startTime if provided, otherwise extract offset from the stream URL.
      const streamSrc = isDash ? (containerRef.current?.getAttribute?.('src') || meta.mediaUrl || '') : '';
      const urlOffsetMatch = isDash ? streamSrc.match(/[?&]offset=(\d+)/) : null;
      const urlOffset = urlOffsetMatch ? Number(urlOffsetMatch[1]) : 0;
      const dashSeekTarget = (Number.isFinite(startTime) && startTime > 0) ? startTime : urlOffset;

      if (isDash && dashSeekTarget > 0) {
        {
          if (DEBUG_MEDIA) console.log('[StartTime] DASH: deferring seek to loadedmetadata/timeupdate', { startTime, urlOffset, dashSeekTarget });
          const container = containerRef.current;
          let seekApplied = false;
          const applySeek = (source) => {
            if (seekApplied) return;
            seekApplied = true;
            mediaEl.removeEventListener('loadedmetadata', onLoaded);
            mediaEl.removeEventListener('timeupdate', onTimeUpdate);
            try {
              if (container?.api?.seek) {
                container.api.seek(dashSeekTarget);
              } else {
                mediaEl.currentTime = dashSeekTarget;
              }
            } catch (_) {}
            mcLog().info('playback.start-time-applied', {
              mediaKey: assetId,
              method: `dash-${source}`,
              intent: dashSeekTarget,
              actual: mediaEl.currentTime,
              drift: Math.abs(mediaEl.currentTime - dashSeekTarget)
            });
            lastSeekIntentRef.current = null;
            if (DEBUG_MEDIA) console.log('[StartTime] DASH: applied seek via', source, { dashSeekTarget, currentTime: mediaEl.currentTime });
          };
          // Seek on loadedmetadata (earliest reliable point for DASH with server offset)
          const onLoaded = () => applySeek('loadedmetadata');
          // Fallback: seek on first timeupdate with any progress
          const onTimeUpdate = () => {
            if (mediaEl.currentTime < 0.5) return;
            applySeek('timeupdate');
          };
          mediaEl.addEventListener('loadedmetadata', onLoaded);
          mediaEl.addEventListener('timeupdate', onTimeUpdate);
          // If metadata already loaded (e.g. hardReset reload), seek immediately
          if (mediaEl.readyState >= 1) applySeek('immediate');
        }
      } else if (Number.isFinite(startTime)) {
        try {
          mediaEl.currentTime = startTime;
          mcLog().info('playback.start-time-applied', {
            mediaKey: assetId,
            method: 'direct',
            intent: startTime,
            actual: mediaEl.currentTime,
            drift: Math.abs(mediaEl.currentTime - startTime)
          });
          // Clear seek intent after start-time is applied — prevents stale intent
          // from polluting drift calculations on subsequent pause/resume seeks
          lastSeekIntentRef.current = null;
          if (DEBUG_MEDIA) console.log('[StartTime] set currentTime on load', { startTime, recovering: isRecoveringRef.current });
        } catch (_) {}
      }
      
      mediaEl.autoplay = true;
      mediaEl.volume = adjustedVolume * masterVolume;
      
      // Loop logic — set the native HTMLMediaElement.loop attribute when the
      // caller has *explicitly* opted in. We must NOT loop just because the
      // queue happens to be one item — most NFC/voice/button launches produce a
      // single-item queue and the user expects the track to play once and end.
      // Continuous queues use the queue-controller's continuous-mode logic
      // (advance() restarts from originalQueue), not the element loop.
      const queueLength = meta.queueLength || 0;
      const shouldLoopElement = !!meta.continuous ||
                                 !!meta.loop ||
                                 (queueLength === 0 && isVideo && duration < 20);
      
      if (shouldLoopElement) {
        mediaEl.loop = true;
      } else {
        mediaEl.loop = false;
      }
      
      if (isVideo) {
        mediaEl.controls = false;
        mediaEl.addEventListener('play', () => {
          mediaEl.playbackRate = playbackRate;
        }, { once: false });
        mediaEl.addEventListener('seeked', () => {
          mediaEl.playbackRate = playbackRate;
        }, { once: false });
      } else {
        mediaEl.playbackRate = playbackRate;
      }

      if (snapshot) {
        if (Number.isFinite(snapshot.playbackRate)) {
          mediaEl.playbackRate = snapshot.playbackRate;
        }
        if (typeof snapshot.volume === 'number') {
          mediaEl.volume = Math.min(1, Math.max(0, snapshot.volume * masterVolume));
        }
        if (snapshot.wasPaused) {
          setTimeout(() => {
            try { mediaEl.pause?.(); } catch (_) {}
          }, 0);
        }
      }
      
      // Reset ended flag for new media
      stallStateRef.current.hasEnded = false;
      stallStateRef.current.atDurationStuckLogged = false;
      // Fresh playhead baseline for the new item so the first real forward
      // timeupdate (not a seek-to-start) establishes progress tracking.
      stallStateRef.current.lastAdvancePos = null;
      stallStateRef.current.lastObservedCurrentTime = null;  // bug 2026-05-23 §1: reset stall-verdict tracking for new asset
      stallStateRef.current.lastObservedVideoFrames = null;  // frame counter is per-element; new asset = new baseline (2026-07-09)
      stallStateRef.current.stallSuspicion = null;
      // Don't set lastProgressTs here — let real playback progress (timeupdate
      // → markProgress) set it. Setting it at metadata-load time causes stall
      // detection to fire during initial buffering (after only softMs=1.2s),
      // triggering needless nudge/reload recovery on audio that just needs time
      // to buffer from a remote server.
      scheduleStallDetection();

      if (snapshot) {
        recoverySnapshotRef.current = null;
        isRecoveringRef.current = false;
        lastSeekIntentRef.current = null;
        mcLog().debug('playback.state-mutation', { dict: 'seekIntent', action: 'clear', mediaKey: assetId, reason: 'snapshot-cleanup' });
        verifyRecoveryPosition(snapshot.targetTime);
      }
    };

    const handleSeeking = () => {
      // Capture the seek intent (where the user is trying to seek to)
      const mediaEl = getMediaEl();
      if (mediaEl && Number.isFinite(mediaEl.currentTime)) {
        lastSeekIntentRef.current = mediaEl.currentTime;
        try { useCommonMediaController.__lastSeekByKey[assetId] = mediaEl.currentTime; } catch {}
        mcLog().sampled('playback.seek', {
          mediaKey: assetId,
          phase: 'seeking',
          intent: mediaEl.currentTime,
          duration: mediaEl.duration,
          source: mediaEl.__seekSource || 'programmatic'
        }, { maxPerMinute: 30 });
        // Audit 2026-05-23 §2.1 (Layer A): when a seek lands at end-of-content,
        // capture the stack trace so the next occurrence pins down the caller
        // (whether it is dash.js-internal, an untagged app path, or a known
        // recovery strategy). Sampled at 5/min so a stuck-loop cannot flood
        // the log.
        if (shouldTraceSeekAtDuration({ currentTime: mediaEl.currentTime, duration: mediaEl.duration })) {
          mcLog().sampled('playback.seek-trace',
            buildSeekTracePayload({ assetId, mediaEl, stack: captureSeekStack() }),
            { maxPerMinute: 5 });
        }
        delete mediaEl.__seekSource;
        if (DEBUG_MEDIA) console.log('[Seek] seeking event: intent captured', { intent: lastSeekIntentRef.current, duration: mediaEl.duration });
      }
      setIsSeeking(true);
    };
    const clearSeeking = () => {
      const el = getMediaEl();
      const now = Date.now();
      if (el && now - lastSeekedLogTsRef.current > 200) {
        lastSeekedLogTsRef.current = now;
        mcLog().sampled('playback.seek', {
          mediaKey: assetId,
          phase: 'seeked',
          actual: el.currentTime,
          intent: lastSeekIntentRef.current,
          drift: lastSeekIntentRef.current != null ? Math.abs(el.currentTime - lastSeekIntentRef.current) : null,
          duration: el.duration
        }, { maxPerMinute: 30 });
      }
      requestAnimationFrame(() => setIsSeeking(false));
    };

    mediaEl.addEventListener('timeupdate', onTimeUpdate);
    mediaEl.addEventListener('durationchange', onDurationChange);
    mediaEl.addEventListener('ended', onEnded);
    mediaEl.addEventListener('loadedmetadata', onLoadedMetadata);
    mediaEl.addEventListener('seeking', handleSeeking);
    mediaEl.addEventListener('seeked', clearSeeking);
    mediaEl.addEventListener('playing', clearSeeking);

    const onWaiting = () => {
      const el = getMediaEl();
      if (DEBUG_MEDIA) console.log('[Media] waiting event', { currentTime: el?.currentTime, duration: el?.duration });
      scheduleStallDetection();
    };
    const onStalled = () => {
      const el = getMediaEl();
      if (DEBUG_MEDIA) console.log('[Media] stalled event', { currentTime: el?.currentTime, duration: el?.duration });
      scheduleStallDetection();
    };
    const onPlaying = () => {
      const el = getMediaEl();
      if (DEBUG_MEDIA) console.log('[Media] playing event', { currentTime: el?.currentTime, duration: el?.duration });
      // Prod telemetry: playback actually started
      if (el && !playbackStartedRef.current) {
        playbackStartedRef.current = true;
        const logger = getLogger();
        logger.info('playback.started', {
          title: meta?.title || meta?.name,
          artist: meta?.artist,
          album: meta?.album,
          grandparentTitle: meta?.grandparentTitle,
          parentTitle: meta?.parentTitle,
          mediaKey: assetId,
          mediaType: isAudio ? 'audio' : isVideo ? 'video' : 'unknown',
          currentTime: el.currentTime,
          duration: el.duration,
          startedTs: Date.now()
        });
      }
      scheduleStallDetection();
    };

    // Prod telemetry: pause/resume events
    const onPause = () => {
      const el = getMediaEl();
      if (el && !el.ended) {
        const source = readAndClearPauseSource(el);
        const logger = getLogger();
        logger.info('playback.paused', {
          title: meta?.title || meta?.name,
          artist: meta?.artist,
          album: meta?.album,
          grandparentTitle: meta?.grandparentTitle,
          parentTitle: meta?.parentTitle,
          mediaKey: assetId,
          currentTime: el.currentTime,
          duration: el.duration,
          source
        });
      }
    };
    const onResume = () => {
      const el = getMediaEl();
      if (el && playbackStartedRef.current) {
        const source = readAndClearPlaySource(el);
        const logger = getLogger();
        logger.info('playback.resumed', {
          title: meta?.title || meta?.name,
          artist: meta?.artist,
          album: meta?.album,
          grandparentTitle: meta?.grandparentTitle,
          parentTitle: meta?.parentTitle,
          mediaKey: assetId,
          currentTime: el.currentTime,
          duration: el.duration,
          source
        });
      }
    };

    mediaEl.addEventListener('waiting', onWaiting);
    mediaEl.addEventListener('stalled', onStalled);
    mediaEl.addEventListener('playing', onPlaying);
    mediaEl.addEventListener('pause', onPause);
    mediaEl.addEventListener('play', onResume);

    return () => {
      mediaEl.removeEventListener('timeupdate', onTimeUpdate);
      mediaEl.removeEventListener('durationchange', onDurationChange);
      mediaEl.removeEventListener('ended', onEnded);
      mediaEl.removeEventListener('loadedmetadata', onLoadedMetadata);
      mediaEl.removeEventListener('waiting', onWaiting);
      mediaEl.removeEventListener('stalled', onStalled);
      mediaEl.removeEventListener('playing', onPlaying);
      mediaEl.removeEventListener('pause', onPause);
      mediaEl.removeEventListener('play', onResume);
      mediaEl.removeEventListener('seeking', handleSeeking);
      mediaEl.removeEventListener('seeked', clearSeeking);
    };
  }, [onEnd, playbackRate, start, isVideo, meta, type, assetId, onProgress, isStalled, volume, getMediaEl, markProgress, scheduleStallDetection, clearTimers, readStallState, elementKey]);

  useEffect(() => {
    const mediaEl = getMediaEl();
    if (mediaEl && onMediaRef) onMediaRef(mediaEl);
  }, [meta.assetId, onMediaRef, getMediaEl, elementKey]);

  // On asset change or unmount: save final position if playback was interrupted
  // (onEnded handles natural completion; this captures manual navigation away)
  useEffect(() => {
    // Capture values at effect-run time so cleanup has the correct asset's data
    const capturedAssetId = assetId;
    const capturedType = type;
    const capturedMeta = meta;
    return () => {
      if (endedAssetRef.current === capturedAssetId) return; // onEnded already logged
      const pos = lastPlaybackPosRef.current;
      if (pos < 10) return;
      const dur = lastDurationRef.current;
      if (!dur) return;
      const pct = getProgressPercent(pos, dur);
      if (parseFloat(pct) <= 0) return;
      const title = capturedMeta.title + (capturedMeta.grandparentTitle ? ` (${capturedMeta.grandparentTitle} - ${capturedMeta.parentTitle})` : '');
      mcLog().info('playback.unmount-progress-save', { assetId: capturedAssetId, pos, pct });
      DaylightAPI(`api/v1/play/log`, { title, type: capturedType, assetId: capturedAssetId, seconds: pos, percent: pct, listId: capturedMeta?.listId || null });
    };
  }, [assetId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (typeof onController === 'function') {
      onController({
        stallState,
        readStallState,
        getMediaEl,
        elementKey,
        // Transport-compatible API for Player.jsx seek functionality
        seek: (targetSeconds) => {
          const mediaEl = getMediaEl();
          if (mediaEl && Number.isFinite(targetSeconds)) {
            mediaEl.currentTime = Math.max(0, targetSeconds);
          }
        },
        play: () => {
          const mediaEl = getMediaEl();
          if (mediaEl) {
            tagPlaySource(mediaEl, 'controller');
            mediaEl.play?.();
          }
        },
        pause: () => {
          const mediaEl = getMediaEl();
          if (mediaEl) {
            tagPauseSource(mediaEl, 'controller');
            mediaEl.pause?.();
          }
        },
        toggle: () => {
          const mediaEl = getMediaEl();
          if (mediaEl) {
            if (mediaEl.paused) {
              tagPlaySource(mediaEl, 'controller-toggle');
              mediaEl.play?.();
            } else {
              tagPauseSource(mediaEl, 'controller-toggle');
              mediaEl.pause?.();
            }
          }
        },
        getCurrentTime: () => {
          const mediaEl = getMediaEl();
          return mediaEl?.currentTime || 0;
        },
        getDuration: () => {
          const mediaEl = getMediaEl();
          return mediaEl?.duration || 0;
        }
      });
    }
  }, [onController, stallState, readStallState, getMediaEl, elementKey]);

  return {
    containerRef,
    seconds,
    percent: getProgressPercent(seconds, duration),
    duration,
    isPaused: !seconds ? false : getMediaEl()?.paused || false,
    isDash,
    shader,
    isStalled,
    isSeeking,
    handleProgressClick,
    stallState,
    elementKey,
    getMediaEl,
    getContainerEl
  };
}
