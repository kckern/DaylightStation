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
    fields: ['learnerId', 'unitId', 'studyDay', 'remediationOf', 'variant', 'remediationItemIds', 'openedBy'],
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
  submitted: { fields: ['transport'], validate: oneOfField('transport', TRANSPORTS) },
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
    fields: ['attemptIds', 'percent', 'passingPercent', 'correctCount', 'totalCount', 'missedItemIds', 'voidedItemIds'],
    validate: (raw, push) => {
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
    fields: ['reconciliationId', 'delta', 'txnId', 'sourceAdjustmentId'],
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
  outcome_recorded: ['rewarded', 'remediation_opened'],
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
 */
export const ANNOTATION_EVENTS = Object.freeze(new Set([
  'failed', 'reassigned', 'grade_adjusted', 'grade_adjustment_retracted',
  'reward_reconciled', 'reward_reconciliation_failed',
  'result_receipt_captured', 'result_receipt_reprinted',
]));
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
 *   stay with whoever was paid, which is why `rewarded` records `paidTo` — so
 *   that a later reconciliation reverses the payment against the child who
 *   actually holds it. Making a reassignment move coins is a household-economy
 *   decision nobody has taken.
 */
const TERMINAL_ANNOTATIONS = new Set([
  'grade_adjusted', 'grade_adjustment_retracted', 'reward_reconciled', 'reward_reconciliation_failed',
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
  const legal = annotation
    ? state !== null && (!TERMINAL_STATES.has(state) || TERMINAL_ANNOTATIONS.has(eventType))
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
  gradedPassingPercent: null,
  gradedCorrectCount: null,
  gradedTotalCount: null,
  missedItemIds: [],
  // The questions a grown-up could not mark at all (`void`). They were left
  // out of the graded event's `totalCount`, so a reader that wants to know
  // "out of how many, and which ones went missing from that count" has both
  // here without re-folding the log.
  voidedItemIds: [],
  transport: null,
  mediaDispatch: null,
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
  // Which equivalent-problem form of the unit this session was opened with
  // (spec §3.3). Derived rather than looked up because the document that gets
  // reprinted has to be the SAME variant the child was handed.
  variant: 0,
  remediation: null,
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
    s.machineGrade = {
      percent: typeof e.percent === 'number' ? e.percent : null,
      passingPercent: typeof e.passingPercent === 'number' ? e.passingPercent : null,
      correctCount: Number.isInteger(e.correctCount) ? e.correctCount : null,
      totalCount: Number.isInteger(e.totalCount) ? e.totalCount : null,
      missedItemIds: Array.isArray(e.missedItemIds) ? [...e.missedItemIds] : [],
      attemptIds: Array.isArray(e.attemptIds) ? [...e.attemptIds] : [],
    };
  },
  outcome_recorded(s, e) {
    s.outcome = { outcomeId: e.outcomeId ?? null, result: e.result ?? null, at: e.at };
    s.machineOutcome = { ...s.outcome };
  },
  rewarded(s, e) {
    s.rewardTxn = e.txnId ?? null;
    s.rewardAmount = Number.isInteger(e.amount) ? e.amount : 0;
    if (isNonEmptyString(e.paidTo)) s.rewardPaidTo = e.paidTo;
  },
  reward_reconciled(s, e) {
    s.rewardAmount += e.delta;
    s.rewardReconciliations.push({ reconciliationId: e.reconciliationId, delta: e.delta,
      txnId: e.txnId, sourceAdjustmentId: e.sourceAdjustmentId ?? null, at: e.at, status: 'applied' });
  },
  reward_reconciliation_failed(s, e) {
    s.rewardReconciliations.push({ reconciliationId: e.reconciliationId, delta: e.delta,
      sourceAdjustmentId: e.sourceAdjustmentId ?? null, at: e.at, status: 'failed', reason: e.reason });
  },
  remediation_opened(s, e) {
    s.remediation = { newSessionId: e.newSessionId ?? null, variant: e.variant ?? null };
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
    if (s.outcome && typeof s.gradedPercent === 'number' && typeof s.gradedPassingPercent === 'number') {
      s.outcome = {
        ...s.outcome,
        result: s.gradedPercent >= s.gradedPassingPercent ? 'passed' : 'needs_remediation',
        adjustedBy: effective.adjustedBy,
        adjustmentId: effective.adjustmentId,
      };
    }
  }
  s.nextAction = computeNextAction(s);
  return s;
}
