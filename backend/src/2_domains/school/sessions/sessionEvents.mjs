/**
 * Work-session event model and reducer (spec §5). Pure: no I/O, no clock — an
 * event's `at` is supplied by the caller, never read here.
 *
 * A work session is the durable record of one piece of a child's work: what was
 * printed, what came back, how it was graded, what it earned, what replaced it
 * when it failed. It is stored as an APPEND-ONLY event log and its state is
 * DERIVED on every read (the language-ladder pattern in `../language/dayQueue.mjs`).
 * Nothing here is stored; a mutable status field would be one more thing that can
 * disagree with the evidence.
 *
 * Two rules govern the reducer, and both exist because a parent reads this record
 * exactly when something has already gone wrong:
 *
 *   1. It is TOTAL. An unknown type, an illegal transition, a duplicate seq, a
 *      malformed entry — each is accumulated into `errors[]`. Nothing throws and
 *      nothing is dropped without a trace. A log that crashes the reducer destroys
 *      the only evidence of the work it describes.
 *   2. Every non-terminal state yields a non-null `nextAction`. A state with no
 *      next move is a wedged session: a child holding paper that nothing can
 *      advance. The property test over every reachable state is the guard.
 *
 * Error strings use the house `<path>: <message>` notation (see
 * `../documents/blocks.mjs`), with the reducer's path being `event[seq=N]`.
 */
// Two same-layer imports, both there so a rule lives in one place.
//
// `GATE_STATUSES` is the vocabulary of a scanned finish-code row. Copying the
// strings would give the event schema and the outcome rule that reads them two
// places to drift apart, over a vocabulary that must agree exactly.
//
// `evaluateOutcome` is the pass rule itself, borrowed by the grade-correction
// projection at the tail of `reduceSession` — which used to carry a private
// copy of it and, by carrying only HALF of it, silently erased every clause
// that rule had learned. `./outcome.mjs` imports nothing at all, so this cannot
// cycle.
import { GATE_STATUSES } from '#domains/school/companionCode.mjs';
import { evaluateOutcome } from './outcome.mjs';

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isSeq = (v) => Number.isInteger(v) && v >= 1;
// Parsed-and-round-trips, so "2026-13-45" and "yesterday" are both rejected.
const isIsoTimestamp = (v) => isNonEmptyString(v) && !Number.isNaN(Date.parse(v));
const isStudyDay = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const at = Date.parse(`${v}T00:00:00.000Z`);
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === v;
};

const stringField = (field) => (raw, push) => {
  if (!isNonEmptyString(raw[field])) push(`${field}: must be a non-empty string`);
};
const allOf = (...checks) => (raw, push) => { checks.forEach((c) => c(raw, push)); };
const oneOfField = (field, allowed) => (raw, push) => {
  if (!allowed.includes(raw[field])) push(`${field}: must be one of ${allowed.join(', ')}`);
};
const booleanIfPresent = (field) => (raw, push) => {
  if (raw[field] !== undefined && typeof raw[field] !== 'boolean') push(`${field}: must be a boolean when present`);
};

const TRANSPORTS = ['paper', 'screen'];
const RESULTS = ['passed', 'needs_remediation'];

/**
 * `companionGate` — the scan's verdict on the sheet's finish-code row.
 *
 * ONE validator, because more than one event carries it. Task 10 put it on
 * `graded` alone, which is where a sheet the scanner marks end to end records
 * it. But a sheet with an ambiguous bubble goes to a grown-up instead, and the
 * only event written on THAT path is `submitted` — `GradeSubmission` writes the
 * `graded` later, from the verdict sheet, and knows nothing about a finish-code
 * row. So a single ambiguous bubble was enough to lose the verdict entirely and
 * pass a sheet whose companion was never played. It rides both events now, with
 * the same shape and the same rules, checked here once.
 */
const gateField = (raw, push) => {
  if (raw.companionGate === undefined) return;
  const gate = raw.companionGate;
  if (!gate || typeof gate !== 'object' || Array.isArray(gate) || !GATE_STATUSES.includes(gate.status)) {
    push(`companionGate: must be an object with status ${GATE_STATUSES.join('|')} when present`);
    return;
  }
  // `given` (optional) is the letters the CHILD marked — never the code they
  // were supposed to copy. It is here because a status alone cannot tell a
  // repair from a repeat: a child walking A -> AB -> ABC re-scans a different
  // row every time and every one of them reads `wrong`. The marks are the only
  // thing that changed, so the marks are what a re-scan compares.
  if (gate.given !== undefined && gate.given !== null
      && !(Array.isArray(gate.given) && gate.given.every(isNonEmptyString))) {
    push('companionGate.given: must be an array of marked letters, or null, when present');
  }
};

/**
 * Fold one event's gate verdict into the derived state — the LATEST read wins.
 *
 * An event carrying no gate leaves the field exactly as it was rather than
 * clearing it: an ungated sheet has nothing to say here, and `GradeSubmission`'s
 * own gate-less `graded` must never read as "the gate was cleared".
 */
const applyGate = (s, e) => {
  if (e.companionGate && GATE_STATUSES.includes(e.companionGate.status)) {
    s.companionGate = {
      status: e.companionGate.status,
      ...(Array.isArray(e.companionGate.given) ? { given: [...e.companionGate.given] } : {}),
    };
  }
};
const percentIfPresent = (field) => (raw, push) => {
  if (raw[field] !== undefined && (typeof raw[field] !== 'number'
      || !Number.isFinite(raw[field]) || raw[field] < 0 || raw[field] > 100)) {
    push(`${field}: must be a number between 0 and 100 when present`);
  }
};

/**
 * Key order IS `EVENT_TYPES` (derived below), so a type can never be declared
 * without a validator or validated without being declared — same posture as the
 * document block set.
 *
 * `fields` is the whitelist that survives into the built event: an event log is
 * evidence, and evidence should not carry whatever else the caller happened to
 * pass.
 */
const SCHEMA = {
  created: {
    fields: ['learnerId', 'unitId', 'studyDay', 'remediationOf', 'variant', 'remediationItemIds', 'openedBy', 'replacementKey', 'replacesSessionId'],
    validate: allOf(stringField('learnerId'), stringField('unitId'), (raw, push) => {
      if (raw.studyDay !== undefined && !isStudyDay(raw.studyDay)) push('studyDay: must be YYYY-MM-DD when present');
      // Both optional: only a remediation session carries them.
      if (raw.remediationOf !== undefined && !isNonEmptyString(raw.remediationOf)) {
        push('remediationOf: must be a non-empty string');
      }
      if (raw.remediationItemIds !== undefined && (!Array.isArray(raw.remediationItemIds)
          || !raw.remediationItemIds.every(isNonEmptyString))) {
        push('remediationItemIds: must be an array of non-empty strings when present');
      }
      if (raw.variant !== undefined && !(Number.isInteger(raw.variant) && raw.variant >= 0)) {
        push('variant: must be an integer >= 0');
      }
      if (raw.openedBy !== undefined && !isNonEmptyString(raw.openedBy)) {
        push('openedBy: must be a non-empty string when present');
      }
      if (raw.replacementKey !== undefined && !isNonEmptyString(raw.replacementKey)) {
        push('replacementKey: must be a non-empty string when present');
      }
      if (raw.replacesSessionId !== undefined && !isNonEmptyString(raw.replacesSessionId)) {
        push('replacesSessionId: must be a non-empty string when present');
      }
      if ((raw.replacementKey === undefined) !== (raw.replacesSessionId === undefined)) {
        push('replacementKey and replacesSessionId must be supplied together');
      }
    }),
  },
  // A reprint reuses the ORIGINAL artifactId — that is the lineage rule (spec
  // §5.2). Reprinting under a fresh id would make the same worksheet look like
  // two different pieces of work.
  //
  // `confirmed` (optional, default true when absent — see `isBooleanIfPresent`
  // below): whether the printer port that produced this event represents a
  // GENUINE physical dispatch. `IssueDocument` sets this from whatever its
  // injected `printer.printPdf()` result reports (real `LaserPrinterAdapter`
  // calls never set it, so every production print defaults to confirmed);
  // a caller-supplied double that captures bytes in memory instead of sending
  // them anywhere (the CLI simulator's own "dry run by default" printer, or a
  // future preview/email-me-the-PDF delivery mode) can say so explicitly. The
  // event itself still means what it always meant — this session HAS an
  // issued artifact, its lineage/reprint history is unaffected either way —
  // `confirmed` only changes whether `APPLY.issued`/`APPLY.reprinted` below
  // arm the print-cooldown timer from it. Absent from the field list would
  // mean `createEvent`'s whitelist silently drops it (see that function's own
  // "fields is the whitelist that survives" comment) — it must be declared
  // here to reach the stored event at all.
  issued: {
    fields: ['artifactId', 'confirmed'],
    validate: allOf(stringField('artifactId'), booleanIfPresent('confirmed')),
  },
  reprinted: {
    fields: ['artifactId', 'confirmed', 'idempotencyKey', 'reprintedBy'],
    validate: allOf(stringField('artifactId'), booleanIfPresent('confirmed')),
  },
  // A result receipt is evidence produced by settlement, not a new lesson
  // state. It therefore records its own immutable artifact separately from a
  // worksheet's `issuedArtifacts`, whose list drives paper reprint/cooldown.
  result_receipt_captured: {
    fields: ['artifactId', 'kind', 'printed', 'printReason', 'parentArtifactIds'],
    validate: allOf(stringField('artifactId'), oneOfField('kind', ['result-receipt', 'result-correction']),
      booleanIfPresent('printed'), (raw, push) => {
        if (raw.printReason !== undefined && !isNonEmptyString(raw.printReason)) push('printReason: must be a non-empty string when present');
        if (raw.parentArtifactIds !== undefined && (!Array.isArray(raw.parentArtifactIds)
          || !raw.parentArtifactIds.every(isNonEmptyString))) push('parentArtifactIds: must be an array of non-empty strings when present');
      }),
  },
  result_receipt_reprinted: {
    fields: ['artifactId', 'confirmed', 'idempotencyKey', 'reprintedBy'],
    validate: allOf(stringField('artifactId'), booleanIfPresent('confirmed'), stringField('idempotencyKey'), stringField('reprintedBy')),
  },
  media_dispatched: {
    fields: ['dispatchId', 'target', 'contentId'],
    validate: allOf(stringField('dispatchId'), stringField('target'), stringField('contentId')),
  },
  // `verified` distinguishes a playhead-reported end from a duration-inferred one
  // (spec §8); reports need to tell the two confidences apart.
  media_completed: { fields: ['verified'], validate: () => {} },
  media_stalled: { fields: ['reason'], validate: () => {} },
  // A comprehension gate inside an in-flight dispatch: the media paused at an
  // authored checkpoint, the child answered, and the answer was right. It is an
  // ANNOTATION (see `ANNOTATION_EVENTS`) because clearing a gate is evidence
  // recorded INSIDE `media_dispatched`, not a move out of it — the lesson is
  // still playing, and only `media_completed`/`media_stalled` end it.
  //
  // `at` is the WALL CLOCK, as it is on every other event in this log. The
  // checkpoint's position in the media is authored on the unit
  // (`#domains/school/mediaCheckpoints.mjs`) and looked up by `checkpointId`,
  // so it is deliberately NOT carried here: an `at` that sometimes meant
  // "312 seconds in" and sometimes meant "10:04 on Monday" is the kind of
  // field a report reads wrong for a year. A future need for the observed
  // playhead gets its own unambiguous `positionSeconds`.
  //
  // `attempts` is how many answers it took, >= 1 (a clear costs at least one).
  // There is deliberately NO upper bound: wrong answers re-ask until correct,
  // so a large count is a real fact about a child who struggled, and the one
  // place that reads it (a parent asking "which question stumped them?") is
  // exactly where truncating it would lie.
  checkpoint_cleared: {
    fields: ['checkpointId', 'attempts'],
    validate: allOf(stringField('checkpointId'), (raw, push) => {
      if (!Number.isInteger(raw.attempts) || raw.attempts < 1) push('attempts: must be an integer >= 1');
    }),
  },
  launch_dispatched: {
    fields: ['surface', 'decision', 'approvalId'],
    validate: stringField('surface'),
  },
  program_dispatched: {
    fields: ['programId', 'corpusId', 'day'],
    validate: allOf(stringField('programId'), stringField('corpusId'), (raw, push) => {
      if (!Number.isInteger(raw.day) || raw.day < 1) push('day: must be an integer >= 1');
    }),
  },
  external_activity_dispatched: {
    fields: ['provider', 'attemptId', 'courseRevision', 'policyRevision'],
    validate: allOf(stringField('provider'), stringField('attemptId'), stringField('courseRevision'), stringField('policyRevision')),
  },
  external_activity_assessed: {
    fields: ['provider', 'assessmentId', 'courseRevision', 'policyRevision', 'result', 'measures'],
    validate: allOf(stringField('provider'), stringField('assessmentId'), stringField('courseRevision'),
      stringField('policyRevision'), oneOfField('result', RESULTS), (raw, push) => {
        if (raw.measures !== undefined && (!raw.measures || typeof raw.measures !== 'object' || Array.isArray(raw.measures))) {
          push('measures: must be an object when present');
        }
      }),
  },
  // `companionGate` (optional, Task 11) is the scan's verdict on the sheet's
  // finish-code row, stamped by the SCAN that turned the work in. It matters
  // most on the path that never reaches a `graded` event of its own: an
  // ambiguous bubble or a write-on sends the sheet to a grown-up, and this is
  // the only event `RecordCardScanOutcome` writes before it hands over. The
  // `graded` `GradeSubmission` writes afterwards carries no gate and — by the
  // reducer's "absent never clears" rule — cannot erase this one.
  submitted: {
    fields: ['transport', 'companionGate'],
    validate: allOf(oneOfField('transport', TRANSPORTS), gateField),
  },
  graded: {
    // `passingPercent` (optional) is the bar IN EFFECT at grading time
    // (student-advocacy A4): a later pass-override edit must never move the
    // bar under an already-graded kid, so the close reads this stamp first.
    //
    // `voidedItemIds` (optional) names the questions a grown-up marked `void`
    // — "not markable from the evidence" — and which were therefore taken OUT
    // of `totalCount` before the percent was worked out. Without the stamp a
    // 6-of-8 that was voided down from nine reads identically to a 6-of-8 that
    // was always eight, and the difference is exactly what a later reader
    // needs: one of those sheets had a question nobody could mark.
    // `companionGate` (optional, Task 10) is the scan's verdict on the sheet's
    // finish-code row: `{status: 'satisfied'|'blank'|'wrong'}`. Stamped HERE,
    // beside `passingPercent`, for the same reason — it is a fact about the
    // evidence at grading time, and the close-out must read what the scanner
    // saw rather than re-derive it from a companion record that may since
    // have been satisfied by a different sheet. It carries no percent and no
    // points: the gate can only VETO the pass (`evaluateOutcome`), never move
    // the score. Absent on every ungated sheet, which is all of them today.
    fields: ['attemptIds', 'percent', 'passingPercent', 'correctCount', 'totalCount', 'missedItemIds', 'voidedItemIds', 'companionGate'],
    validate: (raw, push) => {
      gateField(raw, push);
      if (raw.passingPercent !== undefined && (typeof raw.passingPercent !== 'number'
          || !Number.isFinite(raw.passingPercent) || raw.passingPercent < 1 || raw.passingPercent > 100)) {
        push('passingPercent: must be a number from 1-100 when present');
      }
      if (!Array.isArray(raw.attemptIds) || raw.attemptIds.length === 0) {
        push('attemptIds: must be a non-empty array');
      } else {
        raw.attemptIds.forEach((id, i) => {
          if (!isNonEmptyString(id)) push(`attemptIds[${i}]: must be a non-empty string`);
        });
      }
      const pct = raw.percent;
      if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 100) {
        push('percent: must be a number between 0 and 100');
      }
      if (raw.correctCount !== undefined && (!Number.isInteger(raw.correctCount) || raw.correctCount < 0)) {
        push('correctCount: must be an integer >= 0 when present');
      }
      if (raw.totalCount !== undefined && (!Number.isInteger(raw.totalCount) || raw.totalCount < 1)) {
        push('totalCount: must be an integer >= 1 when present');
      }
      if (Number.isInteger(raw.correctCount) && Number.isInteger(raw.totalCount)
          && raw.correctCount > raw.totalCount) push('correctCount must not exceed totalCount');
      if (raw.missedItemIds !== undefined && (!Array.isArray(raw.missedItemIds)
          || !raw.missedItemIds.every(isNonEmptyString))) {
        push('missedItemIds: must be an array of non-empty strings when present');
      }
      if (raw.voidedItemIds !== undefined && (!Array.isArray(raw.voidedItemIds)
          || !raw.voidedItemIds.every(isNonEmptyString))) {
        push('voidedItemIds: must be an array of non-empty strings when present');
      }
    },
  },
  // A LATER SCAN RE-READ THE FINISH-CODE ROW (Task 11).
  //
  // This is how a sheet blocked by its gate is repaired: the child fills in the
  // code bubbles and feeds the SAME card again. It carries the gate and nothing
  // else — no percent, no attempt ids, no verdicts — because that is the entire
  // point: only the gate row is re-read, and the score the sheet already earned
  // stands untouched. Re-grading the questions on a repair scan would let a
  // child add the right bubble beside a wrong answer and gain credit, turning a
  // gate repair into a score repair.
  //
  // AN ANNOTATION, NOT A TRANSITION, and that is what makes it work at all. The
  // sheet has usually already reached `outcome_recorded` by the time the child
  // comes back with the code, and neither `graded` nor `submitted` is legal
  // from there. This one is legal wherever the session is still alive, and it
  // moves the lifecycle nowhere: the work did not un-happen, its verdict on one
  // row simply changed.
  companion_gate_read: { fields: ['companionGate'], validate: gateField },
  outcome_recorded: {
    fields: ['outcomeId', 'result', 'reason'],
    validate: allOf(stringField('outcomeId'), oneOfField('result', RESULTS)),
  },
  // `paidTo` (optional) is WHICH CHILD actually holds these coins. It is not
  // redundant with the session's credited learner: `reassigned` is legal at
  // `rewarded`, so a session can be re-credited AFTER it paid, and from that
  // moment the derived `learnerId` and the child holding the coins are two
  // different people. A later grade correction reconciles the reward by
  // applying a delta — reversing a payment against whoever `learnerId` names
  // now would debit a child who was never paid, and pay the household's coins
  // out twice on a raise. Reconciliation therefore targets THIS field.
  //
  // Written only when a positive amount actually moved (see
  // `CloseSessionOutcome.#recordRewarded`). A skipped or zero reward holds no
  // coins for anybody, so it names nobody, and reconciliation falls back to the
  // currently credited learner — which is also the behaviour every session
  // rewarded before this field existed keeps.
  rewarded: { fields: ['txnId', 'amount', 'paidTo'], validate: stringField('txnId') },
  reward_reconciled: {
    // `paidTo` (optional): whose balance this delta actually landed on. A
    // reconciliation moves coins, so it can create a payee the award never
    // named — see `APPLY.reward_reconciled`. Declared here or `createEvent`
    // drops it, like every other field on this table.
    fields: ['reconciliationId', 'delta', 'txnId', 'sourceAdjustmentId', 'paidTo'],
    validate: allOf(stringField('reconciliationId'), stringField('txnId'), (raw, push) => {
      if (!Number.isInteger(raw.delta) || raw.delta === 0) push('delta: must be a non-zero integer');
    }),
  },
  reward_reconciliation_failed: {
    fields: ['reconciliationId', 'delta', 'reason', 'sourceAdjustmentId'],
    validate: allOf(stringField('reconciliationId'), stringField('reason'), (raw, push) => {
      if (!Number.isInteger(raw.delta) || raw.delta === 0) push('delta: must be a non-zero integer');
    }),
  },
  remediation_opened: {
    fields: ['newSessionId', 'variant', 'openedBy'],
    validate: allOf(stringField('newSessionId'), (raw, push) => {
      if (!(Number.isInteger(raw.variant) && raw.variant >= 0)) push('variant: must be an integer >= 0');
      if (raw.openedBy !== undefined && !isNonEmptyString(raw.openedBy)) {
        push('openedBy: must be a non-empty string when present');
      }
    }),
  },
  // A teacher may replace an unworked retry without rewriting either attempt.
  // This annotation changes which linked sibling is active while the original
  // failed attempt stays terminal and both retry logs remain auditable.
  remediation_replaced: {
    fields: ['previousSessionId', 'newSessionId', 'variant', 'replacementKey', 'reason', 'replacedBy'],
    validate: allOf(
      stringField('previousSessionId'), stringField('newSessionId'),
      stringField('replacementKey'), stringField('reason'), stringField('replacedBy'),
      (raw, push) => {
        if (!(Number.isInteger(raw.variant) && raw.variant >= 0)) push('variant: must be an integer >= 0');
        if (raw.previousSessionId === raw.newSessionId) push('newSessionId must differ from previousSessionId');
      },
    ),
  },
  reassigned: {
    // `reason` is REQUIRED, not optional-when-present. Moving a child's work
    // onto a sibling is a decision with an author and a why (the
    // no-silent-verbs contract), and the event log is where that why has to
    // live: a separate audit trail can go missing or be written best-effort,
    // whereas this fact travels with the work forever. `reviewedBy` names the
    // author; whether that author was allowed is the writer's TeacherGate to
    // decide, not this table's.
    fields: ['fromLearnerId', 'toLearnerId', 'reviewedBy', 'reason'],
    validate: allOf(stringField('fromLearnerId'), stringField('toLearnerId'), stringField('reason'), (raw, push) => {
      // A reassignment to the same learner records no fact and would still
      // rewrite attribution downstream — reject it rather than store a no-op.
      if (isNonEmptyString(raw.toLearnerId) && raw.toLearnerId === raw.fromLearnerId) {
        push('toLearnerId: must differ from fromLearnerId');
      }
    }),
  },
  // Teacher corrections are annotations, not replacement grades. The original
  // `graded` event remains machine evidence; this event supplies the effective
  // interpretation used by reports and progression. `adjustmentId` makes a
  // retriable HTTP/CLI command idempotent and is also the retraction target.
  grade_adjusted: {
    fields: ['adjustmentId', 'percent', 'correctCount', 'totalCount', 'missedItemIds', 'itemVerdicts', 'reason', 'adjustedBy', 'baseSeq'],
    validate: allOf(stringField('adjustmentId'), stringField('reason'), stringField('adjustedBy'), percentIfPresent('percent'), (raw, push) => {
      if (raw.percent === undefined && raw.correctCount === undefined) {
        push('percent or correctCount must be supplied');
      }
      if (raw.percent === undefined && raw.correctCount !== undefined && raw.totalCount === undefined) {
        push('totalCount is required when deriving percent from correctCount');
      }
      if (raw.correctCount !== undefined && (!Number.isInteger(raw.correctCount) || raw.correctCount < 0)) {
        push('correctCount: must be an integer >= 0 when present');
      }
      if (raw.totalCount !== undefined && (!Number.isInteger(raw.totalCount) || raw.totalCount < 1)) {
        push('totalCount: must be an integer >= 1 when present');
      }
      if (Number.isInteger(raw.correctCount) && Number.isInteger(raw.totalCount)
          && raw.correctCount > raw.totalCount) push('correctCount must not exceed totalCount');
      if (raw.missedItemIds !== undefined && (!Array.isArray(raw.missedItemIds)
          || !raw.missedItemIds.every(isNonEmptyString))) {
        push('missedItemIds: must be an array of non-empty strings when present');
      }
      if (raw.itemVerdicts !== undefined && (!Array.isArray(raw.itemVerdicts)
          || !raw.itemVerdicts.every((v) => v && isNonEmptyString(v.itemId) && typeof v.correct === 'boolean'))) {
        push('itemVerdicts: must be an array of {itemId, correct} records when present');
      }
      if (raw.baseSeq !== undefined && !isSeq(raw.baseSeq)) push('baseSeq: must be an integer >= 1 when present');
    }),
  },
  grade_adjustment_retracted: {
    fields: ['adjustmentId', 'reason', 'retractedBy', 'baseSeq'],
    validate: allOf(stringField('adjustmentId'), stringField('reason'), stringField('retractedBy'), (raw, push) => {
      if (raw.baseSeq !== undefined && !isSeq(raw.baseSeq)) push('baseSeq: must be an integer >= 1 when present');
    }),
  },
  // The scan remains machine evidence, but none of its answers may be used as
  // learner evidence. This is deliberately distinct from a grade adjustment:
  // when the wrong worksheet was bubbled there is no honest replacement score.
  evidence_invalidated: {
    fields: ['invalidationId', 'attemptIds', 'reason', 'invalidatedBy', 'baseSeq'],
    validate: allOf(stringField('invalidationId'), stringField('reason'), stringField('invalidatedBy'), (raw, push) => {
      if (!Array.isArray(raw.attemptIds) || raw.attemptIds.length === 0
          || !raw.attemptIds.every(isNonEmptyString)) {
        push('attemptIds: must be a non-empty array of attempt ids');
      }
      if (Array.isArray(raw.attemptIds) && new Set(raw.attemptIds).size !== raw.attemptIds.length) {
        push('attemptIds: must not contain duplicates');
      }
      if (raw.baseSeq !== undefined && !isSeq(raw.baseSeq)) push('baseSeq: must be an integer >= 1 when present');
    }),
  },
  // Human-confirmed lineage for answers that were physically marked against
  // another worksheet's row window. This says where the credit came from; it
  // does not invent machine-readable answer values or replace grading.
  evidence_attributed: {
    fields: [
      'attributionId', 'sourceSessionId', 'sourceCardId', 'sourceRows',
      'targetCardId', 'targetRows', 'itemIds', 'marks',
      'reason', 'attributedBy', 'baseSeq',
    ],
    validate: allOf(
      stringField('attributionId'), stringField('sourceSessionId'),
      stringField('sourceCardId'), stringField('targetCardId'),
      stringField('reason'), stringField('attributedBy'),
      (raw, push) => {
        const integerRows = (rows) => Array.isArray(rows) && rows.length > 0
          && rows.every((row) => Number.isInteger(row) && row >= 1 && row <= 50)
          && new Set(rows).size === rows.length;
        if (!integerRows(raw.sourceRows)) push('sourceRows: must be unique integers from 1 to 50');
        if (!integerRows(raw.targetRows)) push('targetRows: must be unique integers from 1 to 50');
        if (!Array.isArray(raw.itemIds) || raw.itemIds.length === 0
            || !raw.itemIds.every(isNonEmptyString)) {
          push('itemIds: must be a non-empty array of item ids');
        }
        if (!Array.isArray(raw.marks) || raw.marks.length === 0
            || !raw.marks.every(isNonEmptyString)) {
          push('marks: must be a non-empty array of human-confirmed marks');
        }
        const lengths = [raw.sourceRows?.length, raw.targetRows?.length, raw.itemIds?.length, raw.marks?.length];
        if (lengths.some((length) => length !== lengths[0])) {
          push('sourceRows, targetRows, itemIds, and marks must have equal lengths');
        }
        if (raw.baseSeq !== undefined && !isSeq(raw.baseSeq)) push('baseSeq: must be an integer >= 1 when present');
      },
    ),
  },
  failed: { fields: ['stage', 'reason'], validate: allOf(stringField('stage'), stringField('reason')) },
  abandoned: { fields: ['reason', 'decidedBy'], validate: () => {} },
};

export const EVENT_TYPES = Object.freeze(Object.keys(SCHEMA));

/**
 * The legal transition table (spec §5.2) — a closed map, read as "while the
 * session is in state K, these event types may be appended".
 */
export const TRANSITIONS = Object.freeze({
  created: ['issued', 'media_dispatched', 'launch_dispatched', 'program_dispatched', 'external_activity_dispatched', 'abandoned'],
  issued: ['submitted', 'reprinted', 'failed', 'abandoned'],
  reprinted: ['submitted', 'reprinted', 'abandoned'],
  media_dispatched: ['media_completed', 'media_stalled', 'abandoned'],
  media_completed: ['issued', 'submitted'],
  media_stalled: ['media_dispatched', 'abandoned'],
  launch_dispatched: ['outcome_recorded', 'abandoned'],
  program_dispatched: ['outcome_recorded', 'abandoned'],
  external_activity_dispatched: ['external_activity_assessed', 'abandoned'],
  external_activity_assessed: ['outcome_recorded'],
  submitted: ['graded'],
  graded: ['outcome_recorded'],
  // `outcome_recorded -> outcome_recorded` is a SUPERSEDING result, not a
  // second one (Task 11): the reducer keeps only the latest, the outcome id is
  // derived from the session so it does not change, and `#recordOutcomeAndSettle`
  // only writes one when the RULE that decided has actually changed. It exists
  // for exactly one move — a companion gate that was blocking this sheet has
  // since been read again and now says something else — which is the only way a
  // settled sheet can honestly change its verdict without a grown-up. Same
  // shape as the `reprinted -> reprinted` self-edge above.
  outcome_recorded: ['rewarded', 'remediation_opened', 'outcome_recorded'],
});

/**
 * Events that record a fact WITHOUT advancing the state.
 *
 * - `failed` is non-advancing by spec §9: "the same token stays valid because
 *   state didn't advance, so the next scan retries". Retrying an issue emits
 *   `reprinted` (legal from `issued`), which is why `failed` needs no outgoing
 *   edges of its own. It is legal at any non-terminal state — the canonical
 *   failure is an offline printer, which can strike before anything issued.
 * - `reassigned` (spec §5.3) re-credits the work and rides the existing
 *   `attributedTo` mechanics; the lifecycle position is unchanged.
 * - `checkpoint_cleared` is evidence from INSIDE an in-flight media dispatch:
 *   the child answered a mid-lesson gate correctly and the video resumed. The
 *   lesson has not finished, so the state must stay `media_dispatched` — an
 *   advancing event here would release the linked quiz halfway through the
 *   video, which is the exact thing the gate exists to prevent.
 * - `companion_gate_read` (Task 11) is a re-read of the finish-code row by a
 *   later scan of the same sheet. It changes the verdict on one row, never the
 *   lifecycle position: the work was handed in and graded exactly when it was,
 *   and a child coming back with the code does not un-submit it.
 */
export const ANNOTATION_EVENTS = Object.freeze(new Set([
  'failed', 'reassigned', 'grade_adjusted', 'grade_adjustment_retracted',
  'evidence_invalidated', 'evidence_attributed',
  'reward_reconciled', 'reward_reconciliation_failed',
  'result_receipt_captured', 'result_receipt_reprinted', 'checkpoint_cleared',
  'companion_gate_read', 'remediation_replaced',
]));
/**
 * Annotations that are legal only from specific states, overriding the default
 * "legal anywhere non-terminal".
 *
 * `failed` and `reassigned` can strike at any point in a session's life, which
 * is why the default is as wide as it is. A checkpoint clear cannot: there is
 * no gate to clear before anything was dispatched, and none left once the
 * media ended. Accepting one from `created` would file an answer against a
 * lesson that never played.
 *
 * `media_stalled` IS accepted, and that is not a loophole — it is the common
 * case. `RecordMediaCompletion.checkStalled` stalls a dispatch at
 * `dispatchedAt + duration + grace`, grace defaulting to 600s. A 20-minute
 * lesson is therefore stalled at 30 minutes of wall clock — and a 20-minute
 * lesson with five gates, at ~2 minutes per gate while a six-year-old thinks
 * and answers, takes exactly that. So a perfectly healthy gated lesson wanders
 * into `media_stalled` just by having an attentive child. Refusing the clear
 * there would reject a CORRECT answer, lose the evidence, and re-ask the
 * question after the replay — the precise frustration this feature exists to
 * prevent, and indistinguishable from a broken gate to the child sitting there.
 * Nothing is lost by accepting it: `media_stalled -> media_dispatched` is
 * already a legal replay edge, so the session is alive, and a clear is evidence
 * about the CHILD, not a claim about the transport that stalled.
 *
 * (Annotations are absent from `TRANSITIONS` by construction, so
 * `statesAccepting` answers empty for every one of them — `transitionViolation`
 * below is the authority on annotation legality, as it always was.)
 */
const ANNOTATION_STATES = new Map([
  ['checkpoint_cleared', new Set(['media_dispatched', 'media_stalled'])],
  ['remediation_replaced', new Set(['remediation_opened'])],
]);

/**
 * The annotations that stay legal after the session has settled.
 *
 * The default is the other way round: a terminal state closes an annotation
 * out, because most of them describe work still in motion — a `failed` print
 * on a session nobody will ever print again is a fact about something that has
 * already stopped. Membership here is the deliberately narrow exception, one
 * reason per group:
 *
 * - `grade_adjusted` / `grade_adjustment_retracted`, and the
 *   `reward_reconciled` / `reward_reconciliation_failed` pair that follows
 *   them: a mark discovered wrong AFTER the coins were paid must still be
 *   correctable, and the reward reconciles from the corrected grade.
 * - `result_receipt_captured` / `result_receipt_reprinted`: settlement closes
 *   the state before its retained receipt can be linked. These are
 *   evidence-only and must remain legal afterwards.
 * - `reassigned`: a reassignment changes ATTRIBUTION, never lifecycle position
 *   — the same argument that already admits `grade_adjusted`. Finding the
 *   wrong child's name on a `rewarded` lesson is exactly the moment the move
 *   is needed, and leaving it illegal there would mean settled work is the one
 *   work that can never be given back to whoever actually did it. The coin
 *   ledger is NOT rewritten by an attribution change, and NOTHING moves it
 *   afterwards: no code path debits one child and credits another. The coins
 *   stay with whoever was paid — which is why the fold tracks `rewardPaidTo`
 *   across both `rewarded` and `reward_reconciled`, so that a later
 *   reconciliation reverses a payment against the child who actually holds it
 *   rather than whoever the work is credited to by then. That holds for every
 *   log in the store, not only ones written since: where the event carries no
 *   payee the fold derives one, and it is exact, because a reassignment could
 *   not legally follow a reward until this change. Making a reassignment MOVE
 *   coins is a household-economy decision nobody has taken.
 */
const TERMINAL_ANNOTATIONS = new Set([
  'grade_adjusted', 'grade_adjustment_retracted', 'evidence_invalidated', 'evidence_attributed',
  'reward_reconciled', 'reward_reconciliation_failed',
  'result_receipt_captured', 'result_receipt_reprinted',
  'reassigned',
]);

/** States the table can reach but never leave. */
export const TERMINAL_STATES = Object.freeze(new Set(
  [...new Set(Object.values(TRANSITIONS).flat())]
    .filter((state) => !TRANSITIONS[state] && !ANNOTATION_EVENTS.has(state)),
));

/**
 * `TRANSITIONS` read backwards: event type -> the states it may be appended from.
 *
 * It exists so that callers asking "may this session still be issued a sheet?"
 * can ask the TABLE instead of hand-writing their own copy of the answer. Three
 * use cases used to carry a literal `ISSUABLE = new Set([...])`, each a manual
 * projection of the same four states, each free to drift the moment an edge was
 * added or removed here. Derived, not declared: there is only ever one table.
 */
const ACCEPTING = (() => {
  const index = new Map();
  Object.entries(TRANSITIONS).forEach(([state, types]) => {
    types.forEach((type) => {
      if (!index.has(type)) index.set(type, new Set());
      index.get(type).add(state);
    });
  });
  return index;
})();

/**
 * @param {string} eventType
 * @returns {Set<string>} a fresh set (callers must not be able to edit the table)
 */
export function statesAccepting(eventType) {
  return new Set(ACCEPTING.get(eventType) ?? []);
}

/** The one wording for "this log has not been opened yet". */
const MUST_OPEN = 'session must open with a created event';

/**
 * Decide whether `eventType` may be appended while the session sits in `state`.
 *
 * This is the SINGLE legality decision — `reduceSession` consults it when it
 * folds a log, and `YamlWorkSessionDatastore.appendEvent` consults it before it
 * writes one. The reducer records a violation and moves on, because a log that
 * crashes the reducer destroys the only evidence of the work it describes; the
 * datastore refuses, because there is no such evidence to protect yet and an
 * event written here is a fact asserted about a child's work that never
 * happened. Same table, two postures, deliberately.
 *
 * @param {string|null} state - the derived state, null for an empty log
 * @param {string} eventType
 * @returns {string|null} null when legal, else the reason in house notation
 */
export function transitionViolation(state, eventType) {
  const annotation = ANNOTATION_EVENTS.has(eventType);
  if (state === null && !annotation) {
    return eventType === 'created' ? null : MUST_OPEN;
  }
  const only = ANNOTATION_STATES.get(eventType);
  const legal = annotation
    ? state !== null && (only
      ? only.has(state)
      : (!TERMINAL_STATES.has(state) || TERMINAL_ANNOTATIONS.has(eventType)))
    : (TRANSITIONS[state] || []).includes(eventType);
  return legal ? null : `illegal transition ${state} -> ${eventType}`;
}

function validateInto(raw, errors) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push('event must be a mapping');
    return null;
  }
  // Own-property lookup, not a bracket read: `constructor`/`toString` would
  // otherwise resolve to an Object.prototype function and validate clean.
  const known = Object.prototype.hasOwnProperty.call(SCHEMA, raw.type);
  if (!known) errors.push(`type: unknown event type: ${raw.type}`);
  if (!isIsoTimestamp(raw.at)) errors.push('at: must be an ISO-8601 timestamp');
  if (!isNonEmptyString(raw.sessionId)) errors.push('sessionId: must be a non-empty string');
  // Optional on the way in: the datastore stamps `seq` inside its append lock,
  // because two callers that each read nextSeq() before either wrote would
  // otherwise collide and one child's event would overwrite another's.
  if (raw.seq !== undefined && !isSeq(raw.seq)) errors.push('seq: must be an integer >= 1');
  if (!known) return null;
  SCHEMA[raw.type].validate(raw, (message) => errors.push(message));
  return SCHEMA[raw.type];
}

/**
 * @param {*} raw - one candidate event
 * @returns {{ errors: string[] }} empty errors === valid
 */
export function validateEvent(raw) {
  const errors = [];
  validateInto(raw, errors);
  return { errors };
}

/**
 * Build one session event, validating its per-type payload.
 *
 * @param {*} raw - `{ type, at, sessionId, seq?, ...payload }`
 * @returns {{ errors: string[], event?: object }} the event only when valid
 */
export function createEvent(raw) {
  const errors = [];
  const schema = validateInto(raw, errors);
  if (errors.length) return { errors };
  const event = { type: raw.type, at: raw.at, sessionId: raw.sessionId };
  if (raw.seq !== undefined) event.seq = raw.seq;
  schema.fields.forEach((f) => { if (raw[f] !== undefined) event[f] = raw[f]; });
  return { errors, event };
}

const emptyState = () => ({
  sessionId: null,
  learnerId: null,
  unitId: null,
  studyDay: null,
  state: null,
  terminal: false,
  issuedArtifacts: [],
  resultReceiptArtifacts: [],
  // The `at` of the most recent CONFIRMED `issued`/`reprinted` event — NOT
  // the most recent scan, and not just any issue. IssueDocument's
  // print-debounce times its cooldown window from this field for two
  // independent reasons: a `failed` annotation (an attempt that never
  // reached paper) does not touch it, so a print that failed is retryable on
  // the very next scan; and an `issued`/`reprinted` event with
  // `confirmed: false` (the injected printer port saying "I did not actually
  // send this anywhere") ALSO does not touch it — an issue that does not
  // print must not arm the cooldown, or a household print-preview/simulator
  // tool silently blocks the next REAL print for however many minutes the
  // cooldown lasts, for a sheet nobody ever saw. See the `issued`/
  // `reprinted` handlers below.
  lastPrintedAt: null,
  // When this session's work was FIRST handed out, which `lastPrintedAt`
  // cannot answer: every reprint moves that forward, so a week-old session
  // reprinted this morning looks like this morning's work. Learner-Four's session
  // was created 2026-08-14, sat unsubmitted, and resumed eight days later
  // presenting itself as fresh — a different student number and a sheet
  // starting at question 7, with nothing on the paper explaining why. Set
  // once, by the first `issued` event, and never moved after.
  firstIssuedAt: null,
  attemptIds: [],
  gradedPercent: null,
  machineGrade: null,
  gradeAdjustments: [],
  evidenceInvalidations: [],
  evidenceInvalidated: false,
  evidenceAttributions: [],
  gradedPassingPercent: null,
  gradedCorrectCount: null,
  gradedTotalCount: null,
  // The scan's verdict on the finish-code row (Task 10), or null on an
  // ungated sheet. NOT part of the grade — it sits beside the percent rather
  // than inside it, which is exactly how `evaluateOutcome` uses it: a veto
  // over a sheet that has already scored well enough to pass.
  companionGate: null,
  missedItemIds: [],
  // The questions a grown-up could not mark at all (`void`). They were left
  // out of the graded event's `totalCount`, so a reader that wants to know
  // "out of how many, and which ones went missing from that count" has both
  // here without re-folding the log.
  voidedItemIds: [],
  transport: null,
  mediaDispatch: null,
  // Rows, not a Set, and shaped exactly as `clearedSetFrom` in
  // `#domains/school/mediaCheckpoints.mjs` consumes them: the derived state is
  // read back through YAML and HTTP, where a Set serialises to `{}`. Same
  // posture as `resultReceiptArtifacts` and `gradeAdjustments` above — an
  // ordered array of plain records, deduped on append.
  clearedCheckpoints: [],
  outcome: null,
  machineOutcome: null,
  rewardTxn: null,
  rewardAmount: 0,
  // The child holding the coins this session paid — NOT necessarily the child
  // it is now credited to, because a session can be reassigned after it was
  // rewarded. Null when nothing was paid. See the `rewarded` schema comment.
  rewardPaidTo: null,
  rewardReconciliations: [],
  remediationOf: null,
  remediationItemIds: [],
  replacementKey: null,
  replacesSessionId: null,
  // Which equivalent-problem form of the unit this session was opened with
  // (spec §3.3). Derived rather than looked up because the document that gets
  // reprinted has to be the SAME variant the child was handed.
  variant: 0,
  remediation: null,
  remediationHistory: [],
  lastFailure: null,
  launch: null,
  externalActivity: null,
  eventCount: 0,
  nextAction: null,
  errors: [],
});

const APPLY = {
  created(s, e) {
    s.learnerId = e.learnerId ?? null;
    s.unitId = e.unitId ?? null;
    s.studyDay = e.studyDay ?? null;
    if (e.remediationOf) s.remediationOf = e.remediationOf;
    if (Array.isArray(e.remediationItemIds)) s.remediationItemIds = [...e.remediationItemIds];
    if (Number.isInteger(e.variant)) s.variant = e.variant;
    if (isNonEmptyString(e.replacementKey)) s.replacementKey = e.replacementKey;
    if (isNonEmptyString(e.replacesSessionId)) s.replacesSessionId = e.replacesSessionId;
  },
  issued(s, e) {
    if (e.artifactId && !s.issuedArtifacts.includes(e.artifactId)) s.issuedArtifacts.push(e.artifactId);
    s.lastFailure = null;
    // `e.confirmed === false` is the ONLY way to opt out — absent (every
    // production print; every event built before this field existed) and
    // `true` both arm the cooldown, so this is additive: nothing that used to
    // set `lastPrintedAt` stops doing so. See this event type's own SCHEMA
    // comment for what `confirmed` represents and who sets it to false.
    if (e.confirmed !== false) s.lastPrintedAt = e.at;
    // First issue wins, unconditionally — including an unconfirmed one. This
    // records WHEN THE WORK WAS ASSIGNED, which is true whether or not that
    // particular attempt reached paper, and it is deliberately not guarded by
    // `confirmed` the way the print cooldown above is.
    if (s.firstIssuedAt === null) s.firstIssuedAt = e.at;
  },
  reprinted(s, e, push) {
    if (e.artifactId && !s.issuedArtifacts.includes(e.artifactId)) {
      push(`reprinted artifactId "${e.artifactId}" was never issued (a reprint reuses the original)`);
    }
    s.lastFailure = null;
    if (e.confirmed !== false) s.lastPrintedAt = e.at;
  },
  result_receipt_captured(s, e) {
    if (!e.artifactId || s.resultReceiptArtifacts.some((row) => row.artifactId === e.artifactId)) return;
    s.resultReceiptArtifacts.push({ artifactId: e.artifactId, kind: e.kind,
      printed: e.printed !== false, printReason: e.printReason ?? null,
      parentArtifactIds: e.parentArtifactIds ?? [], at: e.at });
  },
  media_dispatched(s, e) {
    s.mediaDispatch = {
      dispatchId: e.dispatchId ?? null,
      target: e.target ?? null,
      contentId: e.contentId ?? null,
      status: 'dispatched',
    };
    s.lastFailure = null;
  },
  media_completed(s, e) {
    if (s.mediaDispatch) {
      s.mediaDispatch.status = 'completed';
      if (e.verified !== undefined) s.mediaDispatch.verified = e.verified;
    }
  },
  media_stalled(s) {
    if (s.mediaDispatch) s.mediaDispatch.status = 'stalled';
  },
  // First clear wins. The screen may retry its POST (a resume that the child is
  // watching for is worth retrying), and a re-delivered clear is the SAME fact:
  // the gate released at the first one. Overwriting would move `at` forward and
  // let a duplicate inflate `attempts`, turning one right answer into a record
  // of a child who struggled.
  checkpoint_cleared(s, e) {
    if (!isNonEmptyString(e.checkpointId)) return;
    if (s.clearedCheckpoints.some((row) => row.checkpointId === e.checkpointId)) return;
    s.clearedCheckpoints.push({ checkpointId: e.checkpointId, attempts: e.attempts, at: e.at });
  },
  launch_dispatched(s, e) {
    s.launch = {
      surface: e.surface ?? null,
      at: e.at,
    };
    s.lastFailure = null;
  },
  program_dispatched(s, e) {
    s.launch = {
      surface: 'program',
      programId: e.programId ?? null,
      corpusId: e.corpusId ?? null,
      day: e.day ?? null,
      at: e.at,
    };
    s.lastFailure = null;
  },
  external_activity_dispatched(s, e) {
    s.externalActivity = {
      provider: e.provider, attemptId: e.attemptId, courseRevision: e.courseRevision,
      policyRevision: e.policyRevision, status: 'dispatched', dispatchedAt: e.at,
    };
    s.lastFailure = null;
  },
  external_activity_assessed(s, e) {
    s.externalActivity = {
      ...(s.externalActivity ?? {}), provider: e.provider, assessmentId: e.assessmentId,
      courseRevision: e.courseRevision, policyRevision: e.policyRevision,
      result: e.result, measures: e.measures ?? null, status: 'assessed', assessedAt: e.at,
    };
    s.gradedPercent = e.result === 'passed' ? 100 : 0;
    s.gradedPassingPercent = 100;
  },
  submitted(s, e) {
    s.transport = e.transport ?? null;
    s.lastFailure = null;
    // The verdict the SCAN read, recorded before anyone knows whether this
    // sheet will reach `graded` through the scanner or through a grown-up.
    applyGate(s, e);
  },
  graded(s, e) {
    (Array.isArray(e.attemptIds) ? e.attemptIds : []).forEach((id) => {
      if (isNonEmptyString(id) && !s.attemptIds.includes(id)) s.attemptIds.push(id);
    });
    if (typeof e.percent === 'number') s.gradedPercent = e.percent;
    if (typeof e.passingPercent === 'number') s.gradedPassingPercent = e.passingPercent;
    if (Number.isInteger(e.correctCount)) s.gradedCorrectCount = e.correctCount;
    if (Number.isInteger(e.totalCount)) s.gradedTotalCount = e.totalCount;
    if (Array.isArray(e.missedItemIds)) s.missedItemIds = [...e.missedItemIds];
    if (Array.isArray(e.voidedItemIds)) s.voidedItemIds = [...e.voidedItemIds];
    // A re-scan of the same sheet re-states the gate; the latest read wins,
    // which is what makes Task 11's repair-by-re-scan possible at all.
    applyGate(s, e);
    s.machineGrade = {
      percent: typeof e.percent === 'number' ? e.percent : null,
      passingPercent: typeof e.passingPercent === 'number' ? e.passingPercent : null,
      correctCount: Number.isInteger(e.correctCount) ? e.correctCount : null,
      totalCount: Number.isInteger(e.totalCount) ? e.totalCount : null,
      missedItemIds: Array.isArray(e.missedItemIds) ? [...e.missedItemIds] : [],
      attemptIds: Array.isArray(e.attemptIds) ? [...e.attemptIds] : [],
    };
  },
  companion_gate_read(s, e) {
    // Latest read wins, same rule the `graded` and `submitted` stamps follow —
    // that is what makes repair-by-re-scan work: the child fills in the code,
    // feeds the sheet again, and this restates the row.
    applyGate(s, e);
  },
  outcome_recorded(s, e) {
    // `reason` (already a declared field on this event, and already written by
    // `CloseSessionOutcome`) is now carried into the derived state too: WHICH
    // rule decided this is the difference between "you were below the bar" and
    // "your read-along code was blank", and a reader that can only see
    // `needs_remediation` cannot tell a child which one they hit.
    s.outcome = {
      outcomeId: e.outcomeId ?? null, result: e.result ?? null, at: e.at,
      ...(isNonEmptyString(e.reason) ? { reason: e.reason } : {}),
    };
    s.machineOutcome = { ...s.outcome };
  },
  rewarded(s, e) {
    s.rewardTxn = e.txnId ?? null;
    s.rewardAmount = Number.isInteger(e.amount) ? e.amount : 0;
    // Stamp first, DERIVE second. Every log written before `paidTo` existed
    // carries none, and those sessions are not safe just because they are old:
    // the session can be reassigned tomorrow, and the reversal that follows
    // must still find the child who was paid. The derivation is exact for all
    // of them — a reassignment could not legally follow a reward until this
    // change, so at the instant `rewarded` folds, `s.learnerId` IS the id
    // `economy.earn` was called with. Zero paid, nobody named.
    s.rewardPaidTo = isNonEmptyString(e.paidTo)
      ? e.paidTo
      : (Number.isInteger(e.amount) && e.amount > 0 ? s.learnerId : s.rewardPaidTo);
  },
  reward_reconciled(s, e) {
    s.rewardAmount += e.delta;
    // A reconciliation MOVES COINS TOO, so it can create a payee where the
    // award named none — a session that closed unpaid, was reassigned, then
    // corrected upward paid the child credited at that moment. Same
    // stamp-then-derive rule, and for the same reason: reconciliations already
    // on disk carry no `paidTo` and must still resolve to whoever holds the
    // balance. A balance back at zero is held by nobody, so it names nobody
    // and the next credit goes to whoever the work belongs to by then.
    if (isNonEmptyString(e.paidTo)) s.rewardPaidTo = e.paidTo;
    else if (s.rewardPaidTo === null) s.rewardPaidTo = s.learnerId;
    if (!(s.rewardAmount > 0)) s.rewardPaidTo = null;
    s.rewardReconciliations.push({ reconciliationId: e.reconciliationId, delta: e.delta,
      txnId: e.txnId, sourceAdjustmentId: e.sourceAdjustmentId ?? null, at: e.at, status: 'applied' });
  },
  reward_reconciliation_failed(s, e) {
    s.rewardReconciliations.push({ reconciliationId: e.reconciliationId, delta: e.delta,
      sourceAdjustmentId: e.sourceAdjustmentId ?? null, at: e.at, status: 'failed', reason: e.reason });
  },
  remediation_opened(s, e) {
    s.remediation = { newSessionId: e.newSessionId ?? null, variant: e.variant ?? null };
    s.remediationHistory.push({
      kind: 'opened', newSessionId: e.newSessionId ?? null, variant: e.variant ?? null, at: e.at,
    });
  },
  remediation_replaced(s, e) {
    s.remediation = { newSessionId: e.newSessionId ?? null, variant: e.variant ?? null };
    s.remediationHistory.push({
      kind: 'replaced', previousSessionId: e.previousSessionId ?? null,
      newSessionId: e.newSessionId ?? null, variant: e.variant ?? null,
      replacementKey: e.replacementKey ?? null, reason: e.reason ?? null,
      replacedBy: e.replacedBy ?? null, at: e.at,
    });
  },
  reassigned(s, e) { if (isNonEmptyString(e.toLearnerId)) s.learnerId = e.toLearnerId; },
  grade_adjusted(s, e, push) {
    if (!s.machineGrade) {
      push('cannot adjust a session with no machine grade');
      return;
    }
    if (s.gradeAdjustments.some((row) => row.adjustmentId === e.adjustmentId)) {
      push(`duplicate adjustmentId "${e.adjustmentId}"`);
      return;
    }
    s.gradeAdjustments.push({
      adjustmentId: e.adjustmentId,
      percent: typeof e.percent === 'number' ? e.percent : null,
      correctCount: Number.isInteger(e.correctCount) ? e.correctCount : null,
      totalCount: Number.isInteger(e.totalCount) ? e.totalCount : null,
      missedItemIds: Array.isArray(e.missedItemIds) ? [...e.missedItemIds] : null,
      itemVerdicts: Array.isArray(e.itemVerdicts) ? e.itemVerdicts.map((v) => ({ ...v })) : [],
      reason: e.reason,
      adjustedBy: e.adjustedBy,
      at: e.at,
      seq: e.seq,
      retracted: false,
    });
  },
  grade_adjustment_retracted(s, e, push) {
    const target = [...s.gradeAdjustments].reverse().find((row) => row.adjustmentId === e.adjustmentId);
    if (!target) {
      push(`adjustmentId "${e.adjustmentId}" does not exist`);
      return;
    }
    if (target.retracted) {
      push(`adjustmentId "${e.adjustmentId}" is already retracted`);
      return;
    }
    target.retracted = true;
    target.retractedAt = e.at;
    target.retractedBy = e.retractedBy;
    target.retractionReason = e.reason;
  },
  evidence_invalidated(s, e, push) {
    if (!s.machineGrade) {
      push('cannot invalidate a session with no machine grade');
      return;
    }
    if (s.evidenceInvalidations.some((row) => row.invalidationId === e.invalidationId)) {
      push(`duplicate invalidationId "${e.invalidationId}"`);
      return;
    }
    s.evidenceInvalidations.push({
      invalidationId: e.invalidationId,
      attemptIds: [...e.attemptIds],
      reason: e.reason,
      invalidatedBy: e.invalidatedBy,
      at: e.at,
      seq: e.seq,
    });
    s.evidenceInvalidated = true;
  },
  evidence_attributed(s, e, push) {
    if (s.evidenceAttributions.some((row) => row.attributionId === e.attributionId)) {
      push(`duplicate attributionId "${e.attributionId}"`);
      return;
    }
    s.evidenceAttributions.push({
      attributionId: e.attributionId,
      sourceSessionId: e.sourceSessionId,
      sourceCardId: e.sourceCardId,
      sourceRows: [...e.sourceRows],
      targetCardId: e.targetCardId,
      targetRows: [...e.targetRows],
      itemIds: [...e.itemIds],
      marks: [...e.marks],
      reason: e.reason,
      attributedBy: e.attributedBy,
      at: e.at,
      seq: e.seq,
    });
  },
  failed(s, e) { s.lastFailure = { stage: e.stage ?? null, reason: e.reason ?? null, at: e.at }; },
  abandoned() {},
};

/**
 * The printed next move for each non-terminal state.
 *
 * `tokenClass` names the action-token class that carries the move where a scan
 * is what advances it (see `./tokens.mjs`); null means the move belongs to a
 * grown-up or to the system, not to a barcode.
 */
function computeNextAction(s) {
  const act = (kind, label, tokenClass = null) => ({ kind, label, tokenClass, sessionId: s.sessionId });
  if (s.state === null || TERMINAL_STATES.has(s.state)) return null;
  switch (s.state) {
    case 'created':
      return s.lastFailure
        ? act('issue_document', 'Scan your ticket to try printing again', 'recovery')
        : act('issue_document', 'Scan your ticket to print your work', 'issue_document');
    case 'issued':
    case 'reprinted':
      return s.lastFailure
        ? act('reprint_document', 'Scan your ticket to print it again', 'recovery')
        : act('submit_work', 'Turn your work in to be checked');
    case 'media_dispatched':
      return act('await_media_completion', 'Finish watching, then scan your card');
    case 'media_completed':
      return act('issue_document', 'Scan your ticket to print the questions', 'issue_document');
    case 'media_stalled':
      return act('replay_media', 'Scan your ticket to start it again', 'media_action');
    case 'launch_dispatched':
      return act('record_outcome', 'Waiting for the work to be done');
    case 'program_dispatched':
      return act('continue_program', 'Keep going on the Portal.');
    case 'external_activity_dispatched':
      return act('await_external_assessment', 'Finish the activity in Fitness');
    case 'external_activity_assessed':
      return act('record_outcome', 'Recording the Fitness result');
    case 'submitted':
      return act('grade_work', 'A grown-up will check this');
    case 'graded':
      return act('record_outcome', 'Recording the result');
    case 'outcome_recorded':
      return s.outcome?.result === 'needs_remediation'
        ? act('open_remediation', 'Scan the retry ticket for a fresh sheet', 'remediation')
        // Whether coins are actually due is policy the reducer cannot see —
        // `./outcome.mjs` decides, and may skip. The step is still real: the
        // outcome is recorded and something must close it out.
        : act('award_reward', 'Collect the reward for this unit');
    default:
      // Unreachable while TRANSITIONS and this switch agree, but a state with
      // no case would be exactly the wedge the property test forbids, so fall
      // back to the action that always exists: reprint what is in hand.
      return act('reprint_document', 'Scan your ticket to print it again', 'recovery');
  }
}

/**
 * Fold an append-only event log into the session's derived state.
 *
 * Events reduce in `seq` order regardless of array order — the log is a set of
 * facts, not a sequence of lines, and a file that was concatenated or re-sorted
 * on disk must still reduce identically.
 *
 * @param {Array} events
 * @returns {object} derived state; `errors[]` is empty for a clean log
 */
export function reduceSession(events) {
  const s = emptyState();
  if (!Array.isArray(events)) {
    s.errors.push('events: must be an array');
    return s;
  }

  // --- pass 1: entries that cannot be ordered at all ------------------------
  const ordered = [];
  events.forEach((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      s.errors.push('event[seq=?]: event must be a mapping');
      return;
    }
    if (!isSeq(raw.seq)) {
      s.errors.push('event[seq=?]: seq must be an integer >= 1');
      return;
    }
    ordered.push(raw);
  });
  // Stable sort: among a duplicated seq the earlier array position wins, so the
  // reported "kept" event is deterministic.
  ordered.sort((a, b) => a.seq - b.seq);

  // --- pass 2: fold ---------------------------------------------------------
  const seen = new Set();
  ordered.forEach((raw) => {
    const at = `event[seq=${raw.seq}]`;
    const push = (message) => s.errors.push(`${at}: ${message}`);
    if (seen.has(raw.seq)) {
      push(`duplicate seq (${raw.type})`);
      return;
    }
    seen.add(raw.seq);

    if (!Object.prototype.hasOwnProperty.call(SCHEMA, raw.type)) {
      push(`unknown event type: ${raw.type}`);
      return;
    }
    if (s.sessionId === null) s.sessionId = isNonEmptyString(raw.sessionId) ? raw.sessionId : null;
    else if (raw.sessionId !== s.sessionId) {
      push(`sessionId "${raw.sessionId}" does not match session ${s.sessionId}`);
      return;
    }

    // Payload problems are reported but do not veto the transition: a `graded`
    // event with an unreadable percent still happened, and hiding it would make
    // the session look un-submitted.
    validateEvent(raw).errors.forEach((message) => {
      if (!message.startsWith('type:')) push(message);
    });

    const annotation = ANNOTATION_EVENTS.has(raw.type);
    const violation = transitionViolation(s.state, raw.type);
    if (violation) {
      push(violation);
      // A log that opens on something other than `created` is reported but
      // still folded: the events happened, and refusing to read them would
      // hide the very work whose record is already damaged. A genuinely
      // illegal EDGE is skipped, as it always was.
      if (violation !== MUST_OPEN) return;
    }

    APPLY[raw.type](s, raw, push);
    if (!annotation) s.state = raw.type;
    s.eventCount += 1;
  });

  s.terminal = s.state !== null && TERMINAL_STATES.has(s.state);
  // Last active correction wins. The machine grade/outcome stay separately
  // visible, while existing consumers of gradedPercent/outcome receive the
  // effective projection and therefore update reports and gates naturally.
  const effective = [...s.gradeAdjustments].reverse().find((row) => !row.retracted);
  if (effective) {
    if (typeof effective.percent === 'number') s.gradedPercent = effective.percent;
    else if (Number.isInteger(effective.correctCount) && Number.isInteger(effective.totalCount)) {
      s.gradedPercent = Math.round((effective.correctCount / effective.totalCount) * 10000) / 100;
    }
    if (Number.isInteger(effective.correctCount)) s.gradedCorrectCount = effective.correctCount;
    if (Number.isInteger(effective.totalCount)) s.gradedTotalCount = effective.totalCount;
    if (Array.isArray(effective.missedItemIds)) s.missedItemIds = [...effective.missedItemIds];
    // A correction that re-marks a voided question un-voids it (the grading
    // lane does the same at `GradeSubmission`), so the stamp from the `graded`
    // event goes stale the moment one does. Left alone, the record asserts
    // both that a question was unmarkable and that a grown-up marked it.
    // Only an item-level correction can say anything here: a percent-only one
    // carries no verdicts and must leave the stamp exactly as it found it.
    if (Array.isArray(effective.itemVerdicts) && effective.itemVerdicts.length && s.voidedItemIds.length) {
      const stillVoid = new Set(effective.itemVerdicts
        .filter((row) => row?.voided === true).map((row) => row.itemId));
      s.voidedItemIds = s.voidedItemIds.filter((itemId) => stillVoid.has(itemId));
    }
    if (s.outcome && typeof s.gradedPercent === 'number' && typeof s.gradedPassingPercent === 'number') {
      // A CORRECTION MOVES THE SCORE. IT DOES NOT GET TO RE-DECIDE THE RULE.
      //
      // This projection used to carry its own copy of the pass rule —
      // `gradedPercent >= gradedPassingPercent` — which is the whole rule for
      // an ungated sheet and only part of it for anything else. Every clause
      // `evaluateOutcome` had learned since was therefore erased by any grade
      // correction at all, favourable or not: a sheet blocked by its
      // finish-code row was promoted to `passed`, and so was one still waiting
      // on a grown-up's sign-off. Delegating rather than duplicating is the
      // fix, and it is the only one that stays fixed the next time that
      // function grows a clause.
      //
      // `reason` travels with `result` for the same reason. Spreading the old
      // reason over a freshly derived result produced records asserting
      // `passed` beside `below_passing`, and every reader that decides what to
      // SAY from the reason (the receipt's gate lines, the retry ticket) was
      // reading a stale answer to a question that had just been re-asked.
      //
      // One honest gap: sign-off is not part of reducer state, so
      // `requiresSignoff` defaults false here. That is exactly what this
      // projection already did, so nothing regresses — but a session whose
      // reward genuinely awaits a grown-up still projects as `passed` after a
      // correction, and only the close-out (which CAN see the sign-off) is
      // authoritative about that.
      const reEvaluated = evaluateOutcome({
        gradedPercent: s.gradedPercent,
        passingPercent: s.gradedPassingPercent,
        companionGate: s.companionGate,
      });
      s.outcome = {
        ...s.outcome,
        result: reEvaluated.result,
        reason: reEvaluated.reason,
        adjustedBy: effective.adjustedBy,
        adjustmentId: effective.adjustmentId,
      };
    }
  }
  // An attribution failure has no honest numerator or denominator. Preserve
  // machineGrade/machineOutcome above as the immutable incident record, while
  // every effective consumer sees a voided session with no score.
  if (s.evidenceInvalidated) {
    const invalidation = s.evidenceInvalidations.at(-1);
    s.gradedPercent = null;
    s.gradedPassingPercent = null;
    s.gradedCorrectCount = null;
    s.gradedTotalCount = null;
    s.missedItemIds = [];
    s.voidedItemIds = [];
    s.outcome = {
      result: 'voided', reason: 'evidence_invalidated', at: invalidation.at,
      invalidationId: invalidation.invalidationId,
    };
  }
  s.nextAction = computeNextAction(s);
  return s;
}
