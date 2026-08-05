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

export class RecordCardScanOutcome {
  #datastore; #sessions; #reviewQueue; #clock; #logger;

  /**
   * @param {object} deps
   * @param {{appendAttempt: Function, readAllAttempts: Function}} deps.datastore -
   *   `YamlSchoolDatastore`-shaped: the canonical per-learner attempt log.
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
   * @param {{testId: string, card: object}} args - `card` is ONE graded entry
   *   from `ResolveCardScan.execute().results` (never a drift-error entry).
   * @returns {Promise<{recorded: boolean, reason?: string, attemptIds?: string[],
   *   session?: {sessionId: string, advancedTo: string|null, reason?: string}}>}
   */
  async execute({ testId, card } = {}) {
    if (!card || card.error || !Array.isArray(card.results)) {
      return { recorded: false, reason: 'not-a-graded-result' };
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

    const key = scanKey(card);
    const priorAttempts = this.#datastore.readAllAttempts(learnerId)
      .filter((attempt) => attempt?.provenance?.recordId === card.recordId);
    const recordedRows = new Set(
      priorAttempts.map((attempt) => `${attempt.provenance.row}:${JSON.stringify(attempt.given)}`),
    );
    const freshRows = card.results.filter(
      (row) => row.status !== 'blank' && !recordedRows.has(`${row.row}:${JSON.stringify(row.given)}`),
    );
    if (freshRows.length === 0) {
      // Every non-blank row on this card was already recorded verbatim —
      // nothing new happened to the child's work, so nothing new lands in
      // the log (whether that's the identical card re-fed, or a complete
      // re-feed whose rows were all already captured by an earlier partial).
      this.#logger.info?.('school.print.scan-already-recorded', {
        testId, recordId: card.recordId, learnerId,
      });
      return { recorded: false, reason: 'duplicate-scan' };
    }

    const documentSegments = card.documentId.split('/');
    const subjectId = documentSegments.length > 1 ? documentSegments[0] : null;

    const at = this.#clock().toISOString();
    const attemptIds = [];
    // itemId -> attempt id, for the verdict sheet's `attemptId` field. Built
    // from THIS call's fresh appends first, then backfilled from attempts
    // already on record for this recordId — a re-fed row that deduped above
    // still needs its attemptId to resolve for the machine mark below.
    const attemptIdByItem = new Map();
    for (const row of freshRows) {
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
        ...(subjectId ? { learning: { subjectId } } : {}),
        provenance: {
          kind: 'omr-card',
          cardId: card.cardId,
          recordId: card.recordId,
          row: row.row,
          rowStatus: row.status,
          scanKey: key,
          ...(card.reScored ? { reScored: true } : {}),
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

    const priorAttemptIdsForRecord = priorAttempts.map((attempt) => attempt.id);
    const session = await this.#bridgeSession(card, attemptIds, attemptIdByItem, at, priorAttemptIdsForRecord);
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
   */
  async #bridgeSession(card, attemptIds, attemptIdByItem, at, priorAttemptIdsForRecord = []) {
    if (!this.#sessions || card.sessionId == null) return null;
    const { sessionId } = card;
    try {
      const state = reduceSession(await this.#sessions.readEvents(sessionId));
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
          this.#logger.info?.('school.print.scan-awaiting-review', {
            sessionId, recordId: card.recordId, pendingReview: pending.length,
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
        // attemptIds is only the rows freshly appended THIS call; if this
        // graded event ever fires without any (defensive — the row-scoped
        // dedup above normally returns before reaching here), fall back to
        // the ids already on record for this recordId rather than a
        // synthetic id.
        attemptIds: attemptIds.length ? attemptIds : priorAttemptIdsForRecord,
        percent,
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
