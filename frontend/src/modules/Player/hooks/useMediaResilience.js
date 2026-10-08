import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { playbackLog } from '../lib/playbackLogger.js';
import { describeWaitKey } from '../lib/waitKeyLabel.js';
import { usePlaybackHealth, describeElementSource, readElementTag } from './usePlaybackHealth.js';
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
import { useSourceAvailability } from './useSourceAvailability.js';
import { sourceNoticeText, resolveSourceContentId } from '../lib/sourceAvailability.js';

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
  // Owner report of a refused-source wait: ({ waiting, since?, decision? }).
  onSourceWait,
  // Screens (every owner but Media) hold a refused video instead of letting an
  // unknown answer fall through to the ladder and its queue skip.
  holdOnRefusal = false,
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
  // The browser refused autoplay and is waiting for a tap: nothing is wrong with
  // the stream, so the deadline holds and no recovery attempt is spent.
  autoplayBlocked = false,
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
  //
  // Requires one mounted Player per playbackSessionKey: a sibling hook sharing the key
  // gets its ledger entry wiped here. That used to hold by accident, because the Player
  // minted a RANDOM guid per source object, so two Players never shared a key. Since
  // 2026-08-16 the guid is derived from content (a hash of contentId/plex/…), which is
  // what stops a re-rendering caller from remounting the video — and it meant two
  // Players showing the SAME content computed the same key. A reachable pairing: a menu
  // selection mounts a Player on the nav stack (MenuWidget is a layout widget, so it
  // renders inside ScreenOverlayProvider's children), then a media:play action mounts a
  // second Player in the fullscreen slot for content already open in the menu — its
  // dismissOverlay clears only the overlay slot and cannot unmount the first.
  //
  // Player.jsx now pays for the constraint deliberately: it appends a per-instance id
  // (`#<id>`, a ref seeded once per mounted Player) to itemSessionKey, so two live
  // Players on the same content hold separate ledger sessions and separate
  // usePlaybackSession entries. The id is a ref rather than per-mount state because a
  // remount happens BELOW the Player, and the attempt cap has to accumulate across
  // remounts. Anything that passes a hand-built playbackSessionKey here still owes the
  // one-mounted-consumer-per-key rule. See Player.sessionScope.test.jsx.
  useEffect(() => () => {
    if (prevSessionKeyRef.current) {
      getRecoveryLedger().releaseSession(prevSessionKeyRef.current);
    }
  }, []);

  // Raw key AND its hash, as two distinct fields. The raw half carries the `:N`
  // nonce ordinal that a hash destroys — the field that would have made the
  // 2026-08-16 nonce climb self-evident — and the hash half joins these lines to
  // every hashed line written before the change. Spread, never renamed.
  const waitKeyFields = useMemo(() => describeWaitKey(waitKey), [waitKey]);

  const playbackHealth = usePlaybackHealth({
    seconds,
    getMediaEl,
    waitKey,
    // Content identity, shaped like AudioPlayer's `mediaKey` so an audio remount
    // and a video element generation read off the same field.
    mediaKey: meta?.contentId || meta?.assetId || plexId || null,
    mediaType: mediaTypeHint || meta?.mediaType,
    playerFlavor: playerFlavorHint,
    epsilonSeconds
  });

  // A fatal pipeline error is consulted in TWO places below, at two different
  // widths, so both are derived once here next to their source.
  //
  // `hasMediaError` — the pipeline is dead — feeds `isStuck` (see there).
  //
  // `mediaErrorStoppedPlayback` — the pipeline died OUT FROM UNDER playback —
  // is the only one allowed to override the user-intent classification just
  // below. An element the error stopped is not a user-paused element: on the
  // audio/video path `pauseIntent` is never supplied (only ContentScroller's
  // useMediaReporter sets it, via classifyPauseIntent), so the pause that
  // follows the error arrives unclassified and would otherwise read as the
  // user's — hard-returning the monitoring effect and disarming the recovery
  // ladder on the very failure it exists for. See plan decision 4d.
  //
  // The narrow signal is what keeps that override off an element somebody had
  // ALREADY paused when the error landed: rung 0 for audio falls through to a
  // remount of `<audio src autoPlay>`, so overriding there would restart a
  // paused track by itself every time a deploy killed the stream.
  //
  // That quiet branch is a DELIBERATE TRADE, not a free one — do not read it as
  // "recovery is merely deferred". The deferral is real only where metrics are
  // pause-driven: `useMediaReporter` (ContentScroller) reports from the element's
  // own `play`/`pause` listeners, so `isPaused` flips back to false on play and
  // the latched error arms the ladder then. On the audio/video path there is no
  // such listener — `isPaused` reaches this hook ONLY through
  // `SinglePlayer.handleProgress` <- `onProgress` <- `onTimeUpdate`
  // (useCommonMediaController.js:874-889, its sole call site), and a dead
  // pipeline cannot fire `timeupdate`. So `isPaused` is frozen true, pressing
  // play cannot unfreeze it, `userIntent` stays `paused`, the monitoring effect
  // hard-returns below, and a paused-then-errored audio element stays quiet
  // until the item is re-dispatched. That is the status quo for that case rather
  // than something this guard broke, and it is the better half of the trade
  // against self-resuming a paused track — but it IS still broken there. The
  // durable fix is real pause provenance plumbed from the controller, tracked as
  // a follow-up; until it lands, this branch deserves worry.
  const hasMediaError = playbackHealth.hasMediaError === true;

  // A REFUSED source (the server will not read the file — 2026-09-28, the NAS
  // zeroing modes) is waited out, not recovered from: while `isUnavailable`,
  // no recovery attempt runs and nothing is spent from the ledger. The hook
  // polls the backend, which also tries to repair the file; `onSettled` below
  // (wired after triggerRecovery exists) turns its answer into one reload.
  // See lib/sourceAvailability.js and docs/reference/player/media-source-healing.md.
  const sourceSettledRef = useRef(null);
  const onSourceWaitRef = useRef(onSourceWait);
  onSourceWaitRef.current = onSourceWait;
  const sourceAvailability = useSourceAvailability({
    // The PLAYING item's identity; `plexId` is the queue root (see
    // resolveSourceContentId) so it only counts as a last resort.
    contentId: resolveSourceContentId(meta, plexId),
    plexId: null,
    holdOnRefusal,
    getMediaEl,
    registrationSignal,
    errorCode: playbackHealth.elementSignals?.errorCode ?? null,
    errorMessage: playbackHealth.elementSignals?.errorMessage ?? null,
    mediaType: mediaTypeHint || meta?.mediaType || null,
    disabled,
    onSettled: (decision, context) => sourceSettledRef.current?.(decision, context),
    maxWaitMs: monitorSettings.sourceUnavailableMaxMs,
    onWaitChange: (event) => onSourceWaitRef.current?.(event),
  });
  const sourceUnavailable = sourceAvailability.isUnavailable;
  const sourceUnavailableRef = useRef(false);
  sourceUnavailableRef.current = sourceUnavailable;
  const mediaErrorStoppedPlayback = playbackHealth.mediaErrorStoppedPlayback === true;

  const { targetTimeSeconds, consumeTargetTimeSeconds } = usePlaybackSession({
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
  // A pause that lands on a DEAD PIPELINE (any element error that arrived
  // while it was playing) is the error's, not a person's. Only that pause is
  // exempt: a real viewer pause during an ordinary network stall must stand,
  // or the ladder keeps running and skips the item mid-workout (review B1).
  // Recovery status is deliberately not part of this.
  const deadPipelinePause = playbackHealth.elementSignals?.errorCode != null
    && playbackHealth.elementSignals?.errorWhilePlaying === true;
  useEffect(() => {
    if (isSeeking) {
      setUserIntent(USER_INTENT.seeking);
    } else if (isPaused && pauseIntent !== 'system' && !mediaErrorStoppedPlayback && !sourceUnavailable && !deadPipelinePause) {
      setUserIntent(USER_INTENT.paused);
    } else {
      setUserIntent(USER_INTENT.playing);
    }
  }, [isPaused, isSeeking, pauseIntent, mediaErrorStoppedPlayback, sourceUnavailable, deadPipelinePause]);

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
    // Reloading cannot fix a file the server refuses to read; the source wait
    // owns this item until it settles.
    if (sourceUnavailableRef.current && options.sourceRestored !== true) {
      playbackLog('resilience-recovery-deferred', { reason, cause: 'source-unavailable', ...waitKeyFields }, { level: 'debug' });
      return;
    }
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
          reason, ...waitKeyFields,
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
          reason, ...waitKeyFields, waitMs: gate.waitMs, attempts: gate.attempt
        }, { level: 'debug' });
      }
      return gate.deniedBy === 'session-cap' ? 'exhausted' : 'denied';
    }

    const attempt = gate.attempt;
    playbackLog('resilience-recovery', {
      reason, ...waitKeyFields,
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
        ...(options.resumePlayback === true ? { resumePlayback: true } : {}),
        seekToIntentMs: seekMs
      });
    }
  }, [actions, waitKeyFields, meta, onReload, onExhausted, statusRef, targetTimeSeconds, initialStart, waitKey, playbackSessionKey, maxSamePositionRetries, recoverySeekNudgeSeconds, maxAttempts]);

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
    playbackLog('resilience-retry-from-exhausted', { ...waitKeyFields, seekToIntentMs: seekMs });
    if (typeof onReload === 'function') {
      // forceRemount: in-place hardReset (even with refreshUrl) is unreliable on a
      // reaped Plex transcode session — the <video> stays wedged at readyState=0.
      // A user-initiated exhaustion retry must escalate to a real React remount,
      // which mints a fresh transcode session (plexClientSession bumps with the
      // remount nonce). refreshUrl stays true so any in-place fallback still refreshes.
      // userInitiated: a HUMAN asked for this. Distinct from forceRemount, which
      // only says "an in-place hardReset won't do". The stall-jolt ladder sets
      // forceRemount automatically (STALL_JOLT_LADDER rung 1), so consumers must
      // not read it as consent — this is the only path a viewer drives, and it is
      // what tells the Player not to second-guess the request when playback looks
      // healthy mid-backoff.
      onReload({ reason: 'user-retry-exhausted', meta, waitKey, refreshUrl: true, forceRemount: true, userInitiated: true, seekToIntentMs: seekMs });
    }
  }, [actions, consumeTargetTimeSeconds, waitKeyFields, meta, onReload, playbackSessionKey, waitKey, targetTimeSeconds, playbackHealth.lastProgressSeconds, seconds, initialStart]);

  // How a settled source wait becomes (at most) one reload. Assigned every
  // render so it always closes over the current triggerRecovery.
  //   resume  — the file is readable again after a wait: a fresh ledger (the
  //             wait was not the player's failure) and one remount at the saved
  //             position, even from `exhausted`.
  //   retry   — the refusal cleared before we ever waited: reload now instead
  //             of sitting until the startup deadline.
  //   gave-up — SOURCE_UNAVAILABLE_MAX_MS passed: the ordinary Tap to Retry.
  //
  // Whether the restored file should PLAY, decided when the wait begins. The
  // refused load pauses the element itself, so at settle time `isPaused` reads
  // true and the remount would carry it as a viewer's pause — 2026-09-30 the
  // restored video sat loaded and frozen for 15s until the startup deadline
  // remounted it again. Play if the error stopped playback, or if the item
  // never got as far as playing (it failed on its way to starting), or the
  // viewer's last known intent was to play; stay paused only when the viewer
  // had paused before the error landed. `userIntent` here is still the value
  // from before the wait (the intent effect forces `playing` once it opens).
  const sourceWaitResumeRef = useRef(false);
  const sourceWaitWasOpenRef = useRef(false);
  if (sourceUnavailable && !sourceWaitWasOpenRef.current) {
    sourceWaitResumeRef.current = mediaErrorStoppedPlayback
      || !hasEverPlayedRef.current
      || userIntent !== USER_INTENT.paused;
  }
  sourceWaitWasOpenRef.current = sourceUnavailable;
  // A source error the backend says is NOT a refusal (the file is readable)
  // but the element calls unplayable (MEDIA_ERR_SRC_NOT_SUPPORTED, e.g. a load
  // that failed mid-stream) used to arm nothing: code 4 is outside the stall
  // ladder and `normal` was ignored here, so the item sat on "Recovering…"
  // forever and its owner never heard it failed (2026-10-03 RELY.5a trace).
  // One fresh-URL remount is worth it; a second such failure is final.
  // Judged on the LIVE element's own error, never on the latched signal (it
  // latches until `playing` and survives an in-place reset), so a slow but
  // healthy reload after a cleared refusal is not mistaken for one (review B2).
  const unsupportedRetryRef = useRef({ sessionKey: null, retried: false });
  sourceSettledRef.current = (decision, context = {}) => {
    const fromMediaError = context.reason === 'media-error' || context.reason === 'media-error-suspected';
    // The same failure seen again only through the startup deadline (a
    // refreshed URL that fails the same way raises no NEW error event).
    const readableAtDeadline = decision === 'retry' && context.reason === 'startup-deadline';
    const liveEl = getMediaEl?.();
    const liveUnplayable = liveEl?.error?.code === 4;
    if (((decision === 'normal' && fromMediaError) || readableAtDeadline) && liveUnplayable) {
      const tracker = unsupportedRetryRef.current;
      if (tracker.sessionKey !== playbackSessionKey) {
        tracker.sessionKey = playbackSessionKey;
        tracker.retried = false;
      }
      if (!tracker.retried) {
        tracker.retried = true;
        triggerRecovery('media-error-unplayable', { refreshUrl: true, forceRemount: true, bypassCooldown: true });
        return;
      }
      actions.setStatus(STATUS.exhausted);
      if (!exhaustedNotifiedRef.current) {
        exhaustedNotifiedRef.current = true;
        onExhausted?.({ reason: 'media-error-unplayable', attempts: 2, waitKey });
      }
      return;
    }
    if (decision === 'resume') {
      getRecoveryLedger().userReset(playbackSessionKey);
      exhaustedNotifiedRef.current = false;
      // A wait may have begun at the END of the jolt ladder (checked before
      // skipping). The restored file gets a fresh ladder, not an instant skip.
      joltStepRef.current = 0;
      triggerRecovery('source-restored', {
        sourceRestored: true, refreshUrl: true, forceRemount: true, bypassCooldown: true,
        resumePlayback: sourceWaitResumeRef.current,
      });
    } else if (decision === 'retry') {
      triggerRecovery('source-refusal-cleared', { refreshUrl: true });
    } else if (decision === 'gave-up') {
      actions.setStatus(STATUS.exhausted);
      if (!exhaustedNotifiedRef.current) {
        exhaustedNotifiedRef.current = true;
        onExhausted?.({ reason: 'source-unavailable-gave-up', waitKey });
      }
    }
  };

  // One tick a second while waiting, for the elapsed time on the overlay.
  const [sourceNowMs, setSourceNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!sourceUnavailable) return undefined;
    setSourceNowMs(Date.now());
    const id = setInterval(() => setSourceNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [sourceUnavailable]);
  const sourceNotice = sourceUnavailable
    ? sourceNoticeText({
      mediaType: mediaTypeHint || meta?.mediaType,
      unavailableMs: sourceNowMs - (sourceAvailability.unavailableSince ?? sourceNowMs),
    })
    : null;

  // A deadline-driven recovery. An in-place recovery (hls.js network abort: the
  // renderer's hardReset reattaches without a remount) leaves `status` at
  // `recovering`, so the arm effect would not run again and the item stalled
  // after two attempts, never reaching the ledger cap. Re-arm after every
  // deadline recovery; the ledger bounds it and its cap exhausts.
  const recoverAndRearm = useCallback((reason) => {
    if (triggerRecovery(reason) === 'exhausted') return;
    playbackLog('resilience-deadline-rearm', { reason, ...waitKeyFields }, { level: 'debug' });
    setRecoveryNonce((n) => n + 1);
  }, [triggerRecovery, waitKeyFields]);

  useEffect(() => {
    // Self-contained formats (titlecard, etc.) have no media element —
    // skip resilience monitoring to avoid false startup-deadline-exceeded remounts.
    if (disabled) {
      if (status !== STATUS.playing) actions.setStatus(STATUS.playing);
      clearTimeout(startupDeadlineRef.current);
      startupDeadlineRef.current = null;
      return;
    }

    // Waiting on a refused source: hold in `recovering` (so the overlay shows
    // and a stale progressToken cannot flip us back to `playing`) with no
    // deadline armed — the source poll decides when to reload.
    if (sourceUnavailable) {
      clearTimeout(startupDeadlineRef.current);
      startupDeadlineRef.current = null;
      if (status !== STATUS.recovering) actions.setStatus(STATUS.recovering);
      return;
    }

    // Autoplay refused by the browser: waiting for a tap, not a failing stream.
    // Hold (no deadline, no ledger spend); the effect re-runs when it clears.
    if (autoplayBlocked) {
      clearTimeout(startupDeadlineRef.current);
      startupDeadlineRef.current = null;
      return;
    }

    if (userIntent === USER_INTENT.paused) {
      // A viewer's pause stands: a deadline armed before it (e.g. by a
      // recovery already in flight) must not fire another reload (review B1).
      clearTimeout(startupDeadlineRef.current);
      startupDeadlineRef.current = null;
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
          startupDeadlineRef.current = null;
          // A startup that never produced a frame may be a refused Plex file
          // whose error the element never surfaced. Ask first; only an answer
          // that says nothing about the source falls through to the ladder
          // (`wait` holds, `retry`/`resume` reload via onSettled).
          if (sourceAvailability.healable) {
            sourceAvailability.checkNow('startup-deadline').then((decision) => {
              if (decision === 'normal') recoverAndRearm('startup-deadline-exceeded');
            });
            return;
          }
          recoverAndRearm('startup-deadline-exceeded');
        }, hardRecoverLoadingGraceMs);
      }
    }
  }, [status, playbackHealth.progressToken, playbackHealth.lastProgressSeconds, userIntent, actions, triggerRecovery, hardRecoverLoadingGraceMs, playbackSessionKey, disabled, hasMediaMeta, recoveryNonce, sourceUnavailable, autoplayBlocked, sourceAvailability.healable, sourceAvailability.checkNow, recoverAndRearm]);

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
        ...waitKeyFields, kind, deadlineMs, reason, msSinceLastSeek
      });

      clearTimeout(startupDeadlineRef.current);
      warmupDeadlineArmedRef.current = true;
      startupDeadlineRef.current = setTimeout(() => {
        warmupDeadlineArmedRef.current = false;
        startupDeadlineRef.current = null;
        recoverAndRearm(reason);
      }, deadlineMs);
    };

    const handleWarmed = () => {
      if (transcodeWarmingRef.current) {
        transcodeWarmingRef.current = false;
        playbackLog('resilience-transcode-warmed', { ...waitKeyFields });
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
  }, [disabled, getMediaEl, waitKeyFields, recoverAndRearm, registrationSignal]);

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
  // Also the authority for `mediaDetails.hasElement`, which used to be the
  // literal `true` (2026-08-16): the loading overlay branches on it to choose
  // `el:…` over `el:none`, so the `el:` prefix asserted an element existed and
  // nothing had ever checked. `elTag`/`elSource` come along because a
  // <dash-video> wrapper and the real inner <video> both used to print `r=n/a`.
  const mediaElSnapshot = (() => {
    try {
      const el = getMediaEl?.();
      return {
        hasElement: Boolean(el),
        elTag: readElementTag(el),
        elSource: describeElementSource(el),
        seeking: el?.seeking === true,
        seekSource: el?.__seekSource || null,
        duration: Number.isFinite(el?.duration) ? el.duration : null
      };
    } catch {
      return { hasElement: false, elTag: null, elSource: 'none', seeking: false, seekSource: null, duration: null };
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

  // `hasMediaError` (declared up by usePlaybackHealth) is a FOURTH way to be
  // stuck, and the only one that produces no starvation signal at all: Chromium
  // fires error + pause and never fires waiting or stalled, so the three flags
  // above all stay false. Without this term the ladder sits idle while a dead
  // proxy stream never resumes (2026-09-03: a container redeploy killed the
  // proxy mid-audiobook and the player went silent for 5 minutes with 284s
  // still buffered).
  //
  // It belongs INSIDE the !clockAdvancing conjunct: once playback resumes the
  // clock advances and isStuck goes false even if the code has not cleared yet.
  // Hoisting it out would make a recovered stream read as permanently stuck.
  const isStuck = hasEverPlayedRef.current && !isUserPaused && !clockAdvancing && !atEnd
    && (isStalled || isBuffering || effectiveSeeking || hasMediaError);

  // Snapshot everything the ladder needs so its effect can depend only on `isStuck`
  // (and not tear down/rebuild — resetting the ladder — when a callback identity or
  // a frozen scalar changes).
  joltLatestRef.current = {
    getMediaEl, targetTimeSeconds, seconds, meta, waitKey, waitKeyFields,
    onReload, onExhausted, actions, statusRef, playbackSessionKey,
    sourceHealable: sourceAvailability.healable,
    checkSource: sourceAvailability.checkNow,
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
      // A refused source cannot be jolted back; hold the rung until it settles.
      if (sourceUnavailableRef.current) {
        joltTimerRef.current = setTimeout(fireRung, STALL_JOLT_STEP_MS);
        return;
      }
      const ledger = getRecoveryLedger();
      const declareExhausted = (attempts) => {
        playbackLog('resilience-stall-jolt-exhausted', {
          ...L.waitKeyFields, rung: joltStepRef.current, attempt: attempts
        }, { level: 'warn' });
        L.actions?.setStatus(STATUS.exhausted);
        if (!exhaustedNotifiedRef.current) {
          exhaustedNotifiedRef.current = true;
          L.onExhausted?.({ reason: 'stall-jolt-exhausted', attempts, waitKey: L.waitKey });
        }
        joltTimerRef.current = null;
      };

      // Before giving up (which, in a queue, SKIPS the item): a Plex file the
      // server is refusing is waited out, not skipped. 2026-09-29: both rungs
      // failed on a Bluey part Plex refused mid library scan, and the episode
      // was skipped at 90% — the file was readable again a minute later.
      // The token guards the async gap: if playback recovers (isStuck falls and
      // the cleanup clears joltTimerRef) while we ask, nothing is declared.
      const exhaustUnlessRefused = (attempts) => {
        if (!L.sourceHealable || typeof L.checkSource !== 'function') {
          declareExhausted(attempts);
          return;
        }
        const token = { checkingBeforeExhaust: true };
        joltTimerRef.current = token;
        L.checkSource('before-exhausted-skip', { suspected: true }).then((decision) => {
          if (joltTimerRef.current !== token) return;
          if (decision === 'wait') {
            playbackLog('exhausted-skip-deferred', {
              ...L.waitKeyFields, rung: joltStepRef.current, attempt: attempts,
            }, { level: 'warn' });
            // The wait holds every rung (sourceUnavailableRef) and its `resume`
            // resets the ladder; keep a timer so the ladder re-evaluates after.
            joltTimerRef.current = setTimeout(fireRung, STALL_JOLT_STEP_MS);
            return;
          }
          declareExhausted(attempts);
        });
      };

      const plan = stallJoltPlan(joltStepRef.current);
      if (!plan) {
        // Ladder ran out of rungs.
        exhaustUnlessRefused(ledger.snapshot(L.playbackSessionKey)?.count ?? joltStepRef.current);
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
            ...L.waitKeyFields, rung: joltStepRef.current, waitMs: gate.waitMs
          }, { level: 'debug' });
          joltTimerRef.current = setTimeout(fireRung, gate.waitMs);
          return;
        }
        if (gate.deniedBy === 'session-cap') {
          // Total recovery budget spent.
          exhaustUnlessRefused(gate.attempt);
          return;
        }
        // Any other denial (e.g. a future mount-budget on this actor) must not
        // masquerade as session exhaustion — log it and stop this ladder run.
        playbackLog('resilience-stall-jolt-denied', {
          ...L.waitKeyFields, rung: joltStepRef.current, deniedBy: gate.deniedBy
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
        ...L.waitKeyFields, step: plan.reason, rung: joltStepRef.current, attempt,
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
  const shouldShowOverlay = !isLoopTransition && !seekGraceActive && (isExhausted || isStalled || isRecovering || (isStartup && !hasEverPlayedRef.current) || isBuffering || isUserPaused || sourceUnavailable);

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
    ...waitKeyFields,
    // While a refused source is being waited out, a tap asks again right away
    // rather than reloading a file the server still will not read.
    onRequestHardReset: () => (sourceUnavailable
      ? sourceAvailability.checkNow('user-tap')
      : triggerRecovery('manual-reset')),
    onRetryFromExhausted: retryFromExhausted,
    isExhausted,
    sourceNotice,
    playerPositionDisplay: formatTime(Math.max(0, seconds)),
    intentPositionDisplay: (Number.isFinite(targetTimeSeconds) ? formatTime(Math.max(0, targetTimeSeconds)) : null)
      || (effectiveSeeking ? stickyIntentDisplayRef.current : null),
    playerPositionUpdatedAt,
    intentPositionUpdatedAt: intentPositionUpdatedAt
      || (effectiveSeeking ? stickyIntentUpdatedAtRef.current : null),
    mediaDetails: {
      hasElement: mediaElSnapshot.hasElement,
      elTag: mediaElSnapshot.elTag,
      elSource: mediaElSnapshot.elSource,
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
    effectiveSeeking,
    isBuffering,
    isUserPaused,
    // Every field of mediaElSnapshot that reaches mediaDetails, `duration`
    // included — it was missing. Nothing observable depended on it, because
    // triggerRecovery's identity changes each render and drags the memo along,
    // but a dep list that only works by accident is one refactor from reporting
    // the first read forever, which is a hardcoded value with extra steps.
    mediaElSnapshot.hasElement,
    mediaElSnapshot.elTag,
    mediaElSnapshot.elSource,
    mediaElSnapshot.duration,
    shouldShowOverlay,
    showPauseOverlay,
    userIntent,
    seconds,
    initialStart,
    message,
    plexId,
    debugContext,
    playbackHealth,
    waitKeyFields,
    triggerRecovery,
    retryFromExhausted,
    isExhausted,
    sourceNotice,
    sourceUnavailable,
    sourceAvailability.checkNow,
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
