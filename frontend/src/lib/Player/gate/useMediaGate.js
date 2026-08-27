/**
 * useMediaGate — the React binding that joins `resolvePause` (decide) to
 * `createMediaGate` (enforce), and closes the loop between them.
 *
 * The two halves below it are framework-free and deliberately dumb about React.
 * Everything genuinely hard about wiring them together lives here.
 *
 * ## 1. The DOM `pause` event has two meanings, and only one of them is intent
 *
 * A human pressing pause must reach the arbiter's `user` slot. Without that wiring
 * the gate wins an argument it should lose: it pauses, the resume is rejected by
 * the autoplay policy, the person presses pause — and the next `apply` carrying a
 * PLAYING decision calls `play()` again, overriding them.
 *
 * But `el.pause()` fires the SAME event. Route the gate's own echo into `user` and
 * the lesson deadlocks:
 *
 *     gate blocks -> apply() calls el.pause() -> DOM fires 'pause'
 *       -> user.paused = true -> PAUSED_USER forever -> the gate never resumes
 *       -> the lesson is stuck AFTER a correct answer.
 *
 * The gate is the only thing that knows it issued that pause, so we ask it. A DOM
 * `pause` is user intent only when `getState().ownsPause` is false — plus one more
 * guard: `applyingRef`. The spec queues the `pause` event as a task, so in a real
 * browser it lands after `apply` returned and `ownsPause` is already true; but an
 * environment (or a test double) that dispatches SYNCHRONOUSLY from inside
 * `el.pause()` arrives BEFORE `mediaGate` has assigned ownership, and `ownsPause`
 * would still read false. `applyingRef` covers that window. It cannot hide a real
 * user pause: nobody presses a button inside a synchronous call stack.
 *
 * DOM `seeking` is NOT wired at all, for the same reason in the other direction:
 * the clamp writes `el.currentTime`, which fires `seeking`, and the arbiter
 * suppresses the pause action mid-seek — so feeding it back would make the clamp
 * cancel the very pause it was enforcing. `player.seeking` comes from the caller,
 * who knows which seeks were the viewer's.
 *
 * ## 2. DOM `play` is wired too, and it is not double-counting
 *
 * `mediaGate` already treats "the element is playing" as the human taking the
 * transport back — but only when `apply` is next called, which on a stable decision
 * may be never. Two things then rot: the user-pause latch here never clears (so the
 * gate re-pauses a person who just pressed play), and `ownsPause` stays stale-true
 * (so their NEXT pause is misread as our echo). Observing `play` fixes both by
 * driving one `apply`, which is what lets `mediaGate` release ownership.
 *
 * The gate's OWN resume fires `play` too, and — unlike the `pause` case — there is no
 * way to filter it out. `applyingRef` only covers a synchronous dispatch; a real
 * browser queues the event, so by the time it lands our `apply` has long returned.
 * `ownsPause` cannot stand in either, because it is TRUE at the exact instant a human
 * presses play in both cases that matter: the autoplay-blocked retry (ownership held
 * so it can retry) and a kid pressing play to skip an unanswered checkpoint (the gate
 * paused them). Filtering on it lets a checkpoint be skipped — both shapes are pinned
 * by tests. So the epoch bump stays UNCONDITIONAL; it is safe because a redundant
 * apply hits `mediaGate`'s in-flight latch and returns early. Only the log's
 * attribution is conditioned, so a gate-issued resume never claims a human pressed
 * play — on this kiosk the log store is the only thing anyone can read afterwards.
 *
 * ## 3. The gate is constructed INSIDE the effect
 *
 * `detach()` is terminal — `detached` is never cleared. A gate built in `useRef` or
 * `useMemo` and detached by an effect cleanup is permanently dead, so the next
 * effect run enforces nothing at all. Building it in the effect means a
 * mount/cleanup/mount cycle (StrictMode, a future concurrent feature) gets a live
 * gate every time. This app does not use StrictMode today; this way it never has to
 * think about it.
 *
 * ## 4. The decision is stabilized by VALUE, not by input identity
 *
 * Callers write `verdicts={[{ ... }]}` and `player={{ ... }}`. Those are new objects
 * every render. Keying the enforcement effect on them would call `apply` once per
 * render — and on a kiosk where the autoplay policy is rejecting the resume, that is
 * one `play()` attempt per render forever. (This house has already paid for the
 * identity-churn shape once: an inline `play={{...}}` literal on the player opened
 * 495 Plex transcode sessions.)
 *
 * Rather than trying to stabilize every possible input shape, we stabilize the
 * OUTPUT: `resolvePause` is pure and cheap, so it runs every render, and the result
 * is reused unless one of its five scalar fields actually changed. That is
 * complete by construction — no input can churn past it.
 */

import { useEffect, useRef, useState } from 'react';
import { resolvePause } from './pauseArbiter.js';
import { createMediaGate } from './mediaGate.js';
import { useContributedVerdicts } from './GateVerdictContext.jsx';
import getLogger from '../../logging/Logger.js';

// Lazy module logger: `getLogger()` at import time binds before the app configures
// the logger (CLAUDE.md, "Module-Level Loggers").
let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ app: 'player', component: 'use-media-gate' });
  return _logger;
}

/**
 * How often the element is re-resolved. `mediaGate` re-reads the element on every
 * `apply`, but applies only happen when the decision changes — so an element that
 * mounts late, or is swapped on a queue advance, would otherwise carry no listeners
 * and no enforcement until the next verdict change. Same cadence and same reason as
 * `useMediaClock`'s supervisor.
 */
const SUPERVISOR_MS = 250;

const EMPTY = Object.freeze([]);

/** Matches `mediaGate`'s initial snapshot, so the first render is not null-shaped. */
const IDLE_STATUS = Object.freeze({
  blocked: false, gate: null, seekCeiling: null,
  ownsPause: false, resumeBlocked: false, detached: false
});

/**
 * Field-complete equality over a `PauseDecision`. Every field is a scalar, so this
 * is exhaustive — which is what makes the value-stabilization in the header safe
 * rather than an approximation.
 */
const sameDecision = (a, b) => Boolean(a) && Boolean(b)
  && a.paused === b.paused
  && a.reason === b.reason
  && a.blocked === b.blocked
  && a.gate === b.gate
  && a.seekCeiling === b.seekCeiling;

/**
 * @param {object} opts
 * @param {() => (HTMLMediaElement|null)} opts.getMediaEl  Re-read on every supervisor
 *   pass and every apply; a late mount and an element swap both work without the
 *   caller re-creating anything.
 * @param {import('./pauseArbiter.js').GateVerdict[]} [opts.verdicts] this caller's own
 *   verdicts. Merged AFTER anything contributed by `GateVerdictProvider` ancestors,
 *   so an outer household rule outranks a lesson-local one (see that module).
 * @param {{seeking?: object, resilience?: object, user?: object}} [opts.player] live
 *   player state. Any slot may be null before its source resolves.
 * @param {object} [opts.logger] Logger override — pass the player's child logger so
 *   gate events inherit its session-log routing.
 * @returns {{ decision: import('./pauseArbiter.js').PauseDecision, status: object }}
 *   `decision` is what the arbiter ruled this tick; `status` is `mediaGate`'s
 *   enforcement snapshot (`ownsPause`, `resumeBlocked` — the "autoplay blocked,
 *   press play" affordance — and `seekCeiling`).
 */
export function useMediaGate({
  getMediaEl,
  verdicts = EMPTY,
  player = null,
  logger: injectedLogger = null
} = {}) {
  const contributed = useContributedVerdicts();
  const slots = player || {};

  // Observed user intent, kept in state because it must re-run the arbiter. Distinct
  // from `slots.user`: this one is what the DOM told us, that one is what the caller
  // already knew. Either being true means the transport should stay down.
  const [userPaused, setUserPaused] = useState(false);
  const [status, setStatus] = useState(IDLE_STATUS);

  // Bumped when something OTHER than the decision needs enforcement re-run: the human
  // took the transport back, or the element was swapped. It is a state bump rather
  // than a direct `apply` call on purpose — applying from inside a DOM handler would
  // use the decision from BEFORE the same handler's `setUserPaused`, and that stale
  // decision still says PAUSED_USER: the gate would shove the person straight back
  // down the instant they pressed play. Deferring to the effect applies the decision
  // the state change produced.
  const [transportEpoch, setTransportEpoch] = useState(0);

  const callerPaused = Boolean(slots.user?.paused ?? (slots.user?.pauseIntent === 'user'));
  const raw = resolvePause({
    seeking: slots.seeking,
    gates: [...contributed, ...(Array.isArray(verdicts) ? verdicts : EMPTY)],
    resilience: slots.resilience,
    user: { paused: callerPaused || userPaused }
  });

  // See header §4. Writing a ref during render is safe here because the derivation is
  // pure: a double-render produces an equal value and keeps the same object.
  const decisionRef = useRef(null);
  if (!sameDecision(decisionRef.current, raw)) decisionRef.current = raw;
  const decision = decisionRef.current;

  // Latest-value refs so the effect below can stay `[]`-deps and never tear the gate
  // down (same reason `useMediaClock` holds its accessor in a ref).
  const getElRef = useRef(getMediaEl);
  getElRef.current = getMediaEl;
  const loggerRef = useRef(injectedLogger);
  loggerRef.current = injectedLogger;

  // Read through the ref, so a caller that swaps in its session logger mid-life is
  // followed. `createMediaGate` below is constructed once and can only ever hold the
  // logger it was built with — an acceptable difference, since the player's child
  // logger is created once and does not churn.
  const log = () => loggerRef.current || logger();

  const applyRef = useRef(null);
  const applyingRef = useRef(false);

  useEffect(() => {
    const resolveEl = () => {
      try {
        return typeof getElRef.current === 'function' ? (getElRef.current() || null) : null;
      } catch (_) {
        return null;      // a ref accessor that throws must not kill enforcement
      }
    };

    // Constructed HERE, not in a ref — see header §3.
    const gate = createMediaGate({ getMediaEl: resolveEl, logger: loggerRef.current });

    const runApply = (d) => {
      applyingRef.current = true;
      try {
        gate.apply(d);
      } finally {
        applyingRef.current = false;
      }
    };
    applyRef.current = runApply;

    // The ONLY path status takes into React. `apply` returns the same snapshot, but
    // pushing that too would be a second source of the same truth — `publish()` already
    // notifies on every change, including the ones no `apply` caused. And those are the
    // ones that matter: `resumeBlocked` flips on a promise rejection, long after the
    // `apply` that started it, so a pull-only read would never see the autoplay block.
    const unsubscribe = gate.subscribe((snapshot) => setStatus(snapshot));

    let bound = null;

    const onPause = () => {
      if (applyingRef.current || gate.getState().ownsPause) {
        // Our own echo. Header §1 — routing this into `user` deadlocks the lesson.
        log().debug('gate.pause-echo-ignored', { gate: gate.getState().gate });
        return;
      }
      log().info('gate.user-pause-observed', { gate: gate.getState().gate });
      setUserPaused(true);
    };

    const onPlay = () => {
      setUserPaused(false);
      if (applyingRef.current) return;   // synchronous dispatch from inside our own apply
      // Attribution only — never a filter. See header §2 for why `ownsPause` cannot
      // gate the bump: it is true for a human's play as well as for our own resume.
      if (gate.getState().ownsPause) {
        log().debug('gate.play-observed-while-owned', { gate: gate.getState().gate });
      } else {
        log().info('gate.user-play-observed', { gate: gate.getState().gate });
      }
      // The resulting apply is how `mediaGate` learns the transport moved.
      setTransportEpoch((n) => n + 1);
    };

    let firstSync = true;
    const syncEl = () => {
      const next = resolveEl();
      // Consumed BEFORE the early return: the mount pass often resolves nothing at
      // all (the ref fills in later), and leaving the flag set there would make the
      // real bind look like the first one and skip its enforcement.
      const wasFirst = firstSync;
      firstSync = false;
      if (next === bound) return;
      if (bound) {
        try {
          bound.removeEventListener('pause', onPause);
          bound.removeEventListener('play', onPlay);
        } catch (_) { /* element already gone */ }
        // A different transport carries no stale intent from the old one.
        setUserPaused(false);
      }
      bound = next;
      if (bound) {
        try {
          bound.addEventListener('pause', onPause);
          bound.addEventListener('play', onPlay);
        } catch (_) { /* not an element we can bind */ }
      }
      log().debug('gate.element-sync', { bound: Boolean(bound) });
      // On the FIRST pass the decision effect below is about to apply anyway; only a
      // genuine late mount or swap needs enforcement re-run from here.
      if (!wasFirst) setTransportEpoch((n) => n + 1);
    };

    syncEl();
    const supervisor = setInterval(syncEl, SUPERVISOR_MS);
    log().info('gate.hook.mounted', {});

    return () => {
      clearInterval(supervisor);
      if (bound) {
        try {
          bound.removeEventListener('pause', onPause);
          bound.removeEventListener('play', onPlay);
        } catch (_) { /* element already gone */ }
      }
      bound = null;
      unsubscribe();
      gate.detach();
      applyRef.current = null;
      log().info('gate.hook.unmounted', {});
    };
    // `[]` on purpose: every value this effect reads from the render scope is a ref, a
    // setState, or module scope, so there is nothing for exhaustive-deps to ask for —
    // and the gate must outlive every render, since `detach()` is terminal.
  }, []);

  // One apply per MATERIALLY different decision — plus one per transport epoch, which
  // is how a re-bound element or a human-driven transport change gets enforced without
  // the decision itself changing. `decision` is value-stabilized above, so caller-side
  // identity churn cannot reach this.
  useEffect(() => {
    applyRef.current?.(decision);
  }, [decision, transportEpoch]);

  return { decision, status };
}

export default useMediaGate;
