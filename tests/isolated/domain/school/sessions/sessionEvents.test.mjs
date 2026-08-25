import { describe, it, expect } from 'vitest';
import {
  EVENT_TYPES,
  TRANSITIONS,
  TERMINAL_STATES,
  ANNOTATION_EVENTS,
  createEvent,
  validateEvent,
  reduceSession,
} from '#domains/school/sessions/sessionEvents.mjs';

const AT = '2026-07-27T10:00:00.000Z';
const SID = 'ses_abc123';

/** Minimal legal payload for each type, so tests state only what they vary. */
const PAYLOADS = {
  created: { learnerId: 'kid1', unitId: 'math-add-1' },
  issued: { artifactId: 'doc_1' },
  reprinted: { artifactId: 'doc_1' },
  result_receipt_captured: { artifactId: 'receipt/ses_abc123/out:ses_abc123', kind: 'result-receipt', printed: true },
  result_receipt_reprinted: { artifactId: 'receipt/ses_abc123/out:ses_abc123', idempotencyKey: 'rp_1', reprintedBy: 'parent1' },
  media_dispatched: { dispatchId: 'dsp_1', target: 'shield-tv', contentId: 'plex:1234' },
  media_completed: {},
  media_stalled: {},
  launch_dispatched: { surface: 'screen-1', decision: 'auto', approvalId: 'app_1' },
  program_dispatched: { programId: 'language', corpusId: 'glossika-korean', day: 3 },
  external_activity_dispatched: { provider: 'fitness', attemptId: SID, courseRevision: 'course-1', policyRevision: 'policy-1' },
  external_activity_assessed: { provider: 'fitness', assessmentId: 'fitness-assessment-1', courseRevision: 'course-1', policyRevision: 'policy-1', result: 'passed', measures: { engagements: 1 } },
  submitted: { transport: 'paper' },
  graded: { attemptIds: ['att_1'], percent: 90 },
  outcome_recorded: { outcomeId: `out:${SID}`, result: 'passed' },
  rewarded: { txnId: 'txn_1' },
  reward_reconciled: { reconciliationId: 'rec_1', delta: 1, txnId: 'txn_2' },
  reward_reconciliation_failed: { reconciliationId: 'rec_2', delta: -1, reason: 'economy unavailable' },
  remediation_opened: { newSessionId: 'ses_next', variant: 1 },
  reassigned: { fromLearnerId: 'kid1', toLearnerId: 'kid2' },
  failed: { stage: 'print', reason: 'printer offline' },
  grade_adjusted: { adjustmentId: 'adj_1', percent: 100, reason: 'OMR erased answer misread', adjustedBy: 'parent1' },
  grade_adjustment_retracted: { adjustmentId: 'adj_1', reason: 'entered against wrong session', retractedBy: 'parent1' },
  abandoned: {},
};

let nextSeq = 0;
const ev = (type, over = {}) => {
  nextSeq += 1;
  return {
    type, at: AT, sessionId: SID, seq: nextSeq, ...PAYLOADS[type], ...over,
  };
};
/** Build a log from a list of types, stamping seq 1..n. */
const log = (types, overrides = {}) => {
  nextSeq = 0;
  return types.map((t) => ev(t, overrides[t] || {}));
};

describe('EVENT_TYPES', () => {
  it('is the closed spec §5.2 set', () => {
    expect(EVENT_TYPES).toEqual([
      'created', 'issued', 'reprinted', 'result_receipt_captured', 'result_receipt_reprinted',
      'media_dispatched', 'media_completed', 'media_stalled',
      'launch_dispatched', 'program_dispatched', 'external_activity_dispatched', 'external_activity_assessed',
      'submitted', 'graded', 'outcome_recorded', 'rewarded',
      'reward_reconciled', 'reward_reconciliation_failed',
      'remediation_opened', 'reassigned', 'grade_adjusted', 'grade_adjustment_retracted', 'failed', 'abandoned',
    ]);
  });

  it('is frozen — a new event type is a code change, never config', () => {
    expect(Object.isFrozen(EVENT_TYPES)).toBe(true);
  });

  it('has a payload validator for every declared type', () => {
    EVENT_TYPES.forEach((type) => {
      expect(createEvent({ type, at: AT, sessionId: SID, seq: 1, ...PAYLOADS[type] }).errors).toEqual([]);
    });
  });
});

describe('append-only teacher grade corrections', () => {
  it('records a retained result receipt without advancing the learning state', () => {
    const state = reduceSession(log(['created', 'issued', 'submitted', 'graded', 'outcome_recorded', 'result_receipt_captured'], {
      result_receipt_captured: { artifactId: 'receipt/ses_abc123/out:ses_abc123', kind: 'result-receipt', printed: true },
    }));
    expect(state.errors).toEqual([]);
    expect(state.state).toBe('outcome_recorded');
    expect(state.issuedArtifacts).toEqual(['doc_1']);
    expect(state.resultReceiptArtifacts).toEqual([expect.objectContaining({
      artifactId: 'receipt/ses_abc123/out:ses_abc123', kind: 'result-receipt', printed: true,
    })]);
  });

  it('preserves machine evidence while projecting the latest active correction through pass state', () => {
    const events = log(['created', 'issued', 'submitted', 'graded', 'outcome_recorded', 'rewarded'], {
      graded: { percent: 60, passingPercent: 80, correctCount: 3, totalCount: 5 },
      outcome_recorded: { result: 'needs_remediation' },
    });
    events.push(ev('grade_adjusted', {
      adjustmentId: 'adj_eraser', percent: 80, correctCount: 4, totalCount: 5,
      reason: 'eraser read as two marks', adjustedBy: 'parent1',
    }));
    const state = reduceSession(events);
    expect(state.errors).toEqual([]);
    expect(state.machineGrade).toMatchObject({ percent: 60, correctCount: 3 });
    expect(state.gradedPercent).toBe(80);
    expect(state.outcome).toMatchObject({ result: 'passed', adjustmentId: 'adj_eraser' });
    expect(state.machineOutcome.result).toBe('needs_remediation');
    expect(state.rewardTxn).toBe('txn_1');
  });

  it('retraction restores the machine grade without deleting correction history', () => {
    const events = log(['created', 'issued', 'submitted', 'graded', 'outcome_recorded'], {
      graded: { percent: 60, passingPercent: 80 }, outcome_recorded: { result: 'needs_remediation' },
    });
    events.push(ev('grade_adjusted', { adjustmentId: 'adj_1', percent: 100, reason: 'freebie', adjustedBy: 'parent1' }));
    events.push(ev('grade_adjustment_retracted', { adjustmentId: 'adj_1', reason: 'wrong learner', retractedBy: 'parent1' }));
    const state = reduceSession(events);
    expect(state.errors).toEqual([]);
    expect(state.gradedPercent).toBe(60);
    expect(state.outcome.result).toBe('needs_remediation');
    expect(state.gradeAdjustments[0]).toMatchObject({ adjustmentId: 'adj_1', retracted: true });
  });
});

describe('TRANSITIONS', () => {
  it('is the closed table from the spec', () => {
    expect(TRANSITIONS).toEqual({
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
  });

  it('is frozen', () => {
    expect(Object.isFrozen(TRANSITIONS)).toBe(true);
  });

  it('names only declared event types as targets', () => {
    Object.values(TRANSITIONS).flat().forEach((target) => {
      expect(EVENT_TYPES).toContain(target);
    });
  });

  it('terminal states are exactly the reachable states with no outgoing edge', () => {
    const reachable = new Set(Object.values(TRANSITIONS).flat());
    const dead = [...reachable].filter((s) => !TRANSITIONS[s] && !ANNOTATION_EVENTS.has(s));
    expect([...TERMINAL_STATES].sort()).toEqual(dead.sort());
  });
});

describe('createEvent: envelope', () => {
  it('returns the event with no errors when valid', () => {
    const { errors, event } = createEvent({ type: 'created', at: AT, sessionId: SID, seq: 1, learnerId: 'kid1', unitId: 'u1' });
    expect(errors).toEqual([]);
    expect(event).toEqual({ type: 'created', at: AT, sessionId: SID, seq: 1, learnerId: 'kid1', unitId: 'u1' });
  });

  it('reports success by an empty error list, not an ok flag', () => {
    const result = createEvent({ type: 'abandoned', at: AT, sessionId: SID, seq: 1 });
    expect(result.ok).toBeUndefined();
    expect(result.errors.length).toBe(0);
  });

  it('omits the event when anything failed', () => {
    const { errors, event } = createEvent({ type: 'created', at: AT, sessionId: SID, seq: 1 });
    expect(event).toBeUndefined();
    expect(errors.length).toBeGreaterThan(0);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'created'],
  ])('rejects an event that is %s', (_label, raw) => {
    expect(createEvent(raw).errors).toEqual(['event must be a mapping']);
  });

  it('rejects an unknown type by name', () => {
    expect(createEvent({ type: 'exploded', at: AT, sessionId: SID, seq: 1 }).errors)
      .toContain('type: unknown event type: exploded');
  });

  it('rejects a prototype-borrowed type name', () => {
    expect(createEvent({ type: 'constructor', at: AT, sessionId: SID, seq: 1 }).errors)
      .toContain('type: unknown event type: constructor');
  });

  it('requires an ISO-8601 `at`', () => {
    expect(createEvent({ type: 'abandoned', at: 'yesterday', sessionId: SID, seq: 1 }).errors)
      .toContain('at: must be an ISO-8601 timestamp');
    expect(createEvent({ type: 'abandoned', sessionId: SID, seq: 1 }).errors)
      .toContain('at: must be an ISO-8601 timestamp');
  });

  it('requires a sessionId', () => {
    expect(createEvent({ type: 'abandoned', at: AT, seq: 1 }).errors)
      .toContain('sessionId: must be a non-empty string');
  });

  it('accepts an event with no seq — the store stamps it inside its append lock', () => {
    expect(createEvent({ type: 'abandoned', at: AT, sessionId: SID }).errors).toEqual([]);
  });

  it('rejects a seq that is present but not a positive integer', () => {
    expect(createEvent({ type: 'abandoned', at: AT, sessionId: SID, seq: 0 }).errors)
      .toContain('seq: must be an integer >= 1');
    expect(createEvent({ type: 'abandoned', at: AT, sessionId: SID, seq: 1.5 }).errors)
      .toContain('seq: must be an integer >= 1');
  });

  it('accumulates every envelope error rather than stopping at the first', () => {
    expect(createEvent({ type: 'created', at: 'nope', sessionId: '' }).errors.length).toBeGreaterThanOrEqual(4);
  });

  it('validateEvent is the same check without building the event', () => {
    expect(validateEvent({ type: 'abandoned', at: AT, sessionId: SID })).toEqual({ errors: [] });
  });
});

describe('createEvent: per-type payloads', () => {
  const missing = (type, field, over = {}) => createEvent({
    type, at: AT, sessionId: SID, seq: 1, ...PAYLOADS[type], [field]: undefined, ...over,
  }).errors;

  it.each([
    ['created', 'learnerId'],
    ['created', 'unitId'],
    ['issued', 'artifactId'],
    ['reprinted', 'artifactId'],
    ['media_dispatched', 'dispatchId'],
    ['media_dispatched', 'target'],
    ['media_dispatched', 'contentId'],
    ['launch_dispatched', 'surface'],
    ['outcome_recorded', 'outcomeId'],
    ['rewarded', 'txnId'],
    ['remediation_opened', 'newSessionId'],
    ['reassigned', 'fromLearnerId'],
    ['reassigned', 'toLearnerId'],
    ['failed', 'stage'],
    ['failed', 'reason'],
  ])('%s requires %s', (type, field) => {
    expect(missing(type, field)).toContain(`${field}: must be a non-empty string`);
  });

  it('submitted requires a known transport', () => {
    expect(missing('submitted', 'transport')).toContain('transport: must be one of paper, screen');
    expect(missing('submitted', 'transport', { transport: 'telepathy' }))
      .toContain('transport: must be one of paper, screen');
    expect(createEvent({ type: 'submitted', at: AT, sessionId: SID, seq: 1, transport: 'screen' }).errors).toEqual([]);
  });

  it('graded requires a non-empty attemptIds array of strings', () => {
    expect(missing('graded', 'attemptIds')).toContain('attemptIds: must be a non-empty array');
    expect(missing('graded', 'attemptIds', { attemptIds: [] })).toContain('attemptIds: must be a non-empty array');
    expect(missing('graded', 'attemptIds', { attemptIds: [7] }))
      .toContain('attemptIds[0]: must be a non-empty string');
  });

  it('graded requires a percent between 0 and 100', () => {
    expect(missing('graded', 'percent')).toContain('percent: must be a number between 0 and 100');
    expect(missing('graded', 'percent', { percent: 101 })).toContain('percent: must be a number between 0 and 100');
    expect(missing('graded', 'percent', { percent: -1 })).toContain('percent: must be a number between 0 and 100');
    expect(createEvent({ type: 'graded', at: AT, sessionId: SID, attemptIds: ['a'], percent: 0 }).errors).toEqual([]);
  });

  it('outcome_recorded requires a known result', () => {
    expect(missing('outcome_recorded', 'result')).toContain('result: must be one of passed, needs_remediation');
    expect(missing('outcome_recorded', 'result', { result: 'perfect' }))
      .toContain('result: must be one of passed, needs_remediation');
  });

  it('remediation_opened requires a variant integer >= 0', () => {
    expect(missing('remediation_opened', 'variant')).toContain('variant: must be an integer >= 0');
    expect(missing('remediation_opened', 'variant', { variant: -1 })).toContain('variant: must be an integer >= 0');
    expect(missing('remediation_opened', 'variant', { variant: 0 })).toEqual([]);
  });

  it('reassigned rejects a no-op reassignment to the same learner', () => {
    expect(missing('reassigned', 'toLearnerId', { toLearnerId: 'kid1' }))
      .toContain('toLearnerId: must differ from fromLearnerId');
  });

  it('accepts the types that carry no required payload', () => {
    ['media_completed', 'media_stalled', 'abandoned'].forEach((type) => {
      expect(createEvent({ type, at: AT, sessionId: SID, seq: 1 }).errors).toEqual([]);
    });
  });
});

describe('reduceSession: happy path', () => {
  it('derives identity, state and lineage from a full paper flow', () => {
    const state = reduceSession(log([
      'created', 'issued', 'submitted', 'graded', 'outcome_recorded', 'rewarded',
    ]));
    expect(state.errors).toEqual([]);
    expect(state.sessionId).toBe(SID);
    expect(state.learnerId).toBe('kid1');
    expect(state.unitId).toBe('math-add-1');
    expect(state.state).toBe('rewarded');
    expect(state.terminal).toBe(true);
    expect(state.issuedArtifacts).toEqual(['doc_1']);
    expect(state.attemptIds).toEqual(['att_1']);
    expect(state.gradedPercent).toBe(90);
    expect(state.outcome).toEqual({ outcomeId: `out:${SID}`, result: 'passed', at: AT });
    expect(state.rewardTxn).toBe('txn_1');
    expect(state.nextAction).toBe(null);
  });

  it('derives the media flow through to issue', () => {
    const state = reduceSession(log(['created', 'media_dispatched', 'media_completed', 'issued']));
    expect(state.errors).toEqual([]);
    expect(state.state).toBe('issued');
    expect(state.mediaDispatch).toEqual({
      dispatchId: 'dsp_1', target: 'shield-tv', contentId: 'plex:1234', status: 'completed',
    });
  });

  it('derives a launch_dispatched flow through to outcome_recorded', () => {
    const state = reduceSession(log(['created', 'launch_dispatched', 'outcome_recorded']));
    expect(state.errors).toEqual([]);
    expect(state.state).toBe('outcome_recorded');
    expect(state.launch).toEqual({ surface: 'screen-1', at: AT });
  });

  it('an empty log reduces to an empty, renderable state', () => {
    const state = reduceSession([]);
    expect(state.state).toBe(null);
    expect(state.nextAction).toBe(null);
    expect(state.errors).toEqual([]);
    expect(state.issuedArtifacts).toEqual([]);
  });

  it('a non-array log reduces rather than throwing', () => {
    expect(reduceSession(null).errors).toEqual(['events: must be an array']);
    expect(reduceSession(null).state).toBe(null);
  });
});

describe('reduceSession: ordering', () => {
  it('reduces in seq order regardless of array order', () => {
    const ordered = log(['created', 'issued', 'submitted']);
    const shuffled = [ordered[2], ordered[0], ordered[1]];
    expect(reduceSession(shuffled)).toEqual(reduceSession(ordered));
    expect(reduceSession(shuffled).state).toBe('submitted');
  });

  it('records a duplicate seq as an error and applies only the first', () => {
    const events = log(['created', 'issued']);
    const dupe = { ...ev('abandoned'), seq: 2 };
    const state = reduceSession([...events, dupe]);
    expect(state.errors).toContain('event[seq=2]: duplicate seq (abandoned)');
    expect(state.state).toBe('issued');
  });

  it('records a missing seq as an error instead of guessing a position', () => {
    const events = log(['created']);
    const state = reduceSession([...events, { type: 'issued', at: AT, sessionId: SID, artifactId: 'doc_1' }]);
    expect(state.errors).toContain('event[seq=?]: seq must be an integer >= 1');
    expect(state.state).toBe('created');
  });
});

describe('reduceSession: corrupt logs still render', () => {
  it('records an unknown event type and keeps reducing', () => {
    const events = log(['created', 'issued']);
    const state = reduceSession([
      ...events,
      { type: 'exploded', at: AT, sessionId: SID, seq: 3 },
      { ...ev('submitted'), seq: 4 },
    ]);
    expect(state.errors).toContain('event[seq=3]: unknown event type: exploded');
    expect(state.state).toBe('submitted');
  });

  it('records an illegal transition and keeps the prior state', () => {
    const events = log(['created', 'issued']);
    const state = reduceSession([...events, { ...ev('rewarded'), seq: 3 }]);
    expect(state.errors).toContain('event[seq=3]: illegal transition issued -> rewarded');
    expect(state.state).toBe('issued');
    expect(state.rewardTxn).toBe(null);
  });

  it('records launch_dispatched as illegal from issued', () => {
    const events = log(['created', 'issued']);
    const state = reduceSession([...events, { ...ev('launch_dispatched'), seq: 3 }]);
    expect(state.errors).toContain('event[seq=3]: illegal transition issued -> launch_dispatched');
    expect(state.state).toBe('issued');
    expect(state.launch).toBe(null);
  });

  it('records an event appended after a terminal state', () => {
    const events = log(['created', 'abandoned']);
    const state = reduceSession([...events, { ...ev('issued'), seq: 3 }]);
    expect(state.errors).toContain('event[seq=3]: illegal transition abandoned -> issued');
    expect(state.state).toBe('abandoned');
  });

  it('records a log that does not open with `created` but still derives a state', () => {
    const state = reduceSession([{ type: 'issued', at: AT, sessionId: SID, seq: 1, artifactId: 'doc_1' }]);
    expect(state.errors).toContain('event[seq=1]: session must open with a created event');
    expect(state.state).toBe('issued');
    expect(state.learnerId).toBe(null);
  });

  it('records a second created event', () => {
    const events = log(['created']);
    const state = reduceSession([...events, { ...ev('created'), seq: 2 }]);
    expect(state.errors).toContain('event[seq=2]: illegal transition created -> created');
  });

  it('records an event carrying a foreign sessionId', () => {
    const events = log(['created']);
    const state = reduceSession([...events, { ...ev('issued'), seq: 2, sessionId: 'ses_other' }]);
    expect(state.errors).toContain('event[seq=2]: sessionId "ses_other" does not match session ses_abc123');
  });

  it('records a malformed event entry without dropping it silently', () => {
    const events = log(['created']);
    const state = reduceSession([...events, null, 'garbage']);
    expect(state.errors).toContain('event[seq=?]: event must be a mapping');
    expect(state.errors.filter((e) => e.includes('must be a mapping')).length).toBe(2);
    expect(state.state).toBe('created');
  });

  it('records a payload error without discarding the transition', () => {
    const events = log(['created']);
    const state = reduceSession([...events, { type: 'issued', at: AT, sessionId: SID, seq: 2 }]);
    expect(state.errors).toContain('event[seq=2]: artifactId: must be a non-empty string');
    expect(state.state).toBe('issued');
  });

  it('never throws on an arbitrarily corrupt log', () => {
    expect(() => reduceSession([
      undefined, { type: 'graded', seq: 'x' }, { seq: 1 }, { type: 'rewarded', at: AT, sessionId: SID, seq: 1 },
    ])).not.toThrow();
  });
});

describe('reduceSession: reprint lineage', () => {
  it('a reprint reuses the original artifactId and adds no second artifact', () => {
    const state = reduceSession(log(['created', 'issued', 'reprinted', 'reprinted']));
    expect(state.errors).toEqual([]);
    expect(state.issuedArtifacts).toEqual(['doc_1']);
    expect(state.state).toBe('reprinted');
  });

  it('records a reprint of an artifact that was never issued', () => {
    const events = log(['created', 'issued']);
    const state = reduceSession([...events, { ...ev('reprinted'), seq: 3, artifactId: 'doc_other' }]);
    expect(state.errors).toContain(
      'event[seq=3]: reprinted artifactId "doc_other" was never issued (a reprint reuses the original)',
    );
  });
});

// The print-debounce feature (IssueDocument) needs to time its cooldown from
// the last successful PRINT, not the last scan — a session with no print yet
// carries no such signal, and a print carries the ONLY signal a re-scan (that
// never reaches the printer) must not overwrite.
describe('reduceSession: lastPrintedAt', () => {
  it('is null before anything has ever been printed', () => {
    const state = reduceSession(log(['created']));
    expect(state.lastPrintedAt).toBeNull();
  });

  it('is stamped from the issued event\'s own `at`', () => {
    const events = [
      { ...ev('created'), at: '2026-08-14T09:00:00.000Z' },
      { ...ev('issued'), at: '2026-08-14T09:00:05.000Z' },
    ];
    const state = reduceSession(events);
    expect(state.lastPrintedAt).toBe('2026-08-14T09:00:05.000Z');
  });

  it('advances to the LATEST reprint\'s `at`, not the original issue', () => {
    const events = [
      { ...ev('created'), at: '2026-08-14T09:00:00.000Z' },
      { ...ev('issued'), at: '2026-08-14T09:00:05.000Z' },
      { ...ev('reprinted'), at: '2026-08-14T09:10:00.000Z' },
    ];
    const state = reduceSession(events);
    expect(state.lastPrintedAt).toBe('2026-08-14T09:10:00.000Z');
  });

  // A `failed` annotation records an attempt that never reached paper — it
  // must never look like a successful print to a debounce reading this field.
  it('a failed print attempt does not move lastPrintedAt', () => {
    const events = [
      { ...ev('created'), at: '2026-08-14T09:00:00.000Z' },
      { ...ev('failed'), at: '2026-08-14T09:00:03.000Z' },
      { ...ev('issued'), at: '2026-08-14T09:00:05.000Z' },
    ];
    const state = reduceSession(events);
    expect(state.lastPrintedAt).toBe('2026-08-14T09:00:05.000Z');
  });
});

// `firstIssuedAt` is the twin of `lastPrintedAt` above and exists because that
// field cannot answer "when was this work assigned": every reprint moves it
// forward, so a session issued last week and reprinted this morning looks like
// this morning's work. That is exactly how Felix's 2026-08-14 session resumed
// eight days later presenting itself as fresh.
describe('reduceSession: firstIssuedAt', () => {
  it('is null before anything has ever been issued', () => {
    expect(reduceSession(log(['created'])).firstIssuedAt).toBeNull();
  });

  it("is stamped from the FIRST issued event's own `at`", () => {
    const events = [
      { ...ev('created'), at: '2026-08-14T09:00:00.000Z' },
      { ...ev('issued'), at: '2026-08-14T09:00:05.000Z' },
    ];
    expect(reduceSession(events).firstIssuedAt).toBe('2026-08-14T09:00:05.000Z');
  });

  it('does NOT advance on a reprint, where lastPrintedAt does — this is the whole point', () => {
    const events = [
      { ...ev('created'), at: '2026-08-14T09:00:00.000Z' },
      { ...ev('issued'), at: '2026-08-14T09:00:05.000Z' },
      { ...ev('reprinted'), at: '2026-08-22T09:10:00.000Z' },
    ];
    const state = reduceSession(events);
    expect(state.firstIssuedAt).toBe('2026-08-14T09:00:05.000Z');
    expect(state.lastPrintedAt).toBe('2026-08-22T09:10:00.000Z');
  });

  it('records an UNCONFIRMED issue too — the work was assigned whether or not that attempt reached paper', () => {
    const events = [
      { ...ev('created'), at: '2026-08-14T09:00:00.000Z' },
      { ...ev('issued'), at: '2026-08-14T09:00:05.000Z', confirmed: false },
    ];
    const state = reduceSession(events);
    expect(state.firstIssuedAt).toBe('2026-08-14T09:00:05.000Z');
    // ...while the print cooldown correctly ignores it.
    expect(state.lastPrintedAt).toBeNull();
  });
});

describe('reduceSession: annotation events', () => {
  it('reassignment moves the credited learner without advancing state', () => {
    const state = reduceSession(log(['created', 'issued', 'reassigned']));
    expect(state.errors).toEqual([]);
    expect(state.state).toBe('issued');
    expect(state.learnerId).toBe('kid2');
  });

  it('a failure does not advance state, so the same token still retries', () => {
    const state = reduceSession(log(['created', 'issued', 'failed']));
    expect(state.errors).toEqual([]);
    expect(state.state).toBe('issued');
    expect(state.lastFailure).toEqual({ stage: 'print', reason: 'printer offline', at: AT });
    expect(state.nextAction.kind).toBe('reprint_document');
  });

  it('a failure at the created stage is legal — the printer can be offline before anything issued', () => {
    const state = reduceSession(log(['created', 'failed']));
    expect(state.errors).toEqual([]);
    expect(state.state).toBe('created');
  });

  it('a successful retry clears the pending failure', () => {
    const state = reduceSession(log(['created', 'issued', 'failed', 'reprinted']));
    expect(state.lastFailure).toBe(null);
    expect(state.nextAction.kind).toBe('submit_work');
  });

  it('annotations after a terminal state are illegal', () => {
    const events = log(['created', 'abandoned']);
    const state = reduceSession([...events, { ...ev('failed'), seq: 3 }]);
    expect(state.errors).toContain('event[seq=3]: illegal transition abandoned -> failed');
  });
});

describe('reduceSession: remediation lineage', () => {
  it('links forward to the session opened from a failed outcome', () => {
    const state = reduceSession(log(
      ['created', 'issued', 'submitted', 'graded', 'outcome_recorded', 'remediation_opened'],
      { outcome_recorded: { result: 'needs_remediation' }, graded: { attemptIds: ['att_1'], percent: 40 } },
    ));
    expect(state.errors).toEqual([]);
    expect(state.state).toBe('remediation_opened');
    expect(state.remediation).toEqual({ newSessionId: 'ses_next', variant: 1 });
    expect(state.terminal).toBe(true);
  });

  it('links back from a session created as a remediation of another', () => {
    const events = log(['created']);
    events[0].remediationOf = 'ses_prev';
    const state = reduceSession(events);
    expect(state.remediationOf).toBe('ses_prev');
  });
});

describe('nextAction: the wedged-session property', () => {
  /**
   * Walk every state reachable from `created` through the legal table, and
   * assert each non-terminal one offers a next move. A state with no next
   * action is a child holding paper that nothing can advance.
   */
  const reachableLogs = () => {
    const found = new Map(); // state -> event log that reaches it
    const queue = [{ state: 'created', types: ['created'] }];
    found.set('created', ['created']);
    while (queue.length) {
      const { state, types } = queue.shift();
      for (const next of TRANSITIONS[state] || []) {
        // Annotations record a fact without advancing — they are events, not states.
        if (ANNOTATION_EVENTS.has(next) || found.has(next)) continue;
        const path = [...types, next];
        found.set(next, path);
        queue.push({ state: next, types: path });
      }
    }
    return found;
  };

  it('reaches every state named in the transition table', () => {
    const reached = reachableLogs();
    const named = new Set(['created', ...Object.values(TRANSITIONS).flat()]);
    [...named].filter((s) => !ANNOTATION_EVENTS.has(s)).forEach((s) => {
      expect([...reached.keys()]).toContain(s);
    });
  });

  it('every non-terminal reachable state yields a non-null nextAction', () => {
    const reached = reachableLogs();
    for (const [state, types] of reached) {
      const derived = reduceSession(log(types));
      expect(derived.errors).toEqual([]);
      expect(derived.state).toBe(state);
      if (TERMINAL_STATES.has(state)) {
        expect(derived.nextAction).toBe(null);
      } else {
        expect(derived.nextAction, `state ${state} is wedged: no nextAction`).not.toBe(null);
        expect(typeof derived.nextAction.kind).toBe('string');
        expect(derived.nextAction.label.length).toBeGreaterThan(0);
        expect(derived.nextAction.sessionId).toBe(SID);
      }
    }
  });

  it('offers remediation rather than reward when the outcome needs it', () => {
    const state = reduceSession(log(
      ['created', 'issued', 'submitted', 'graded', 'outcome_recorded'],
      { outcome_recorded: { result: 'needs_remediation' } },
    ));
    expect(state.nextAction.kind).toBe('open_remediation');
    expect(state.nextAction.tokenClass).toBe('remediation');
  });

  it('offers the reward step when the outcome passed', () => {
    const state = reduceSession(log(['created', 'issued', 'submitted', 'graded', 'outcome_recorded']));
    expect(state.nextAction.kind).toBe('award_reward');
  });

  it('offers a replay after a stalled media dispatch', () => {
    const state = reduceSession(log(['created', 'media_dispatched', 'media_stalled']));
    expect(state.nextAction.kind).toBe('replay_media');
    expect(state.mediaDispatch.status).toBe('stalled');
  });

  it('offers outcome recording after a launch_dispatched', () => {
    const state = reduceSession(log(['created', 'launch_dispatched']));
    expect(state.nextAction.kind).toBe('record_outcome');
    expect(state.nextAction.label).toBe('Waiting for the work to be done');
  });

  it('a corrupt log with an unrecognised state still offers a recovery action', () => {
    const state = reduceSession([{ type: 'issued', at: AT, sessionId: SID, seq: 1, artifactId: 'd' }]);
    expect(state.nextAction).not.toBe(null);
  });
});
