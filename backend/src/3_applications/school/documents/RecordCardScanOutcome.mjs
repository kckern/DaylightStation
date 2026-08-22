/**
 * RecordCardScanOutcome — a graded card scan becomes DURABLE evidence
 * (review wave B1: "grades go nowhere").
 *
 * `ResolveCardScan` grades; this use case records. Two obligations, the
 * first never conditional on the second:
 *
 * 1. ATTEMPTS (always, when the scan is attributable): every graded row is
 *    appended to the learner's append-only attempt log — the SAME
 *    `createAttempt` shape and the SAME `users/{id}/apps/school/attempts/`
 *    store the on-screen quiz engine writes (`SchoolService#answer`), with
 *    `transport: 'paper'` and a `provenance` block carrying the card/record
 *    identity. Every progress/evidence reader that understands screen
 *    attempts therefore understands scan attempts for free.
 *
 *    IDEMPOTENT PER (record, answers): re-feeding the identical card through
 *    the scanner writes nothing new — the attempt log must reflect work
 *    done, not how many times paper went through a roller. A re-scan with
 *    DIFFERENT answers on an already-settled record (`reScored`) is recorded
 *    (the marks are real evidence) but never silently: the caller's own
 *    warn (`schoolPrintScanConsumer`) plus the fresh scanKey make the repeat
 *    visible.
 *
 * 2. SESSION BRIDGE (when the allocation record carries a `sessionId` —
 *    IssueDocument's tracked-quiz path): the work session advances
 *    `issued/reprinted → submitted → graded` through the SAME
 *    `sessionEvents` lifecycle every other transport uses, so
 *    `CloseSessionOutcome` (outcome, rewards, remediation) can run. Only a
 *    COMPLETE scan advances the session — a partial feed (blank owned rows)
 *    records its attempts and waits: the allocation record stayed `live`
 *    (`ResolveCardScan`'s partial-coverage rule), so the child re-feeds a
 *    finished card and THAT scan advances the session with every row present.
 *    A session already at/past `graded` is never advanced twice.
 *
 *    REVIEW QUEUE (when wired): a complete scan does not always mean the work
 *    is DONE — an ambiguous bubble row or a write-on question a bank cannot
 *    score still needs a person. Every row becomes a verdict-sheet entry
 *    (`IReviewQueue`, the same shape `GradeSubmission` writes): correct/
 *    incorrect rows are RESOLVED (`gradedBy: 'engine'`), ambiguous rows and
 *    `unscannedItems` (write-ons) are PENDING. Anything pending holds the
 *    session at `submitted` — never `graded` — until a grown-up clears it
 *    through `GradeSubmission`, which reads that same queue as the sheet's
 *    roster for a print-document unit.
 */
import { reduceSession, createEvent } from '#domains/school/sessions/sessionEvents.mjs';
import { createAttempt } from '#domains/school/attempt.mjs';

/** Session states from which this bridge may advance toward `graded`. */
const BRIDGEABLE = new Set(['issued', 'reprinted', 'submitted']);

/** Deterministic content key for one scan of one record — the idempotency unit. */
export function scanKey(card) {
  const rows = [...card.results]
    .sort((a, b) => a.row - b.row)
    .map((row) => `${row.row}:${JSON.stringify(row.given)}:${row.status}`);
  return `${card.recordId}|${rows.join('|')}`;
}

/** `YYYY-MM-DDTHH:mm:ss...` -> `YYYY-MM-DD`, or null for anything else. */
function dayOf(iso) {
  return typeof iso === 'string' && iso.length >= 10 ? iso.slice(0, 10) : null;
}

export class RecordCardScanOutcome {
  #datastore; #sessions; #reviewQueue; #clock; #logger;

  /**
   * @param {object} deps
   * @param {{appendAttempt: Function, readAllAttempts: Function,
   *   readAttemptsInRange?: Function}} deps.datastore -
   *   `YamlSchoolDatastore`-shaped: the canonical per-learner attempt log.
   *   `readAttemptsInRange` is optional — when present, the dedup read below
   *   uses it to scope the scan to `[card.renderedAt's day, today]` instead
   *   of parsing the learner's entire history; without it (or for a legacy
   *   card with no `renderedAt`) the dedup read falls back to a full scan.
   * @param {{readEvents: Function, appendEvent: Function}} [deps.sessions] -
   *   `IWorkSessionRepository`-shaped; optional — without it (or for a scan
   *   whose record carries no sessionId) only attempts are recorded.
   * @param {import('../ports/IReviewQueue.mjs').IReviewQueue} [deps.reviewQueue] -
   *   optional — without it the bridge degrades to wave-1 behavior (a complete
   *   scan always reaches `graded`, even when a row was ambiguous or a question
   *   went unscanned). With it wired, every graded row becomes a RESOLVED
   *   verdict-sheet entry and every ambiguous/write-on row becomes a PENDING
   *   one, and the session holds at `submitted` until a person clears the
   *   pending ones through `GradeSubmission`.
   * @param {() => Date} [deps.clock]
   * @param {object} [deps.logger]
   */
  constructor({
    datastore, sessions = null, reviewQueue = null, clock = () => new Date(), logger = console,
  } = {}) {
    if (!datastore?.appendAttempt) throw new Error('RecordCardScanOutcome requires datastore.appendAttempt');
    this.#datastore = datastore;
    this.#sessions = sessions;
    this.#reviewQueue = reviewQueue;
    this.#clock = clock;
    this.#logger = logger;
  }

  /**
   * @param {{testId: string, card: object, cardIdInferred?: {pattern: string, cardId: string}|null}} args -
   *   `card` is ONE graded entry from `ResolveCardScan.execute().results`
   *   (never a drift-error entry). `cardIdInferred` is that SAME `execute()`
   *   call's top-level diagnostic (present only when `testId` itself needed
   *   best-effort resolution) — threaded down so the permanent evidence
   *   record, not just the transient log stream, can tell a read id from an
   *   inferred one (household direction: "the resolution must be visible,
   *   not silently substituted" — a log line rotates away, an attempt record
   *   does not).
   * @returns {Promise<{recorded: boolean, reason?: string, attemptIds?: string[],
   *   session?: {sessionId: string, advancedTo: string|null, reason?: string}}>}
   */
  async execute({ testId, card, cardIdInferred = null } = {}) {
    if (!card || card.error || !Array.isArray(card.results)) {
      return { recorded: false, reason: 'not-a-graded-result' };
    }
    // One composed allocation can carry several lesson sessions. Resolve and
    // record each immutable section as if it had been printed alone, while
    // retaining the shared card/record provenance for deduplication. This is
    // also what lets a re-scan advance lesson A after its rows are complete
    // without waiting for the learner to finish lesson B on the same card.
    if (Array.isArray(card.sections) && card.sections.length > 0) {
      const sectionOutcomes = [];
      for (const section of card.sections) {
        // eslint-disable-next-line no-await-in-loop
        sectionOutcomes.push(await this.execute({
          testId,
          card: {
            ...card,
            sections: undefined,
            results: section.results,
            totalPoints: section.totalPoints,
            earnedPoints: section.earnedPoints,
            sessionId: section.sessionId ?? null,
            subjectId: section.subjectId ?? null,
            courseId: section.courseId ?? null,
            lessonId: section.lessonId ?? null,
            sectionId: section.id,
          },
          cardIdInferred,
        }));
      }
      return {
        recorded: sectionOutcomes.some((outcome) => outcome.recorded),
        sectionOutcomes,
      };
    }
    const learnerId = card.learnerId ?? null;
    if (learnerId == null) {
      // An anonymous allocation (worksheet, or a legacy pre-binding card):
      // there is no learner to credit. The consumer's scan-resolved log line
      // remains the only record — loudly, since a QUIZ should never get here
      // once the print route enforces learner binding.
      this.#logger.warn?.('school.print.scan-unattributed', {
        testId, recordId: card.recordId, documentId: card.documentId,
      });
      return { recorded: false, reason: 'unattributed' };
    }

    // ZERO ROWS RESOLVED — a fault, not a duplicate. `ResolveCardScan` omits
    // a record that owns none of the rows marked this scan (spec §5.4), so a
    // card that reached this use case at all is supposed to carry rows. Zero
    // means the resolver/allocation side failed to map the paper onto any
    // question: nothing was assessed, and nothing CAN be. Reported before the
    // dedup read below (which has nothing to compare) so it can never fall
    // through into the `duplicate-scan` exit — "already recorded" would put a
    // false claim about the child's work into the durable log.
    if (card.results.length === 0) {
      this.#logger.warn?.('school.print.scan-no-rows-resolved', {
        testId,
        cardId: card.cardId,
        recordId: card.recordId,
        documentId: card.documentId,
        learnerId,
        ...(card.sessionId ? { sessionId: card.sessionId } : {}),
      });
      return { recorded: false, reason: 'no-rows-resolved' };
    }

    const key = scanKey(card);
    // Dedup only ever needs to see attempts from this card's own printing
    // forward — a card rendered today cannot collide with a day file from
    // last year. `renderedAt`'s day is the lower bound, `today` (this
    // execute's own clock) the upper; a legacy card with no `renderedAt`
    // (pre-dates the field) falls back to the full scan.
    const renderedDay = dayOf(card.renderedAt);
    const priorAttempts = (
      renderedDay !== null && typeof this.#datastore.readAttemptsInRange === 'function'
        ? this.#datastore.readAttemptsInRange(learnerId, renderedDay, dayOf(this.#clock().toISOString()))
        : this.#datastore.readAllAttempts(learnerId)
    ).filter((attempt) => attempt?.provenance?.recordId === card.recordId);
    const recordedRows = new Set(
      priorAttempts.map((attempt) => `${attempt.provenance.row}:${JSON.stringify(attempt.given)}`),
    );
    const freshRows = card.results.filter(
      (row) => row.status !== 'blank' && !recordedRows.has(`${row.row}:${JSON.stringify(row.given)}`),
    );
    if (freshRows.length === 0) {
      // NO MARKS — every row this record owns resolved blank. The card is
      // real and mapped fine; it simply carries no work: fed face-down, fed
      // by mistake, or never filled in. Benign in cause and expected to be
      // the most frequent of these three exits in the field, but the person
      // at the scanner has to learn to re-feed it rather than walk away
      // believing the quiz landed — so it warns, carrying `cardId` (the
      // number printed on the paper in their hand) to identify which sheet.
      if (card.results.every((row) => row.status === 'blank')) {
        this.#logger.warn?.('school.print.scan-no-marks', {
          testId,
          cardId: card.cardId,
          recordId: card.recordId,
          documentId: card.documentId,
          learnerId,
          rowCount: card.results.length,
          ...(card.sessionId ? { sessionId: card.sessionId } : {}),
        });
        return { recorded: false, reason: 'no-marks' };
      }
      // Every non-blank row on this card was already recorded verbatim —
      // nothing new happened to the child's work, so nothing new lands in
      // the log (whether that's the identical card re-fed, or a complete
      // re-feed whose rows were all already captured by an earlier partial).
      this.#logger.info?.('school.print.scan-already-recorded', {
        testId, recordId: card.recordId, learnerId,
      });
      return { recorded: false, reason: 'duplicate-scan' };
    }

    // Curriculum spine (R2): `subjectId`/`courseId` come off the document's
    // own path — a print document is always filed `subject/course/...` when
    // it carries either segment at all (spec's taxonomy convention, same
    // split the pre-R2 subjectId-only derivation already used). `unitId`
    // comes off the ISSUING WORK SESSION when there is one — a URL-printed
    // sheet has no session and therefore no unit, never guessed at.
    const documentSegments = card.documentId.split('/');
    const subjectId = card.subjectId ?? (documentSegments.length > 1 ? documentSegments[0] : null);
    const courseId = card.courseId ?? (documentSegments.length > 2 ? documentSegments[1] : null);

    // Read + reduce the issuing session ONCE, up front — never inside
    // `#bridgeSession` (which used to do its own `readEvents` call). A read
    // failure here must not block attempt recording (the attempts are real
    // evidence regardless of whether the session bridge can run): caught and
    // reported as `null`, which `#bridgeSession` below turns into the SAME
    // `bridge-failed` outcome the old inline try/catch reported.
    let preReadState = null;
    if (card.sessionId && this.#sessions) {
      try {
        preReadState = reduceSession(await this.#sessions.readEvents(card.sessionId));
      } catch {
        preReadState = null;
      }
    }
    const unitId = preReadState?.unitId ?? null;

    const at = this.#clock().toISOString();
    const attemptIds = [];
    // itemId -> attempt id, for the verdict sheet's `attemptId` field. Built
    // from THIS call's fresh appends first, then backfilled from attempts
    // already on record for this recordId — a re-fed row that deduped above
    // still needs its attemptId to resolve for the machine mark below.
    const attemptIdByItem = new Map();
    for (const row of freshRows) {
      const learning = {
        ...(subjectId ? { subjectId } : {}),
        ...(courseId ? { courseId } : {}),
        ...(unitId ? { unitId } : {}),
        conceptIds: row.concepts ?? [],
      };
      const attempt = createAttempt({
        at,
        sessionId: card.sessionId ?? null,
        bankId: `${card.documentId}@${card.rev}`,
        itemId: row.itemId,
        itemType: row.itemType,
        mode: 'quiz',
        given: row.given,
        correct: row.status === 'correct',
        attributedTo: learnerId,
        transport: 'paper',
        learning,
        provenance: {
          kind: 'omr-card',
          cardId: card.cardId,
          recordId: card.recordId,
          row: row.row,
          rowStatus: row.status,
          scanKey: key,
          ...(card.sectionId ? { sectionId: card.sectionId } : {}),
          ...(card.reScored ? { reScored: true } : {}),
          // The card id this row's allocation was resolved against was
          // INFERRED (best-effort match against a `?`-bearing scan), not
          // cleanly read off the sheet — see this method's own doc comment.
          ...(cardIdInferred ? { cardIdInferred } : {}),
          // The attempt's own `sessionId` already carries `card.sessionId`
          // (set below); this copy is for evidence-layer reach, since
          // `attemptEvidence` maps provenance rather than the raw attempt.
          ...(card.sessionId ? { workSessionId: card.sessionId } : {}),
        },
      });
      const appended = this.#datastore.appendAttempt(learnerId, attempt);
      if (!appended) {
        this.#logger.error?.('school.print.scan-attempt-write-failed', {
          testId, recordId: card.recordId, learnerId, itemId: row.itemId,
        });
        return { recorded: false, reason: 'attempt-write-failed', attemptIds };
      }
      attemptIds.push(attempt.id);
      attemptIdByItem.set(row.itemId, attempt.id);
    }
    for (const attempt of priorAttempts) {
      if (!attemptIdByItem.has(attempt.itemId)) attemptIdByItem.set(attempt.itemId, attempt.id);
    }

    this.#logger.info?.('school.print.scan-attempts-recorded', {
      testId,
      recordId: card.recordId,
      learnerId,
      attemptCount: attemptIds.length,
      earnedPoints: card.earnedPoints,
      totalPoints: card.totalPoints,
    });

    const session = await this.#bridgeSession(
      card, attemptIds, attemptIdByItem, at, preReadState,
    );
    return { recorded: true, attemptIds, ...(session ? { session } : {}) };
  }

  /**
   * Advance the issuing work session, when there is one, through the SAME
   * transitions every other transport uses. Never throws — a session-side
   * refusal must not un-record the attempts above.
   *
   * When a review queue is wired, this is also where the card's rows become
   * the durable verdict sheet `GradeSubmission` reads: every correct/incorrect
   * row is a RESOLVED entry (`gradedBy: 'engine'`), every ambiguous row and
   * every unscanned (write-on) item is a PENDING one. A card with anything
   * pending holds the session at `submitted` instead of advancing to `graded`
   * — the same "a grown-up still has some of this to check" wait
   * `SubmitPaperWork`/`GradeSubmission` already use for a screen-facing sheet.
   *
   * `preReadState` is the session state `execute` already read + reduced
   * ONCE up front (never a fresh `readEvents` call here). `null` means that
   * pre-read itself failed (a thrown error, e.g. the store is unreachable) —
   * reported as the same `bridge-failed` outcome a `readEvents` throw inside
   * this method used to produce. A session `execute` genuinely couldn't find
   * (empty event history) still reduces to a real state object whose
   * `sessionId` is `null` — that is the pre-existing `session-missing` path,
   * distinct from a pre-read failure.
   */
  async #bridgeSession(card, attemptIds, attemptIdByItem, at, preReadState) {
    if (!this.#sessions || card.sessionId == null) return null;
    const { sessionId } = card;
    try {
      if (preReadState === null) {
        throw new Error('session pre-read failed');
      }
      const state = preReadState;
      if (!state.sessionId) {
        this.#logger.warn?.('school.print.scan-session-missing', { sessionId, recordId: card.recordId });
        return { sessionId, advancedTo: null, reason: 'session-missing' };
      }
      if (!BRIDGEABLE.has(state.state)) {
        // Already graded (a re-scan), or somewhere this bridge has no
        // business touching (abandoned, outcome_recorded, ...).
        this.#logger.info?.('school.print.scan-session-not-bridgeable', {
          sessionId, state: state.state, recordId: card.recordId,
        });
        return { sessionId, advancedTo: null, reason: `state-${state.state}` };
      }
      const incomplete = card.results.some((row) => row.status === 'blank');
      if (incomplete) {
        // Partial feed: the record stayed live, the child re-feeds a finished
        // card — grading a half-empty sheet into the session would be a
        // permanent verdict on unfinished work.
        this.#logger.info?.('school.print.scan-partial-not-bridged', {
          sessionId, recordId: card.recordId,
        });
        return { sessionId, advancedTo: null, reason: 'partial-scan' };
      }

      if (this.#reviewQueue) {
        const machineMarks = card.results
          .filter((row) => row.status === 'correct' || row.status === 'incorrect')
          .map((row) => ({
            sessionId, itemId: row.itemId, learnerId: state.learnerId, unitId: state.unitId,
            reason: 'machine', given: row.given,
            prompt: row.prompt ?? null, questionNumber: row.row, rubric: null,
            enqueuedAt: at,
            verdict: row.status === 'correct' ? 'correct' : 'incorrect',
            gradedBy: 'engine', gradedAt: at,
            attemptId: attemptIdByItem.get(row.itemId) ?? null,
          }));
        const pending = [
          ...card.results.filter((row) => row.status === 'ambiguous').map((row) => ({
            sessionId, itemId: row.itemId, learnerId: state.learnerId, unitId: state.unitId,
            reason: 'ambiguous', given: row.given,
            prompt: row.prompt ?? null, questionNumber: row.row, rubric: null, enqueuedAt: at,
          })),
          ...(card.unscannedItems ?? []).map((item) => ({
            sessionId, itemId: item.itemId, learnerId: state.learnerId, unitId: state.unitId,
            reason: 'free_response', given: null,
            prompt: item.prompt ?? null, questionNumber: null, rubric: null, enqueuedAt: at,
          })),
        ];
        // Enqueued unconditionally — the machine marks belong on the verdict
        // sheet whether or not anything is left pending (a fully machine-
        // scored card still needs its marks readable by `GradeSubmission`).
        await this.#reviewQueue.enqueue([...machineMarks, ...pending]);
        if (pending.length > 0) {
          if (state.state !== 'submitted') {
            const submitted = createEvent({
              type: 'submitted', at, sessionId, transport: 'paper',
            });
            if (submitted.errors.length) throw new Error(submitted.errors.join('; '));
            await this.#sessions.appendEvent(sessionId, submitted.event);
          }
          // The reasons/items ride along because the count alone says work
          // stopped without saying WHY. On 2026-08-22 this line read
          // `pendingReview: 1` and it took reading the queue file on disk to
          // learn that one row was double-bubbled.
          this.#logger.info?.('school.print.scan-awaiting-review', {
            sessionId,
            recordId: card.recordId,
            pendingReview: pending.length,
            learnerId: state.learnerId ?? null,
            reasons: [...new Set(pending.map((row) => row.reason))],
            items: pending.map((row) => row.itemId),
          });
          return {
            sessionId, advancedTo: 'submitted', reason: 'awaiting-review', pendingReview: pending.length,
          };
        }
      }

      if (state.state !== 'submitted') {
        const submitted = createEvent({
          type: 'submitted', at, sessionId, transport: 'paper',
        });
        if (submitted.errors.length) throw new Error(submitted.errors.join('; '));
        await this.#sessions.appendEvent(sessionId, submitted.event);
      }

      const correctRows = card.results.filter((row) => row.status === 'correct').length;
      const percent = card.results.length > 0
        ? Math.round((correctRows / card.results.length) * 10000) / 100
        : 0;
      const graded = createEvent({
        type: 'graded',
        at,
        sessionId,
        // Always the rows freshly appended THIS call, and always at least
        // one: `execute` returns at its `freshRows.length === 0` exit before
        // ever calling this method, and the append loop pushes an id per
        // fresh row (or returns early on a write failure). There is no
        // reachable path here with an empty `attemptIds`, so no fallback.
        attemptIds,
        percent,
        correctCount: correctRows,
        totalCount: card.results.length,
        missedItemIds: card.results.filter((row) => row.status !== 'correct').map((row) => row.itemId),
      });
      if (graded.errors.length) throw new Error(graded.errors.join('; '));
      await this.#sessions.appendEvent(sessionId, graded.event);

      this.#logger.info?.('school.print.scan-session-graded', {
        sessionId, recordId: card.recordId, percent,
      });
      return { sessionId, advancedTo: 'graded' };
    } catch (err) {
      this.#logger.warn?.('school.print.scan-session-bridge-failed', {
        sessionId, recordId: card.recordId, error: err.message,
      });
      return { sessionId, advancedTo: null, reason: 'bridge-failed' };
    }
  }
}

export default RecordCardScanOutcome;
