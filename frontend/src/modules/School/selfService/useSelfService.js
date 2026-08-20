/**
 * useSelfService — the locked wall panel's state machine (self-service access
 * codes design, §3).
 *
 * A child types a 6-digit code printed beside the lesson on their agenda; the
 * panel resolves it, offers the one action that lesson is at, runs it, and
 * goes back to the lock screen. This hook owns that whole cycle so the two
 * components below it (Keypad, LaunchCard) stay presentational and the flow is
 * testable without a DOM full of runners.
 *
 * THREE RULES IT EXISTS TO HOLD
 *
 * 1. A BAD CODE IS NOT AN ERROR. `/resolve` answers 200 `{ok:false}` for an
 *    unknown, expired or revoked code, and the panel says "Try again" and stays
 *    live — no throttle, no lockout, no dead keypad (D1: this is a fence to
 *    keep a child on task, not a vault). A NON-2xx is a different thing
 *    entirely — the backend is down, or `lifecycle.enabled` is false and the
 *    routers were never mounted — and gets the degraded sentence plus a retry.
 *    Collapsing the two would tell a child their good code was wrong.
 *
 * 2. THE PRINT DEBOUNCE IS RENDERED, NOT SWALLOWED. Inside its cooldown
 *    `IssueDocument` answers `status:'debounced'` with `message:''` — silence
 *    designed for thermal slips. On a screen that is a child tapping "Print it
 *    again", nothing happening, and nothing explaining why. So a debounced
 *    outcome gets words of our own whenever the backend supplies none.
 *
 * 3. ON-SCREEN WORK GOES OUT THROUGH `onLaunch`, NOT A PRIVATE MOUNT. That is
 *    SchoolApp's `onPortalLaunch` — the same callback the `school.launch`
 *    broadcast lands on, which routes into `start()` → `schoolApi.openSession`.
 *    Only that path opens a SchoolService sitting, and `PortalSurface.
 *    occupancy()` reads `SchoolService.activeSittings()`; a runner mounted any
 *    other way is invisible to DoNow's clobber protection, which would then
 *    interrupt a child mid-quiz.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';

/** Neither a code problem nor the child's fault — say so, and offer a retry. */
export const DEGRADED_SENTENCE = "The school computer isn't answering. Tell a grown-up.";
/** The whole failure path for a code (D1). */
export const TRY_AGAIN_SENTENCE = 'Try again.';
/** Rule 2 above: the words the backend deliberately does not supply. */
export const DEBOUNCED_SENTENCE = "It's already on its way — give it a minute.";
/** `/act` said yes but named nothing this panel can mount. Never strand. */
export const UNMOUNTABLE_SENTENCE = "That won't open here. Tell a grown-up.";
export const PRINT_CONFIRM_QUESTION = 'Did it print?';
export const DEFAULT_IDLE_TIMEOUT_SECONDS = 120;

/**
 * Is an `ok:false` refusal a BACKEND FAULT rather than a bad code?
 *
 * It matters because the two get different affordances: a fault gets a retry
 * button, a bad code does not (there is nothing to retry — type a better code).
 * `ResolveAccessCode` never throws; it catches its own lookup/resolve faults
 * and answers a 200 carrying `{ok:false}`, so HTTP status cannot tell them
 * apart and a fault would otherwise leave a child reading "isn't answering"
 * beside a keypad with no way forward.
 *
 * `reason` is the discriminator and the one to trust. The sentence match is a
 * TEMPORARY fallback for backends that predate it: duplicating a user-facing
 * string across two layers means rewording the backend copy for a child
 * silently removes this panel's retry button — the same dead end, reintroduced
 * by a typo.
 *
 * TODO: drop the sentence fallback once `/resolve` always sends
 * `reason: 'not_answering' | 'unknown_code'` (Task 7).
 */
const isBackendFault = (payload) => {
  if (payload?.reason === 'not_answering') return true;
  if (payload?.reason === 'unknown_code') return false;
  return typeof payload?.sentence === 'string' && payload.sentence.trim() === DEGRADED_SENTENCE;
};

/** Kinds whose outcome is a print job the child has to go and collect. */
const PRINT_KINDS = new Set(['print', 'retry']);
/** Kinds that mount something on this panel rather than sending it elsewhere. */
const MOUNT_KINDS = new Set(['screen', 'program']);

/**
 * What `onLaunch` (SchoolApp's `onPortalLaunch`) needs in order to route into a
 * runner. `/act` is the authority — it knows the session it just opened — but a
 * `program` action already carries its target in the offered Action, so fall
 * back to that rather than dead-ending on a thin response.
 */
function launchTarget(action, target) {
  if (target && typeof target === 'object' && target.kind) return target;
  if (action.kind === 'program') return { kind: 'program', program: target ?? action.target ?? null };
  if (action.kind === 'screen' && (target ?? action.target)) {
    return { kind: 'bank', bankId: target ?? action.target };
  }
  return null;
}

/**
 * @param {object} args
 * @param {number} [args.idleTimeoutSeconds] - `selfService.idleTimeoutSeconds`.
 *   A wall panel left on one child's maths all afternoon is exactly what this
 *   exists for. `<= 0` disables it.
 * @param {(learnerId: string) => void} [args.claim] - soft-claim, so a mounted
 *   runner records against the right learner (the same claim the WS launch does).
 * @param {(target: object) => void} [args.onLaunch] - rule 3 above.
 */
export function useSelfService({
  idleTimeoutSeconds = DEFAULT_IDLE_TIMEOUT_SECONDS,
  claim = null,
  onLaunch = null,
} = {}) {
  // 'keypad' is the lock screen; every other view is a card on top of it.
  const [view, setView] = useState('keypad');
  const [card, setCard] = useState(null);
  const [message, setMessage] = useState(null);   // shown on the keypad
  const [degraded, setDegraded] = useState(false);
  const [sentence, setSentence] = useState(null); // shown on the card
  const [busy, setBusy] = useState(false);
  // The code stays valid across an exit or a timeout — nothing here revokes
  // it, so the child can simply type it again.
  const codeRef = useRef(null);
  const lastTriedRef = useRef(null);

  const toLock = useCallback(() => {
    setView('keypad');
    setCard(null);
    setSentence(null);
    setMessage(null);
    setDegraded(false);
    codeRef.current = null;
  }, []);

  /**
   * @returns {Promise<{resolved: boolean, sentence: string|null}>} — the keypad
   * ignores this, but `confirmPrint` needs to know whether the recomputed card
   * actually opened rather than landing on keypad-only state it cannot show.
   */
  const submit = useCallback(async (code) => {
    if (!code) return { resolved: false, sentence: null };
    lastTriedRef.current = code;
    setBusy(true);
    const res = await schoolApi.selfServiceResolve(code);
    setBusy(false);

    // Rule 1: a transport/lifecycle failure is NOT a wrong code.
    if (!res.ok || !res.data) {
      setDegraded(true);
      setMessage(DEGRADED_SENTENCE);
      schoolLog.selfServiceError('resolve.failed', { status: res.status });
      return { resolved: false, sentence: DEGRADED_SENTENCE };
    }
    // `ok` is the ONLY thing separating a REFUSAL (bad code — stay on the
    // keypad) from a REAL CARD that simply has no buttons (`served`,
    // `locked`). Both arrive as a 200 with an empty-ish body, and reading a
    // `served` card as a refusal would tell a child who finished their maths
    // that they typed the code wrong.
    if (res.data.ok === false) {
      const faulted = isBackendFault(res.data);
      setDegraded(faulted);
      setMessage(res.data.sentence || TRY_AGAIN_SENTENCE);
      if (faulted) schoolLog.selfServiceError('resolve.failed', { status: res.status, inBody: true, reason: res.data.reason ?? null });
      else schoolLog.selfService('code.rejected', { status: res.status });
      return { resolved: false, sentence: res.data.sentence || TRY_AGAIN_SENTENCE };
    }

    codeRef.current = code;
    setDegraded(false);
    setMessage(null);
    setCard(res.data);
    setSentence(null);
    setView('card');
    schoolLog.selfService('code.resolved', { subject: res.data.subject ?? null });
    // Claim so a runner mounted from this card records against the learner the
    // code named — the same soft-claim `useSchoolLaunch` performs. The card
    // itself never shows the name, and the lock screen never has one to show.
    const learnerId = res.data.learnerId
      ?? (typeof res.data.learner === 'string' ? res.data.learner : res.data.learner?.id)
      ?? null;
    if (learnerId && claim) claim(learnerId);
    return { resolved: true, sentence: null };
  }, [claim]);

  /** The degraded retry — the same code, not a fresh typing exercise. */
  const retry = useCallback(() => submit(lastTriedRef.current), [submit]);

  const runAction = useCallback(async (action) => {
    if (!action || busy) return;
    if (action.kind === 'exit') { toLock(); return; }

    schoolLog.selfService('action.run', { kind: action.kind });
    setBusy(true);
    const res = await schoolApi.selfServiceAct({ code: codeRef.current, action: action.kind });
    setBusy(false);

    if (!res.ok || !res.data) {
      schoolLog.selfServiceError('act.failed', { kind: action.kind, status: res.status });
      setSentence(DEGRADED_SENTENCE);
      setView('sentence');
      return;
    }
    const { outcome, sentence: said, target } = res.data;

    if (PRINT_KINDS.has(action.kind)) {
      if (outcome === 'debounced') {
        schoolLog.selfService('print.debounced', { kind: action.kind });
        setSentence(said && said.trim() ? said : DEBOUNCED_SENTENCE); // rule 2
        setView('sentence');
        return;
      }
      setView('confirm');
      return;
    }

    if (MOUNT_KINDS.has(action.kind)) {
      const mountTarget = launchTarget(action, target);
      if (!mountTarget || !onLaunch) {
        // A thin/unroutable response must not blank the panel. The card stays
        // up with words on it and a Done, per the never-dead-end rule.
        setSentence(said && said.trim() ? said : UNMOUNTABLE_SENTENCE);
        setView('sentence');
        return;
      }
      // Back to the lock screen FIRST: the runner now owns the panel, and when
      // it exits there is a keypad behind it rather than a stale card.
      toLock();
      onLaunch(mountTarget);
      return;
    }

    // play / launch — DoNow's sentence is shown VERBATIM (it is the only thing
    // that knows whether a grown-up has to say yes first).
    setSentence(said || '');
    setView('sentence');
  }, [busy, onLaunch, toLock]);

  /**
   * "Did it print?" — Yes closes the interaction, No offers it again.
   *
   * No RE-RESOLVES rather than relabelling a button. The session has moved to
   * `issued` by now, so the domain's own recomputed card says "Print it again"
   * without the frontend ever deciding that wording — which is D8's "the card
   * offers one action and recomputes", and keeps `offeredActions` the single
   * authority on every label. Relabelling here was a second wording authority,
   * i.e. exactly the drift `offerSession.mjs` records deleting.
   */
  const confirmPrint = useCallback(async (printed) => {
    if (printed) {
      schoolLog.selfService('print.confirmed', {});
      toLock();
      return;
    }
    schoolLog.selfService('print.retried', {});
    const { resolved, sentence: said } = await submit(codeRef.current);
    // A recompute that failed must not strand the child on a confirm whose
    // question has already been answered: `message`/`degraded` are keypad-only
    // state and would be invisible from here.
    if (!resolved) {
      setSentence(said ?? DEGRADED_SENTENCE);
      setView('sentence');
    }
  }, [submit, toLock]);

  // Idle timeout. Armed only while a card is open — the lock screen IS the
  // resting state, so there is nothing to time out to from there.
  useEffect(() => {
    if (view === 'keypad') return undefined;
    const ms = Number(idleTimeoutSeconds) * 1000;
    if (!Number.isFinite(ms) || ms <= 0) return undefined;
    const timer = setTimeout(() => {
      schoolLog.selfService('idle.timeout', { view });
      toLock();
    }, ms);
    return () => clearTimeout(timer);
  }, [view, idleTimeoutSeconds, toLock]);

  // Escape → lock screen. DELIBERATELY does not preventDefault or stop
  // propagation, and is not even bound while the panel is idle: `portal.yml`
  // maps idle escape to `reload`, the kiosk's only refresh affordance since
  // FKB has no address bar. Swallowing it would strand the panel on a bad
  // deploy with no way to pick up the next one.
  useEffect(() => {
    if (view === 'keypad') return undefined;
    const onKey = (e) => { if (e.key === 'Escape') toLock(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, toLock]);

  return {
    view, card, message, degraded, sentence, busy,
    submit, retry, runAction, confirmPrint, exit: toLock,
  };
}

export default useSelfService;
