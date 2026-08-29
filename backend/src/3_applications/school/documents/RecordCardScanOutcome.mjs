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
 *    incorrect rows are RESOLVED (`gradedBy: 'engine'`, or `'engine-leniency'`
 *    for a row `ResolveCardScan`'s eraser-leniency pass promoted from
 *    `ambiguous` — spec §5.4, 2026-08-22 policy — auditable via that same
 *    row's `leniency: 'eraser'` marker), ambiguous rows and `unscannedItems`
 *    (write-ons) are PENDING. Anything pending holds the session at
 *    `submitted` — never `graded` — until a grown-up clears it through
 *    `GradeSubmission`, which reads that same queue as the sheet's roster
 *    for a print-document unit.
 *
 * THE COMPANION GATE PASSES THROUGH, IT IS NEVER SCORED (Task 10). A gated
 * sheet's finish-code row arrives on `card.companionGate`, never inside
 * `card.results` — so it is in no attempt, no percent, no `missedItemIds` and
 * no verdict sheet. It is stamped onto the `graded` event and travels to
 * `CloseSessionOutcome`, which is where it can veto a pass. Deliberately NOT
 * an attempt row: the ledger records what a child answered about the LESSON,
 * and `attempt.mjs` carries no points field, so a `companion_code` attempt
 * would sit in a learner's permanent history looking exactly like a question
 * they got wrong, with nothing to tell any reader it was worth zero.
 *
 * AND IT RIDES `submitted`, NOT ONLY `graded` (Task 11). A sheet with an
 * ambiguous bubble goes to a grown-up: this bridge returns at `awaiting-review`
 * having written `submitted` and nothing else, and the `graded`
 * `GradeSubmission` writes afterwards carries no gate at all. Stamped on
 * `graded` alone, the verdict was therefore lost on every sheet that needed a
 * person — one double-bubbled question was enough to pass a lesson whose
 * read-along was never played.
 */
import { reduceSession, createEvent } from '#domains/school/sessions/sessionEvents.mjs';
import { createAttempt } from '#domains/school/attempt.mjs';
import { GATE_SATISFIED } from '#domains/school/companionCode.mjs';
import { shortId } from '#system/utils/id.mjs';

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

/**
 * FAIL-SAFE: the companion gate row can never be in `results` (Task 10).
 *
 * `ResolveCardScan` already partitions it out — the gate leaves through
 * `card.companionGate` and `results` carries only the child's answers. This
 * belt is here because `results` is the denominator of the session percent,
 * the source of the attempt ledger, and the source of `missedItemIds`; a gate
 * row that ever reached any of them would score a perfect ten-question sheet
 * 10/11 = 90.91% and file a permanent `correct: false` attempt against an item
 * worth zero points. Cheap, and it fails in the safe direction for any caller
 * (a replay of an older resolved scan, a hand-built card) that has not
 * partitioned.
 */
function withoutGateRow(card) {
  if (!card || !Array.isArray(card.results)) return card;
  const results = card.results.filter((row) => row?.itemType !== 'companion_code');
  return results.length === card.results.length ? card : { ...card, results };
}

/**
 * The gate verdict as it goes into a session event: the status, and the letters
 * the CHILD marked. Never `item.code` — see `ResolveCardScan#gradeRow`, which
 * deliberately never carries the expected code out of the resolver at all.
 */
function gateStamp(card) {
  const gate = card.companionGate;
  return {
    status: gate.status,
    ...(Array.isArray(gate.given) ? { given: [...gate.given] } : {}),
  };
}

/** The marked letters, order-insensitive — bubbles have no order on paper. */
const gateMarks = (gate) => (Array.isArray(gate?.given) ? [...gate.given].sort().join('') : '');

/** Same row, same marks: nothing about the finish-code row has changed. */
const sameGateReading = (a, b) => a.status === b.status && gateMarks(a) === gateMarks(b);

export class RecordCardScanOutcome {
  #datastore; #sessions; #reviewQueue; #resultArtifacts; #renderMachineResult; #clock; #logger; #newAttemptId;

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
    datastore, sessions = null, reviewQueue = null, resultArtifacts = null, renderMachineResult = null,
    clock = () => new Date(), newAttemptId = () => `att_${shortId(8)}`, logger = console,
  } = {}) {
    if (!datastore?.appendAttempt) throw new Error('RecordCardScanOutcome requires datastore.appendAttempt');
    this.#datastore = datastore;
    this.#sessions = sessions;
    this.#reviewQueue = reviewQueue;
    this.#resultArtifacts = resultArtifacts;
    this.#renderMachineResult = renderMachineResult;
    this.#clock = clock;
    this.#newAttemptId = newAttemptId;
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
  async execute({ testId, card: scannedCard, cardIdInferred = null } = {}) {
    const card = withoutGateRow(scannedCard);
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
            // One card, one gate row, several lessons: the gate belongs to the
            // section whose row range physically contains it, and to no other.
            // Copying it onto every section would veto lessons whose sheets
            // never had a companion at all.
            companionGate: (card.companionGate
              && card.companionGate.row >= section.rowRange.start
              && card.companionGate.row <= section.rowRange.end)
              ? card.companionGate : undefined,
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
        // Each entry gets its OWN section's score (not the whole card's
        // aggregate) — the caller (schoolPrintScanConsumer) fires one grading-
        // hook event per section and needs section A's 2/2 to read differently
        // from section B's 1/3 on the same card. `sectionOutcomes[i]` and
        // `card.sections[i]` correspond by construction: this loop above
        // pushes one outcome per `for (const section of card.sections)`
        // iteration, in the same order, so the index correlation here is not
        // a coincidence — it is guaranteed by the loop that built the array.
        sectionOutcomes: sectionOutcomes.map((outcome, i) => ({
          ...outcome,
          earnedPoints: card.sections[i].earnedPoints,
          totalPoints: card.sections[i].totalPoints,
        })),
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

    const at = this.#clock().toISOString();

    // Read + reduce the issuing session ONCE, up front — never inside
    // `#bridgeSession` (which used to do its own `readEvents` call). A read
    // failure here must not block attempt recording (the attempts are real
    // evidence regardless of whether the session bridge can run): caught and
    // reported as `null`, which `#bridgeSession` below turns into the SAME
    // `bridge-failed` outcome the old inline try/catch reported.
    //
    // It happens BEFORE the dedup below because of the gate: a re-scan whose
    // only change is the finish-code row carries the same rows as the first
    // one and would otherwise leave at `duplicate-scan` without ever asking
    // what the session already knows about the gate.
    let preReadState = null;
    if (card.sessionId && this.#sessions) {
      try {
        preReadState = reduceSession(await this.#sessions.readEvents(card.sessionId));
      } catch {
        preReadState = null;
      }
    }
    const unitId = preReadState?.unitId ?? null;

    // THE REPAIR LANE (Task 11). A gate blocked this sheet; the child filled in
    // the code and fed the SAME card again. See `#reReadGate` — when it hands
    // back an outcome, the gate has been restated and NOTHING else about this
    // scan is recorded.
    const repaired = await this.#reReadGate({ testId, card, state: preReadState, at });
    if (repaired) return repaired;

    const key = scanKey(card);
    // Dedup only ever needs to see attempts from this card's own printing
    // forward — a card rendered today cannot collide with a day file from
    // last year. `renderedAt`'s day is the lower bound, `today` (this
    // execute's own clock) the upper; a legacy card with no `renderedAt`
    // (pre-dates the field) falls back to the full scan.
    const renderedDay = dayOf(card.renderedAt);
    const priorAttempts = (
      renderedDay !== null && typeof this.#datastore.readAttemptsInRange === 'function'
        ? this.#datastore.readAttemptsInRange(learnerId, renderedDay, dayOf(at))
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
        id: this.#newAttemptId(),
        at,
        processedAt: at,
        studyDay: preReadState?.studyDay ?? (preReadState?.firstIssuedAt ?? preReadState?.createdAt ?? at).slice(0, 10),
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
    if (session?.advancedTo === 'graded' && card.sessionId && this.#resultArtifacts && this.#renderMachineResult) {
      try {
        const bytes = await this.#renderMachineResult({ sessionId: card.sessionId, unitId, card });
        await this.#resultArtifacts.putMachineIfAbsent(card.sessionId, bytes);
      } catch (error) {
        this.#logger.warn?.('school.print.machine-result-retention-failed', {
          sessionId: card.sessionId, recordId: card.recordId, error: error.message,
        });
      }
    }
    return {
      recorded: true,
      attemptIds,
      curriculum: { subjectId, courseId, unitId, lessonId: card.lessonId ?? null },
      ...(session ? { session } : {}),
    };
  }

  /**
   * THE GATE REPAIR LANE (Task 11): only the finish-code row is re-read.
   *
   * A sheet blocked by its gate is repaired the only way a printed sheet can
   * be — the child fills in the code bubbles and feeds the SAME card again.
   * This is the branch that notices, because nothing else would: the gate is
   * not in `card.results`, so a re-scan whose only change is the gate row
   * produces the identical rows the dedup below already has on file and leaves
   * at `duplicate-scan` without a second look.
   *
   * WHAT IT DELIBERATELY DOES NOT DO. When the sheet already carries a score,
   * this records the gate and RETURNS: no attempts, no `graded` event, no
   * verdict-sheet churn. The result receipt already told the child which
   * questions were wrong, and `ResolveCardScan`'s eraser-leniency credits a
   * two-mark row containing the right answer — so re-grading the questions
   * here would let a child add the correct bubble beside a wrong one and gain
   * credit. That turns a gate repair into a score repair, which is the one
   * thing the gate must never be able to do.
   *
   * WHEN THE SHEET IS NOT SCORED YET (it is sitting with a grown-up, its rows
   * still being marked) the reading is still restated — `submitted -> submitted`
   * is not a transition, so this annotation is that lane's only way to say the
   * row changed — but it returns null so the ordinary path still runs and a row
   * the child has since filled in still becomes an attempt.
   *
   * @returns {Promise<object|null>} an `execute` outcome when the scan was a
   *   repair and nothing else, otherwise null (carry on with the ordinary path)
   */
  async #reReadGate({ testId, card, state, at }) {
    if (!this.#sessions || card.sessionId == null || !card.companionGate) return null;
    if (!state?.sessionId) return null;
    const recorded = state.companionGate;
    // A gate nobody has read yet, or one that already cleared, is not a repair:
    // the first reading rides `submitted`/`graded` and a satisfied one is done.
    if (!recorded || recorded.status === GATE_SATISFIED) return null;
    // The MARKS, not just the status. A child walking A -> AB -> ABC re-scans a
    // genuinely different row each time and every one of them reads `wrong`;
    // comparing statuses alone would call those repeats duplicates and leave
    // the child feeding a sheet that never answers.
    if (sameGateReading(recorded, card.companionGate)) return null;

    try {
      await this.#appendGateRead({ sessionId: card.sessionId, at, card });
    } catch (error) {
      // Never fatal: the scan falls through to the ordinary path, which will
      // report `duplicate-scan` for a rows-identical re-feed. Loud, because a
      // child is standing at the scanner waiting for a sheet to clear.
      this.#logger.warn?.('school.print.scan-gate-read-failed', {
        testId, sessionId: card.sessionId, recordId: card.recordId, error: error.message,
      });
      return null;
    }

    const status = card.companionGate.status;
    this.#logger.info?.('school.print.scan-gate-re-read', {
      testId,
      sessionId: card.sessionId,
      recordId: card.recordId,
      cardId: card.cardId,
      from: recorded.status,
      to: status,
      scored: state.gradedPercent !== null,
    });
    // Still being marked: the row is restated, but this scan is otherwise an
    // ordinary one and the path below must still run.
    if (state.gradedPercent === null) return null;
    return {
      recorded: true,
      reason: 'companion-gate-repaired',
      attemptIds: [],
      curriculum: {
        subjectId: card.subjectId ?? null,
        courseId: card.courseId ?? null,
        unitId: state.unitId ?? null,
        lessonId: card.lessonId ?? null,
      },
      session: {
        sessionId: card.sessionId,
        advancedTo: null,
        reason: 'gate-repaired',
        companionGate: { status },
        // The score the sheet ALREADY earned, read back off the session rather
        // than recomputed from this scan's rows — which is the whole promise of
        // this lane. It rides here so the caller's ceremony can announce the
        // same numbers the gradebook holds without a second read.
        percent: state.gradedPercent,
        correctCount: state.gradedCorrectCount,
        totalCount: state.gradedTotalCount,
      },
    };
  }

  /** Append the annotation that restates the finish-code row. */
  async #appendGateRead({ sessionId, at, card }) {
    const built = createEvent({
      type: 'companion_gate_read', at, sessionId, companionGate: gateStamp(card),
    });
    if (built.errors.length) throw new Error(built.errors.join('; '));
    await this.#sessions.appendEvent(sessionId, built.event);
  }

  /**
   * Hand the work in, carrying the scan's verdict on the finish-code row.
   *
   * Both `#bridgeSession` branches turn a sheet in the same way, and both must
   * carry the gate: the awaiting-review branch because `submitted` is the only
   * event it ever writes, and the grading branch so the two paths record the
   * same fact in the same shape rather than one of them being the exception.
   * Absent on every ungated sheet, which is all of them today.
   */
  async #appendSubmitted({ sessionId, at, card }) {
    const submitted = createEvent({
      type: 'submitted',
      at,
      sessionId,
      transport: 'paper',
      ...(card.companionGate ? { companionGate: gateStamp(card) } : {}),
    });
    if (submitted.errors.length) throw new Error(submitted.errors.join('; '));
    await this.#sessions.appendEvent(sessionId, submitted.event);
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
            // A row `ResolveCardScan`'s eraser-leniency pass promoted from
            // `ambiguous` (spec §5.4, 2026-08-22 policy) carries its own
            // `leniency: 'eraser'` marker — surfaced here as a distinct
            // `gradedBy` so the verdict sheet stays auditable: a human can
            // tell "the engine decided this outright" apart from "the engine
            // extended eraser-leniency" without re-reading the scan.
            gradedBy: row.leniency === 'eraser' ? 'engine-leniency' : 'engine',
            gradedAt: at,
            attemptId: attemptIdByItem.get(row.itemId) ?? null,
            ...(row.leniency ? { leniency: row.leniency } : {}),
            // The eraser-leniency rationale is written for the RECORD, not
            // the child (Slice H, 2026-08-22): `internalNote` is the field
            // `reviewNoteLines`/the result receipt's "NOTES FOR YOU" block
            // structurally cannot read (see `IReviewQueue.mjs`). Before this
            // field existed the only place to put this explanation at all
            // was `note` — the child-facing one — which is exactly how
            // machine-written audit text was one edit away from landing on
            // a 3rd-grader's receipt.
            ...(row.leniency === 'eraser' ? {
              internalNote: `Eraser signature: marks ${JSON.stringify(row.given)}, one correct — credited in full per the bounded eraser-leniency rule (spec §5.4).`,
            } : {}),
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
            // THE GATE VERDICT RIDES THE HAND-OVER (Task 11). This branch
            // returns without ever writing a `graded` event, and the one
            // `GradeSubmission` writes when the grown-up is done carries no
            // gate — so `submitted` is the only place the scan can put what it
            // read, and until it did, one double-bubbled question was enough
            // to pass a sheet whose companion was never played.
            await this.#appendSubmitted({ sessionId, at, card });
          }
          // The reasons/items ride along because the count alone says work
          // stopped without saying WHY. On 2026-08-22 this line read
          // `pendingReview: 1` and it took reading the queue file on disk to
          // learn that one row was double-bubbled.
          const reviewReasons = [...new Set(pending.map((row) => row.reason))];
          const reviewItems = pending.map((row) => row.itemId);
          this.#logger.info?.('school.print.scan-awaiting-review', {
            sessionId,
            recordId: card.recordId,
            pendingReview: pending.length,
            learnerId: state.learnerId ?? null,
            reasons: reviewReasons,
            items: reviewItems,
          });
          return {
            sessionId,
            advancedTo: 'submitted',
            reason: 'awaiting-review',
            pendingReview: pending.length,
            reasons: reviewReasons,
            items: reviewItems,
          };
        }
      }

      if (state.state !== 'submitted') {
        await this.#appendSubmitted({ sessionId, at, card });
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
        // The scan's verdict on the finish-code row, stamped onto the grade
        // event beside the percent but never inside it (Task 10). This is how
        // it reaches `CloseSessionOutcome`, which is where a pass is actually
        // decided; `percent` above is deliberately unaffected by it, so the
        // gradebook records the child's answers and the gate blocks the pass
        // as two separate facts. Absent on every ungated sheet.
        ...(card.companionGate ? { companionGate: gateStamp(card) } : {}),
      });
      if (graded.errors.length) throw new Error(graded.errors.join('; '));
      await this.#sessions.appendEvent(sessionId, graded.event);

      this.#logger.info?.('school.print.scan-session-graded', {
        sessionId, recordId: card.recordId, percent,
      });
      // percent/correctCount/totalCount surfaced onto the session object
      // (final review Fix 3, same pattern as the `reasons`/`items` surfaced
      // on the awaiting-review branch above and the per-section
      // earnedPoints/totalPoints `execute()` attaches to `sectionOutcomes`):
      // this ROW-COUNT percent is the SAME number that becomes the session's
      // `gradedPercent` via `reduceSession` (`sessionEvents.mjs`: `graded`
      // event's `percent` -> `s.gradedPercent`), which drives pass/fail,
      // course grades, and the report card. `schoolPrintScanConsumer` reads
      // it from here for the grading-hook fire so Home Assistant can never
      // announce a different percent than the gradebook records — the whole
      // point of exposing it here rather than letting the caller recompute
      // its own (points-based) percent from `earnedPoints`/`totalPoints`.
      return {
        sessionId, advancedTo: 'graded', percent, correctCount: correctRows, totalCount: card.results.length,
      };
    } catch (err) {
      this.#logger.warn?.('school.print.scan-session-bridge-failed', {
        sessionId, recordId: card.recordId, error: err.message,
      });
      return { sessionId, advancedTo: null, reason: 'bridge-failed' };
    }
  }
}

export default RecordCardScanOutcome;
