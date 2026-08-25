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
 * FOUR RULES IT EXISTS TO HOLD
 *
 * 1. A BAD CODE IS NOT AN ERROR. `/resolve` answers 200 `{ok:false}` for an
 *    unknown, expired or revoked code, and the panel says "Try again." and
 *    stays live — no throttle, no lockout (D1: a fence to keep a child on
 *    task, not a vault). A NON-2xx is a different thing entirely — the backend
 *    is down, or `lifecycle.enabled` is false and the routers were never
 *    mounted — and gets the degraded sentence plus a retry. Collapsing the two
 *    would tell a child their good code was wrong.
 *
 * 2. NEVER A SILENT DEAD END. Every path that does not mount something ends on
 *    words with a way out. `/act` guarantees a non-blank sentence for every
 *    outcome (`RunSelfServiceAction#report`), so the panel's own fallbacks are
 *    last resorts, deliberately worded differently from the domain's so a
 *    fallback firing is VISIBLE rather than a silent near-duplicate.
 *
 * 3. ON-SCREEN WORK GOES OUT THROUGH `onLaunch`, NOT A PRIVATE MOUNT. That is
 *    SchoolApp's `onPortalLaunch` — the same callback the `school.launch`
 *    broadcast lands on, which routes into `start()` → `schoolApi.openSession`.
 *    Only that path opens a SchoolService sitting, and `PortalSurface.
 *    occupancy()` reads `SchoolService.activeSittings()`; a runner mounted any
 *    other way is invisible to DoNow's clobber protection, which would then
 *    interrupt a child mid-quiz.
 *
 * 4. A LATE RESPONSE MAY NOT REOPEN A CLOSED CARD. The idle timeout and the
 *    exit both close the panel while requests are still in flight; without the
 *    generation guard below, a `/act` resolving afterwards flips the panel back
 *    to a confirm with `card` already null, and the NEXT child answers "Did it
 *    print?" about someone else's worksheet.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';

/** Neither a code problem nor the child's fault — say so, and offer a retry. */
export const DEGRADED_SENTENCE = "The school computer isn't answering. Tell a grown-up.";
/** The whole failure path for a code (D1). */
export const TRY_AGAIN_SENTENCE = 'Try again.';

/**
 * The panel's OWN last-resort words, for the case `/act` answered without any.
 * `RunSelfServiceAction#report` promises that never happens ("A blank sentence
 * is the one thing a panel may never show"), so this should be unreachable —
 * and it is worded unlike anything the domain says ON PURPOSE. An earlier draft
 * mirrored the domain's debounce sentence byte for byte, which meant a fallback
 * firing was indistinguishable from the real thing and the duplicate could
 * drift unnoticed. If a child ever sees this, something upstream is wrong.
 */
export const NO_WORDS_SENTENCE = 'Something went wrong here. Tell a grown-up.';

export const DEFAULT_IDLE_TIMEOUT_SECONDS = 120;

/**
 * The `/act` outcome union — `RunSelfServiceAction.mjs:153-155`. Named here
 * because the panel branches on all six and a typo'd string silently takes the
 * wrong branch: an earlier test invented `'on_screen'` and `'issued'`, neither
 * of which exists, and passed while asserting nothing real.
 *
 * NOT importable from the use case today — it exports only the class.
 * Exporting this union from the backend would let a rename break both suites
 * at once; raised with the coordinator for Task 7.
 */
export const ACT_OUTCOMES = Object.freeze({
  DONE: 'done',
  DEBOUNCED: 'debounced',
  PENDING: 'pending',
  MOUNT: 'mount',
  REFUSED: 'refused',
  FAILED: 'failed',
});

/** Legacy v1 kinds whose outcome was inferred client-side as a print job. */
const PRINT_KINDS = new Set(['print', 'retry']);

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
 * `reason` is the machine-readable discriminator and the ONLY thing consulted:
 * `unknown_code` | `not_answering`, always present on a refusal card. An
 * earlier draft matched the user-facing sentence instead, which meant
 * rewording the backend's copy for a child would silently remove this panel's
 * retry button — a dead end introduced by a typo.
 *
 * The default LEANS TOWARD FAULT: only `unknown_code`, the one reason that
 * definitively means "the child mistyped", suppresses the retry. Anything
 * unrecognised or absent gets one, because a spurious retry button costs a
 * wasted tap while a missing one is a dead end at a wall panel that has no
 * other affordance.
 */
const isBackendFault = (payload) => payload?.reason !== 'unknown_code';

/**
 * What `onLaunch` (SchoolApp's `onPortalLaunch`) needs in order to route into a
 * runner, read off `/act`'s `effect`.
 *
 * `effect` is the ONLY place this information exists. `offeredActions` emits
 * the screen action with no `target` at all (`action('screen', 'Answer on the
 * screen')`), and `/act` has no top-level `target` — an earlier draft read one
 * and EVERY screen tap fell through to "nothing opens", which also meant
 * `openSession` never fired and DoNow's clobber protection stayed blind to
 * exactly the case this feature creates.
 */
function launchTarget(action, effect) {
  if (effect?.kind === 'bank' && effect.bankId) return { kind: 'bank', bankId: effect.bankId };
  if (effect?.kind === 'companion' && effect.companionId) return {
    kind: 'companion', companionId: effect.companionId, presentation: effect.presentation ?? null,
    title: effect.title ?? null, parts: effect.parts ?? [], state: effect.state ?? {},
    participation: effect.participation ?? 'optional', learnerId: effect.learnerId ?? null,
  };
  if (effect?.kind === 'program') {
    return {
      kind: 'program', program: effect.programId ?? action.target ?? null,
      corpusId: effect.corpusId ?? null,
      studyGrant: effect.studyGrant ?? null,
      learnerId: effect.learnerId ?? null,
    };
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
 * @param {(target: object) => boolean|Promise<boolean>} [args.onLaunch] - rule 3.
 *   MUST report whether it actually mounted: anything other than `true` is
 *   treated as a miss and the child gets words instead of a bare keypad.
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
  // Rule 4. Bumped by every return-to-lock; an in-flight request whose
  // generation has moved on drops its answer on the floor.
  const genRef = useRef(0);
  // The double-tap guard has to be a REF, not the `busy` state. Two taps on a
  // wall panel land as two synchronous handler calls in the same React batch,
  // so both read the same stale `busy === false` and both fire. Only a ref
  // written synchronously closes that window. (`busy` remains, for disabling
  // the buttons visually.)
  const workRef = useRef(false);

  /** Claim the single in-flight slot. `false` means someone else has it. */
  const beginWork = useCallback(() => {
    if (workRef.current) return false;
    workRef.current = true;
    setBusy(true);
    return true;
  }, []);

  const endWork = useCallback(() => {
    workRef.current = false;
    setBusy(false);
  }, []);

  const toLock = useCallback(() => {
    genRef.current += 1;
    workRef.current = false;
    setView('keypad');
    setCard(null);
    setSentence(null);
    setMessage(null);
    setDegraded(false);
    setBusy(false);
    codeRef.current = null;
  }, []);

  /**
   * @returns {Promise<{resolved: boolean, sentence: string|null, skipped?: boolean, degraded?: boolean}>}
   * — `confirmPrint` needs to tell three cases apart: a card opened, the
   * resolve failed, and `skipped` (a second tap that never made a request at
   * all, which must change nothing on screen).
   *
   * The KEYPAD reads `degraded` off this too, and it has to come back on the
   * verdict rather than be read off the hook's state: the keypad's own await
   * resumes in the microtask right after this one, with no guarantee React has
   * flushed `setDegraded` yet, so a stale read would play the wrong-code
   * animation over a backend outage — telling a child their good code was
   * wrong, which is the one thing rule 1 exists to prevent.
   */
  const submit = useCallback(async (code) => {
    if (!code) return { resolved: false, sentence: null };
    if (!beginWork()) return { resolved: false, sentence: null, skipped: true };
    const gen = genRef.current;
    lastTriedRef.current = code;
    const res = await schoolApi.selfServiceResolve(code);
    endWork();
    if (genRef.current !== gen) return { resolved: false, sentence: null, skipped: true }; // rule 4

    // Rule 1: a transport/lifecycle failure is NOT a wrong code.
    if (!res.ok || !res.data) {
      setDegraded(true);
      setMessage(DEGRADED_SENTENCE);
      schoolLog.selfServiceError('resolve.failed', { status: res.status });
      return { resolved: false, sentence: DEGRADED_SENTENCE, degraded: true };
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
      if (faulted) {
        schoolLog.selfServiceError('resolve.failed', {
          status: res.status, inBody: true, reason: res.data.reason ?? null,
        });
      } else {
        schoolLog.selfService('code.rejected', { status: res.status });
      }
      return { resolved: false, sentence: res.data.sentence || TRY_AGAIN_SENTENCE, degraded: faulted };
    }

    codeRef.current = code;
    setDegraded(false);
    setMessage(null);
    setCard(res.data);
    setSentence(null);
    setView('card');
    schoolLog.selfService('code.resolved', { subject: res.data.subject ?? null });
    // Claim so a runner mounted from this card records against the learner the
    // code named — the same soft-claim `useSchoolLaunch` performs. A valid
    // contextual card confirms that identity; the keypad itself stays
    // anonymous.
    const learnerId = res.data.learnerId
      ?? (typeof res.data.learner === 'string' ? res.data.learner : res.data.learner?.id)
      ?? null;
    if (learnerId && claim) claim(learnerId);
    return { resolved: true, sentence: null, degraded: false };
  }, [beginWork, claim, endWork]);

  /** The degraded retry — the same code, not a fresh typing exercise. */
  const retry = useCallback(() => submit(lastTriedRef.current), [submit]);

  /** Land on words with a Done. The ending every non-mounting path shares. */
  const say = useCallback((words) => {
    setSentence(words && String(words).trim() ? words : NO_WORDS_SENTENCE);
    setView('sentence');
  }, []);

  const runAction = useCallback(async (action) => {
    if (!action) return;
    if (action.kind === 'exit') { toLock(); return; }
    if (!beginWork()) return;   // second tap of a double-tap

    const gen = genRef.current;
    schoolLog.selfService('action.run', { kind: action.kind });
    const res = await schoolApi.selfServiceAct({ code: codeRef.current, action: action.kind });
    endWork();
    if (genRef.current !== gen) return; // rule 4

    if (!res.ok || !res.data) {
      schoolLog.selfServiceError('act.failed', { kind: action.kind, status: res.status });
      say(DEGRADED_SENTENCE);
      return;
    }
    // The real wire shape (`RunSelfServiceAction`): no top-level `target`.
    const { outcome, sentence: said, effect, transition = null } = res.data;

    // MOUNT IS DECIDED BY THE OUTCOME, NEVER BY THE ACTION KIND.
    //
    // `program` used to imply "opens here", and gating on the kind was safe
    // while every program was local. It is not any more: a surface program
    // dispatches through `launcher.launch()` and answers `done` (or `pending`,
    // or a refusal), with an effect that deliberately carries NO `kind`. A
    // kind-gated branch would have mounted a language runner on this panel at
    // the same moment the garage kiosk started — two things running, neither
    // of them the one asked for. Only the backend knows whether a program is
    // local (`IProgramLauncher.surface`), and `outcome: 'mount'` is how it
    // says so.
    if (outcome === ACT_OUTCOMES.MOUNT) {
      const mountTarget = launchTarget(action, effect);
      if (!mountTarget || !onLaunch) {
        schoolLog.selfServiceError('mount.no-target', {
          kind: action.kind, effectKind: effect?.kind ?? null,
        });
        say(said);
        return;
      }
      // Do NOT close the card until the mount is CONFIRMED. `onPortalLaunch`
      // is inert on a miss (an unknown bankId, no loaded course), and closing
      // first left the child staring at a bare keypad with no message —
      // "a screen nobody is watching" is sound reasoning for a broadcast and
      // wrong for a child who just pressed the button. Anything but an
      // explicit `true` counts as a miss, so a callback that forgets to report
      // still fails toward words.
      const mounted = await onLaunch(mountTarget);
      if (genRef.current !== gen) return; // rule 4
      if (mounted !== true) {
        schoolLog.selfServiceError('mount.refused', { kind: action.kind, target: mountTarget.kind });
        say(said);
        return;
      }
      toLock();
      return;
    }

    if (transition === 'confirm-print') {
      setView('confirm');
      return;
    }

    if (transition === 'close') {
      toLock();
      return;
    }

    // During the additive rollout an old backend has no `transition`, so keep
    // the previous inference only for that wire shape. V2 decides the next UI
    // state server-side from what ACTUALLY happened, which matters for a
    // remediation action whose stable kind is `retry` but whose operation may
    // be screen, play or launch rather than print.
    if (transition === null && PRINT_KINDS.has(action.kind)) {
      if (outcome === ACT_OUTCOMES.DEBOUNCED) {
        // The debounce must be RENDERED, not swallowed: inside its cooldown
        // `IssueDocument` answers with an empty message — silence written for
        // thermal slips, which on a screen is a child tapping a button and
        // nothing happening. `#report` turns it into words; show them.
        schoolLog.selfService('print.debounced', { kind: action.kind });
        say(said);
        return;
      }
      // Only a `done` print actually produced a sheet. `refused` ("That one is
      // finished") and `failed` ("The printer did not answer") both arrive
      // carrying the sentence that explains them — asking "Did it print?"
      // instead DISCARDS it and loops the child through reprints of a sheet
      // that was never coming.
      if (outcome !== ACT_OUTCOMES.DONE) {
        schoolLog.selfService('print.unfulfilled', { kind: action.kind, outcome: outcome ?? null });
        say(said);
        return;
      }
      setView('confirm');
      return;
    }

    if (PRINT_KINDS.has(action.kind) && outcome === ACT_OUTCOMES.DEBOUNCED) {
      schoolLog.selfService('print.debounced', { kind: action.kind });
    } else if (PRINT_KINDS.has(action.kind) && outcome !== ACT_OUTCOMES.DONE) {
      schoolLog.selfService('print.unfulfilled', { kind: action.kind, outcome: outcome ?? null });
    }

    // Everything else — play, launch, a DISPATCHED program, every refusal —
    // ends on the sentence, verbatim. It is the only thing that knows whether
    // a grown-up has to say yes first, or which room the work just started in.
    say(said);
  }, [beginWork, endWork, onLaunch, say, toLock]);

  /**
   * "Did it print?" — Yes closes the interaction, No offers it again.
   *
   * No RE-RESOLVES rather than relabelling a button. The session has moved to
   * `issued` by now, so the domain's recomputed card supplies its own reprint
   * wording. That is D8's "the card offers one action and recomputes", and it
   * keeps `offeredActions` the single authority on every label.
   */
  const confirmPrint = useCallback(async (printed) => {
    if (workRef.current) return;   // a recompute is already running
    if (printed) {
      schoolLog.selfService('print.confirmed', {});
      toLock();
      return;
    }
    const gen = genRef.current;
    schoolLog.selfService('print.retried', {});
    // NOTE: the work lock is taken by `submit`, not here — taking it in both
    // would deadlock the recompute against itself.
    const { resolved, skipped, sentence: said } = await submit(codeRef.current);
    if (skipped) return;
    if (genRef.current !== gen) return; // rule 4
    // A recompute that failed must not strand the child on a confirm whose
    // question has already been answered: `message`/`degraded` are keypad-only
    // state and would be invisible from here.
    if (!resolved) say(said ?? DEGRADED_SENTENCE);
  }, [say, submit, toLock]);

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

  /**
   * THE TOUCH EQUIVALENT OF THAT ESCAPE KEY.
   *
   * The note above is about a keyboard the wall panel does not have: FKB shows
   * no address bar, lock mode draws no header (so not even SchoolApp's apple,
   * which is the reload affordance everywhere else), and the keypad is the
   * resting state — so a panel left on a stale bundle had nothing to tap. The
   * Keypad wires this to a Clear pressed on an ALREADY-EMPTY entry: the second
   * tap of a double Clear, or a deliberate one on an idle screen. Neither costs
   * a child anything (there is nothing typed to lose, and a reload lands back
   * on this same keypad), and it needs no code, no gesture and no grown-up.
   */
  const reload = useCallback(() => {
    schoolLog.selfService('keypad.reload', {});
    window.location.reload();
  }, []);

  return {
    view, card, message, degraded, sentence, busy,
    submit, retry, runAction, confirmPrint, exit: toLock, reload,
  };
}

export default useSelfService;
