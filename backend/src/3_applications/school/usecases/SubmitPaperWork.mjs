/**
 * SubmitPaperWork — a sheet of paper comes back (spec §7.1, §7.3).
 *
 * It does exactly one thing: work out, item by item, WHAT CAN HONESTLY BE
 * SCORED. Everything else — a smudged bubble row, an empty one, a written answer
 * with no bank item behind it — goes to a person. The engine grades what it can
 * genuinely grade and nothing more, because a machine that guesses at an
 * ambiguous mark produces a score that looks exactly like a real one.
 *
 * The denominator comes from the DOCUMENT, not from the submission: a six
 * question sheet is out of six whether or not six answers came back. An
 * unanswered question is therefore unresolved, not wrong — a child who skipped
 * it and a child whose eraser smudged both get a grown-up, which is the right
 * outcome for both.
 *
 * WHAT EACH REVIEW ITEM SAYS. A queued item carries the QUESTION (`prompt`,
 * plus the `questionNumber` printed beside it) and, separately, the unit's
 * whole-sheet marking RUBRIC. Those were one field once, holding the rubric, so
 * a parent marking six questions read the same sentence six times with nothing
 * to tell them apart. The question text comes from the bank item where there is
 * one, and otherwise from the printed document — a rubric-graded worksheet has
 * no bank at all, and that is exactly the sheet a person has to read.
 *
 * OMR is a feeder, not a second pipeline (§7.3). `fromOmrSheet` decodes column
 * masks against the stored form map and then goes through the same `execute`.
 *
 * WHERE THE DENOMINATOR COMES FROM, precisely. A printed `document` states its
 * own questions. A unit with a `bank` and no `document` states nothing — its
 * sheet was SAMPLED from the bank at issue time and frozen as a worksheet
 * instance, so that instance is the sheet and the bank is only what it was
 * drawn from. Reading the bank back here turned every item the sampler left off
 * into a `blank` for a grown-up to mark: questions the child was never asked,
 * on a list nobody could ever clear.
 */
import { reduceSession, createEvent } from '#domains/school/sessions/sessionEvents.mjs';
import { questionItemIds, questionPrompts } from '#domains/school/documents/documentValidation.mjs';
import { decodeOmrSheet } from '#domains/school/documents/omrForm.mjs';
import { noticeDocument } from '#domains/school/documents/receipts.mjs';
import { worksheetInstanceRoster } from '#domains/school/questionBankV2.mjs';
import { COMPANION_GATE_ITEM_ID } from '#domains/school/companionCode.mjs';

/** States from which handing work in is a legal move. */
const SUBMITTABLE = new Set(['issued', 'reprinted', 'media_completed']);
/** States that mean it has already been handed in. */
const ALREADY_IN = new Set(['submitted', 'graded', 'outcome_recorded', 'rewarded', 'remediation_opened']);

export class SubmitPaperWork {
  #curriculum; #sessions; #formMaps; #reviewQueue; #bankReader; #worksheetInstances; #clock; #logger;

  /**
   * @param {object} deps
   * @param {import('../CurriculumAccess.mjs').CurriculumAccess} deps.curriculum
   * @param {import('../ports/IWorkSessionRepository.mjs').IWorkSessionRepository} deps.sessions
   * @param {import('../ports/IFormMapStore.mjs').IFormMapStore} deps.formMaps
   * @param {import('../ports/IReviewQueue.mjs').IReviewQueue} deps.reviewQueue
   * @param {{getBank: (id: string) => object|null}} [deps.bankReader]
   * @param {{findBySession: (sessionId: string) => Promise<object|null>}|null}
   *   [deps.worksheetInstances] - the issued sheets. OPTIONAL and read-only:
   *   unwired, or with no instance on file, the bank stays the roster exactly
   *   as it was before instances existed.
   * @param {() => Date} [deps.clock]
   * @param {object} [deps.logger]
   */
  constructor({
    curriculum, sessions, formMaps, reviewQueue, bankReader = null,
    worksheetInstances = null, clock = () => new Date(), logger = console,
  } = {}) {
    if (!curriculum || !sessions || !formMaps || !reviewQueue) {
      throw new Error('SubmitPaperWork requires curriculum, sessions, formMaps and reviewQueue');
    }
    this.#curriculum = curriculum;
    this.#sessions = sessions;
    this.#formMaps = formMaps;
    this.#reviewQueue = reviewQueue;
    this.#bankReader = bankReader;
    this.#worksheetInstances = worksheetInstances;
    this.#clock = clock;
    this.#logger = logger;
  }

  /**
   * @param {object} args
   * @param {string} args.sessionId
   * @param {Record<string,*>} [args.entries] - itemId → what the child wrote/marked
   * @param {string[]} [args.ambiguous] - itemIds the reader could not resolve
   * @param {string[]} [args.blank] - itemIds with no mark at all
   * @param {string} [args.submittedBy]
   * @returns {Promise<{ status: 'submitted'|'duplicate'|'unavailable',
   *                     sessionId: string, expectedItems: string[],
   *                     scorable: Record<string,*>, review: object[],
   *                     message: string, document: object|null, pointsAt?: object }>}
   */
  async execute({ sessionId, entries = {}, ambiguous = [], blank = [], submittedBy = null } = {}) {
    // THIS LANE CANNOT ENFORCE A GATE, SO IT REFUSES TO SEE ONE.
    //
    // Grading here is exactly `questionItemIds(document)`, which skips the gate
    // row by design, and nothing else in this file reads one. A gate entry that
    // arrived would therefore be decoded and DISCARDED — the sheet ungated and
    // passing on score alone, with nobody told. The card lane (`ResolveCardScan`)
    // is where a gate is actually read and vetoed.
    //
    // Unreachable today: every worksheet-instance render is card-backed, and
    // `DocumentPdfRenderer` pushes form-map marks only when a render is not, so
    // gate marks never reach a form map. That is why this THROWS rather than
    // degrading politely — the day someone makes that lane reachable, it must
    // fail loudly instead of ungating a sheet in silence.
    if (entries && Object.prototype.hasOwnProperty.call(entries, COMPANION_GATE_ITEM_ID)) {
      this.#logger.error?.('school.submit.companion-gate-unenforceable', { sessionId, submittedBy });
      throw new Error(`SubmitPaperWork cannot enforce a companion gate: session '${sessionId}' handed in a '${COMPANION_GATE_ITEM_ID}' entry this lane would discard`);
    }
    const nowIso = this.#clock().toISOString();
    const state = reduceSession(await this.#sessions.readEvents(sessionId));
    if (!state.sessionId) return this.#unavailable(sessionId, 'We could not find that work.');

    if (ALREADY_IN.has(state.state)) {
      // The matrix row: a second submission is rejected and POINTS AT the
      // existing result rather than starting a parallel one.
      this.#logger.info?.('school.submit.duplicate', { sessionId, state: state.state });
      return {
        status: 'duplicate',
        sessionId,
        expectedItems: [],
        scorable: {},
        review: [],
        message: 'That work is already handed in.',
        document: null,
        pointsAt: {
          state: state.state,
          attemptIds: state.attemptIds,
          gradedPercent: state.gradedPercent,
          outcome: state.outcome,
        },
      };
    }
    if (!SUBMITTABLE.has(state.state)) {
      return this.#unavailable(sessionId, 'There is nothing to hand in yet. Scan your ticket to print your sheet.');
    }

    const unit = await this.#curriculum.getUnit(state.unitId);
    const document = unit?.document ? await this.#curriculum.getDocument(unit.document) : null;
    const bank = unit?.bank ? (this.#bankReader?.getBank(unit.bank) ?? null) : null;
    // The sheet the child actually received, when one was frozen for this
    // session (see the note at the top of the file). `null` — no store, or no
    // instance — leaves the bank as the roster, unchanged.
    const roster = document
      ? null
      : worksheetInstanceRoster(await this.#worksheetInstances?.findBySession?.(sessionId) ?? null);
    const expectedItems = document
      ? questionItemIds(document)
      : (roster ?? (bank?.items ?? []).map((i) => i.id));
    if (!expectedItems.length) {
      return this.#unavailable(sessionId, 'There are no questions to mark on that one. Tell a grown-up.');
    }

    const bankItemIds = new Set((bank?.items ?? []).map((i) => i.id));
    const ambiguousSet = new Set(ambiguous);
    const blankSet = new Set(blank);

    // What was asked, and how this unit says to mark it — two separate fields.
    const bankPrompts = new Map((bank?.items ?? []).map((i) => [i.id, i.prompt ?? null]));
    const printed = questionPrompts(document);
    const rubric = typeof unit?.review?.rubric === 'string' ? unit.review.rubric : null;

    const scorable = {};
    const review = [];
    expectedItems.forEach((itemId) => {
      const given = entries?.[itemId];
      const reason = (() => {
        if (ambiguousSet.has(itemId)) return 'ambiguous';
        if (blankSet.has(itemId) || given === undefined || given === null || given === '') return 'blank';
        // No bank behind the item means nothing to compare against: a written
        // sentence is not a wrong answer, it is an unscored one.
        if (!bankItemIds.has(itemId)) return 'free_response';
        return null;
      })();
      if (reason) {
        review.push({
          sessionId, itemId, learnerId: state.learnerId, unitId: state.unitId,
          reason, given: given ?? null,
          prompt: bankPrompts.get(itemId) ?? printed.get(itemId)?.prompt ?? null,
          questionNumber: printed.get(itemId)?.number ?? null,
          rubric,
          enqueuedAt: nowIso,
        });
        return;
      }
      scorable[itemId] = given;
    });

    if (review.length) await this.#reviewQueue.enqueue(review);

    const { errors, event } = createEvent({ type: 'submitted', at: nowIso, sessionId, transport: 'paper' });
    if (errors.length) throw new Error(`SubmitPaperWork: could not record the submission: ${errors.join('; ')}`);
    await this.#sessions.appendEvent(sessionId, event);

    this.#logger.info?.('school.submit.received', {
      sessionId, unitId: state.unitId, submittedBy,
      scorable: Object.keys(scorable).length, review: review.length,
    });

    return {
      status: 'submitted',
      sessionId,
      expectedItems,
      scorable,
      review,
      message: review.length ? 'Handed in. A grown-up will check some of it.' : 'Handed in.',
      document: null,
    };
  }

  /**
   * Read a bubble sheet against the form map that produced the paper, then
   * submit it. The reader's masks never reach the grading engine directly —
   * meaning lives on this side of the wire.
   *
   * @param {object} args
   * @param {string} args.sessionId
   * @param {{marks: number[]}} args.sheet - the reader's normalised event
   * @param {string} [args.submittedBy]
   * @returns {Promise<object>} the `execute` result, or an explanation
   */
  async fromOmrSheet({ sessionId, sheet, submittedBy = null } = {}) {
    const state = reduceSession(await this.#sessions.readEvents(sessionId));
    if (!state.sessionId) return this.#unavailable(sessionId, 'We could not find that work.');

    const artifactId = state.issuedArtifacts.at(-1) ?? null;
    const formMap = artifactId ? await this.#formMaps.get(artifactId) : null;
    if (!formMap) {
      this.#logger.warn?.('school.submit.no-form-map', { sessionId, artifactId });
      return this.#unavailable(sessionId, 'We could not match that sheet to your work. Tell a grown-up.');
    }

    const decoded = decodeOmrSheet({ formMap, sheet });
    if (decoded.errors.length) {
      this.#logger.warn?.('school.submit.omr-decode-failed', { sessionId, artifactId, errors: decoded.errors });
      return this.#unavailable(sessionId, 'That sheet did not read properly. Tell a grown-up.');
    }

    return this.execute({
      sessionId, entries: decoded.entries, ambiguous: decoded.ambiguous, blank: decoded.blank, submittedBy,
    });
  }

  #unavailable(sessionId, line) {
    return {
      status: 'unavailable',
      sessionId: sessionId ?? null,
      expectedItems: [],
      scorable: {},
      review: [],
      message: line,
      document: noticeDocument({
        id: `submit-${sessionId ?? 'none'}`,
        headline: 'We could not take that in',
        lines: [line, 'Scan your card for a new list.'],
      }),
    };
  }
}

export default SubmitPaperWork;
