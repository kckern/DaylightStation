/**
 * ResolveScanAction — everything behind the relay's `sch:` branch (spec §6.2).
 *
 * One entry point. A code arrives from ANY scanner in the house, and this
 * resolves it, routes it by token class, and makes sure something physical
 * happens. Nothing else in the system knows what a scanned school code means.
 *
 * THE INVARIANT: **a scan never succeeds silently, and never dead-ends.** Every
 * path out of here ends in paper — a worksheet, a receipt, or an explanation
 * slip. An unknown ticket, an expired one, a ticket for work that has already
 * moved on: each prints something a child can read and act on. "That didn't
 * work" with nothing after it is the failure this whole subsystem exists to
 * avoid, and it is not reachable from this file.
 *
 * IDEMPOTENCE IS DELEGATED, TWICE OVER. `resolveTokenState` decides whether a
 * ticket is still meaningful against the session's derived state, so a re-scan
 * while valid re-executes and a re-scan after the state advanced returns a
 * friendly `already_done`. Each downstream use case then guards itself as well,
 * because the two checks protect different things: this one protects the
 * child's experience, theirs protect the record.
 */
import { isSchoolToken, resolveTokenState } from '#domains/school/sessions/tokens.mjs';
import { reduceSession } from '#domains/school/sessions/sessionEvents.mjs';
import { noticeDocument } from '#domains/school/documents/receipts.mjs';

export class ResolveScanAction {
  #tokens; #sessions; #curriculum; #card; #issue; #media; #remediation; #receipts; #clock; #logger;
  #subjectResolver; #portal; #launchers;

  /**
   * @param {object} deps
   * @param {import('../ports/ITokenRegistry.mjs').ITokenRegistry} deps.tokens
   * @param {import('../ports/IWorkSessionRepository.mjs').IWorkSessionRepository} deps.sessions
   * @param {import('../CurriculumAccess.mjs').CurriculumAccess} deps.curriculum
   * @param {import('./ResolvePersonalCard.mjs').ResolvePersonalCard} deps.resolvePersonalCard
   * @param {import('./IssueDocument.mjs').IssueDocument} deps.issueDocument
   * @param {import('./DispatchMedia.mjs').DispatchMedia} deps.dispatchMedia
   * @param {import('./OpenRemediation.mjs').OpenRemediation} deps.openRemediation
   * @param {import('../ReceiptPrinting.mjs').ReceiptPrinting} deps.receipts
   * @param {import('./ResolveSubjectNext.mjs').ResolveSubjectNext} [deps.resolveSubjectNext] -
   *   required to route `subject_next` tickets; a deployment that has not yet
   *   wired Task 12's composition simply never mints one, so this is allowed
   *   to be absent rather than widening every existing construction site.
   * @param {import('../PortalDispatch.mjs').PortalDispatch} [deps.portal] - broadcasts
   *   a bank/program hand-off; a screen-bound move still prints its slip
   *   without one, it just cannot also wake a screen.
   * @param {Map<string, import('../ports/IProgramLauncher.mjs').IProgramLauncher>} [deps.launchers]
   *   program id -> launcher, called for `launch()` on a `program` resolution
   *   (the same map `ResolveSubjectNext` separately calls `status()` on).
   * @param {() => Date} [deps.clock]
   * @param {object} [deps.logger]
   */
  constructor({
    tokens, sessions, curriculum, resolvePersonalCard, issueDocument,
    dispatchMedia, openRemediation, receipts,
    resolveSubjectNext = null, portal = null, launchers = new Map(),
    clock = () => new Date(), logger = console,
  } = {}) {
    if (!tokens || !sessions || !curriculum || !resolvePersonalCard || !issueDocument
      || !dispatchMedia || !openRemediation || !receipts) {
      throw new Error('ResolveScanAction requires the full lifecycle graph');
    }
    this.#tokens = tokens;
    this.#sessions = sessions;
    this.#curriculum = curriculum;
    this.#card = resolvePersonalCard;
    this.#issue = issueDocument;
    this.#media = dispatchMedia;
    this.#remediation = openRemediation;
    this.#receipts = receipts;
    this.#subjectResolver = resolveSubjectNext;
    this.#portal = portal;
    this.#launchers = launchers;
    this.#clock = clock;
    this.#logger = logger;
  }

  /**
   * @param {object} args
   * @param {string} args.code - the raw scanned code
   * @param {string} [args.device] - which scanner it came from
   * @returns {Promise<{ status: string, tokenClass: string|null, sessionId: string|null,
   *                     physical: 'worksheet'|'receipt'|'none', printed: boolean,
   *                     message: string, effect: object|null }>}
   */
  async execute({ code, device = null } = {}) {
    if (!isSchoolToken(code)) {
      // Not ours. The relay branches on the same predicate, so reaching here is
      // a caller mistake rather than a child's — say so, print nothing.
      return this.#plain('not_school', 'That code is not one of ours.');
    }

    const record = await this.#tokens.get(code);
    // Both classes name something other than a session — `identify` a
    // learner, `subject_next` a learner+subject — so neither has a
    // `sessionId` to look up ahead of resolving what the ticket means.
    const sessionId = (record?.tokenClass === 'identify' || record?.tokenClass === 'subject_next')
      ? null : (record?.subject?.sessionId ?? null);
    const sessionState = sessionId ? reduceSession(await this.#sessions.readEvents(sessionId)) : null;
    const resolution = resolveTokenState(record, { sessionState, now: this.#clock().toISOString() });

    this.#logger.info?.('school.scan.resolved', {
      device, tokenClass: record?.tokenClass ?? null, sessionId, status: resolution.status,
    });

    if (resolution.status !== 'actionable') {
      return this.#slip({
        status: resolution.status,
        tokenClass: record?.tokenClass ?? null,
        sessionId,
        id: `${resolution.status}-${sessionId ?? 'ticket'}`,
        headline: resolution.status === 'already_done' ? 'All done with that one' : 'That ticket did not work',
        lines: [resolution.message],
        message: resolution.message,
      });
    }

    switch (record.tokenClass) {
      case 'identify': return this.#identify(record);
      case 'select_unit': return this.#start(sessionId, sessionState);
      case 'issue_document':
      case 'recovery': return this.#print(sessionId, record.tokenClass, sessionState);
      case 'media_action': return this.#play(sessionId);
      case 'remediation': return this.#retry(sessionId);
      case 'subject_next':
        // A deployment that has not yet wired the subject resolver (Task 12's
        // composition) must degrade to the same "we could not use that
        // ticket" slip every other unreachable class gets, never a crash —
        // the invariant at the top of this file applies to every branch,
        // including the ones still waiting on a later task to finish wiring.
        return this.#subjectResolver
          ? this.#subjectNext(record)
          : this.#unsupported(record.tokenClass, sessionId);
      default:
        // Unreachable while TOKEN_CLASSES and this switch agree; a class with no
        // case would be the silent scan the whole file exists to prevent.
        return this.#unsupported(record.tokenClass, sessionId);
    }
  }

  #unsupported(tokenClass, sessionId) {
    return this.#slip({
      status: 'unsupported', tokenClass, sessionId,
      id: `unsupported-${sessionId ?? 'ticket'}`,
      headline: 'We could not use that ticket',
      lines: ['Scan your card to see what is next.'],
      message: 'We could not use that ticket.',
    });
  }

  async #identify(record) {
    const result = await this.#card.execute({ learnerId: record.subject?.learnerId });
    return {
      status: result.status,
      tokenClass: 'identify',
      sessionId: null,
      physical: 'receipt',
      printed: result.printed,
      message: result.message,
      effect: { offers: result.offers },
    };
  }

  /**
   * What "start this" means depends on how the unit is composed — the reducer
   * never sees units, so the decision lives here rather than in the token.
   */
  async #start(sessionId, sessionState) {
    const unit = await this.#curriculum.getUnit(sessionState?.unitId);
    if (unit?.media) return this.#play(sessionId);
    if (unit?.document) return this.#print(sessionId, 'select_unit', sessionState);
    if (unit?.bank) return this.#onScreen(sessionId, unit, 'select_unit', sessionState?.learnerId ?? null);
    return this.#slip({
      status: 'unavailable',
      tokenClass: 'select_unit',
      sessionId,
      id: `empty-${sessionId}`,
      headline: 'Nothing to do there yet',
      lines: ['Tell a grown-up. Scan your card to see what else there is.'],
      message: 'That unit has nothing to hand out.',
    });
  }

  /**
   * A screen-only unit prints nothing but must still announce itself, or the
   * child scans and watches nothing happen. It ALSO broadcasts the hand-off
   * through `PortalDispatch` (spec §4.3) so a screen that is already awake
   * can pick the bank session up without the child hunting for it — the slip
   * still prints regardless, because a household with no screen listening
   * (or a `portal` that was never wired) must not strand the child on paper
   * that only half-explains itself.
   */
  async #onScreen(sessionId, unit, tokenClass, learnerId = null) {
    this.#portal?.launch({
      learnerId,
      target: { kind: 'bank', bankId: unit.bank, unitId: unit.unitId, sessionId },
    });
    return this.#slip({
      status: 'open_on_screen',
      tokenClass,
      sessionId,
      id: `screen-${sessionId}`,
      headline: unit.title,
      lines: ['Starting on the school screen — or open it there yourself.'],
      message: 'Start this one on the screen.',
      effect: { unitId: unit.unitId, bank: unit.bank },
    });
  }

  /**
   * Print the sheet — unless the unit does not have one.
   *
   * A media + bank unit reaches `media_completed`, whose reducer next action is
   * `issue_document` because the reducer cannot see units. Sending that ticket
   * straight to `IssueDocument` prints "There is no sheet to print for this
   * one" and strands the child with the rest of the course behind it. The unit's
   * composition is the only thing that knows better, and it is known here.
   */
  async #print(sessionId, tokenClass, sessionState = null) {
    const unit = await this.#curriculum.getUnit(sessionState?.unitId);
    if (unit && !unit.document && unit.bank) {
      return this.#onScreen(sessionId, unit, tokenClass, sessionState?.learnerId ?? null);
    }

    const result = await this.#issue.execute({ sessionId });
    // A worksheet came out of the laser: that IS the physical response, and a
    // receipt beside it would be noise. Anything else needs explaining.
    const printedSheet = result.status === 'issued' || result.status === 'reprinted';
    const printed = printedSheet ? true : (await this.#receipts.print(result.document)).printed;
    return {
      status: result.status,
      tokenClass,
      sessionId,
      physical: printedSheet ? 'worksheet' : 'receipt',
      printed,
      message: result.message,
      // The tickets that went out ON the sheet. Reported so a caller can see
      // what a child is now holding — and so a test can check that every
      // barcode printed on it resolves to something.
      effect: { artifactId: result.artifactId, pageCount: result.pageCount, tokens: result.tokens ?? {} },
    };
  }

  async #play(sessionId) {
    const result = await this.#media.execute({ sessionId });
    const printed = await this.#receipts.print(result.document ?? noticeDocument({
      id: `playing-${sessionId}`,
      headline: 'Off you go',
      lines: [result.message, 'When it finishes, scan your card for the questions.'],
    }));
    return {
      status: result.status,
      tokenClass: 'media_action',
      sessionId,
      physical: 'receipt',
      printed: printed.printed,
      message: result.message,
      effect: { dispatchId: result.dispatchId, target: result.target },
    };
  }

  async #retry(sessionId) {
    const opened = await this.#remediation.execute({ sessionId });
    if (opened.status === 'unavailable') {
      const printed = await this.#receipts.print(opened.document);
      return {
        status: 'unavailable', tokenClass: 'remediation', sessionId,
        physical: 'receipt', printed: printed.printed, message: opened.message, effect: null,
      };
    }
    // The fresh sheet is the point of the retry ticket, so hand it over right
    // away rather than sending the child back to their card for a second scan.
    // Routed through #print, so a unit whose second try happens on the screen
    // says so instead of failing to find a sheet it never had.
    const retryState = reduceSession(await this.#sessions.readEvents(opened.newSessionId));
    const issued = await this.#print(opened.newSessionId, 'remediation', retryState);
    const printedSheet = issued.physical === 'worksheet';
    return {
      ...issued,
      sessionId: opened.newSessionId,
      message: printedSheet ? 'Printing a fresh sheet to try again.' : issued.message,
      effect: {
        ...(issued.effect ?? {}),
        remediationOf: sessionId,
        variant: opened.variant,
      },
    };
  }

  /**
   * The `subject_next` ticket (spec §6.3, Task 10/11): sessionless, so
   * everything about what it means is computed FRESH by `ResolveSubjectNext`
   * on this very scan, never re-derived here. This is purely a router from
   * that computed answer to the existing physical helpers — the same
   * `#print`/`#play`/`#onScreen`/`#retry` a per-unit ticket would have
   * reached, so a subject ticket never behaves differently from a unit
   * ticket once the "what's next" question is answered.
   */
  async #subjectNext(record) {
    const { learnerId, subject } = record.subject ?? {};
    const r = await this.#subjectResolver.execute({ learnerId, subject });
    const nice = (s) => (s ? s[0].toUpperCase() + s.slice(1) : 'That');

    if (r.kind === 'served') {
      return this.#slip({
        status: 'served_today', tokenClass: 'subject_next', id: `served-${subject}`,
        headline: `${nice(subject)} is done for today`,
        lines: ['Nice work — scan your card tomorrow.'],
        message: 'Done for today.',
      });
    }
    if (r.kind === 'locked') {
      return this.#slip({
        status: 'locked', tokenClass: 'subject_next', id: `locked-${subject}`,
        headline: 'Not open yet',
        lines: [r.remedy ?? 'Finish the earlier work first.'],
        message: r.remedy ?? 'Locked.',
      });
    }
    if (r.kind === 'empty' || r.kind === 'unavailable') {
      return this.#slip({
        status: r.kind, tokenClass: 'subject_next', id: `${r.kind}-${subject}`,
        headline: 'Nothing to hand out',
        lines: ['Try it on the Portal, or ask a grown-up.'],
        message: 'Nothing to hand out.',
      });
    }
    if (r.kind === 'program') {
      const launcher = this.#launchers.get(r.programId);
      let dispatched = false;
      try {
        dispatched = (await launcher?.launch({ userId: learnerId }))?.dispatched === true;
      } catch (e) {
        this.#logger.warn?.('school.scan.launch-failed', { programId: r.programId, error: e.message });
      }
      return this.#slip({
        status: dispatched ? 'launched' : 'launch_unconfirmed', tokenClass: 'subject_next',
        id: `launch-${r.programId}`, headline: r.unit?.title ?? nice(subject),
        lines: [dispatched
          ? 'Starting on the Portal — or open it there yourself.'
          : 'Go to the Portal and open it there.'],
        message: 'Off to the Portal.',
      });
    }

    // r.kind === 'move' — act through the existing physical helpers. The
    // session was already ensured by `ResolveSubjectNext`; nothing here
    // re-reads events.
    if (r.move.kind === 'retry') return this.#retry(r.sessionId); // OpenRemediation: new session, fresh sheet
    if (r.move.kind === 'print') return this.#print(r.sessionId, 'subject_next', r.state);
    if (r.move.kind === 'play') return this.#play(r.sessionId);
    if (r.move.kind === 'screen') return this.#onScreen(r.sessionId, r.unit, 'subject_next', r.state?.learnerId ?? null);
    return this.#slip({
      status: 'wait', tokenClass: 'subject_next', id: `wait-${r.sessionId}`,
      headline: r.unit?.title ?? 'Keep going', lines: [r.move.label], message: r.move.label,
    });
  }

  async #slip({ status, tokenClass = null, sessionId = null, id, headline, lines, message, effect = null }) {
    const printed = await this.#receipts.print(noticeDocument({ id, headline, lines }));
    return { status, tokenClass, sessionId, physical: 'receipt', printed: printed.printed, message, effect };
  }

  #plain(status, message) {
    return { status, tokenClass: null, sessionId: null, physical: 'none', printed: false, message, effect: null };
  }
}

export default ResolveScanAction;
