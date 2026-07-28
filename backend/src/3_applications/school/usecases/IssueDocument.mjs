/**
 * IssueDocument — put a sheet of paper in a child's hand (spec §2, §5.2, §9).
 *
 * Mints the tokens the sheet will carry, renders it, sends it to the laser
 * printer, keeps the form map, and records what happened on the session.
 *
 * Three things it is careful about:
 *
 *   1. **A reprint reuses the ORIGINAL artifact id** (§5.2). Reprinting under a
 *      fresh id would make one piece of work look like two, and would give the
 *      same bubbles two different form maps. The `reprinted` event carries the
 *      same id, which is what makes the lineage readable.
 *   2. **A printer failure is not an exception in the caller's face** (§9). The
 *      session records a `failed` annotation — which does NOT advance the state,
 *      so the token the child is holding stays valid — and the child gets a slip
 *      with a recovery ticket. The next scan retries.
 *   3. **The form map is written BEFORE the issue is recorded.** The paper is
 *      already out of the tray by then; if the two were the other way round, a
 *      fast child could scan a sheet whose geometry the server had not yet saved.
 *
 * The renderer arrives through `IDocumentRenderer` (D1: applications may not
 * import `1_rendering`). Token values are minted HERE and passed in — the
 * renderer draws barcodes, it does not decide what they mean.
 */
import { reduceSession, createEvent } from '#domains/school/sessions/sessionEvents.mjs';
import { mintToken, TOKEN_CLASSES } from '#domains/school/sessions/tokens.mjs';
import { noticeDocument } from '#domains/school/documents/receipts.mjs';
import { walkBlocks } from '#domains/school/documents/documentValidation.mjs';
import { shortId } from '#domains/core/utils/id.mjs';

/** States in which handing over a sheet still means something. */
const ISSUABLE = new Set(['created', 'media_completed', 'issued', 'reprinted']);

export class IssueDocument {
  #curriculum; #sessions; #tokens; #renderer; #printer; #formMaps; #bankReader;
  #clock; #rng; #newArtifactId; #logger;

  /**
   * @param {object} deps
   * @param {import('../CurriculumAccess.mjs').CurriculumAccess} deps.curriculum
   * @param {import('../ports/IWorkSessionRepository.mjs').IWorkSessionRepository} deps.sessions
   * @param {import('../ports/ITokenRegistry.mjs').ITokenRegistry} deps.tokens
   * @param {import('../ports/IDocumentRenderer.mjs').IDocumentRenderer} deps.renderer
   * @param {{printPdf: Function}} deps.printer - laser printer adapter surface
   * @param {import('../ports/IFormMapStore.mjs').IFormMapStore} deps.formMaps
   * @param {{getBank: (id: string) => object|null}} [deps.bankReader] - questions the sheet poses
   * @param {() => Date} [deps.clock]
   * @param {() => number} [deps.rng]
   * @param {() => string} [deps.newArtifactId]
   * @param {object} [deps.logger]
   */
  constructor({
    curriculum, sessions, tokens, renderer, printer, formMaps, bankReader = null,
    clock = () => new Date(), rng = Math.random,
    newArtifactId = () => `art_${shortId(8)}`, logger = console,
  } = {}) {
    if (!curriculum || !sessions || !tokens || !renderer || !printer || !formMaps) {
      throw new Error('IssueDocument requires curriculum, sessions, tokens, renderer, printer and formMaps');
    }
    this.#curriculum = curriculum;
    this.#sessions = sessions;
    this.#tokens = tokens;
    this.#renderer = renderer;
    this.#printer = printer;
    this.#formMaps = formMaps;
    this.#bankReader = bankReader;
    this.#clock = clock;
    this.#rng = rng;
    this.#newArtifactId = newArtifactId;
    this.#logger = logger;
  }

  /**
   * @param {object} args
   * @param {string} args.sessionId
   * @returns {Promise<{ status: 'issued'|'reprinted'|'print_failed'|'unavailable'|'already_done',
   *                     sessionId: string, artifactId: string|null, pageCount: number|null,
   *                     tokens: Record<string,string>, document: object|null, message: string }>}
   *   `document` is a receipt document to print when something needs explaining;
   *   null on the happy path, where the worksheet itself is the evidence.
   */
  async execute({ sessionId } = {}) {
    const nowIso = this.#clock().toISOString();
    const events = await this.#sessions.readEvents(sessionId);
    const state = reduceSession(events);

    if (!state.sessionId) return this.#unavailable(sessionId, 'unknown-session', 'We could not find that work.');
    if (!ISSUABLE.has(state.state)) {
      return {
        status: 'already_done',
        sessionId,
        artifactId: state.issuedArtifacts.at(-1) ?? null,
        pageCount: null,
        tokens: {},
        message: 'That sheet is already done with. Scan your card to see what is next.',
        document: noticeDocument({
          id: `done-${sessionId}`,
          headline: 'All finished with that one',
          lines: ['Scan your card to see what is next.'],
        }),
      };
    }

    const unit = await this.#curriculum.getUnit(state.unitId);
    const document = unit?.document ? await this.#curriculum.getDocument(unit.document) : null;
    if (!document) {
      // A dangling reference should be impossible at runtime (the catalog gate
      // resolves every reference at publish time), so it is logged loudly as
      // well as explained on paper.
      this.#logger.warn?.('school.issue.no-document', { sessionId, unitId: state.unitId, document: unit?.document ?? null });
      return this.#unavailable(sessionId, 'no-document', 'There is no sheet to print for this one. Tell a grown-up.');
    }

    const reprinting = state.issuedArtifacts.length > 0;
    const artifactId = reprinting ? state.issuedArtifacts.at(-1) : this.#newArtifactId();
    const tokens = await this.#mintSheetTokens(document, sessionId, nowIso);

    let rendered;
    try {
      rendered = await this.#renderer.render(document, {
        tokens,
        variant: state.variant,
        artifactId,
        sessionId,
        learnerId: state.learnerId,
        bank: unit.bank ? (this.#bankReader?.getBank(unit.bank) ?? null) : null,
      });
    } catch (err) {
      return this.#recordFailure({ sessionId, stage: 'render', reason: err.message, nowIso, state });
    }

    try {
      await this.#printer.printPdf(rendered.pdf, {
        jobName: `school-${state.unitId}-${artifactId}`,
        user: state.learnerId ?? 'daylight',
      });
    } catch (err) {
      return this.#recordFailure({ sessionId, stage: 'print', reason: err.message, nowIso, state });
    }

    // Written first-wins and BEFORE the issue event: see the header.
    if (rendered.formMap) await this.#formMaps.put(artifactId, rendered.formMap);

    const type = reprinting ? 'reprinted' : 'issued';
    const { errors, event } = createEvent({ type, at: nowIso, sessionId, artifactId });
    if (errors.length) throw new Error(`IssueDocument: could not record the issue: ${errors.join('; ')}`);
    await this.#sessions.appendEvent(sessionId, event);

    this.#logger.info?.('school.issue.printed', {
      sessionId, unitId: state.unitId, artifactId, reprint: reprinting, pages: rendered.pageCount ?? null,
    });

    return {
      status: type,
      sessionId,
      artifactId,
      pageCount: rendered.pageCount ?? null,
      tokens,
      formMap: rendered.formMap ?? null,
      document: null,
      message: reprinting ? 'Printing that again for you.' : 'Printing your sheet.',
    };
  }

  /**
   * One token per `scan_action` block whose `action` names a token class. A
   * block naming anything else is left alone — a document may carry a literal
   * instruction that is not a ticket.
   */
  async #mintSheetTokens(document, sessionId, nowIso) {
    const wanted = new Set();
    walkBlocks(document.blocks, (block) => {
      if (block.type === 'scan_action' && TOKEN_CLASSES.includes(block.action)) wanted.add(block.action);
    });
    const tokens = {};
    for (const tokenClass of wanted) {
      const record = mintToken({ tokenClass, subject: { sessionId }, at: nowIso, rng: this.#rng });
      // eslint-disable-next-line no-await-in-loop
      await this.#tokens.put(record);
      tokens[tokenClass] = record.token;
    }
    return tokens;
  }

  /**
   * Record the failure as an ANNOTATION (state does not advance, so the ticket
   * in the child's hand stays valid) and hand back a slip with a fresh recovery
   * ticket. Never throws — §9's whole point is that a failed print is a retry,
   * not a dead end.
   */
  async #recordFailure({ sessionId, stage, reason, nowIso, state }) {
    const { event } = createEvent({ type: 'failed', at: nowIso, sessionId, stage, reason: reason || stage });
    if (event) await this.#sessions.appendEvent(sessionId, event);
    this.#logger.warn?.('school.issue.failed', { sessionId, stage, reason });

    let recovery = null;
    try {
      const record = mintToken({ tokenClass: 'recovery', subject: { sessionId }, at: nowIso, rng: this.#rng });
      await this.#tokens.put(record);
      recovery = record.token;
    } catch (err) {
      // A registry that cannot mint still must not swallow the failure notice.
      this.#logger.warn?.('school.issue.recovery-token-failed', { sessionId, error: err.message });
    }

    return {
      status: 'print_failed',
      sessionId,
      artifactId: state.issuedArtifacts.at(-1) ?? null,
      pageCount: null,
      tokens: {},
      message: 'The printer did not answer. Scan the ticket below to try again.',
      document: noticeDocument({
        id: `print-failed-${sessionId}`,
        headline: 'The printer is not answering',
        lines: ['Your work is safe. Nothing was lost.'],
        actions: recovery ? [{ token: recovery, label: 'Try printing again' }] : [],
      }),
    };
  }

  #unavailable(sessionId, id, line) {
    return {
      status: 'unavailable',
      sessionId: sessionId ?? null,
      artifactId: null,
      pageCount: null,
      tokens: {},
      message: line,
      document: noticeDocument({
        id: `${id}-${sessionId ?? 'none'}`,
        headline: 'We could not print that',
        lines: [line, 'Scan your card for a new list.'],
      }),
    };
  }
}

export default IssueDocument;
