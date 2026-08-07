/**
 * GradeSubmission — mark what came back, through the ONE grading engine
 * (spec §7.1).
 *
 * Paper answers become the same `answer` calls the on-screen quiz makes: same
 * bank, same `gradeAnswer`, same attempt record, with one additive field —
 * `transport: 'paper'`. There is no second scoring path to keep in step, and
 * "paper earns nothing the screen couldn't" is a structural fact rather than a
 * promise.
 *
 * What a machine cannot score, a person does. Parent verdicts on review items
 * are recorded in the queue with `gradedBy`, NOT laundered into bank attempts:
 * a grown-up's judgement of a written sentence is a different kind of evidence
 * from a server-graded multiple choice, and merging them would make the second
 * indistinguishable from the first in every later report.
 *
 * The session only reaches `graded` when EVERY question on the sheet has a
 * verdict. Until then it sits at `submitted`, whose printed next action is "a
 * grown-up will check this" — waiting, not wedged.
 *
 * A PERSON'S VERDICT NEEDS A PERSON. `gradedBy` overrides the engine and is
 * written into the durable verdict sheet, so it is authority rather than a
 * label — and it arrives from an HTTP body. Any call carrying `verdicts` is
 * therefore checked against the household roster before a single one is
 * recorded. A sheet the ENGINE marks needs no identity: nobody is claiming
 * anything.
 */
import { reduceSession, createEvent } from '#domains/school/sessions/sessionEvents.mjs';
import { questionItemIds, questionPrompts } from '#domains/school/documents/documentValidation.mjs';
import { PRINT_DOCUMENT_REF_PATTERN } from '#domains/school/curriculum/unitValidation.mjs';

export class GradeSubmission {
  #curriculum; #sessions; #reviewQueue; #grader; #bankReader; #grownUps; #teacherGate; #clock; #logger; #passOverrides;

  /**
   * @param {object} deps
   * @param {import('../CurriculumAccess.mjs').CurriculumAccess} deps.curriculum
   * @param {import('../ports/IWorkSessionRepository.mjs').IWorkSessionRepository} deps.sessions
   * @param {import('../ports/IReviewQueue.mjs').IReviewQueue} deps.reviewQueue
   * @param {{openSession: Function, answer: Function}} deps.grader - `SchoolService`;
   *   the existing engine, injected rather than reimplemented
   * @param {{getBank: (id: string) => object|null}} [deps.bankReader]
   * @param {import('../GrownUpGate.mjs').GrownUpGate} deps.grownUps - who may
   *   hand down a verdict; required, because a gate that can be left out is a
   *   gate that will be
   * @param {import('../TeacherGate.mjs').TeacherGate|null} [deps.teacherGate] -
   *   readiness punch 2 (console PIN). ADDITIVE, not a replacement: `grownUps`
   *   below always runs first and is never skipped, so a pre-console install
   *   (or a test with no gate wired) keeps its exact legacy behavior. When
   *   wired, the console PIN is asked ON TOP of the grown-up check, and ONLY
   *   for a call that actually carries a person's verdicts — the self-closing
   *   finisher (`execute({sessionId})`, no verdicts) is already behind the
   *   gated resolve that triggered it and must never re-assert.
   * @param {() => Date} [deps.clock]
   * @param {object} [deps.logger]
   */
  constructor({
    curriculum, sessions, reviewQueue, grader, bankReader = null, grownUps = null, teacherGate = null,
    passOverrides = null, clock = () => new Date(), logger = console,
  } = {}) {
    if (!curriculum || !sessions || !reviewQueue || !grader) {
      throw new Error('GradeSubmission requires curriculum, sessions, reviewQueue and grader');
    }
    if (!grownUps) throw new Error('GradeSubmission requires grownUps (a GrownUpGate)');
    this.#curriculum = curriculum;
    this.#sessions = sessions;
    this.#reviewQueue = reviewQueue;
    this.#grader = grader;
    this.#bankReader = bankReader;
    this.#grownUps = grownUps;
    this.#teacherGate = teacherGate;
    this.#clock = clock;
    this.#logger = logger;
    this.#passOverrides = passOverrides;
  }

  /**
   * @param {object} args
   * @param {string} args.sessionId
   * @param {Record<string,*>} [args.entries] - itemId → given, for machine grading
   * @param {Record<string,'correct'|'incorrect'>} [args.verdicts] - a person's marks
   * @param {string} [args.gradedBy] - the roster id of the grown-up who marked
   *   the review items; required (and checked) whenever `verdicts` is non-empty
   * @param {string|null} [args.pin] - the console PIN, consulted only when a
   *   `teacherGate` is wired AND a human verdict is present
   * @returns {Promise<{ status: 'graded'|'awaiting_review'|'duplicate'|'unavailable',
   *                     sessionId: string, percent: number|null, correct: number,
   *                     expected: number, attemptIds: string[], outstanding: string[],
   *                     message: string, pointsAt?: object }>}
   */
  async execute({
    sessionId, entries = {}, verdicts = {}, gradedBy = null, pin = null,
  } = {}) {
    // Before anything is read, let alone written: a human verdict is a claim of
    // authority over a child's work, and this is the only place it can be
    // checked once for every caller — HTTP, a scan, or a reconciliation job.
    if (Object.values(verdicts ?? {}).some((v) => v === 'correct' || v === 'incorrect')) {
      this.#grownUps.assert(gradedBy, 'Only a grown-up can mark a child\'s work', {
        action: 'grade.verdicts', sessionId,
      });
      // The console PIN rides ON TOP of the grown-up rule, not instead of it —
      // and only for THIS lane (a person's verdicts on the call). The
      // finisher (no verdicts) skips this whole block, gate or no gate.
      if (this.#teacherGate) {
        this.#teacherGate.assert({
          userId: gradedBy, pin, action: 'sessions.grade', context: { sessionId },
        });
      }
    }

    const nowIso = this.#clock().toISOString();
    const state = reduceSession(await this.#sessions.readEvents(sessionId));
    if (!state.sessionId) return this.#unavailable(sessionId, 'We could not find that work.');

    if (state.state !== 'submitted') {
      if (state.gradedPercent !== null) {
        // Already marked: point at the result rather than marking it twice.
        this.#logger.info?.('school.grade.duplicate', { sessionId, state: state.state });
        return {
          status: 'duplicate',
          sessionId,
          percent: state.gradedPercent,
          correct: 0,
          expected: 0,
          attemptIds: state.attemptIds,
          outstanding: [],
          message: 'That work has already been marked.',
          pointsAt: { attemptIds: state.attemptIds, gradedPercent: state.gradedPercent, outcome: state.outcome },
        };
      }
      return this.#unavailable(sessionId, 'That work has not been handed in yet.');
    }

    const unit = await this.#curriculum.getUnit(state.unitId);
    const document = unit?.document ? await this.#curriculum.getDocument(unit.document) : null;
    const bank = unit?.bank ? (this.#bankReader?.getBank(unit.bank) ?? null) : null;
    // A `print/<id>@<rev>` document ref (spec §9, Task 7) names a print-time
    // artefact, not a catalog document — there is nothing for `getDocument`
    // above to resolve, and a print unit carries no `bank` either. The review
    // queue IS the verdict sheet for a card-scanned print document: the scan
    // bridge (`RecordCardScanOutcome`) enqueues every machine mark (resolved)
    // and every human-needed item (pending) as it reads the card, so the set
    // of queue itemIds is exactly the roster the printed sheet carried —
    // including whatever a bank-select expansion put on it, which no static
    // document walk could reproduce.
    const isPrintUnit = typeof unit?.document === 'string' && PRINT_DOCUMENT_REF_PATTERN.test(unit.document);
    // Single read of the session's queue: it is both the print-unit roster
    // (below) and, for every unit type, the record of verdicts already on
    // file (`marked`, further down) — and for a print unit it is also the
    // ONLY place the genuine scan attempt ids live (each queue item's own
    // `attemptId`, filed by `RecordCardScanOutcome` off the physical scan),
    // so re-reading it separately per use risked the roster and the
    // attempt-id collection disagreeing on what the queue held.
    const queueItemsForSession = await this.#reviewQueue.listForSession(sessionId);
    const expectedItems = isPrintUnit
      ? [...new Set(queueItemsForSession.map((item) => item.itemId))]
      : (document ? questionItemIds(document) : (bank?.items ?? []).map((i) => i.id));
    if (!expectedItems.length) return this.#unavailable(sessionId, 'There are no questions to mark on that one.');

    // --- verdicts already on record ------------------------------------------
    // Marking a paper sheet is not one moment: the engine can mark the bubbles
    // now and a parent may read the written answers tomorrow. The review queue
    // is therefore the durable per-item verdict sheet for the whole submission —
    // machine marks included — so the second call can see what the first decided
    // without the caller having to re-send a sheet it no longer holds.
    const marked = new Map();
    queueItemsForSession
      .filter((item) => item.verdict === 'correct' || item.verdict === 'incorrect')
      .forEach((item) => marked.set(item.itemId, item.verdict === 'correct'));

    // --- a person's verdicts -------------------------------------------------
    for (const [itemId, verdict] of Object.entries(verdicts)) {
      if (verdict !== 'correct' && verdict !== 'incorrect') continue;
      // eslint-disable-next-line no-await-in-loop
      const resolved = await this.#reviewQueue.resolve({ sessionId, itemId, verdict, gradedBy, at: nowIso });
      // A verdict on something that was never queued still counts — a parent
      // may mark a question the machine thought it could score.
      marked.set(itemId, verdict === 'correct');
      if (!resolved) this.#logger.debug?.('school.grade.verdict-unqueued', { sessionId, itemId });
    }

    // --- the engine ----------------------------------------------------------
    const bankItemIds = new Set((bank?.items ?? []).map((i) => i.id));
    const gradable = Object.entries(entries).filter(([itemId, given]) => (
      bankItemIds.has(itemId) && !marked.has(itemId) && given !== undefined && given !== null && given !== ''
    ));

    // A machine mark is recorded in the same durable verdict sheet a parent
    // reads, so it carries the same two fields: what was asked, and how the
    // unit says to mark it. Without them the record reads differently depending
    // on who marked it.
    const bankPrompts = new Map((bank?.items ?? []).map((i) => [i.id, i.prompt ?? null]));
    const printedQuestions = questionPrompts(document);
    const rubric = typeof unit?.review?.rubric === 'string' ? unit.review.rubric : null;

    const attemptIds = [...state.attemptIds];
    if (gradable.length) {
      const { sessionId: quizSessionId } = this.#grader.openSession({
        userId: state.learnerId, bankId: unit.bank, mode: 'quiz',
      });
      const machineMarks = [];
      for (const [itemId, given] of gradable) {
        // `quizSessionId` is a throwaway grader session opened fresh above —
        // it never appears anywhere else. The WORK session (`sessionId`, this
        // execute()'s own argument) is what a parent handed in and what the
        // review queue and evidence readers key off of, so it travels in
        // provenance rather than being lost once the disposable one takes
        // over `sessionId` on the recorded attempt.
        const result = this.#grader.answer({
          sessionId: quizSessionId, itemId, given, transport: 'paper',
          provenance: { kind: 'review-grade', workSessionId: sessionId },
        });
        marked.set(itemId, result.correct === true);
        if (result.attemptId) attemptIds.push(result.attemptId);
        machineMarks.push({
          sessionId, itemId, learnerId: state.learnerId, unitId: state.unitId,
          reason: 'machine', given,
          prompt: bankPrompts.get(itemId) ?? printedQuestions.get(itemId)?.prompt ?? null,
          questionNumber: printedQuestions.get(itemId)?.number ?? null,
          rubric,
          enqueuedAt: nowIso,
          verdict: result.correct === true ? 'correct' : 'incorrect',
          gradedBy: 'engine', gradedAt: nowIso, attemptId: result.attemptId ?? null,
        });
      }
      // Recorded already-resolved, so they never appear in a parent's pending
      // queue — the queue is a verdict sheet here, not a to-do list.
      await this.#reviewQueue.enqueue(machineMarks);
    }

    // --- the score -----------------------------------------------------------
    const outstanding = expectedItems.filter((itemId) => !marked.has(itemId));
    const correct = expectedItems.filter((itemId) => marked.get(itemId) === true).length;
    const percent = Math.round((correct / expectedItems.length) * 10000) / 100;

    if (outstanding.length) {
      this.#logger.info?.('school.grade.awaiting-review', { sessionId, outstanding });
      return {
        status: 'awaiting_review',
        sessionId,
        percent: null,
        correct,
        expected: expectedItems.length,
        attemptIds,
        outstanding,
        message: 'A grown-up still has some of this to check.',
      };
    }

    // `graded` needs at least one attempt id; a wholly parent-marked sheet has
    // none, so the session itself stands in as the evidence pointer. Inventing a
    // fake attempt id would put un-earned rows in the attempt log.
    //
    // For a print unit specifically, `attemptIds` above is the wrong source:
    // it only ever gains entries from THIS call's own engine-graded loop
    // (`gradable`, filtered to `bankItemIds` — a print unit carries no
    // `bank`, so that loop never runs for one), while the genuine scan
    // attempt ids live on the queue items themselves (`attemptId`, filed by
    // `RecordCardScanOutcome` off the physical scan). Using the synthetic
    // `review:<sessionId>` id instead would discard those real ids, so a
    // print unit prefers them, falling back to the synthetic only when the
    // queue carries none.
    const printAttemptIds = isPrintUnit
      ? [...new Set(queueItemsForSession.map((item) => item.attemptId).filter(Boolean))]
      : [];
    const recordedAttempts = isPrintUnit
      ? (printAttemptIds.length ? printAttemptIds : [`review:${sessionId}`])
      : (attemptIds.length ? attemptIds : [`review:${sessionId}`]);
    // Stamp the bar IN EFFECT now (student-advocacy A4): the close prefers
    // this over a later override edit — the bar cannot move under a kid who
    // has already been graded.
    const effectivePassingPercent = this.#passOverrides?.percentFor?.(state.unitId)
      ?? unit?.passing?.percent;
    const { errors, event } = createEvent({
      type: 'graded', at: nowIso, sessionId, attemptIds: recordedAttempts, percent,
      ...(typeof effectivePassingPercent === 'number' ? { passingPercent: effectivePassingPercent } : {}),
    });
    if (errors.length) throw new Error(`GradeSubmission: could not record the grade: ${errors.join('; ')}`);
    await this.#sessions.appendEvent(sessionId, event);

    this.#logger.info?.('school.grade.recorded', {
      sessionId, unitId: state.unitId, percent, correct, expected: expectedItems.length, gradedBy,
    });

    return {
      status: 'graded',
      sessionId,
      percent,
      passingPercent: typeof effectivePassingPercent === 'number' ? effectivePassingPercent : null,
      correct,
      expected: expectedItems.length,
      attemptIds: recordedAttempts,
      outstanding: [],
      message: `Marked: ${correct} of ${expectedItems.length}.`,
    };
  }

  #unavailable(sessionId, message) {
    return {
      status: 'unavailable',
      sessionId: sessionId ?? null,
      percent: null,
      correct: 0,
      expected: 0,
      attemptIds: [],
      outstanding: [],
      message,
    };
  }
}

export default GradeSubmission;
