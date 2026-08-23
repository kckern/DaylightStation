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
    fields: ['learnerId', 'unitId', 'remediationOf', 'variant', 'remediationItemIds'],
    validate: allOf(stringField('learnerId'), stringField('unitId'), (raw, push) => {
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
    fields: ['artifactId', 'confirmed'],
    validate: allOf(stringField('artifactId'), booleanIfPresent('confirmed')),
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
  submitted: { fields: ['transport'], validate: oneOfField('transport', TRANSPORTS) },
  graded: {
    // `passingPercent` (optional) is the bar IN EFFECT at grading time
    // (student-advocacy A4): a later pass-override edit must never move the
    // bar under an already-graded kid, so the close reads this stamp first.
    fields: ['attemptIds', 'percent', 'passingPercent', 'correctCount', 'totalCount', 'missedItemIds'],
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
    },
  },
  outcome_recorded: {
    fields: ['outcomeId', 'result', 'reason'],
    validate: allOf(stringField('outcomeId'), oneOfField('result', RESULTS)),
  },
  rewarded: { fields: ['txnId', 'amount'], validate: stringField('txnId') },
  remediation_opened: {
    fields: ['newSessionId', 'variant'],
    validate: allOf(stringField('newSessionId'), (raw, push) => {
      if (!(Number.isInteger(raw.variant) && raw.variant >= 0)) push('variant: must be an integer >= 0');
    }),
  },
  reassigned: {
    fields: ['fromLearnerId', 'toLearnerId', 'reviewedBy'],
    validate: allOf(stringField('fromLearnerId'), stringField('toLearnerId'), (raw, push) => {
      // A reassignment to the same learner records no fact and would still
      // rewrite attribution downstream — reject it rather than store a no-op.
      if (isNonEmptyString(raw.toLearnerId) && raw.toLearnerId === raw.fromLearnerId) {
        push('toLearnerId: must differ from fromLearnerId');
      }
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
  created: ['issued', 'media_dispatched', 'launch_dispatched', 'program_dispatched', 'abandoned'],
  issued: ['submitted', 'reprinted', 'failed', 'abandoned'],
  reprinted: ['submitted', 'reprinted', 'abandoned'],
  media_dispatched: ['media_completed', 'media_stalled', 'abandoned'],
  media_completed: ['issued', 'submitted'],
  media_stalled: ['media_dispatched', 'abandoned'],
  launch_dispatched: ['outcome_recorded', 'abandoned'],
  program_dispatched: ['outcome_recorded', 'abandoned'],
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
export const ANNOTATION_EVENTS = Object.freeze(new Set(['failed', 'reassigned']));

/** States the table can reach but never leave. */
export const TERMINAL_STATES = Object.freeze(new Set(
  [...new Set(Object.values(TRANSITIONS).flat())]
    .filter((state) => !TRANSITIONS[state] && !ANNOTATION_EVENTS.has(state)),
));

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
  state: null,
  terminal: false,
  issuedArtifacts: [],
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
  // reprinted this morning looks like this morning's work. Felix's session
  // was created 2026-08-14, sat unsubmitted, and resumed eight days later
  // presenting itself as fresh — a different student number and a sheet
  // starting at question 7, with nothing on the paper explaining why. Set
  // once, by the first `issued` event, and never moved after.
  firstIssuedAt: null,
  attemptIds: [],
  gradedPercent: null,
  gradedPassingPercent: null,
  gradedCorrectCount: null,
  gradedTotalCount: null,
  missedItemIds: [],
  transport: null,
  mediaDispatch: null,
  outcome: null,
  rewardTxn: null,
  remediationOf: null,
  remediationItemIds: [],
  // Which equivalent-problem form of the unit this session was opened with
  // (spec §3.3). Derived rather than looked up because the document that gets
  // reprinted has to be the SAME variant the child was handed.
  variant: 0,
  remediation: null,
  lastFailure: null,
  launch: null,
  eventCount: 0,
  nextAction: null,
  errors: [],
});

const APPLY = {
  created(s, e) {
    s.learnerId = e.learnerId ?? null;
    s.unitId = e.unitId ?? null;
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
  },
  outcome_recorded(s, e) {
    s.outcome = { outcomeId: e.outcomeId ?? null, result: e.result ?? null, at: e.at };
  },
  rewarded(s, e) { s.rewardTxn = e.txnId ?? null; },
  remediation_opened(s, e) {
    s.remediation = { newSessionId: e.newSessionId ?? null, variant: e.variant ?? null };
  },
  reassigned(s, e) { if (isNonEmptyString(e.toLearnerId)) s.learnerId = e.toLearnerId; },
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
    if (s.state === null && !annotation) {
      if (raw.type !== 'created') push('session must open with a created event');
    } else {
      const legal = annotation
        ? s.state !== null && !TERMINAL_STATES.has(s.state)
        : (TRANSITIONS[s.state] || []).includes(raw.type);
      if (!legal) {
        push(`illegal transition ${s.state} -> ${raw.type}`);
        return;
      }
    }

    APPLY[raw.type](s, raw, push);
    if (!annotation) s.state = raw.type;
    s.eventCount += 1;
  });

  s.terminal = s.state !== null && TERMINAL_STATES.has(s.state);
  s.nextAction = computeNextAction(s);
  return s;
}
