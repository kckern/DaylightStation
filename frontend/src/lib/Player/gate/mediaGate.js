/**
 * mediaGate — the ENFORCEMENT half of the gate layer.
 *
 * `pauseArbiter.resolvePause` decides; this module makes a real
 * `HTMLMediaElement` obey. Two jobs, both derived from one `PauseDecision`:
 *
 *   1. **Transport.** Pause when the decision says pause; resume ONLY what this
 *      module itself paused, and only once nothing is blocking any more.
 *   2. **Seek clamp.** While a gate publishes a `seekCeiling`, a seek past it is
 *      snapped back. A ceiling is a standing rule (see the arbiter's note), so
 *      it is enforced whether or not a gate is currently blocking — otherwise a
 *      kid could scrub past an unanswered checkpoint the instant playback resumes.
 *
 * ## Why resume is conditioned on `!blocked`, not on `paused === false`
 *
 * The arbiter deliberately suppresses the pause ACTION mid-seek while leaving
 * `blocked` true. An enforcement layer that read only `paused` would call
 * `play()` in the middle of a seek on a gated lesson and re-pause on seek end —
 * the exact pause/resume thrash the seeking rule exists to prevent, reintroduced
 * from the other side. So resume requires `!blocked && !paused`: nothing refuses,
 * AND nothing else (buffering, the user) wants the transport down this tick.
 *
 * ## `getState()` exists to break a feedback loop, not for display
 *
 * Every transport action this module takes fires the DOM event a caller would
 * naturally feed back INTO the arbiter, and each of those is a deadlock:
 *
 *   - `el.pause()` fires `'pause'`. Routed into the arbiter's `user` slot it
 *     returns `PAUSED_USER` forever, so the gate never resumes and the lesson
 *     sticks AFTER a correct answer.
 *   - `el.currentTime = ceiling` fires `'seeking'`. Routed into the `seeking`
 *     slot it suppresses the very pause the clamp was enforcing.
 *
 * The gate is the only thing that knows it issued that pause, so it has to say
 * so. `getState().ownsPause` is how a caller tells its own echo from a human's
 * hand on the remote, and `resumeBlocked` is how it knows to render "press play"
 * for the autoplay case below. `subscribe()` exists because a resume failure
 * lands on a promise rejection, long after the `apply()` that started it.
 *
 * ## Known limits, deliberately not fixed here
 *
 *   - **Drift past the ceiling is never clamped.** The clamp fires on `seeking`
 *     only, so a verdict that lands a tick after the checkpoint leaves the
 *     playhead slightly past the ceiling until the next seek. Bounded by one
 *     render tick, and the pause is what actually stops the lesson.
 *   - **Two gates over one element can strand a pause.** If A owns the pause and
 *     B then declines to resume, A detaching leaves the element paused with no
 *     owner. Correct by construction while there is one gate per player (Task 3
 *     constructs it inside the effect), but worth knowing before a second
 *     governor tempts someone to add a parallel instance.
 *   - **The sampled budget is shared process-wide.** `emitSampled` keys its state
 *     by event name alone (`Logger.js`), so every `createMediaGate` shares one
 *     10/min allowance per event. Harmless with one player; relevant once the
 *     school widget and the fitness player run at once.
 *
 * Framework-free on purpose — `useMediaGate` wraps it, and every rule above is
 * unit-testable without React or a DOM.
 */

import getLogger from '../../logging/Logger.js';

// Lazy module logger: `getLogger()` at import time binds before the app configures
// the logger (CLAUDE.md, "Module-Level Loggers").
let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ app: 'player', component: 'media-gate' });
  return _logger;
}

/**
 * Slack allowed above the ceiling before we treat a seek as a violation. Browsers
 * land `currentTime` a frame off what was asked for, and clamping that would fight
 * the player over a difference nobody can perceive.
 */
const CEILING_SLACK_S = 0.25;

/** A held fast-forward fires `seeking` continuously; the clamp log must not flood. */
const CLAMP_LOG_PER_MINUTE = 10;

/** A blocked autoplay policy re-rejects on every retry; same flood shape, same budget. */
const RESUME_FAIL_LOG_PER_MINUTE = 10;

/** `apply` runs from a render effect, so a persistent throw has the same flood shape. */
const APPLY_FAIL_LOG_PER_MINUTE = 5;

/**
 * How long a `play()` may stay unsettled before the retry latch is forced open.
 * A promise that never settles (element torn down mid-call) would otherwise pin
 * `resumeInFlight` forever: one `play()`, media paused, and not one log line.
 */
const RESUME_LATCH_MS = 5000;

const finiteOrNull = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);

/**
 * @param {object} opts
 * @param {() => (HTMLMediaElement|null)} opts.getMediaEl  Re-read on EVERY `apply`,
 *   so a late mount and an element swap are both handled without the caller
 *   re-creating the gate (same reason `useMediaClock` re-resolves).
 * @param {object} [opts.logger] Logger override. Pass the player's child logger to
 *   inherit its session-log routing; without it, gate events are stdout + WebSocket only.
 * @returns {{ apply: (decision: object) => object, getState: () => object,
 *             subscribe: (cb: Function) => Function, detach: () => void }}
 */
export function createMediaGate({ getMediaEl, logger: injectedLogger = null } = {}) {
  const log = () => injectedLogger || logger();

  let el = null;               // element the seek listener is currently attached to
  let ceiling = null;          // latest composed seekCeiling; read live by the listener
  let gateId = null;           // latest blocking gate id, for clamp/release logs
  let detached = false;

  // The plan calls this `#gatePausedByUs`. Held as the ELEMENT we paused rather than
  // a bare flag, so ownership is tied to an identity: it survives a tick where the ref
  // is momentarily null, and cannot be spent on a different element that arrives later.
  // It tracks OUR pause regardless of which reason produced it (gate, buffering,
  // user-intent sync) — that is what makes the user-pause invariant hold: an element
  // the user paused was never paused by us, so we never play it.
  let pausedEl = null;
  let resumeInFlight = false;
  let resumeStartedAt = 0;
  let resumeSeq = 0;           // generation guard, so a stale settle cannot clobber a retry
  let resumeBlocked = false;   // last resume attempt failed — the viewer must press play

  // Last-seen standing block, for TRANSITION-only logging. `apply` is called from a
  // React effect and will repeat with an identical decision; logging `gate.blocked`
  // on every one of those would bury the one transition that matters.
  let lastBlocked = false;
  let lastBlockedGate = null;  // gate id while blocked, else null
  // Survives the release, so a failed resume names the gate it was resuming FROM.
  // `lastBlockedGate` is already null by then, which would log the useful field empty.
  let lastGateSeen = null;

  const subscribers = new Set();
  let state = Object.freeze({
    blocked: false, gate: null, seekCeiling: null,
    ownsPause: false, resumeBlocked: false, detached: false
  });

  /**
   * First occurrence at full severity, every repeat on the sampled budget.
   *
   * Both halves are load-bearing. Sampling alone is not enough: `emitSampled`
   * hardcodes level `info` (`Logger.js`), so a purely sampled event never appears in
   * `level:error`/`level:warn` triage — a lesson stuck behind Firefox's autoplay
   * block would be invisible to the standing query. Severity alone is not enough
   * either: `apply` runs from a render effect and these failures repeat per render.
   */
  const burstLogger = (level, event, maxPerMinute) => {
    let headEmitted = false;
    const emit = (data) => {
      if (!headEmitted) {
        headEmitted = true;
        log()[level](event, data);
        return;
      }
      log().sampled(event, data, { maxPerMinute, aggregate: true });
    };
    emit.reset = () => { headEmitted = false; };
    return emit;
  };

  const logResumeFailed = burstLogger('warn', 'gate.resume-failed', RESUME_FAIL_LOG_PER_MINUTE);
  const logResumeStalled = burstLogger('warn', 'gate.resume-stalled', RESUME_FAIL_LOG_PER_MINUTE);
  const logApplyFailed = burstLogger('error', 'gate.apply-failed', APPLY_FAIL_LOG_PER_MINUTE);

  const publish = () => {
    const next = {
      blocked: lastBlocked,
      gate: lastBlockedGate,
      seekCeiling: ceiling,
      // The answer to "did I cause this DOM pause event?" — the whole reason this
      // surface exists. False the moment a human takes the transport back.
      ownsPause: Boolean(el) && pausedEl === el,
      resumeBlocked,
      detached
    };
    const changed = next.blocked !== state.blocked
      || next.gate !== state.gate
      || next.seekCeiling !== state.seekCeiling
      || next.ownsPause !== state.ownsPause
      || next.resumeBlocked !== state.resumeBlocked
      || next.detached !== state.detached;
    if (!changed) return state;
    state = Object.freeze(next);
    const snapshot = state;
    subscribers.forEach((cb) => {
      try { cb(snapshot); } catch (_) { /* a bad subscriber must not kill the gate */ }
    });
    return state;
  };

  /** Everything that says "this element's pause is ours" and nothing that says more. */
  const releaseOwnership = () => {
    pausedEl = null;
    resumeInFlight = false;
    resumeBlocked = false;
    resumeSeq += 1;            // orphan any settle still pending on the old attempt
    logResumeFailed.reset();
    logResumeStalled.reset();
  };

  // One listener per element, attached on first `apply` that resolves an element and
  // moved (not duplicated) on swap. The listener reads `ceiling` from the closure
  // rather than being re-bound per decision, so a ceiling that appears, changes, or
  // drops costs zero add/removeEventListener churn — and `detach()` only ever has one
  // registration to undo, on the element it is actually still bound to.
  const onSeeking = () => {
    if (detached || !el || ceiling == null) return;
    const from = el.currentTime;
    if (!Number.isFinite(from) || from <= ceiling + CEILING_SLACK_S) return;
    // `gateId` is null while nothing blocks, but a ceiling is a standing rule enforced
    // with playback running free — falling back keeps the lesson identifiable there.
    const attribution = gateId ?? lastGateSeen;
    try {
      el.currentTime = ceiling;
    } catch (err) {
      log().warn('gate.seek-clamp-failed',
        { gate: attribution, from, ceiling, error: String(err?.message || err) });
      return;
    }
    log().sampled('gate.seek-clamped', { gate: attribution, from, ceiling },
      { maxPerMinute: CLAMP_LOG_PER_MINUTE, aggregate: true });
  };

  const bindTo = (next) => {
    if (next === el) return;
    if (el) {
      try { el.removeEventListener('seeking', onSeeking); } catch (_) { /* element already gone */ }
    }
    // A DIFFERENT element is one we have not paused, so ownership does not carry
    // over — otherwise the gate would auto-play a fresh element the user never
    // started. But `null` is NOT a swap: it means "the ref has not resolved this
    // tick" (a React remount leaves it null for a render). Clearing ownership there
    // would strand a gated lesson paused with nobody left to resume it once the same
    // element comes back, so a null hand-back only unbinds the listener. Ownership is
    // released the moment a genuinely different element arrives — which also drops our
    // reference to the outgoing one and frees the in-flight latch.
    if (next && pausedEl && next !== pausedEl) releaseOwnership();
    el = next;
    if (el) {
      try { el.addEventListener('seeking', onSeeking); } catch (_) { /* not an element we can bind */ }
    }
  };

  const resume = (target) => {
    if (pausedEl !== target) return;
    if (resumeInFlight) {
      if (Date.now() - resumeStartedAt < RESUME_LATCH_MS) return;
      // The promise never settled. Force the latch rather than leaving a silently
      // dead lesson on an unattended kiosk; the generation guard orphans the old one.
      logResumeStalled({ gate: lastGateSeen, waitedMs: Date.now() - resumeStartedAt });
      resumeInFlight = false;
      resumeSeq += 1;
    }
    // A human pressed play by hand. This is the ONLY escape from the retry loop, and
    // it is what keeps the gate from fighting the person holding the remote.
    if (!target.paused) { releaseOwnership(); return; }

    resumeInFlight = true;
    resumeStartedAt = Date.now();
    const seq = resumeSeq;
    let promise;
    try {
      promise = target.play();
    } catch (err) {
      resumeInFlight = false;
      resumeBlocked = true;
      logResumeFailed({ gate: lastGateSeen, error: String(err?.message || err) });
      return;
    }
    if (!promise || typeof promise.then !== 'function') {
      releaseOwnership();
      return;
    }
    // `play()` rejects for real in this house: the garage kiosk's Firefox blocks
    // audible autoplay until a gesture. Swallow it into a log — an unhandled rejection
    // here would surface as a page-level error on a kiosk nobody is watching.
    // Ownership is HELD so a later `apply` can try again, and `resumeBlocked` lets the
    // caller offer the gesture that would actually fix it.
    promise.then(
      () => {
        if (seq !== resumeSeq) return;
        releaseOwnership();
        publish();
      },
      (err) => {
        if (seq !== resumeSeq) return;
        resumeInFlight = false;
        resumeBlocked = true;
        logResumeFailed({ gate: lastGateSeen, error: String(err?.message || err) });
        publish();
      }
    );
  };

  /**
   * Enforce one `resolvePause` result. Never throws outward: this runs inside a
   * render effect, and a gate that crashes the player is worse than one that misses
   * a tick.
   *
   * Returns the post-enforcement state. `getState()` is the authoritative surface —
   * this return is the same object, handed back at the call site that just caused the
   * transport action, so the effect feeding DOM events into the arbiter can classify
   * its own echo without a second read.
   *
   * @param {object} decision
   * @returns {object} the same snapshot `getState()` would return
   */
  const apply = (decision) => {
    if (detached) return state;
    try {
      const d = decision || {};
      const next = typeof getMediaEl === 'function' ? getMediaEl() : null;
      bindTo(next || null);

      ceiling = finiteOrNull(d.seekCeiling);
      const blocked = Boolean(d.blocked);
      gateId = blocked ? (d.gate ?? null) : null;
      if (gateId !== null) lastGateSeen = gateId;

      // Transition-only logging, keyed on the gate ID as well as the flag: one gate
      // handing off to another without an intervening release is a real transition.
      // The flag is tracked separately from the id on purpose: keying only on the id
      // would silently log nothing at all for a gate that blocks without naming itself
      // (`gate: null`), because null is also the released value.
      if (blocked && (!lastBlocked || gateId !== lastBlockedGate)) {
        log().info('gate.blocked', { gate: gateId, reason: d.reason ?? null, seekCeiling: ceiling });
      } else if (!blocked && lastBlocked) {
        log().info('gate.released', { gate: lastBlockedGate });
      }
      lastBlocked = blocked;
      lastBlockedGate = blocked ? gateId : null;

      if (el) {
        if (d.paused) {
          // `!el.paused` is what stops the gate ADOPTING a pause the human already
          // made. Without it, a user-paused element becomes gate-owned the first time
          // any gate blocks, and the gate plays it on release — overriding a person.
          if (!el.paused) {
            el.pause();
            pausedEl = el;
          }
        } else if (!blocked) {
          // `!blocked && !paused`: see the module header. `paused === false` alone is
          // true mid-seek on a still-blocked checkpoint.
          resume(el);
        }
      }
      logApplyFailed.reset();
      return publish();
    } catch (err) {
      logApplyFailed({ error: String(err?.message || err) });
      return state;
    }
  };

  /** @returns {object} frozen snapshot; see the header for why this surface exists. */
  const getState = () => state;

  /**
   * @param {Function} cb called with a frozen snapshot whenever it CHANGES. Does not
   *   fire on subscribe — read `getState()` once after subscribing, as `useMediaClock`'s
   *   consumer does.
   * @returns {Function} unsubscribe
   */
  const subscribe = (cb) => {
    if (typeof cb !== 'function') return () => {};
    subscribers.add(cb);
    return () => subscribers.delete(cb);
  };

  /** Terminal and idempotent. Removes the listener from whichever element is bound. */
  const detach = () => {
    if (detached) return;
    detached = true;
    if (el) {
      try { el.removeEventListener('seeking', onSeeking); } catch (_) { /* element already gone */ }
    }
    el = null;
    releaseOwnership();
    publish();
    subscribers.clear();
  };

  return { apply, getState, subscribe, detach };
}

export default createMediaGate;
