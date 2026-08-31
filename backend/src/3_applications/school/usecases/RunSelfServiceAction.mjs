/**
 * RunSelfServiceAction — the launch card's one button, actually doing
 * something (self-service access codes design, §4; decision D7).
 *
 * `ResolveAccessCode` (`/resolve`) reads and only reads. This is the other
 * half. The child has pressed a button, so this is where a session may be
 * opened for real and a use case may be called.
 *
 * IT DOES NOT GO THROUGH `ResolveScanAction` (D7, and that decision was
 * reversed once already — do not reverse it back). Every exit from that file
 * is PAPER-shaped: `#slip` prints a thermal notice, `#play` prints "When it
 * finishes, scan your card for the questions." Reusing it byte-identically
 * means the keypad spits a thermal slip on every tap; suppressing the slips
 * means the outcomes differ by construction anyway. So this file calls the
 * SAME use cases directly — `IssueDocument`, `DispatchMedia`,
 * `OpenRemediation`, `DoNowService` — and `ResolveScanAction`, the file with
 * the highest blast radius in the subsystem, is not touched.
 *
 * FOUR RULES IT HOLDS
 *
 * 1. **THE SYNTHETIC ID NEVER LEAVES THE CARD.** When the plan entry had no
 *    session, `ResolveAccessCode` decides the card against a synthetic
 *    `created` state whose id is the literal string `'synthetic:unopened'`
 *    (named so it cannot be mistaken for a plausible session id). That string
 *    must never reach a use case. `ensureSession` runs FIRST, here, because a
 *    button press is the moment the work really starts — which is the whole
 *    point of splitting `/resolve` from `/act`.
 *
 * 2. **THE PRINT DEBOUNCE GETS WORDS.** `IssueDocument` answers a re-print
 *    inside `printCooldownMinutes` with `status: 'debounced'`,
 *    `document: null` and `message: ''`. That silence is deliberate and
 *    correct for thermal slips (see its own comment — do not "fix" it there).
 *    On a screen the same silence is a child tapping a button and nothing
 *    happening with nothing to explain why, so the sentence is supplied here.
 *
 * 3. **PRINTING NEVER RETIRES WORK.** Only an OMR/grade event does
 *    (`offerSession.mjs`). `IssueDocument`'s ISSUABLE set accepts `issued` and
 *    `reprinted` precisely so a lost or garbled sheet can be reprinted as
 *    often as needed — so "Did it print? -> No" routes straight back here for
 *    another `print`, and nothing in this file closes work on a print.
 *
 * 4. **NEVER A DEAD END.** Every path returns a sentence a child can act on —
 *    an unknown code, an expired one, a button that is no longer on the card,
 *    a use case that throws, a collaborator that was never wired. Nothing
 *    thrown escapes `execute`; a keypad that answers an HTTP status to a
 *    seven-year-old is the failure this subsystem exists to avoid.
 *
 * DoNow's own wording is shown VERBATIM (`DoNowService.mjs`): `dispatched |
 * pending_approval | denied | failed` each carry a sentence that already names
 * the real surface through that surface's own adapter label. Re-wording it
 * here would re-introduce the hardcoded "Go to the Portal" that lied for every
 * program that was never on the Portal.
 */
import { createEvent } from '#domains/school/sessions/sessionEvents.mjs';
import { shortId } from '#system/utils/id.mjs';
import { ensureSession } from './offerSession.mjs';
import { SYNTHETIC_SESSION_ID } from './ResolveAccessCode.mjs';

/** The buttons that act on a work session, and therefore need a real one. */
const NEEDS_SESSION = new Set(['print', 'play', 'launch', 'screen', 'retry']);

const TELL_A_GROWN_UP = 'Something went wrong. Tell a grown-up.';
/** The card moved on under the child's finger — recompute and type again. */
const MOVED_ON = 'That is not what this lesson needs now. Type your code again.';

/**
 * `IssueDocument` status -> what the panel says and how Task 8 should branch.
 *
 * `sentence: null` means the use case's own message is already panel-safe
 * ("Printing your sheet."). Every other row is rewritten because
 * `IssueDocument`'s copy tells the child to SCAN — a scanner instruction on a
 * keypad, the exact trap `offeredActions` warns about for `nextMove`'s labels.
 */
const PRINT_RESULTS = Object.freeze({
  issued: { outcome: 'done', sentence: null },
  reprinted: { outcome: 'done', sentence: null },
  debounced: { outcome: 'debounced', sentence: "It's already on its way — give it a minute." },
  already_done: { outcome: 'refused', sentence: 'That one is finished. Type your code again to see what is next.' },
  print_failed: { outcome: 'failed', sentence: 'The printer did not answer. Try that again in a minute.' },
  render_failed: { outcome: 'failed', sentence: 'We could not make that sheet. Tell a grown-up.' },
  unavailable: { outcome: 'failed', sentence: 'There is no sheet for this one. Tell a grown-up.' },
});

/** `DispatchMedia` status -> the same, for the same reason. */
const PLAY_RESULTS = Object.freeze({
  dispatched: { outcome: 'done', sentence: null },
  already_playing: { outcome: 'done', sentence: null },
  already_done: { outcome: 'refused', sentence: 'You already watched this one. Type your code again to see what is next.' },
  // The refusals here are several different sentences, one of which ("… did
  // not answer. Scan your card to try again.") is a scanner instruction. One
  // panel sentence for all of them; the real message goes to the log.
  unavailable: { outcome: 'failed', sentence: 'We could not start the video. Tell a grown-up.' },
});

/** DoNow decision -> outcome. `denied` is "busy, come back", not "broken". */
const LAUNCH_OUTCOMES = Object.freeze({
  dispatched: 'done', pending_approval: 'pending', denied: 'refused', failed: 'failed',
});

export class RunSelfServiceAction {
  #resolver; #sessions; #issue; #media; #remediation; #donow; #close; #launchers; #companions; #companionHandlers;
  #newSessionId; #clock; #logger;

  /**
   * @param {object} deps
   * @param {import('./ResolveAccessCode.mjs').ResolveAccessCode} deps.resolveAccessCode
   *   the SAME instance `/resolve` answers from, so the card this acts on is
   *   the card the child is looking at — recomputed, never remembered.
   * @param {import('../ports/IWorkSessionRepository.mjs').IWorkSessionRepository} deps.sessions
   * @param {import('./IssueDocument.mjs').IssueDocument} [deps.issueDocument]
   * @param {import('./DispatchMedia.mjs').DispatchMedia} [deps.dispatchMedia]
   * @param {import('./OpenRemediation.mjs').OpenRemediation} [deps.openRemediation]
   * @param {import('../../donow/DoNowService.mjs').DoNowService} [deps.donow]
   * @param {Map<string, import('../ports/IProgramLauncher.mjs').IProgramLauncher>} [deps.launchers]
   *   program id -> launcher, the SAME map `ResolveScanAction` gets. Without
   *   it this use case cannot tell a Portal program from a garage one and
   *   would tell every child their work is opening on the screen in front of
   *   them — see `#program`.
   * @param {import('./CloseSessionOutcome.mjs').CloseSessionOutcome} [deps.closeSessionOutcome]
   *   honours a `launch:` unit the moment DoNow reports `dispatched`, as
   *   `ResolveScanAction#dispatchLaunch` does — never with `signedOffBy`, that
   *   claim belongs to a grown-up and not to a keypad.
   * @param {() => string} [deps.newSessionId]
   * @param {() => Date} [deps.clock]
   * @param {object} [deps.logger]
   *
   * Every collaborator but `resolveAccessCode` and `sessions` is
   * OPTIONAL-DEGRADING: absent, the button it backs answers "Tell a grown-up"
   * rather than crashing or phantom-succeeding. Same posture `donow` already
   * has in `ResolveScanAction`.
   */
  constructor({
    resolveAccessCode, sessions,
    issueDocument = null, dispatchMedia = null, openRemediation = null,
    donow = null, closeSessionOutcome = null, launchers = new Map(), companions = null, companionHandlers = null,
    newSessionId = () => `ses_${shortId(8)}`,
    clock = () => new Date(), logger = console,
  } = {}) {
    if (!resolveAccessCode || !sessions) {
      throw new Error('RunSelfServiceAction requires resolveAccessCode and sessions');
    }
    this.#resolver = resolveAccessCode;
    this.#sessions = sessions;
    this.#issue = issueDocument;
    this.#media = dispatchMedia;
    this.#remediation = openRemediation;
    this.#donow = donow;
    this.#close = closeSessionOutcome;
    this.#launchers = launchers instanceof Map ? launchers : new Map();
    this.#companions = companions;
    this.#companionHandlers = companionHandlers;
    this.#newSessionId = newSessionId;
    this.#clock = clock;
    this.#logger = logger;
  }

  /**
   * @param {object} args
   * @param {string} [args.code] - the six digits the card was opened with
   * @param {string} [args.token] - the opaque QR token the card was opened with
   * @param {string|{kind: string}} args.action - the button that was pressed
   * @returns {Promise<{outcome: 'done'|'debounced'|'pending'|'mount'|'refused'|'failed',
   *                    sentence: string, action: string|null,
   *                    sessionId: string|null, effect: object|null,
   *                    transition: 'confirm-print'|'mount'|'message'|'close'}>}
   *   `sentence` is ALWAYS a non-empty sentence to put in front of a child.
   *   `mount` means the panel opens it itself (a bank quiz, a program) and
   *   `effect` carries what it needs to do so. `sessionId` is always a REAL
   *   session id or null — never the card's synthetic marker.
   */
  async execute({ code, token, action } = {}) {
    const kind = typeof action === 'string' ? action : (action?.kind ?? null);
    let result;
    try {
      const hasCode = typeof code === 'string' && code.length > 0;
      const hasToken = typeof token === 'string' && token.length > 0;
      result = hasCode === hasToken
        ? { outcome: 'refused', sentence: 'Try that again.' }
        : await this.#run({ code: hasCode ? code : null, token: hasToken ? token : null, kind });
    } catch (error) {
      // The outer net. Every branch below has its own catch with better
      // words; this one exists so that no throw at all can reach the router.
      this.#logger.error?.('school.selfservice.action.failed', {
        stage: 'run', action: kind, error: error?.message ?? String(error),
      });
      result = { outcome: 'failed', sentence: TELL_A_GROWN_UP, effect: null };
    }
    const answer = {
      outcome: result.outcome,
      // THE NON-EMPTY SENTENCE IS AN INVARIANT, not a convention every branch
      // is trusted to keep. No path below produces a blank one today, but the
      // panel's play/launch branch shows whatever arrives with no fallback of
      // its own — so this is the only thing standing between a use case that
      // one day answers `message: ''` and a card with nothing on it. Enforced
      // once, here, so a branch added later is safe by construction.
      sentence: (typeof result.sentence === 'string' && result.sentence.trim())
        ? result.sentence : TELL_A_GROWN_UP,
      action: kind,
      sessionId: result.sessionId ?? null,
      effect: result.effect ?? null,
      transition: result.transition
        ?? (result.outcome === 'mount' ? 'mount' : 'message'),
    };
    this.#logger.info?.('school.selfservice.action.run', {
      action: kind, outcome: answer.outcome, sessionId: answer.sessionId,
      status: answer.effect?.status ?? answer.effect?.decision ?? null,
    });
    return answer;
  }

  async #run({ code, token, kind }) {
    let resolved;
    try {
      resolved = token
        ? await this.#resolver.resolveToken({ token })
        : await this.#resolver.resolve({ code });
    } catch (error) {
      this.#logger.error?.('school.selfservice.action.failed', {
        stage: 'resolve', action: kind, error: error?.message ?? String(error),
      });
      return { outcome: 'failed', sentence: TELL_A_GROWN_UP };
    }

    const { card, resolution } = resolved ?? {};
    // An unknown, expired or revoked code already carries its own sentence
    // ("Try again."), and so does a backend that would not answer. Reusing
    // them keeps the keypad saying one thing about one code.
    if (!card?.ok) return { outcome: 'refused', sentence: card?.sentence || TELL_A_GROWN_UP };

    // RECOMPUTED, NEVER REMEMBERED. Between the card rendering and the tap,
    // the state can have moved (a sibling's scan, a video that finished, the
    // study day rolling over). A button that is no longer on the card is
    // refused — but refused in words, with the child told what to do next.
    const offered = (card.actions ?? []).find((a) => a.kind === kind);
    if (!offered) {
      this.#logger.info?.('school.selfservice.action.not-offered', {
        action: kind, offered: (card.actions ?? []).map((a) => a.kind),
      });
      return { outcome: 'refused', sentence: MOVED_ON };
    }

    // The way out of the card. No session, no use case, nothing recorded —
    // the code stays valid and the panel goes back to the keypad.
    if (kind === 'exit') {
      return { outcome: 'done', sentence: 'Okay — see you next time.', transition: 'close' };
    }

    if (kind === 'companion' && resolution?.kind === 'companion') {
      const answer = await this.#companionHandlers?.open?.({ offer: resolution.offer });
      if (!answer) {
        this.#logger.warn?.('school.selfservice.companion.unwired', {
          offerId: resolution.offer?.id ?? null,
        });
      }
      return answer ?? { outcome: 'failed', sentence: TELL_A_GROWN_UP };
    }

    if (kind === 'program') {
      return this.#program({
        programId: offered.target ?? resolution?.programId ?? null,
        unitId: resolution?.unit?.unitId ?? null,
        corpusId: resolution?.unit?.programInstance ?? null,
        learnerId: card.learner,
      });
    }

    if (resolution?.kind === 'bulk_print' && kind === 'print') {
      return this.#bulkPrint(resolution);
    }

    if (!NEEDS_SESSION.has(kind) || resolution?.kind !== 'move') {
      // Only reachable if `offeredActions` grows a kind this file has not been
      // taught. Say something rather than fall off the end.
      this.#logger.warn?.('school.selfservice.action.unhandled', { action: kind, kind: resolution?.kind ?? null });
      return { outcome: 'refused', sentence: MOVED_ON };
    }

    // RULE 1. The card may have been decided against a synthetic state; the
    // button press is what earns a real session.
    let session;
    try {
      session = await ensureSession({
        entry: resolution.entry,
        learnerId: card.learner,
        nowIso: this.#clock().toISOString(),
        sessions: this.#sessions,
        newSessionId: this.#newSessionId,
      });
    } catch (error) {
      this.#logger.error?.('school.selfservice.action.failed', {
        stage: 'ensure-session', action: kind, error: error?.message ?? String(error),
      });
      return { outcome: 'failed', sentence: TELL_A_GROWN_UP };
    }

    const sessionId = session?.sessionId;
    // Belt and braces on rule 1: whatever happened above, the id that goes on
    // to a use case is a real one. Handing `'synthetic:unopened'` to
    // `IssueDocument` would print against a session that does not exist.
    if (typeof sessionId !== 'string' || !sessionId || sessionId === SYNTHETIC_SESSION_ID) {
      this.#logger.error?.('school.selfservice.action.no-session', { action: kind, sessionId: sessionId ?? null });
      return { outcome: 'failed', sentence: TELL_A_GROWN_UP };
    }

    const learnerId = card.learner;
    switch (kind) {
      case 'print': return this.#print(sessionId);
      case 'retry': return this.#retry({
        sessionId,
        offered,
        learnerId,
        unit: resolution.unit,
      });
      case 'play': return this.#play(sessionId, offered.target ?? null);
      case 'launch': return this.#launch({ sessionId, learnerId, launch: resolution.unit?.launch });
      case 'screen': return this.#screen({ sessionId, learnerId, unit: resolution.unit });
      default:
        this.#logger.warn?.('school.selfservice.action.unhandled', { action: kind });
        return { outcome: 'refused', sentence: MOVED_ON };
    }
  }

  /**
   * The sheet. No print-or-screen fallback here on purpose: the card already
   * made that judgement once (`offeredActions` takes `bankPrintable` from
   * `IssueDocument.canIssueBank`), and a `print` that is not on the card is
   * refused above — so re-deciding it would be the duplicated judgement
   * `offerSession.mjs` records deleting after it drifted.
   */
  async #print(sessionId) {
    if (!this.#issue) return this.#unwired('print', sessionId);
    let result;
    try {
      result = await this.#issue.execute({ sessionId });
    } catch (error) {
      return this.#threw('print', sessionId, error);
    }
    return this.#report('print', PRINT_RESULTS, result, sessionId, {
      artifactId: result?.artifactId ?? null,
      pageCount: result?.pageCount ?? null,
    });
  }

  /**
   * The bulk-print fan-out (Task 5's `resolution.kind === 'bulk_print'`): one
   * access code that named several subjects at once, one printer run per
   * subject. Each `ref` gets its OWN `ensureSession` — rule 1 applies per
   * subject, not once for the batch, because each `ref.entry` may or may not
   * already have a real session — and then its own `IssueDocument` call. One
   * ref's failure must not stop the rest: a sibling code that would have
   * printed five sheets should not lose four of them because the third's
   * session could not be opened.
   *
   * This does NOT go through `PRINT_RESULTS` / `#report` — those speak for a
   * single card's outcome. The outcome here is an aggregate over `refs`, so it
   * is judged separately, per the design's outcome table.
   */
  async #bulkPrint(resolution) {
    const { learnerId, refs } = resolution;
    this.#logger.info?.('school.selfservice.bulk.print.start', { learnerId, refCount: refs.length });

    const results = [];
    for (const ref of refs) {
      try {
        const session = await ensureSession({
          entry: ref.entry, learnerId,
          nowIso: this.#clock().toISOString(),
          sessions: this.#sessions, newSessionId: this.#newSessionId,
        });
        const result = await this.#issue.execute({ sessionId: session.sessionId });
        const status = result?.status ?? 'unavailable';
        this.#logger.info?.('school.selfservice.bulk.print.ref', {
          subject: ref.subject, status, artifactId: result?.artifactId ?? null,
        });
        results.push({ subject: ref.subject, status, artifactId: result?.artifactId ?? null, pageCount: result?.pageCount ?? null });
      } catch (error) {
        this.#logger.error?.('school.selfservice.bulk.print.ref', {
          subject: ref.subject, status: 'error', error: error.message,
        });
        results.push({ subject: ref.subject, status: 'error', artifactId: null, pageCount: null });
      }
    }

    const succeeded = results.filter((r) => r.status === 'issued' || r.status === 'reprinted').length;
    const debounced = results.filter((r) => r.status === 'debounced').length;
    const failed = results.length - succeeded - debounced;

    let outcome;
    let sentence;
    if (succeeded > 0) {
      outcome = 'done';
      sentence = failed > 0
        ? `${succeeded} of ${results.length} sheets printed — ${failed} could not print.`
        : `${succeeded} ${succeeded === 1 ? 'sheet' : 'sheets'} printed.`;
    } else if (debounced === results.length) {
      outcome = 'debounced';
      sentence = "They're already on the way — give it a minute.";
    } else if (results.every((r) => r.status === 'already_done')) {
      outcome = 'refused';
      sentence = 'Those are all finished.';
    } else {
      outcome = 'failed';
      sentence = 'The printer did not answer. Try that again in a minute.';
    }

    this.#logger.info?.('school.selfservice.bulk.print.done', { succeeded, failed, debounced, outcome });

    return {
      outcome,
      sentence,
      sessionId: null,
      effect: { results },
    };
  }

  /**
   * A FRESH session with a fresh variant, never another operation against the
   * graded one. `OpenRemediation` opens the replacement; then the action's
   * declared `operation` runs against THAT session. Paper prints, media plays,
   * banks mount, and launches dispatch exactly as a fresh created card would.
   */
  async #retry({ sessionId, offered, learnerId, unit }) {
    if (!this.#remediation) return this.#unwired('retry', sessionId);
    let opened;
    try {
      opened = await this.#remediation.execute({ sessionId });
    } catch (error) {
      return this.#threw('retry', sessionId, error);
    }

    if (opened?.status === 'unavailable' || !opened?.newSessionId) {
      // OpenRemediation's own refusals ("There is nothing to try again right
      // now.", "We could not find that work.") are already panel-safe.
      return {
        outcome: 'refused',
        sentence: opened?.message || MOVED_ON,
        sessionId,
        effect: { status: opened?.status ?? null },
      };
    }

    const fresh = opened.newSessionId;
    let result;
    const operation = offered?.operation ?? 'print';
    switch (operation) {
      case 'print':
        result = await this.#print(fresh);
        break;
      case 'play':
        result = await this.#play(fresh, offered.target ?? null);
        break;
      case 'screen':
        result = await this.#screen({ sessionId: fresh, learnerId, unit });
        break;
      case 'launch':
        result = await this.#launch({ sessionId: fresh, learnerId, launch: unit?.launch });
        break;
      default:
        return {
          outcome: 'refused', sentence: MOVED_ON, sessionId: fresh,
          effect: { status: 'unsupported-remediation-operation', operation: offered?.operation ?? null },
          transition: 'message',
        };
    }
    return {
      ...result,
      sessionId: fresh,
      sentence: operation === 'print' && result.outcome === 'done'
        ? 'Printing a fresh sheet to try again.' : result.sentence,
      effect: { ...(result.effect ?? {}), remediationOf: sessionId, variant: opened.variant ?? null },
    };
  }

  /**
   * The video, at the room the button named. `target` is the card's own
   * (`selfService.mediaSurface`), so a household that configured a surface
   * `DispatchMedia` does not know gets that use case's own refusal in words
   * rather than a video in the wrong room; with no surface configured the
   * target is null and `DispatchMedia` picks its single child-selectable
   * target, exactly as the scan path does.
   */
  async #play(sessionId, target) {
    if (!this.#media) return this.#unwired('play', sessionId);
    let result;
    try {
      result = await this.#media.execute({ sessionId, target });
    } catch (error) {
      return this.#threw('play', sessionId, error);
    }
    return this.#report('play', PLAY_RESULTS, result, sessionId, {
      requestedTarget: target,
      dispatchId: result?.dispatchId ?? null,
      target: result?.target ?? null,
    });
  }

  /**
   * One use-case result -> one panel answer. THE judgement both `print` and
   * `play` make, made once: which statuses may keep the use case's own
   * wording, and which must be rewritten because that wording tells a child
   * to SCAN — a scanner instruction on a keypad. A status neither table knows
   * is a failure with words, never a blank card, and it is logged, because a
   * new status in `IssueDocument`/`DispatchMedia` that nobody taught this file
   * about is a real gap and there is no other way to see it.
   */
  #report(action, table, result, sessionId, effect) {
    const known = table[result?.status];
    if (!known) {
      this.#logger.warn?.('school.selfservice.action.unknown-status', {
        action, sessionId, status: result?.status ?? null,
      });
    } else if (known.outcome === 'failed') {
      this.#logger.warn?.('school.selfservice.action.use-case-failed', {
        action, sessionId, status: result.status, message: result.message ?? null,
      });
    }
    // `sentence: null` in a table means "the use case already said it well".
    const own = known?.sentence === null ? result?.message : known?.sentence;
    const outcome = known?.outcome ?? 'failed';
    return {
      outcome,
      // A blank sentence is the one thing a panel may never show, so even a
      // use case that answers with an empty message gets words here.
      sentence: (typeof own === 'string' && own.trim()) ? own : (outcome === 'done' ? 'All set.' : TELL_A_GROWN_UP),
      sessionId,
      effect: { status: result?.status ?? null, ...effect },
      transition: action === 'print' && outcome === 'done' ? 'confirm-print' : 'message',
    };
  }

  /**
   * A `launch:` unit's whole ask IS the dispatch. Same three steps
   * `ResolveScanAction#dispatchLaunch` takes — DoNow, then the
   * `launch_dispatched` event, then the honour-close — with a screen sentence
   * where that one prints a slip. The pending->approved half is NOT this
   * method's job: it happens out of band, in `DoNowSchoolBridge`.
   */
  async #launch({ sessionId, learnerId, launch }) {
    if (!launch?.surface) {
      this.#logger.warn?.('school.selfservice.launch.no-surface', { sessionId });
      return { outcome: 'failed', sentence: TELL_A_GROWN_UP, sessionId, effect: null };
    }
    if (!this.#donow) {
      this.#logger.warn?.('school.selfservice.launch.unwired', { sessionId, surface: launch.surface });
      return {
        outcome: 'failed',
        sentence: 'Ask a grown-up to set this up.',
        sessionId,
        effect: { decision: 'unwired', surface: launch.surface },
      };
    }

    const { surface, ...action } = launch;
    let result;
    try {
      result = await this.#donow.dispatch({
        surface, action, learnerId, requestedBy: 'school-panel', ref: sessionId,
      });
    } catch (error) {
      this.#logger.warn?.('school.selfservice.launch.donow-threw', {
        sessionId, surface, error: error?.message ?? String(error),
      });
      result = { decision: 'failed', message: 'Could not start that. Tell a grown-up.' };
    }

    const decision = result?.decision ?? 'failed';
    if (decision === 'dispatched') {
      // `approvalId` is always null on the immediate path (it is
      // `dispatchApproved`-only), written explicitly for parity with the
      // bridge's identical append on the pending-then-approved path.
      try {
        const { errors, event } = createEvent({
          type: 'launch_dispatched', at: this.#clock().toISOString(), sessionId, surface,
          decision, approvalId: result.approvalId ?? null,
        });
        if (errors.length) this.#logger.warn?.('school.selfservice.launch.event-invalid', { sessionId, errors });
        else await this.#sessions.appendEvent(sessionId, event);
        if (this.#close) await this.#close.execute({ sessionId, honorClose: true });
      } catch (error) {
        // The child is already on their way to the garage; a bookkeeping
        // failure must not tell them they are not.
        this.#logger.warn?.('school.selfservice.launch.record-failed', {
          sessionId, surface, error: error?.message ?? String(error),
        });
      }
    }

    const outcome = LAUNCH_OUTCOMES[decision] ?? 'failed';
    if (decision !== 'dispatched') {
      this.#logNotDispatched('school.selfservice.launch.not-dispatched', result?.decision, outcome, {
        sessionId, surface, message: result?.message ?? null,
      });
    }
    return {
      outcome,
      // DoNow's wording, verbatim — it names the real surface via that
      // surface's own adapter label.
      sentence: result?.message || 'Could not start that. Ask a grown-up to set this up.',
      sessionId,
      effect: { decision, surface, approvalId: result?.approvalId ?? null },
    };
  }

  /**
   * A `program:` unit. There is no work session here — a program owns its own
   * record of what a child did — but there IS a question this file must not
   * get wrong: does the program open where the child is standing, or
   * somewhere else entirely?
   *
   * `school.yml`'s `programs:` entries build `SurfaceProgramLauncher`s
   * pointing at arbitrary DoNow surfaces. Answering `mount` for all of them
   * told a child tapping a `garage-fitness` program that the work was opening
   * on the screen in front of them, while nothing happened anywhere — a dead
   * end wearing the words of a success, which is worse than a plain refusal.
   *
   * So the launcher is asked STRUCTURALLY (`surface`, never `locationHint`'s
   * display prose):
   *
   *   - `'portal'`  -> mounted here. `data/household/screens/portal.yml` is the
   *                    only screen in the house that mounts School, and it is
   *                    this panel — so a Portal program really does open in
   *                    place, and mounting beats a DoNow round trip back to
   *                    the device the request came from.
   *   - anything else, or a launcher that declares no surface at all ->
   *                    `launch()`, which routes through DoNow exactly as
   *                    `ResolveScanAction#subjectNext`'s program branch does,
   *                    so occupancy and the pending-approval ladder apply
   *                    uniformly and the sentence names the REAL surface.
   *
   * The `null`/undeclared case dispatches on purpose: a truthful dispatch is
   * the fail-safe direction, and "it opens here" must never be assumed on a
   * launcher's behalf.
   *
   * A program with no launcher registered gets the house wording for an
   * unwired thing rather than a claim that it started.
   */
  async #program({ programId, unitId, corpusId = null, learnerId }) {
    const launcher = programId ? this.#launchers.get(programId) : null;
    if (!launcher || typeof launcher.launch !== 'function') {
      this.#logger.warn?.('school.selfservice.program.no-launcher', { programId, unitId });
      return {
        outcome: 'failed',
        sentence: 'Ask a grown-up to set this up.',
        effect: { programId, unitId },
      };
    }

    let surface = null;
    try {
      surface = launcher.surface ?? null;
    } catch (error) {
      // A launcher whose accessor throws has told us nothing, which means
      // "not known to be here" — dispatch.
      this.#logger.warn?.('school.selfservice.program.surface-failed', {
        programId, error: error?.message ?? String(error),
      });
    }

    if (surface === 'portal') {
      let target;
      try {
        target = typeof launcher.issueLaunchTarget === 'function'
          ? await launcher.issueLaunchTarget({ userId: learnerId, corpusId, programInstance: corpusId, unitId })
          : { kind: 'program', program: programId, corpusId };
      } catch (error) {
        this.#logger.warn?.('school.selfservice.program.grant-failed', {
          programId, learnerId, corpusId, error: error?.message ?? String(error),
        });
        return { outcome: 'failed', sentence: 'Ask a grown-up to set this up.', effect: null };
      }
      this.#logger.info?.('school.selfservice.program.mounted', { programId, unitId });
      return {
        outcome: 'mount',
        sentence: 'Opening it here on the screen.',
        effect: { ...target, programId: target.program, unitId, learnerId },
      };
    }

    let result;
    try {
      result = await launcher.launch({ userId: learnerId, corpusId, programInstance: corpusId, unitId });
    } catch (error) {
      this.#logger.warn?.('school.selfservice.program.launch-threw', {
        programId, surface, error: error?.message ?? String(error),
      });
      result = { decision: 'failed', message: 'Could not start that. Ask a grown-up to set this up.' };
    }

    const rawDecision = result?.decision;
    const decision = rawDecision ?? 'failed';
    const outcome = LAUNCH_OUTCOMES[decision] ?? 'failed';
    if (decision !== 'dispatched') {
      // THE REASON is now on record. Before this, every non-dispatched
      // decision reached `school.selfservice.action.run` as bare
      // `outcome:"failed"` with nothing else anywhere — a launcher's clean,
      // correct refusal (a co-progress lock, an occupancy denial) was
      // indistinguishable in the logs from a launcher that threw (already
      // covered by `program.launch-threw`) or one that returned garbage.
      this.#logNotDispatched('school.selfservice.program.not-dispatched', rawDecision, outcome, {
        programId, unitId, surface, message: result?.message ?? null,
      });
    }
    return {
      outcome,
      // DoNow's own wording, verbatim — it names the real surface through
      // that surface's adapter label, which is why nothing here re-words it.
      sentence: result?.message || 'Could not start that. Ask a grown-up to set this up.',
      // Deliberately NOT `kind: 'program'`: an external-surface handoff is not
      // mounted on the panel. A successful dispatch closes the launch card;
      // the Piano kiosk owns the activity from that point forward.
      effect: { decision, surface, programId, unitId },
      ...(decision === 'dispatched' ? { transition: 'close' } : {}),
    };
  }

  /**
   * Bank work answered on the panel itself. Nothing is dispatched: the child
   * is already standing at the screen, so the DoNow `portal` hand-off the scan
   * path needs (a broadcast to whichever screen is listening) would be a
   * round trip to reach the device the request came from — and would pend or
   * deny against its own occupancy.
   *
   * The session is real by the time this returns, which is what the panel
   * mounts the quiz against. Task 8's obligation, stated in the design: the
   * mounted quiz must open its sitting through the SAME `SchoolService` path
   * the SPA's `start()` uses, or `PortalSurface.occupancy()` is blind to it
   * and DoNow will interrupt a child mid-quiz.
   */
  async #screen({ sessionId, learnerId, unit }) {
    this.#logger.info?.('school.selfservice.screen.mounted', {
      sessionId, unitId: unit?.unitId ?? null, bank: unit?.bank ?? null,
    });
    return {
      outcome: 'mount',
      sentence: 'Answer it here on the screen.',
      sessionId,
      effect: {
        kind: 'bank',
        bankId: unit?.bank ?? null,
        unitId: unit?.unitId ?? null,
        learnerId,
      },
    };
  }

  /**
   * A launcher/DoNow decision that did not dispatch — logged so a clean
   * refusal (`denied`/`pending_approval`) is never indistinguishable in the
   * logs from a decision that is missing or that nothing in `LAUNCH_OUTCOMES`
   * recognises. `info`: the decision is a known shape, so a refusal here is
   * the system working as designed. `warn`: the launcher/DoNow returned a
   * shape nobody taught this file about — a contract defect, not an ordinary
   * "not now". Shared by `#program` and `#launch`, the two places a decision
   * outside `dispatched` can otherwise vanish into a bare `outcome:"failed"`.
   */
  #logNotDispatched(event, rawDecision, outcome, context) {
    const known = rawDecision !== undefined && rawDecision in LAUNCH_OUTCOMES;
    this.#logger[known ? 'info' : 'warn']?.(event, { ...context, decision: rawDecision, outcome });
  }

  #unwired(action, sessionId) {
    this.#logger.warn?.('school.selfservice.action.unwired', { action, sessionId });
    return { outcome: 'failed', sentence: 'That is not set up yet. Tell a grown-up.', sessionId, effect: null };
  }

  #threw(action, sessionId, error) {
    this.#logger.error?.('school.selfservice.action.failed', {
      stage: action, sessionId, error: error?.message ?? String(error),
    });
    return { outcome: 'failed', sentence: TELL_A_GROWN_UP, sessionId, effect: null };
  }
}

export default RunSelfServiceAction;
