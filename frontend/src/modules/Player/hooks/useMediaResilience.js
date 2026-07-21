import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { playbackLog } from '../lib/playbackLogger.js';
import { getLogWaitKey } from '../lib/waitKeyLabel.js';
import { usePlaybackHealth } from './usePlaybackHealth.js';
import { useResilienceConfig } from './useResilienceConfig.js';
import { useResilienceState, RESILIENCE_STATUS } from './useResilienceState.js';
import { usePlaybackSession } from './usePlaybackSession.js';
import { formatTime } from '../lib/helpers.js';
import { shouldArmStartupDeadline } from '../lib/shouldArmStartupDeadline.js';
import { computeRecoverySeekMs } from './recoverySeek.js';
import { decideWarmupRecovery } from '../lib/decideWarmupRecovery.js';
import { stallJoltPlan, STALL_JOLT_GRACE_MS, STALL_JOLT_STEP_MS } from '../lib/stallJolt.js';
import { getRecoveryLedger, RECOVERY_MAX_ATTEMPTS } from '../lib/recoveryLedger.js';
import { evaluatePlayheadProgress } from '../lib/playheadProgress.js';
import { isNearEnd } from '../lib/nearEnd.js';

export { DEFAULT_MEDIA_RESILIENCE_CONFIG, MediaResilienceConfigContext, mergeMediaResilienceConfig } from './useResilienceConfig.js';
export { RESILIENCE_STATUS } from './useResilienceState.js';

const STATUS = RESILIENCE_STATUS;

// Reasons where the dash.js MPD manifest is almost certainly stale
// (Plex transcode session died during startup). These warrant a fresh
// fetch of the stream URL rather than a same-src reload.
const URL_REFRESH_REASONS = new Set([
  'startup-deadline-exceeded',
  'startup-deadline-exceeded-after-warmup',
  // A forward seek that landed past the Plex transcoder's head yields 0-byte
  // fragments the current session will never fill — only a fresh transcode at the
  // seek offset (URL refresh) unsticks it. See decideWarmupRecovery.js.
  'seek-stall-transcode-warming',
  'stale-session-detected'
]);

export function shouldRefreshUrlForReason(reason) {
  return URL_REFRESH_REASONS.has(reason);
}

// Recovery attempt/cooldown accounting lives in the shared recoveryLedger
// (module singleton — persists across React remounts caused by
// onReload → scheduleSinglePlayerRemount, so the cooldown/cap can't be
// bypassed by a remount resetting React state). See lib/recoveryLedger.js.

const USER_INTENT = Object.freeze({
  playing: 'playing',
  paused: 'paused',
  seeking: 'seeking'
});

// Grace period (ms) to suppress overlay during brief seeks (ffwd/rew bumps)
const SEEK_OVERLAY_GRACE_MS = 600;

/** Media resilience: recovery orchestration + overlay state for the Player. */
export function useMediaResilience({
  getMediaEl,
  meta = {},
  seconds = 0,
  isPaused = false,
  isSeeking = false,
  pauseIntent = null,
  initialStart = 0,
  waitKey,
  onStateChange,
  onReload,
  onExhausted,       // NEW: called when all recovery attempts are exhausted
  configOverrides,
  controllerRef,
  plexId,
  playbackSessionKey,
  debugContext,
  message,
  mediaTypeHint,
  playerFlavorHint,
  // External stalled flag from useCommonMediaController - if provided, trust this instead of internal detection
  externalStalled = null,
  // Self-contained formats (titlecard, etc.) have no media element — disable resilience monitoring
  disabled = false,
  // Identity changes when a renderer registers/deregisters its media element.
  // The transcode-warmup effect below bails when no element exists yet; since the
  // 2026-07-21 leak fix made `getMediaEl` identity-stable, this is what re-runs it
  // once the element appears. Without it the cold-start `transcodewarming` window
  // can be missed, so a legitimately-warming transcode gets killed by the startup
  // deadline. See useMediaErrorReporter for the full rationale.
  registrationSignal = null
}) {
  const { monitorSettings } = useResilienceConfig({ configOverrides });
  const {
    epsilonSeconds,
    hardRecoverLoadingGraceMs,
    maxSamePositionRetries,
    recoverySeekNudgeSeconds
  } = monitorSettings;
  // The attempt cap is owned by the recoveryLedger (not per-hook config) so
  // log payloads can never disagree with the enforced limit.
  const maxAttempts = RECOVERY_MAX_ATTEMPTS;

  const { state: resilienceState, status, statusRef, actions } = useResilienceState(STATUS.startup);

  const [showPauseOverlay, setShowPauseOverlay] = useState(true);

  // Consumer-side exhaustion dedupe: the ledger returns exhausted:true on
  // EVERY capped request, and both the deadline path and the jolt path can
  // hit the cap — onExhausted must fire once per exhaustion episode.
  const exhaustedNotifiedRef = useRef(false);

  // Release the ledger session when media changes (new session key) …
  const prevSessionKeyRef = useRef(playbackSessionKey);
  useEffect(() => {
    if (prevSessionKeyRef.current && prevSessionKeyRef.current !== playbackSessionKey) {
      getRecoveryLedger().releaseSession(prevSessionKeyRef.current);
      exhaustedNotifiedRef.current = false;
      lastSuccessPosRef.current = null;
    }
    prevSessionKeyRef.current = playbackSessionKey;
  }, [playbackSessionKey]);
  // … and on unmount — the final session's entry used to leak (audit §5).
  // Assumes one mounted Player per playbackSessionKey: a sibling hook sharing
  // the key would get its ledger entry wiped here (theoretical today —
  // DancePartyWidget/AudioLayer pairs play different guids).
  useEffect(() => () => {
    if (prevSessionKeyRef.current) {
      getRecoveryLedger().releaseSession(prevSessionKeyRef.current);
    }
  }, []);

  const logWaitKey = useMemo(() => getLogWaitKey(waitKey), [waitKey]);

  const playbackHealth = usePlaybackHealth({
    seconds,
    getMediaEl,
    waitKey,
    mediaType: mediaTypeHint || meta?.mediaType,
    playerFlavor: playerFlavorHint,
    epsilonSeconds
  });

  const { targetTimeSeconds, setTargetTimeSeconds, consumeTargetTimeSeconds } = usePlaybackSession({
    sessionKey: playbackSessionKey
  });

  // Latest-ref for the per-tick position inputs (`seconds`,
  // playbackHealth.lastProgressSeconds): both change on every progress tick,
  // and having them as triggerRecovery deps rebuilt its identity each tick —
  // churning every consumer effect (notably the controllerRef assignment).
  // The ref is updated each render; triggerRecovery reads it at call time, so
  // the values are always current without being reactive deps.
  const progressPositionRef = useRef({ seconds: 0, lastProgressSeconds: null });
  progressPositionRef.current = { seconds, lastProgressSeconds: playbackHealth.lastProgressSeconds };

  // User Intent tracking
  const [userIntent, setUserIntent] = useState(USER_INTENT.playing);
  useEffect(() => {
    if (isSeeking) {
      setUserIntent(USER_INTENT.seeking);
    } else if (isPaused && pauseIntent !== 'system') {
      setUserIntent(USER_INTENT.paused);
    } else {
      setUserIntent(USER_INTENT.playing);
    }
  }, [isPaused, isSeeking, pauseIntent]);

  // Stable boolean for dep array — avoids re-runs from meta object reference changes
  const hasMediaMeta = shouldArmStartupDeadline({ meta, disabled });

  // Startup deadline timer (for initial load grace period)
  const startupDeadlineRef = useRef(null);
  // Bumped by a recovery that doesn't change `status` (e.g. retryFromExhausted
  // while already in `recovering`) so the startup-deadline arm effect re-runs and
  // re-arms the watchdog for the fresh attempt instead of orphaning it.
  const [recoveryNonce, setRecoveryNonce] = useState(0);
  // Track if video has ever successfully played (for loop detection)
  const hasEverPlayedRef = useRef(false);
  // Track transcode warmup state (0-byte fragment detection extends startup deadline)
  const transcodeWarmingRef = useRef(false);
  // Timestamp (ms) a seek last STARTED; used to tell a seek-induced warmup (empty
  // fragments after a forward seek) from a cold-start warmup. 0 = no seek yet.
  const lastSeekAtRef = useRef(0);
  // True while a warmup-armed deadline is pending, so `transcodewarmed` can cancel it.
  const warmupDeadlineArmedRef = useRef(false);
  // Stuck-state jolt ladder (mid-playback stall / never-completing seek). Refs so
  // the ladder survives re-renders and the driving effect can depend only on the
  // boolean `isStuck`. joltLatestRef snapshots the callbacks/values each render.
  const joltStepRef = useRef(0);
  const joltIntentRef = useRef(null);
  const joltTimerRef = useRef(null);
  const joltLatestRef = useRef(null);
  // Track repeated same-position recovery seeks so we can nudge past a poisoned segment.
  const recoverySeekTrackerRef = useRef({ lastSeekMs: null, sameCount: 0 });
  // Last playhead position that counted as a genuine recovery success. The
  // ledger must only be cleared when the clock actually moved forward — a
  // remount at a frozen position fires progress events but is not recovery.
  const lastSuccessPosRef = useRef(null);

  // options (all optional — every no-options call site keeps its old behavior):
  //   bypassCooldown  — user-initiated recoveries skip the cooldown gate but
  //                     still record the attempt (pushes the shared window).
  //   seekToIntentMs  — caller-supplied explicit seek target; passed through
  //                     verbatim (the poisoned-segment nudge only applies to
  //                     positions this hook derived itself).
  //   refreshUrl      — override the reason-derived URL-refresh decision.
  //   forceRemount    — escalate to a full React remount in onReload.
  const triggerRecovery = useCallback((reason, options = {}) => {
    const bypassCooldown = options.bypassCooldown === true;
    const refreshUrl = typeof options.refreshUrl === 'boolean'
      ? options.refreshUrl
      : shouldRefreshUrlForReason(reason);
    const ledger = getRecoveryLedger();
    const gate = ledger.request({
      sessionKey: playbackSessionKey,
      mountId: waitKey,
      actor: 'resilience',
      reason,
      bypassCooldown,
      isUrlRefresh: refreshUrl
    });

    if (!gate.allowed) {
      if (gate.deniedBy === 'session-cap') {
        // Max attempts — prevents an infinite remount loop.
        playbackLog('resilience-recovery-exhausted', {
          reason, waitKey: logWaitKey,
          attempts: gate.attempt, maxAttempts,
          urlRefreshesAttempted: ledger.snapshot(playbackSessionKey)?.urlRefreshCount || 0
        }, { level: 'warn' });
        actions.setStatus(STATUS.exhausted);
        if (!exhaustedNotifiedRef.current) {
          exhaustedNotifiedRef.current = true;
          if (typeof onExhausted === 'function') {
            onExhausted({ reason, attempts: gate.attempt, waitKey });
          }
        }
      } else if (gate.deniedBy === 'cooldown') {
        playbackLog('resilience-recovery-cooldown-denied', {
          reason, waitKey: logWaitKey, waitMs: gate.waitMs, attempts: gate.attempt
        }, { level: 'debug' });
      }
      return;
    }

    const attempt = gate.attempt;
    playbackLog('resilience-recovery', {
      reason, waitKey: logWaitKey,
      status: statusRef.current, attempt, maxAttempts,
      // Explicit flag so soak-log filtering doesn't depend on reason-string
      // conventions to tell user-initiated recoveries from automatic ones.
      bypassCooldown
    });
    actions.setStatus(STATUS.recovering);

    if (typeof onReload === 'function') {
      let seekMs;
      if (Number.isFinite(options.seekToIntentMs)) {
        // Explicit caller intent (Fitness manual reload / stalled seek) — the
        // user picked this exact position, so no same-position nudge applies.
        seekMs = Math.max(0, options.seekToIntentMs);
      } else {
        const pos = progressPositionRef.current;
        const baseSeekMs = (targetTimeSeconds || pos.lastProgressSeconds || pos.seconds || initialStart || 0) * 1000;
        const computed = computeRecoverySeekMs({
          baseSeekMs,
          tracker: recoverySeekTrackerRef.current,
          config: { nudgeSeconds: recoverySeekNudgeSeconds, maxSamePositionRetries: maxSamePositionRetries }
        });
        recoverySeekTrackerRef.current = computed.tracker;
        seekMs = computed.seekMs;
      }
      onReload({
        reason,
        meta,
        waitKey,
        refreshUrl,
        ...(options.forceRemount === true ? { forceRemount: true } : {}),
        seekToIntentMs: seekMs
      });
    }
  }, [actions, logWaitKey, meta, onReload, onExhausted, statusRef, targetTimeSeconds, initialStart, waitKey, playbackSessionKey, maxSamePositionRetries, recoverySeekNudgeSeconds]);

  const retryFromExhausted = useCallback(() => {
    getRecoveryLedger().userReset(playbackSessionKey);
    exhaustedNotifiedRef.current = false;
    const seekMs = (targetTimeSeconds || playbackHealth.lastProgressSeconds || seconds || initialStart || 0) * 1000;
    consumeTargetTimeSeconds();
    actions.setStatus(STATUS.recovering);
    // Force the startup-deadline watchdog to re-arm even though `status` was
    // already `recovering` (so the retried remount isn't left without a watchdog
    // and escalation continues if it also stalls).
    clearTimeout(startupDeadlineRef.current);
    startupDeadlineRef.current = null;
    setRecoveryNonce((n) => n + 1);
    playbackLog('resilience-retry-from-exhausted', { waitKey: logWaitKey, seekToIntentMs: seekMs });
    if (typeof onReload === 'function') {
      // forceRemount: in-place hardReset (even with refreshUrl) is unreliable on a
      // reaped Plex transcode session — the <video> stays wedged at readyState=0.
      // A user-initiated exhaustion retry must escalate to a real React remount,
      // which mints a fresh transcode session (plexClientSession bumps with the
      // remount nonce). refreshUrl stays true so any in-place fallback still refreshes.
      onReload({ reason: 'user-retry-exhausted', meta, waitKey, refreshUrl: true, forceRemount: true, seekToIntentMs: seekMs });
    }
  }, [actions, consumeTargetTimeSeconds, logWaitKey, meta, onReload, playbackSessionKey, waitKey, targetTimeSeconds, playbackHealth.lastProgressSeconds, seconds, initialStart]);

  useEffect(() => {
    // Self-contained formats (titlecard, etc.) have no media element —
    // skip resilience monitoring to avoid false startup-deadline-exceeded remounts.
    if (disabled) {
      if (status !== STATUS.playing) actions.setStatus(STATUS.playing);
      clearTimeout(startupDeadlineRef.current);
      startupDeadlineRef.current = null;
      return;
    }

    if (userIntent === USER_INTENT.paused) {
      if (status !== STATUS.paused) actions.setStatus(STATUS.paused);
      return;
    }

    // Check if we have progress (used to track hasEverPlayed and clear startup deadline)
    if (playbackHealth.progressToken > 0) {
      if (status !== STATUS.playing) actions.setStatus(STATUS.playing);
      // Mark that we've successfully played (used for loop detection)
      hasEverPlayedRef.current = true;
      recoverySeekTrackerRef.current = { lastSeekMs: null, sameCount: 0 };
      clearTimeout(startupDeadlineRef.current);
      startupDeadlineRef.current = null;

      // A progressToken bump means "a progress event fired", NOT "the clock
      // moved". A jolt's own remount fires `playing` at the frozen position;
      // clearing the ledger on that would defeat the attempt cap and cooldown.
      // Only strictly-forward motion counts as recovery.
      const observed = Number.isFinite(playbackHealth.lastProgressSeconds)
        ? playbackHealth.lastProgressSeconds
        : null;
      const { advanced, nextPos } = evaluatePlayheadProgress(observed, lastSuccessPosRef.current);
      lastSuccessPosRef.current = nextPos;
      if (advanced) {
        getRecoveryLedger().recordSuccess(playbackSessionKey);
        exhaustedNotifiedRef.current = false;
      }
      return;
    }

    // Coming out of paused with no progress: reset to startup so the deadline re-arms.
    // This handles autoplay unblock: status was paused (browser blocked playback),
    // user tapped to resume, but the seek/load hasn't produced progress yet.
    if (status === STATUS.paused) {
      actions.setStatus(STATUS.startup);
      return; // The status change will re-trigger this effect
    }

    // Startup/recovering: set a deadline for initial load
    // Gate: only arm when we have media metadata (prevents phantom entry timers)
    if (status === STATUS.startup || status === STATUS.recovering) {
      if (!startupDeadlineRef.current && hasMediaMeta) {
        startupDeadlineRef.current = setTimeout(() => {
          triggerRecovery('startup-deadline-exceeded');
          startupDeadlineRef.current = null;
        }, hardRecoverLoadingGraceMs);
      }
    }
  }, [status, playbackHealth.progressToken, playbackHealth.lastProgressSeconds, userIntent, actions, triggerRecovery, hardRecoverLoadingGraceMs, playbackSessionKey, disabled, hasMediaMeta, recoveryNonce]);

  // Clean up timers on unmount or waitKey change
  useEffect(() => {
    return () => {
      clearTimeout(startupDeadlineRef.current);
      startupDeadlineRef.current = null;
    };
  }, [waitKey]);

  // Transcode warmup awareness: extend deadline when 0-byte fragments detected
  useEffect(() => {
    if (disabled) return;

    // The transcodewarming event is dispatched on the dash-video element (web component).
    // We need to find it — getMediaEl returns the inner <video>, so walk up to the dash-video.
    const innerEl = getMediaEl?.();
    if (!innerEl) return;
    const target = innerEl.closest?.('dash-video') || innerEl.parentElement?.closest?.('dash-video') || innerEl;

    const handleWarming = () => {
      transcodeWarmingRef.current = true;

      // A cold-start warmup rides out a long (60s) deadline; a warmup caused by a
      // forward seek past the transcoder's head won't self-resolve, so escalate to
      // a URL-refresh recovery in a few seconds (restart the transcode at the seek
      // offset). decideWarmupRecovery picks which case we're in.
      const msSinceLastSeek = lastSeekAtRef.current ? (Date.now() - lastSeekAtRef.current) : Infinity;
      const { kind, deadlineMs, reason } = decideWarmupRecovery({
        hasEverPlayed: hasEverPlayedRef.current,
        msSinceLastSeek,
      });
      playbackLog('resilience-transcode-warming', {
        waitKey: logWaitKey, kind, deadlineMs, reason, msSinceLastSeek
      });

      clearTimeout(startupDeadlineRef.current);
      warmupDeadlineArmedRef.current = true;
      startupDeadlineRef.current = setTimeout(() => {
        warmupDeadlineArmedRef.current = false;
        triggerRecovery(reason);
        startupDeadlineRef.current = null;
      }, deadlineMs);
    };

    const handleWarmed = () => {
      if (transcodeWarmingRef.current) {
        transcodeWarmingRef.current = false;
        playbackLog('resilience-transcode-warmed', { waitKey: logWaitKey });
      }
      // Data is flowing again — cancel a pending warmup-armed recovery so a short
      // seek-stall deadline doesn't fire after the stall already cleared.
      if (warmupDeadlineArmedRef.current) {
        warmupDeadlineArmedRef.current = false;
        clearTimeout(startupDeadlineRef.current);
        startupDeadlineRef.current = null;
      }
    };

    target.addEventListener('transcodewarming', handleWarming);
    target.addEventListener('transcodewarmed', handleWarmed);

    return () => {
      target.removeEventListener('transcodewarming', handleWarming);
      target.removeEventListener('transcodewarmed', handleWarmed);
    };
    // registrationSignal: re-run once a renderer's element actually exists.
  }, [disabled, getMediaEl, logWaitKey, triggerRecovery, registrationSignal]);

  // Handle outside onStateChange
  useEffect(() => {
    if (onStateChange) onStateChange(resilienceState);
  }, [resilienceState, onStateChange]);

  // Track timestamps for position freshness
  const [playerPositionUpdatedAt, setPlayerPositionUpdatedAt] = useState(Date.now());
  const [intentPositionUpdatedAt, setIntentPositionUpdatedAt] = useState(null);
  const lastSecondsRef = useRef(seconds);
  const lastIntentSecondsRef = useRef(targetTimeSeconds);

  useEffect(() => {
    if (seconds !== lastSecondsRef.current) {
      lastSecondsRef.current = seconds;
      setPlayerPositionUpdatedAt(Date.now());
    }
  }, [seconds]);

  useEffect(() => {
    if (targetTimeSeconds !== lastIntentSecondsRef.current) {
      lastIntentSecondsRef.current = targetTimeSeconds;
      setIntentPositionUpdatedAt(Number.isFinite(targetTimeSeconds) ? Date.now() : null);
    }
  }, [targetTimeSeconds]);

  // SYNCHRONOUS: read the media element's state directly during render.
  // This catches seeks BEFORE React's isSeeking prop propagates (which can lag behind
  // isBuffering, causing the overlay to flash with the old position).
  // Also reads __seekSource ('bump' for arrow keys, 'click' for progress bar) to decide
  // whether the seek grace period should apply.
  const mediaElSnapshot = (() => {
    try {
      const el = getMediaEl?.();
      return {
        seeking: el?.seeking === true,
        seekSource: el?.__seekSource || null,
        duration: Number.isFinite(el?.duration) ? el.duration : null
      };
    } catch {
      return { seeking: false, seekSource: null, duration: null };
    }
  })();
  const effectiveSeeking = isSeeking || mediaElSnapshot.seeking;
  const isBumpSeek = mediaElSnapshot.seekSource === 'bump';

  // Sticky intent: preserve last known intent display for overlay use after consumption.
  // Uses SYNCHRONOUS render-time capture so the intent is available on the same render
  // that seeking starts (useEffect would be too late, causing a flash).
  const stickyIntentDisplayRef = useRef(null);
  const stickyIntentUpdatedAtRef = useRef(null);
  const prevEffectiveSeekingRef = useRef(false);

  // Capture intent from targetTimeSeconds (queue-initiated seeks) — useEffect is fine
  // here because targetTimeSeconds is set BEFORE seeking transitions.
  useEffect(() => {
    if (Number.isFinite(targetTimeSeconds)) {
      stickyIntentDisplayRef.current = formatTime(Math.max(0, targetTimeSeconds));
      stickyIntentUpdatedAtRef.current = Date.now();
    }
  }, [targetTimeSeconds]);

  // SYNCHRONOUS: capture sticky intent from media element on the render where
  // effectiveSeeking transitions to true (for progress bar clicks that bypass targetTimeSeconds).
  // Clear sticky intent on the render where effectiveSeeking transitions to false.
  if (effectiveSeeking && !prevEffectiveSeekingRef.current) {
    // Just started seeking — capture target from media element if no intent yet
    if (!stickyIntentDisplayRef.current) {
      try {
        const el = getMediaEl?.();
        if (el && Number.isFinite(el.currentTime)) {
          stickyIntentDisplayRef.current = formatTime(Math.max(0, el.currentTime));
          stickyIntentUpdatedAtRef.current = Date.now();
        }
      } catch { /* ignore */ }
    }
  }
  if (!effectiveSeeking && prevEffectiveSeekingRef.current) {
    // Just stopped seeking — clear sticky intent
    stickyIntentDisplayRef.current = null;
    stickyIntentUpdatedAtRef.current = null;
  }
  prevEffectiveSeekingRef.current = effectiveSeeking;

  // Seek grace period: suppress overlay during brief seeks (ffwd/rew bumps).
  // Uses a SYNCHRONOUS ref to suppress on the very first render (prevents flash),
  // plus an async timer to force re-render when the grace period expires.
  const seekGraceTimerRef = useRef(null);
  const seekStartedAtRef = useRef(null);
  const [seekGraceExpired, setSeekGraceExpired] = useState(false);

  // SYNCHRONOUS: track when seeking starts/stops (ref only, no setState during render)
  if (effectiveSeeking && seekStartedAtRef.current === null) {
    seekStartedAtRef.current = Date.now();
    // Persist the seek-start time (seekStartedAtRef is cleared as soon as seeking
    // ends). decideWarmupRecovery reads this to know a warmup was seek-induced.
    lastSeekAtRef.current = Date.now();
  }
  if (!effectiveSeeking) {
    seekStartedAtRef.current = null;
  }

  // Async timer: force re-render when grace expires so overlay can appear for long seeks
  useEffect(() => {
    if (effectiveSeeking) {
      clearTimeout(seekGraceTimerRef.current);
      seekGraceTimerRef.current = setTimeout(() => {
        setSeekGraceExpired(true);
      }, SEEK_OVERLAY_GRACE_MS);
    } else {
      setSeekGraceExpired(false);
      clearTimeout(seekGraceTimerRef.current);
      seekGraceTimerRef.current = null;
    }
    return () => clearTimeout(seekGraceTimerRef.current);
  }, [effectiveSeeking]);

  // Effective grace: only suppress overlay for bump seeks (arrow key ffwd/rew),
  // NOT for progress bar click seeks which should show the spinner immediately.
  const seekGraceActive = isBumpSeek && effectiveSeeking && !seekGraceExpired;

  // Presentation logic
  // Stall detection is now handled externally by useCommonMediaController
  const isStalled = externalStalled === true;
  const isRecovering = status === STATUS.recovering;
  const isStartup = status === STATUS.startup;
  const isUserPaused = userIntent === USER_INTENT.paused;
  // If the media clock is genuinely advancing, any lingering waiting/buffering
  // flag is stale (e.g. a `waiting` event whose matching `playing` was missed
  // because the element was swapped out by a recovery). The spinner must never
  // sit on top of visibly-playing video — advancement is the authority.
  const isBuffering = (playbackHealth.isWaiting || playbackHealth.isStalledEvent) && !playbackHealth.isAdvancing;

  // "Stuck": mid-playback, not paused, the clock is NOT advancing, and we're either
  // flagged stalled/buffering OR sitting in a seek that won't complete (a forward
  // seek past the Plex transcoder's head freezes with el.seeking stuck true). This
  // is the trigger for the jolt ladder below — the state that used to hang forever.
  const clockAdvancing = playbackHealth.isAdvancing === true;

  // End-of-content is not a stall. When dash's trailing fragment is zero-byte
  // the element parks at duration with `ended === false`; jolting it re-seeks
  // to the end, "resumes" at the end, and re-stalls forever. `useCommonMedia-
  // Controller` has disengaged stall detection near the end since the
  // 2026-05-23 audit; the jolt ladder must do the same. The queue-advance for
  // this state belongs to useEndOfContentWatchdog, not to recovery.
  const atEndEl = getMediaEl?.();
  const atEnd = playbackHealth.elementSignals?.ended === true
    || (!!atEndEl && (atEndEl.ended === true || isNearEnd(atEndEl.currentTime, atEndEl.duration)));

  const isStuck = hasEverPlayedRef.current && !isUserPaused && !clockAdvancing && !atEnd
    && (isStalled || isBuffering || effectiveSeeking);

  // Snapshot everything the ladder needs so its effect can depend only on `isStuck`
  // (and not tear down/rebuild — resetting the ladder — when a callback identity or
  // a frozen scalar changes).
  joltLatestRef.current = {
    getMediaEl, targetTimeSeconds, seconds, meta, waitKey, logWaitKey,
    onReload, onExhausted, actions, statusRef, playbackSessionKey,
  };

  // Jolt ladder: while stuck, escalate refresh-url → remount, each re-seeking to
  // the captured intent (the frozen seek target), until the clock advances again
  // or the ladder + attempt cap are exhausted. The shared recoveryLedger's
  // session cap bounds total jolts even if `isStuck` flaps (a jolt that plays one
  // frame then re-stalls) — this holds only because recordSuccess requires
  // strictly-forward playhead motion (2026-07-10); a bare progress event at a
  // frozen position must never clear the session. End-of-content is excluded
  // upstream by `atEnd`, so the ladder never chases a playhead parked at duration.
  useEffect(() => {
    if (disabled) return undefined;
    if (!isStuck) {
      if (joltTimerRef.current) { clearTimeout(joltTimerRef.current); joltTimerRef.current = null; }
      joltStepRef.current = 0;
      joltIntentRef.current = null;
      return undefined;
    }
    if (joltTimerRef.current) return undefined; // ladder already scheduled
    if (statusRef.current === STATUS.exhausted) return undefined;

    // Capture the intent = the frozen playhead (the seek target we must not lose).
    {
      const L = joltLatestRef.current || {};
      const el = L.getMediaEl?.();
      joltIntentRef.current = (el && Number.isFinite(el.currentTime)) ? el.currentTime
        : (Number.isFinite(L.targetTimeSeconds) ? L.targetTimeSeconds
          : (Number.isFinite(L.seconds) ? L.seconds : null));
    }

    const fireRung = () => {
      const L = joltLatestRef.current || {};
      const ledger = getRecoveryLedger();
      const declareExhausted = (attempts) => {
        playbackLog('resilience-stall-jolt-exhausted', {
          waitKey: L.logWaitKey, rung: joltStepRef.current, attempt: attempts
        }, { level: 'warn' });
        L.actions?.setStatus(STATUS.exhausted);
        if (!exhaustedNotifiedRef.current) {
          exhaustedNotifiedRef.current = true;
          L.onExhausted?.({ reason: 'stall-jolt-exhausted', attempts, waitKey: L.waitKey });
        }
        joltTimerRef.current = null;
      };

      const plan = stallJoltPlan(joltStepRef.current);
      if (!plan) {
        // Ladder ran out of rungs.
        declareExhausted(ledger.snapshot(L.playbackSessionKey)?.count ?? joltStepRef.current);
        return;
      }
      // Ledger gates the rung: hard cap on total recoveries this session
      // (survives isStuck flaps; cleared by the progress effect once playback
      // resumes) AND the shared cooldown — jolt used to skip the cooldown
      // check while still consuming attempts (audit §3.2).
      const gate = ledger.request({
        sessionKey: L.playbackSessionKey,
        mountId: L.waitKey,
        actor: 'jolt',
        reason: plan.reason
      });
      if (!gate.allowed) {
        if (gate.deniedBy === 'cooldown') {
          // Too soon after the last recovery (any actor). Re-check this SAME
          // rung once the cooldown has elapsed — don't advance the ladder.
          playbackLog('resilience-stall-jolt-cooldown-denied', {
            waitKey: L.logWaitKey, rung: joltStepRef.current, waitMs: gate.waitMs
          }, { level: 'debug' });
          joltTimerRef.current = setTimeout(fireRung, gate.waitMs);
          return;
        }
        if (gate.deniedBy === 'session-cap') {
          // Total recovery budget spent.
          declareExhausted(gate.attempt);
          return;
        }
        // Any other denial (e.g. a future mount-budget on this actor) must not
        // masquerade as session exhaustion — log it and stop this ladder run.
        playbackLog('resilience-stall-jolt-denied', {
          waitKey: L.logWaitKey, rung: joltStepRef.current, deniedBy: gate.deniedBy
        }, { level: 'debug' });
        joltTimerRef.current = null;
        return;
      }
      const attempt = gate.attempt;
      joltStepRef.current += 1;
      const intentSeconds = joltIntentRef.current;
      const seekToIntentMs = Number.isFinite(intentSeconds) ? Math.max(0, intentSeconds * 1000) : undefined;
      L.actions?.setStatus(STATUS.recovering);
      playbackLog('resilience-stall-jolt', {
        waitKey: L.logWaitKey, step: plan.reason, rung: joltStepRef.current, attempt,
        intentSeconds, refreshUrl: plan.refreshUrl, forceRemount: plan.forceRemount,
      });
      L.onReload?.({
        reason: plan.reason, meta: L.meta, waitKey: L.waitKey,
        refreshUrl: plan.refreshUrl, forceRemount: plan.forceRemount, seekToIntentMs,
      });
      // Escalate again if we're still stuck after this rung has had time to work.
      joltTimerRef.current = setTimeout(fireRung, STALL_JOLT_STEP_MS);
    };

    // Grace before the first jolt so a slow-but-succeeding seek/buffer isn't cut off.
    joltTimerRef.current = setTimeout(fireRung, STALL_JOLT_GRACE_MS);
    return () => { if (joltTimerRef.current) { clearTimeout(joltTimerRef.current); joltTimerRef.current = null; } };
    // Depend only on the boolean trigger; the ladder reads a per-render snapshot
    // (joltLatestRef) so a changing callback/scalar identity can't reset it mid-climb.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStuck, disabled]);

  // Detect loop transition: video has loop=true, we've played before, and we're near the start
  // This check runs synchronously during render to prevent overlay flash on loop
  const isLoopTransition = (() => {
    if (!hasEverPlayedRef.current) return false;
    if (seconds >= 1) return false; // Not near start
    try {
      const mediaEl = getMediaEl?.();
      return mediaEl?.loop === true;
    } catch {
      return false;
    }
  })();

  // The overlay should appear if:
  // - We are in a resilience error state (stalling, recovering, startup)
  // - We are buffering AND not in a seek grace period
  // - The user has paused the video (and wants the overlay shown)
  // Seek grace: brief seeks (ffwd/rew bumps) suppress the overlay for SEEK_OVERLAY_GRACE_MS.
  // If the seek stalls beyond the grace period, buffering/stall triggers show the overlay.
  // Note: isLoopTransition still handles loop restart case
  const isExhausted = status === STATUS.exhausted;
  const shouldShowOverlay = !isLoopTransition && !seekGraceActive && (isExhausted || isStalled || isRecovering || (isStartup && !hasEverPlayedRef.current) || isBuffering || isUserPaused);

  const overlayProps = useMemo(() => ({
    status: effectiveSeeking ? 'seeking' : status,
    isVisible: shouldShowOverlay && (isUserPaused ? showPauseOverlay : true),
    shouldRender: shouldShowOverlay,
    waitingToPlay: isStartup || isRecovering || isBuffering,
    isPaused: isUserPaused,
    userIntent,
    systemHealth: (isStalled || isBuffering) ? 'stalled' : 'ok',
    pauseOverlayActive: isUserPaused && showPauseOverlay,
    seconds,
    stalled: isStalled || isBuffering,
    showPauseOverlay,
    showDebug: isStalled || isRecovering || effectiveSeeking,
    initialStart,
    message,
    plexId,
    debugContext,
    lastProgressTs: playbackHealth.lastProgressAt,
    togglePauseOverlay: () => setShowPauseOverlay(p => !p),
    isSeeking: effectiveSeeking,
    waitKey: logWaitKey,
    onRequestHardReset: () => triggerRecovery('manual-reset'),
    onRetryFromExhausted: retryFromExhausted,
    isExhausted,
    playerPositionDisplay: formatTime(Math.max(0, seconds)),
    intentPositionDisplay: (Number.isFinite(targetTimeSeconds) ? formatTime(Math.max(0, targetTimeSeconds)) : null)
      || (effectiveSeeking ? stickyIntentDisplayRef.current : null),
    playerPositionUpdatedAt,
    intentPositionUpdatedAt: intentPositionUpdatedAt
      || (effectiveSeeking ? stickyIntentUpdatedAtRef.current : null),
    mediaDetails: {
      hasElement: true,
      // Numeric currentTime + duration so the loading overlay can recognize
      // paused-at-duration and suppress the misleading "Seeking…" spinner.
      currentTime: Number.isFinite(seconds) ? Math.round(seconds * 10) / 10 : null,
      duration: mediaElSnapshot.duration,
      readyState: playbackHealth.elementSignals.readyState,
      networkState: playbackHealth.elementSignals.networkState,
      paused: playbackHealth.elementSignals.paused
    }
  }), [
    status,
    isStalled,
    isRecovering,
    isStartup,
    isSeeking,
    mediaElSnapshot.seeking,
    effectiveSeeking,
    isBumpSeek,
    isBuffering,
    isUserPaused,
    seekGraceActive,
    seekGraceExpired,
    shouldShowOverlay,
    showPauseOverlay,
    userIntent,
    seconds,
    initialStart,
    message,
    plexId,
    debugContext,
    playbackHealth,
    logWaitKey,
    triggerRecovery,
    retryFromExhausted,
    isExhausted,
    targetTimeSeconds,
    playerPositionUpdatedAt,
    intentPositionUpdatedAt
  ]);

  // Controller API — assigned in an effect, not useMemo, because writing a
  // ref is a side effect (audit §6.2). Post-commit assignment is safe: every
  // consumer reads controllerRef.current lazily from event handlers /
  // imperative APIs (Player.jsx playerApi getters), never during render.
  useEffect(() => {
    if (!controllerRef || !('current' in controllerRef)) return undefined;
    const api = {
      getState: () => resilienceState,
      reset: () => actions.reset(),
      // User-initiated reload (Fitness manual-reload button / stalled-seek
      // recovery). Routes through gated recovery so the attempt is recorded
      // in the shared ledger and status transitions to `recovering`, but
      // bypasses the cooldown — a user action must respond immediately
      // (closes the fifth ledger bypass, audit §3.2).
      forceReload: (opts = {}) => triggerRecovery(opts.reason || 'manual-force-reload', {
        bypassCooldown: true,
        ...(Number.isFinite(opts.seekToIntentMs) ? { seekToIntentMs: opts.seekToIntentMs } : {}),
        ...(typeof opts.refreshUrl === 'boolean' ? { refreshUrl: opts.refreshUrl } : {}),
        ...(opts.forceRemount === true ? { forceRemount: true } : {})
      }),
      clearSeekIntent: () => consumeTargetTimeSeconds()
    };
    controllerRef.current = api;
    return () => {
      // Null only our own assignment (a newer mount may have already claimed
      // the shared ref). All consumers optional-chain, so a late reader gets
      // a no-op instead of driving a recovery against an unmounted player.
      if (controllerRef.current === api) controllerRef.current = null;
    };
  }, [controllerRef, resilienceState, actions, triggerRecovery, consumeTargetTimeSeconds]);

  const cancelDeadline = useCallback(() => {
    clearTimeout(startupDeadlineRef.current);
    startupDeadlineRef.current = null;
  }, []);

  return {
    overlayProps,
    state: resilienceState,
    cancelDeadline,
    requestRecovery: triggerRecovery,
    retryFromExhausted,
    ...(process.env.NODE_ENV !== 'production' && {
      _testTriggerRecovery: triggerRecovery,
      _testRetryFromExhausted: retryFromExhausted
    })
  };
}
