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
   * @param {() => Date} [deps.clock]
   * @param {object} [deps.logger]
   */
  constructor({
    tokens, sessions, curriculum, resolvePersonalCard, issueDocument,
    dispatchMedia, openRemediation, receipts, clock = () => new Date(), logger = console,
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
    const sessionId = record?.tokenClass === 'identify' ? null : (record?.subject?.sessionId ?? null);
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
      case 'recovery': return this.#print(sessionId, record.tokenClass);
      case 'media_action': return this.#play(sessionId);
      case 'remediation': return this.#retry(sessionId);
      default:
        // Unreachable while TOKEN_CLASSES and this switch agree; a class with no
        // case would be the silent scan the whole file exists to prevent.
        return this.#slip({
          status: 'unsupported', tokenClass: record.tokenClass, sessionId,
          id: `unsupported-${sessionId ?? 'ticket'}`,
          headline: 'We could not use that ticket',
          lines: ['Scan your card to see what is next.'],
          message: 'We could not use that ticket.',
        });
    }
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
    if (unit?.document) return this.#print(sessionId, 'select_unit');
    if (unit?.bank) {
      // A screen-only unit prints nothing but must still announce itself, or the
      // child scans and watches nothing happen.
      return this.#slip({
        status: 'open_on_screen',
        tokenClass: 'select_unit',
        sessionId,
        id: `screen-${sessionId}`,
        headline: unit.title,
        lines: ['Go to the school screen and start this one.'],
        message: 'Start this one on the screen.',
        effect: { unitId: unit.unitId, bank: unit.bank },
      });
    }
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

  async #print(sessionId, tokenClass) {
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
      effect: { artifactId: result.artifactId, pageCount: result.pageCount },
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
    // The fresh sheet is the point of the retry ticket, so print it right away
    // rather than sending the child back to their card for a second scan.
    const issued = await this.#issue.execute({ sessionId: opened.newSessionId });
    const printedSheet = issued.status === 'issued' || issued.status === 'reprinted';
    const printed = printedSheet ? true : (await this.#receipts.print(issued.document)).printed;
    return {
      status: issued.status,
      tokenClass: 'remediation',
      sessionId: opened.newSessionId,
      physical: printedSheet ? 'worksheet' : 'receipt',
      printed,
      message: printedSheet ? 'Printing a fresh sheet to try again.' : issued.message,
      effect: { remediationOf: sessionId, variant: opened.variant, artifactId: issued.artifactId },
    };
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
