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

const finiteOrNull = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);

/**
 * @param {object} opts
 * @param {() => (HTMLMediaElement|null)} opts.getMediaEl  Re-read on EVERY `apply`,
 *   so a late mount and an element swap are both handled without the caller
 *   re-creating the gate (same reason `useMediaClock` re-resolves).
 * @param {object} [opts.logger] Logger override. Pass the player's child logger to
 *   inherit its session-log routing; without it, gate events are stdout + WebSocket only.
 * @returns {{ apply: (decision: object) => void, detach: () => void }}
 */
export function createMediaGate({ getMediaEl, logger: injectedLogger = null } = {}) {
  const log = () => injectedLogger || logger();

  let el = null;               // element the seek listener is currently attached to
  let ceiling = null;          // latest composed seekCeiling; read live by the listener
  let gateId = null;           // latest blocking gate id, for clamp/release logs
  let detached = false;

  // The plan calls this `#gatePausedByUs`. It tracks OUR pause regardless of which
  // reason produced it (gate, buffering, user-intent sync) — that is what makes the
  // user-pause invariant hold: an element the user paused was never paused by us,
  // so we never play it. Resume is still gated on `!blocked` above.
  let pausedByUs = false;
  let resumeInFlight = false;

  // Last-seen standing block, for TRANSITION-only logging. `apply` is called from a
  // React effect and will repeat with an identical decision; logging `gate.blocked`
  // on every one of those would bury the one transition that matters.
  let lastBlocked = false;
  let lastBlockedGate = null;  // gate id while blocked, else null
  // Survives the release, so a failed resume names the gate it was resuming FROM.
  // `lastBlockedGate` is already null by then, which would log the useful field empty.
  let lastGateSeen = null;

  // One listener per element, attached on first `apply` that resolves an element and
  // moved (not duplicated) on swap. The listener reads `ceiling` from the closure
  // rather than being re-bound per decision, so a ceiling that appears, changes, or
  // drops costs zero add/removeEventListener churn — and `detach()` only ever has one
  // registration to undo, on the element it is actually still bound to.
  const onSeeking = () => {
    if (detached || !el || ceiling == null) return;
    const from = el.currentTime;
    if (!Number.isFinite(from) || from <= ceiling + CEILING_SLACK_S) return;
    try {
      el.currentTime = ceiling;
    } catch (err) {
      log().warn('gate.seek-clamp-failed', { gate: gateId, from, ceiling, error: String(err?.message || err) });
      return;
    }
    log().sampled('gate.seek-clamped', { gate: gateId, from, ceiling },
      { maxPerMinute: CLAMP_LOG_PER_MINUTE, aggregate: true });
  };

  const bindTo = (next) => {
    if (next === el) return;
    if (el) {
      try { el.removeEventListener('seeking', onSeeking); } catch (_) { /* element already gone */ }
    }
    el = next;
    // A new element is one we have not paused. Carrying the flag over would let the
    // gate auto-play a fresh element the user never started.
    pausedByUs = false;
    resumeInFlight = false;
    if (el) {
      try { el.addEventListener('seeking', onSeeking); } catch (_) { /* not an element we can bind */ }
    }
  };

  const resume = (target) => {
    if (!pausedByUs || resumeInFlight) return;
    if (!target.paused) { pausedByUs = false; return; }
    resumeInFlight = true;
    let promise;
    try {
      promise = target.play();
    } catch (err) {
      resumeInFlight = false;
      log().warn('gate.resume-failed', { gate: lastGateSeen, error: String(err?.message || err) });
      return;
    }
    if (!promise || typeof promise.then !== 'function') {
      resumeInFlight = false;
      pausedByUs = false;
      return;
    }
    // `play()` rejects for real in this house: the garage kiosk's Firefox blocks
    // audible autoplay until a gesture. Swallow it into a warn — an unhandled
    // rejection here would surface as a page-level error on a kiosk nobody is
    // watching. `pausedByUs` stays true so a later `apply` can try again.
    promise.then(
      () => { resumeInFlight = false; pausedByUs = false; },
      (err) => {
        resumeInFlight = false;
        log().warn('gate.resume-failed', { gate: lastGateSeen, error: String(err?.message || err) });
      }
    );
  };

  /**
   * Enforce one `resolvePause` result. Never throws outward: this runs inside a
   * render effect, and a gate that crashes the player is worse than one that misses
   * a tick.
   * @param {object} decision
   */
  const apply = (decision) => {
    if (detached) return;
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

      if (!el) return;

      if (d.paused) {
        if (!el.paused) {
          el.pause();
          pausedByUs = true;
        }
        return;
      }
      // `!blocked && !paused`: see the module header. `paused === false` alone is
      // true mid-seek on a still-blocked checkpoint.
      if (!blocked) resume(el);
    } catch (err) {
      log().error('gate.apply-failed', { error: String(err?.message || err) });
    }
  };

  /** Idempotent. Removes the listener from whichever element is currently bound. */
  const detach = () => {
    if (detached) return;
    detached = true;
    if (el) {
      try { el.removeEventListener('seeking', onSeeking); } catch (_) { /* element already gone */ }
    }
    el = null;
    pausedByUs = false;
    resumeInFlight = false;
  };

  return { apply, detach };
}

export default createMediaGate;
