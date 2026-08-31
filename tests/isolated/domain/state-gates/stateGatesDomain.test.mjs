import { describe, expect, it } from 'vitest';
import {
  Assertion, PolicyGraph, PeriodRef, SubjectRef, decideEntitlement, evaluateGate, fourState,
} from '#domains/state-gates/index.mjs';

const timezone = 'America/Los_Angeles';
const now = Date.parse('2026-08-29T12:00:00-07:00');
const period = new PeriodRef({
  kind: 'local_day', id: '2026-08-29',
  startsAt: Date.parse('2026-08-29T00:00:00-07:00'),
  endsAt: Date.parse('2026-08-30T00:00:00-07:00'),
});
const learner = new SubjectRef({ kind: 'learner', id: 'learner-a' });

function candidate(expression = { kind: 'claim', claimTypeId: 'school.done', publisherId: 'school', subject: '$subject', period: '$period', nodeId: 'claim' }) {
  return {
    schemaVersion: 1, policyRevision: 1, digest: 'digest', activatedAt: now,
    publishers: { school: {} }, subjectSets: {},
    claimTypes: {
      'school.done': {
        schemaVersion: 1, valueSchema: { type: 'boolean' }, subjectKinds: ['learner'],
        periodKinds: ['local_day'], acceptedPublishers: ['school'], visibility: 'subscriber',
        validity: { maxAgeMs: 86_400_000 },
      },
    },
    gates: {
      'school.required': { schemaVersion: 1, subjectKinds: ['learner'], periodKinds: ['local_day'], expression },
    },
    entitlements: {
      'piano.games': { gateId: 'school.required', failurePosture: 'fail_closed' },
    },
  };
}

function graph(value = candidate()) {
  return PolicyGraph.create(value, { timezone, publisherIds: ['school'], subjects: [learner] });
}

describe('State Gates domain', () => {
  it('implements the normative four-state truth tables', () => {
    const states = ['satisfied', 'unsatisfied', 'indeterminate', 'not_applicable'];
    const all = {
      satisfied: ['satisfied', 'unsatisfied', 'indeterminate', 'satisfied'],
      unsatisfied: ['unsatisfied', 'unsatisfied', 'unsatisfied', 'unsatisfied'],
      indeterminate: ['indeterminate', 'unsatisfied', 'indeterminate', 'indeterminate'],
      not_applicable: ['satisfied', 'unsatisfied', 'indeterminate', 'not_applicable'],
    };
    const any = {
      satisfied: ['satisfied', 'satisfied', 'satisfied', 'satisfied'],
      unsatisfied: ['satisfied', 'unsatisfied', 'indeterminate', 'unsatisfied'],
      indeterminate: ['satisfied', 'indeterminate', 'indeterminate', 'indeterminate'],
      not_applicable: ['satisfied', 'unsatisfied', 'indeterminate', 'not_applicable'],
    };
    for (const [leftIndex, left] of states.entries()) {
      for (const [rightIndex, right] of states.entries()) {
        expect(fourState.all([left, right]), `all(${left}, ${right})`).toBe(all[left][rightIndex]);
        expect(fourState.any([left, right]), `any(${left}, ${right})`).toBe(any[left][rightIndex]);
      }
      expect(fourState.not(left), `not(${left})`).toBe(states[[1, 0, 2, 3][leftIndex]]);
    }
  });

  it('keeps publisher sources independent and treats missing evidence as indeterminate', () => {
    const policy = graph();
    const missing = evaluateGate({ graph: policy, assertions: [], gateId: 'school.required', subject: learner, period, now, timezone });
    expect(missing.state).toBe('indeterminate');
    const assertion = Assertion.observe({
      id: 'school:a:day', claimTypeId: 'school.done', subject: learner, period,
      publisherId: 'school', value: true, sourceRevision: 1, observedAt: now, validFrom: now,
    }, policy.claimTypes.get('school.done'), { now }).assertion;
    const evaluation = evaluateGate({ graph: policy, assertions: [assertion], gateId: 'school.required', subject: learner, period, now, timezone });
    expect(evaluation.state).toBe('satisfied');
    expect(decideEntitlement({ definition: policy.entitlements.get('piano.games'), evaluation })).toMatchObject({ decision: 'granted', degraded: false });
    const stale = evaluateGate({ graph: policy, assertions: [assertion], gateId: 'school.required', subject: learner, period, now: now + 86_400_000, timezone });
    expect(stale).toMatchObject({ state: 'indeterminate', reasons: [{ code: 'CLAIM_STALE' }] });
  });

  it('does not let a different accepted publisher satisfy a qualified selector', () => {
    const value = candidate();
    value.publishers.fitness = {};
    value.claimTypes['school.done'].acceptedPublishers.push('fitness');
    const policy = PolicyGraph.create(value, { timezone, publisherIds: ['school', 'fitness'], subjects: [learner] });
    const fitnessAssertion = Assertion.observe({
      id: 'fitness:a:day', claimTypeId: 'school.done', subject: learner, period,
      publisherId: 'fitness', value: true, sourceRevision: 1, observedAt: now, validFrom: now,
    }, policy.claimTypes.get('school.done'), { now }).assertion;
    expect(evaluateGate({ graph: policy, assertions: [fitnessAssertion], gateId: 'school.required', subject: learner, period, now, timezone }).state).toBe('indeterminate');
  });

  it('applies fail-open and fail-closed only to indeterminate evidence', () => {
    const value = candidate();
    value.entitlements['piano.preview'] = { gateId: 'school.required', failurePosture: 'fail_open' };
    const policy = graph(value);
    const evaluation = evaluateGate({ graph: policy, assertions: [], gateId: 'school.required', subject: learner, period, now, timezone });
    expect(decideEntitlement({ definition: policy.entitlements.get('piano.games'), evaluation })).toMatchObject({ decision: 'denied', degraded: true });
    expect(decideEntitlement({ definition: policy.entitlements.get('piano.preview'), evaluation })).toMatchObject({ decision: 'granted', degraded: true });
  });

  it('retraction restores uncertainty without deleting provenance', () => {
    const policy = graph();
    const claim = policy.claimTypes.get('school.done');
    const observed = Assertion.observe({ id: 'a1', claimTypeId: claim.id, subject: learner, period, publisherId: 'school', value: true, sourceRevision: 1, observedAt: now, validFrom: now }, claim, { now }).assertion;
    const { assertion, events } = observed.retract({ sourceRevision: 2, retractedAt: now + 1 }, claim);
    expect(assertion).toMatchObject({ status: 'retracted', supersedesSourceRevision: 1, sourceRevision: 2 });
    expect(events[0].kind).toBe('AssertionRetracted');
    expect(evaluateGate({ graph: policy, assertions: [assertion], gateId: 'school.required', subject: learner, period, now: now + 1, timezone }).state).toBe('indeterminate');
  });

  it('uses count bounds so unresolved members matter only when they can change the result', () => {
    const learners = ['a', 'b', 'c'].map(id => new SubjectRef({ kind: 'learner', id }));
    const value = candidate({
      kind: 'count', over: 'learners', as: 'learner', threshold: { atLeast: 2 }, nodeId: 'count',
      where: { kind: 'claim', claimTypeId: 'school.done', publisherId: 'school', subject: '$learner', period: '$period', nodeId: 'where' },
    });
    value.subjectSets.learners = learners;
    value.gates['school.required'].subjectKinds = ['household'];
    const household = new SubjectRef({ kind: 'household', id: 'home' });
    const policy = PolicyGraph.create(value, { timezone, publisherIds: ['school'], subjects: [...learners, household] });
    const assertions = learners.slice(0, 2).map((subject, index) => Assertion.observe({ id: `a${index}`, claimTypeId: 'school.done', subject, period, publisherId: 'school', value: true, sourceRevision: 1, observedAt: now, validFrom: now }, policy.claimTypes.get('school.done'), { now }).assertion);
    expect(evaluateGate({ graph: policy, assertions, gateId: 'school.required', subject: household, period, now, timezone }).state).toBe('satisfied');
  });

  it('evaluates schedules from supplied time and returns the next boundary', () => {
    const value = candidate({ kind: 'schedule', days: ['sat'], start: '09:00', end: '17:00', nodeId: 'schedule' });
    const policy = graph(value);
    const evaluation = evaluateGate({ graph: policy, assertions: [], gateId: 'school.required', subject: learner, period, now, timezone });
    expect(evaluation.state).toBe('satisfied');
    expect(evaluation.nextBoundary.at).toBe(Date.parse('2026-08-29T17:00:00-07:00'));
  });

  it('constructs local periods with household timezone DST boundaries', () => {
    const springForward = PeriodRef.localDay('2026-03-08', timezone);
    expect(springForward.endsAt - springForward.startsAt).toBe(23 * 60 * 60 * 1000);
  });

  it('projects explicit numeric progress without inventing aggregate weights', () => {
    const value = candidate();
    value.claimTypes['fitness.minutes'] = {
      schemaVersion: 1, valueSchema: { type: 'number', min: 0, unit: 'minute' },
      subjectKinds: ['learner'], periodKinds: ['local_day'], acceptedPublishers: ['school'], visibility: 'subscriber',
    };
    const comparison = { kind: 'comparison', claim: { claimTypeId: 'fitness.minutes', publisherId: 'school', subject: '$subject', period: '$period' }, op: 'gte', value: 30, unit: 'minute', nodeId: 'school.required/expression/1' };
    value.gates['school.required'].expression = { kind: 'all', children: [{ kind: 'schedule', days: ['sat'], start: '00:00', end: '24:00', nodeId: 'school.required/expression/0' }, comparison], nodeId: 'school.required/expression' };
    value.gates['school.required'].progress = { basisNodeId: comparison.nodeId };
    const policy = graph(value);
    const assertion = Assertion.observe({ id: 'minutes', claimTypeId: 'fitness.minutes', subject: learner, period, publisherId: 'school', value: 15, sourceRevision: 1, observedAt: now, validFrom: now }, policy.claimTypes.get('fitness.minutes'), { now }).assertion;
    const evaluation = evaluateGate({ graph: policy, assertions: [assertion], gateId: 'school.required', subject: learner, period, now, timezone });
    expect(evaluation).toMatchObject({ state: 'unsatisfied', progress: { current: 15, target: 30, unit: 'minute', ratio: 0.5 } });
  });

  it('rejects reference cycles and exposes readonly policy maps', () => {
    const value = candidate({ kind: 'reference', gateId: 'school.other', nodeId: 'a' });
    value.gates['school.other'] = { schemaVersion: 1, subjectKinds: ['learner'], periodKinds: ['local_day'], expression: { kind: 'reference', gateId: 'school.required', nodeId: 'b' } };
    expect(() => graph(value)).toThrowError(expect.objectContaining({ code: 'GATE_CYCLE' }));
    const valid = graph();
    expect(() => valid.gates.set('school.extra', {})).toThrow(/ReadonlyMap/);
  });
});
