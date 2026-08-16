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
 *
 * TRACKED QUIZZES (spec §9, Task 7): a unit whose `document` reference matches
 * `print/<id>@<rev>` resolves through the NEWER print-document pipeline
 * (`RenderPrintDocument` + the OMR card allocation store) instead of the
 * legacy curriculum document map — see `#issuePrintDocument` below, reached
 * by an early branch in `execute()` that never runs the legacy lookup for a
 * print-document unit, and is never reached for a legacy one. The allocation
 * record takes the FORM MAP'S SLOT in the write sequence (before the issue
 * event) — `#issuePrintDocument`'s own doc comment explains why that write
 * actually lands even earlier than the legacy slot, not later, and why that
 * is still the same guarantee.
 */
import { reduceSession, createEvent } from '#domains/school/sessions/sessionEvents.mjs';
import { mintToken, TOKEN_CLASSES } from '#domains/school/sessions/tokens.mjs';
import { noticeDocument } from '#domains/school/documents/receipts.mjs';
import { walkBlocks } from '#domains/school/documents/documentValidation.mjs';
import { shortId } from '#domains/core/utils/id.mjs';
import { createWorksheetInstance, worksheetInstanceDocument } from '#domains/school/questionBankV2.mjs';
import { PublishPrintDocument } from '#apps/school/documents/PublishPrintDocument.mjs';
import { deriveLearnerName, deriveIssueDate } from '#apps/school/documents/reprintContext.mjs';
import { slugify } from '#domains/school/documents/receipts.mjs';

/** States in which handing over a sheet still means something. */
const ISSUABLE = new Set(['created', 'media_completed', 'issued', 'reprinted']);

/**
 * `print/<id>@<rev>` — a curriculum unit's `document` field pointing at a
 * PUBLISHED print-document artifact (spec §9) rather than a legacy catalog
 * document id. `id` never contains `@` (the print-document id alphabet
 * excludes it — `documentValidation.mjs`'s `ID_PATTERN`); the remainder after
 * the LAST `@` is the rev, mirroring `YamlAllocationStore`'s own
 * `buildRecordId` convention for the same pair.
 */
const PRINT_DOCUMENT_REF = /^print\/([^@]+)@([^@]+)$/;

function normalizeAnswerSheetPolicy(raw) {
  const reuse = raw?.reuse ?? 'after_scan';
  const capacity = raw?.capacity ?? 50;
  if (!['never', 'after_scan', 'school_day', 'until_full'].includes(reuse)) {
    throw new Error(`IssueDocument: unknown answer-sheet reuse policy "${reuse}"`);
  }
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 50) {
    throw new Error('IssueDocument: answer-sheet capacity must be an integer from 1 to 50');
  }
  return { reuse, capacity };
}

/** @returns {{id: string, rev: string}|null} */
function parsePrintDocumentRef(ref) {
  if (typeof ref !== 'string') return null;
  const match = PRINT_DOCUMENT_REF.exec(ref);
  return match ? { id: match[1], rev: match[2] } : null;
}

/**
 * What a child (and the grown-up they fetch) is told, per cause.
 *
 * Every entry carries a recovery ticket, because §9 says a failure is a retry.
 * They differ in WHO can clear it: paper and cables for `printer`, the
 * curriculum for `missing_artwork`, and a page that will not lay out for
 * `render`. Three different next moves, so three different slips.
 */
const FAILURE_COPY = Object.freeze({
  printer: {
    status: 'print_failed',
    slipId: 'print-failed',
    headline: 'The printer is not answering',
    lines: ['Your work is safe. Nothing was lost.'],
    message: 'The printer did not answer. Scan the ticket below to try again.',
    actionLabel: 'Try printing again',
  },
  missing_artwork: {
    status: 'render_failed',
    slipId: 'missing-artwork',
    headline: 'A picture is missing from that sheet',
    lines: [
      'Your work is safe. Nothing was lost.',
      'Show this to a grown-up — the sheet cannot be made until the picture is put back.',
    ],
    message: 'A picture on that sheet is missing, so it could not be made. Tell a grown-up.',
    actionLabel: 'Try again once it is fixed',
  },
  render: {
    status: 'render_failed',
    slipId: 'sheet-failed',
    headline: 'That sheet could not be made',
    lines: [
      'Your work is safe. Nothing was lost.',
      'Show this to a grown-up.',
    ],
    message: 'We could not make that sheet. Tell a grown-up, then scan the ticket below.',
    actionLabel: 'Try again once it is fixed',
  },
});

export class IssueDocument {
  #curriculum; #sessions; #tokens; #renderer; #printer; #formMaps; #bankReader;
  #printDocuments; #renderPrintDocument; #allocationStore;
  #assignments; #worksheetInstances; #publishPrintDocument;
  #answerSheetPolicy;
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
   * @param {{getPublished: (id: string, rev?: string) => Promise<object|null>|object|null}} [deps.printDocuments] -
   *   `YamlPrintDocumentRepository`-shaped (Task 7, spec §9). Resolves a unit's
   *   `print/<id>@<rev>` document reference to its published artifact. Optional:
   *   absent it, a `print/...` reference degrades to `unavailable` exactly like a
   *   dangling legacy reference does — it never falls through to `curriculum`.
   * @param {{execute: Function}} [deps.renderPrintDocument] - a `RenderPrintDocument`
   *   instance (Task 5), constructed with its OWN `repository`/`banks`/
   *   `allocationStore` at composition time. Required alongside `printDocuments`/
   *   `allocationStore` for a `print/...` unit to actually render.
   * @param {{allocate: Function}} [deps.allocationStore] - the SAME allocation
   *   store `renderPrintDocument` writes through — held here only so a
   *   `print/...` unit can be recognised as configured (or not) before minting
   *   anything; the actual persisting write happens inside `renderPrintDocument`
   *   itself (see `#issuePrintDocument`'s doc comment for why it cannot be
   *   deferred to the form-map slot the way a legacy map is).
   * @param {() => Date} [deps.clock]
   * @param {() => number} [deps.rng]
   * @param {() => string} [deps.newArtifactId]
   * @param {object} [deps.logger]
   */
  constructor({
    curriculum, sessions, tokens, renderer, printer, formMaps, bankReader = null,
    printDocuments = null, renderPrintDocument = null, allocationStore = null,
    assignments = null, worksheetInstances = null, publishPrintDocument = null,
    answerSheetPolicy = null,
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
    this.#printDocuments = printDocuments;
    this.#renderPrintDocument = renderPrintDocument;
    this.#allocationStore = allocationStore;
    this.#assignments = assignments;
    this.#worksheetInstances = worksheetInstances;
    this.#answerSheetPolicy = normalizeAnswerSheetPolicy(answerSheetPolicy);
    this.#publishPrintDocument = publishPrintDocument
      ?? (printDocuments ? new PublishPrintDocument({ repository: printDocuments }) : null);
    this.#clock = clock;
    this.#rng = rng;
    this.#newArtifactId = newArtifactId;
    this.#logger = logger;
  }

  /** Whether a bank-only unit uses the immutable paper-instance pipeline. */
  canIssueBank(bankId) {
    if (!this.#worksheetInstances || !this.#assignments || !this.#publishPrintDocument) return false;
    const bank = this.#bankReader?.getBank(bankId);
    // SchoolService returns validated banks without their schema discriminator;
    // compact-v2's answer(s)+decoys authoring shape remains distinctive.
    return Array.isArray(bank?.items) && bank.items.length > 0
      && bank.items.every((item) => Array.isArray(item.decoys));
  }

  /**
   * @param {object} args
   * @param {string} args.sessionId
   * @returns {Promise<{ status: 'issued'|'reprinted'|'print_failed'|'render_failed'|'unavailable'|'already_done',
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

    // V2 bank-only lessons are printable worksheets. Their authored bank is
    // sampled once into a learner/enrollment-specific immutable instance;
    // every render and scan after this point resolves that frozen artifact.
    if (unit?.bank && !unit.document && this.#worksheetInstances && this.#assignments) {
      return this.#issueWorksheetInstance({ sessionId, nowIso, state, unit });
    }

    // Tracked quizzes (spec §9): a `print/<id>@<rev>` unit-document reference
    // resolves through the print-document pipeline instead of the legacy
    // curriculum document map — a branch AHEAD of the legacy lookup below,
    // which it never runs. Everything from here to the end of this method is
    // unchanged for a legacy unit (this branch is simply never taken).
    const printRef = unit?.document ? parsePrintDocumentRef(unit.document) : null;
    if (printRef) {
      return this.#issuePrintDocument({
        sessionId, nowIso, state, unit, printRef,
      });
    }

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
      rendered = await this.#renderer.render(
        // The VARIANT rides on the document, not just the options: it is what
        // makes a retry sheet a different sheet, and the renderer derives the
        // form map's identity from the document it was handed. A variant passed
        // only alongside would be a variant the paper does not actually carry.
        state.variant === (document.variant ?? 0) ? document : { ...document, variant: state.variant },
        {
          tokens,
          variant: state.variant,
          artifactId,
          sessionId,
          learnerId: state.learnerId,
          bank: unit.bank ? (this.#bankReader?.getBank(unit.bank) ?? null) : null,
        },
      );
    } catch (err) {
      return this.#recordFailure({
        sessionId, stage: 'render', reason: err.message, nowIso, state,
        // Read by NAME, not by class: `1_rendering` is not importable from here
        // (D1), and the renderer arrives through a port that may be any
        // implementation. The name is part of that port's contract.
        cause: err.name === 'UnresolvedAssetError' ? 'missing_artwork' : 'render',
      });
    }

    try {
      await this.#printer.printPdf(rendered.pdf, {
        jobName: `school-${state.unitId}-${artifactId}`,
        user: state.learnerId ?? 'daylight',
      });
    } catch (err) {
      return this.#recordFailure({ sessionId, stage: 'print', reason: err.message, nowIso, state, cause: 'printer' });
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

  async #issueWorksheetInstance({ sessionId, nowIso, state, unit }) {
    if (!this.#renderPrintDocument || !this.#publishPrintDocument || !this.#allocationStore) {
      return this.#unavailable(sessionId, 'worksheet-instance-not-configured', 'There is no sheet to print for this one.');
    }
    const assignment = await this.#assignments.get(state.learnerId);
    const course = (assignment?.courses ?? []).find((entry) => (
      entry.courseId === unit.courseId || entry.enrollment?.lessonOrder
        && Object.values(entry.enrollment.lessonOrder).flat().includes(unit.unitId)
    ));
    const enrollmentId = course?.enrollment?.enrollmentId;
    const profile = course?.profile ?? course?.enrollment?.profile;
    if (!enrollmentId || !profile) {
      return this.#unavailable(sessionId, 'no-enrollment', 'This lesson is not enrolled for this learner.');
    }

    let instance = await this.#worksheetInstances.findBySession(sessionId);
    const reprinting = Boolean(instance);
    if (!instance) {
      const id = `${slugify(unit.subject ?? 'school')}/${slugify(course.courseId)}/ws-${slugify(sessionId)}`;
      const bank = this.#bankReader?.getBank(unit.bank);
      if (!bank) return this.#unavailable(sessionId, 'no-bank', 'There are no questions for this lesson.');
      instance = createWorksheetInstance({
        id, sessionId, bank, learnerId: state.learnerId, enrollmentId,
        lessonId: unit.unitId, profile, seed: `${sessionId}:${state.variant ?? 0}`, issuedAt: nowIso,
        itemIds: state.remediationOf && state.remediationItemIds?.length ? state.remediationItemIds : null,
      });
      const published = await this.#publishPrintDocument.execute({
        source: worksheetInstanceDocument(instance, {
          title: unit.title,
          description: unit.description ?? null,
          sourceTitle: 'The Young People’s Atlas of the United States',
          printedPages: unit.provenance?.printed_pages ?? [],
        }),
      });
      instance = { ...instance, documentId: published.id, documentRevision: published.rev };
    }

    const publishedDocument = await this.#printDocuments.getPublished(instance.documentId, instance.documentRevision);
    const learnerName = deriveLearnerName(instance.learnerId);
    const issueDate = deriveIssueDate(instance.issuedAt);
    const reusableCard = !reprinting && typeof this.#allocationStore.findReusableCard === 'function'
      ? await this.#allocationStore.findReusableCard({
        learnerId: instance.learnerId,
        rowsNeeded: instance.questions.length,
        capacity: this.#answerSheetPolicy.capacity,
        reuse: this.#answerSheetPolicy.reuse,
      })
      : null;
    let rendered;
    try {
      const result = await this.#renderPrintDocument.execute({
        document: publishedDocument,
        context: reprinting && instance.omr?.cardId
          ? { cardId: instance.omr.cardId, startRow: instance.omr.rowRange.start, learnerId: state.learnerId, learnerName, date: issueDate, sessionId }
          : reusableCard
            ? { ...reusableCard, learnerId: state.learnerId, learnerName, date: issueDate, sessionId }
            : { freshCard: true, learnerId: state.learnerId, learnerName, date: issueDate, sessionId },
      });
      rendered = { pdf: result.bytes, pageCount: result.pageCount, allocation: result.allocation };
    } catch (err) {
      await this.#orphanAllocation(err.details?.allocation, { sessionId, unitId: state.unitId, stage: 'render' });
      return this.#recordFailure({ sessionId, stage: 'render', reason: err.message, nowIso, state, cause: 'render' });
    }

    if (!reprinting) {
      instance = {
        ...instance,
        omr: {
          cardId: rendered.allocation.cardId,
          recordId: rendered.allocation.recordId,
          rowRange: rendered.allocation.rowRange,
          letters: instance.questions.map((question) => ({
            itemId: question.itemId,
            options: question.options.map(({ id, label, letter, correct }) => ({ id, label, letter, correct })),
          })),
        },
      };
      await this.#worksheetInstances.put(instance);
    }

    try {
      await this.#printer.printPdf(rendered.pdf, { jobName: `school-${state.unitId}-${instance.id}`, user: state.learnerId });
    } catch (err) {
      await this.#orphanAllocation(rendered.allocation, { sessionId, unitId: state.unitId, stage: 'print' });
      return this.#recordFailure({ sessionId, stage: 'print', reason: err.message, nowIso, state, cause: 'printer' });
    }
    const type = reprinting ? 'reprinted' : 'issued';
    const { errors, event } = createEvent({ type, at: nowIso, sessionId, artifactId: instance.id });
    if (errors.length) throw new Error(`IssueDocument: could not record worksheet instance: ${errors.join('; ')}`);
    await this.#sessions.appendEvent(sessionId, event);
    return {
      status: type, sessionId, artifactId: instance.id, worksheetInstanceId: instance.id,
      pageCount: rendered.pageCount, tokens: {}, allocation: rendered.allocation,
      document: null, message: reprinting ? 'Printing that exact worksheet again.' : 'Printing your worksheet.',
    };
  }

  /**
   * One token per action block whose `action` names a token class. A block
   * naming anything else is left alone — a document may carry a literal
   * instruction that is not a ticket — but a block that DOES name one gets a
   * real, resolvable code, because a barcode printed on a sheet a child is
   * holding must never scan to nothing.
   *
   * `media_action` counts as well as `scan_action`: the "play this" box on a
   * worksheet is scanned exactly like the "another copy" box beside it.
   */
  async #mintSheetTokens(document, sessionId, nowIso) {
    const wanted = new Set();
    walkBlocks(document.blocks, (block) => {
      const isAction = block.type === 'scan_action' || block.type === 'media_action';
      if (isAction && TOKEN_CLASSES.includes(block.action)) wanted.add(block.action);
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
   * Tracked quizzes through the SAME machinery a legacy worksheet uses (spec
   * §9): mint tokens, render, print, record — the identical SHAPE `execute`'s
   * legacy tail runs, just resolving the document via the print-document
   * repository and rendering via `RenderPrintDocument` with a fresh OMR card
   * allocation instead of the legacy `IDocumentRenderer`/form-map pair. Kept
   * as its own method (rather than folded into `execute`'s shared tail) so
   * the legacy path above stays exactly what it always was — nothing here can
   * perturb it.
   *
   * ALLOCATION RECORD TAKES THE FORM MAP'S SLOT (spec §9): a legacy unit
   * writes its form map AFTER a successful print, immediately BEFORE the
   * issue event — "the paper is out of the tray; the mapping must already be
   * durable" (module header). A card-attached render cannot defer ITS durable
   * write that late: the physical row numbers `RenderPrintDocument` prints on
   * the page ARE what `#allocateCard` persists (spec §5.3's numbering-is-the-
   * allocation invariant), so that write has to happen as part of producing
   * the bytes — before print, not after. That is STRICTLY EARLIER than the
   * legacy slot, which only strengthens the guarantee the ordering exists
   * for: nothing here can ever let a scan race a mapping that is not yet
   * durable. What occupies the code's own form-map-write branch below is
   * therefore a log line, not a write — the persistence already happened, in
   * the same role, before the sheet could physically reach a scanner.
   *
   * REPRINTS GET A FRESH CARD TOO: `RenderPrintDocument` is always called
   * with `freshCard: true`, even when `reprinting` reuses the ORIGINAL
   * artifact id for the session's own lineage. This matches, rather than
   * invents, the allocation store's own documented stance
   * (`YamlAllocationStore`'s "SUPERSEDE SCOPE" note): a reprint issued
   * against a different card simply strands the original card's record as an
   * uncollected allocation, which is the accepted, simpler behaviour there
   * already — a lost or damaged physical card needs a NEW one regardless of
   * what the session calls the artifact.
   *
   * ORPHANED ALLOCATIONS ON A LATE FAILURE (Task 7 review, Finding 2): the
   * write-before-print ordering above means a fit rejection or a print jam
   * can both happen AFTER a card is already durably allocated. There is no
   * rollback of the write itself (see this method's own comment on why —
   * the paper-out-of-tray guarantee is about never letting a scan outrun a
   * mapping, not about erasing history), but leaving that record silently
   * `live` would burn a fresh physical card on every retry FOREVER, with no
   * way for anyone to even discover the stranded cardId. Both failure
   * branches below call `#orphanAllocation`, which logs the cardId/recordId
   * at `warn` (`school.issue.allocation-orphaned` — the ONE thing the
   * success-only `allocation-recorded` log never covers) and best-effort
   * releases it via the store (the same `release` a `release-card` CLI call
   * uses), so the very next retry's fresh allocation lands on a clean slate
   * instead of accumulating dead cards.
   */
  async #issuePrintDocument({
    sessionId, nowIso, state, unit, printRef,
  }) {
    if (!this.#printDocuments || !this.#renderPrintDocument || !this.#allocationStore) {
      this.#logger.warn?.('school.issue.print-document-not-configured', {
        sessionId, unitId: state.unitId, document: unit.document,
      });
      return this.#unavailable(sessionId, 'no-document', 'There is no sheet to print for this one. Tell a grown-up.');
    }

    const published = await this.#printDocuments.getPublished(printRef.id, printRef.rev);
    if (!published) {
      // Mirrors the legacy "dangling reference" branch: should be impossible
      // at runtime once publish-time catalog validation covers print refs
      // too, so it is logged loudly as well as explained on paper.
      this.#logger.warn?.('school.issue.no-document', {
        sessionId, unitId: state.unitId, document: unit.document,
      });
      return this.#unavailable(sessionId, 'no-document', 'There is no sheet to print for this one. Tell a grown-up.');
    }

    const reprinting = state.issuedArtifacts.length > 0;
    const artifactId = reprinting ? state.issuedArtifacts.at(-1) : this.#newArtifactId();
    const tokens = await this.#mintSheetTokens(published, sessionId, nowIso);

    let rendered;
    try {
      const result = await this.#renderPrintDocument.execute({
        // The session's own `variant` overrides the published document's,
        // exactly like the legacy path below (`state.variant === (document.variant
        // ?? 0) ? document : {...}`) — a retry sheet must be the shuffle the
        // session actually asked for, not whatever the document was published
        // carrying.
        document: state.variant === (published.variant ?? 0)
          ? published : { ...published, variant: state.variant },
        context: {
          freshCard: true,
          learnerId: state.learnerId ?? null,
          // Session lineage (review wave B1): the allocation record is the
          // one durable artifact a card scan resolves — carrying the
          // sessionId here is what lets a graded scan advance THIS session
          // (submitted → graded) instead of dead-ending in a log line.
          sessionId,
          // F3 review fix (Medium/blocker): the tokens minted just above
          // (`#mintSheetTokens`) must reach `RenderPrintDocument`'s measure
          // + final render, or a scan_action/media_action block's barcode
          // prints its own `.action` literal — a dead code with no matching
          // registry entry — while the REAL minted token sits unused.
          tokens,
        },
      });
      rendered = {
        pdf: result.bytes, pageCount: result.pageCount, formMap: null, allocation: result.allocation,
      };
    } catch (err) {
      // A card may have been allocated and durably written before THIS
      // error fired (e.g. FIT_OVERSET, discovered only after `#allocateCard`
      // already ran) — `RenderPrintDocument` attaches that snapshot to
      // `err.details.allocation` for exactly this reason (see its own doc
      // comment). Absent for a failure that happened before any write (e.g.
      // ALLOCATION_STORE_REQUIRED/ALLOCATION_REQUIRES_REV), in which case
      // `#orphanAllocation` is a no-op.
      await this.#orphanAllocation(err.details?.allocation, { sessionId, unitId: state.unitId, stage: 'render' });
      return this.#recordFailure({
        sessionId, stage: 'render', reason: err.message, nowIso, state,
        cause: err.name === 'UnresolvedAssetError' ? 'missing_artwork' : 'render',
      });
    }

    try {
      await this.#printer.printPdf(rendered.pdf, {
        jobName: `school-${state.unitId}-${artifactId}`,
        user: state.learnerId ?? 'daylight',
      });
    } catch (err) {
      // Render already succeeded here, so the allocation (if any) is right
      // on `rendered.allocation` — no error-detail plumbing needed for this
      // branch the way the render-failure one above needs it.
      await this.#orphanAllocation(rendered.allocation, { sessionId, unitId: state.unitId, stage: 'print' });
      return this.#recordFailure({ sessionId, stage: 'print', reason: err.message, nowIso, state, cause: 'printer' });
    }

    // Same slot the legacy path writes its form map in — see this method's
    // own doc comment on why the write itself already happened, earlier,
    // inside `renderPrintDocument.execute` above.
    if (rendered.allocation) {
      this.#logger.info?.('school.issue.allocation-recorded', {
        sessionId,
        unitId: state.unitId,
        artifactId,
        cardId: rendered.allocation.cardId,
        recordId: rendered.allocation.recordId,
        rowRange: rendered.allocation.rowRange,
      });
    }

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
      formMap: null,
      // Not on the legacy return shape (which has no card concept) — additive,
      // so a caller not yet reading it sees nothing new. Callers include
      // ResolveScanAction/receipts, none of which read this field today.
      allocation: rendered.allocation ?? null,
      document: null,
      message: reprinting ? 'Printing that again for you.' : 'Printing your sheet.',
    };
  }

  /**
   * Best-effort cleanup for a card that was durably allocated but whose
   * render/print never completed (Task 7 review, Finding 2). `allocation`
   * is the `{cardId, rowRange, recordId, status}` snapshot — absent (no-op)
   * whenever nothing was actually written yet.
   *
   * Two things happen, and the FIRST never depends on the second: the
   * cardId/recordId are logged at `warn` unconditionally, because a grown-up
   * (or a future debugging session) needs to be able to find a stranded card
   * even if the release itself also fails — a silent release failure must
   * never also mean a silent orphan. `release` failing (e.g. the store is
   * unreachable) is itself logged, never thrown — this runs from inside an
   * already-failed issue attempt, and a SECOND failure here must not replace
   * the FIRST one in what gets reported back to the child.
   */
  async #orphanAllocation(allocation, { sessionId, unitId, stage }) {
    if (!allocation) return;
    this.#logger.warn?.('school.issue.allocation-orphaned', {
      sessionId, unitId, stage, cardId: allocation.cardId, recordId: allocation.recordId, rowRange: allocation.rowRange,
    });
    if (typeof this.#allocationStore?.release !== 'function') return;
    try {
      const released = await this.#allocationStore.release({ cardId: allocation.cardId, rows: allocation.rowRange });
      this.#logger.warn?.('school.issue.allocation-released', {
        sessionId, cardId: allocation.cardId, recordId: allocation.recordId, releasedCount: released.length,
      });
    } catch (err) {
      this.#logger.warn?.('school.issue.allocation-release-failed', {
        sessionId, cardId: allocation.cardId, recordId: allocation.recordId, error: err.message,
      });
    }
  }

  /**
   * Record the failure as an ANNOTATION (state does not advance, so the ticket
   * in the child's hand stays valid) and hand back a slip with a fresh recovery
   * ticket. Never throws — §9's whole point is that a failed print is a retry,
   * not a dead end.
   *
   * The slip says which thing broke. A message that misidentifies the cause is
   * worse than none: "the printer is not answering" over a document that could
   * not be DRAWN sends a grown-up to check paper and cables while the real
   * problem — a missing diagram — sits in the curriculum, and every retry fails
   * the same way with the same wrong explanation.
   */
  async #recordFailure({ sessionId, stage, reason, nowIso, state, cause = 'printer' }) {
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

    const copy = FAILURE_COPY[cause] ?? FAILURE_COPY.printer;
    return {
      status: copy.status,
      sessionId,
      artifactId: state.issuedArtifacts.at(-1) ?? null,
      pageCount: null,
      tokens: {},
      message: copy.message,
      document: noticeDocument({
        id: `${copy.slipId}-${sessionId}`,
        headline: copy.headline,
        lines: copy.lines,
        actions: recovery ? [{ token: recovery, label: copy.actionLabel }] : [],
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
