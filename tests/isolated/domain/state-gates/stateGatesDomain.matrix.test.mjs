import { describe, expect, it } from 'vitest';
import {
  Assertion, ClaimTypeDefinition, PeriodRef, PolicyGraph, SubjectRef,
  decideEntitlement, evaluateGate,
} from '#domains/state-gates/index.mjs';

const timezone = 'America/Los_Angeles';
const now = Date.parse('2026-08-29T12:00:00-07:00');
const learner = new SubjectRef({ kind: 'learner', id: 'user_4' });
const day = PeriodRef.localDay('2026-08-29', timezone);

function claim(overrides = {}) {
  return new ClaimTypeDefinition({
    id: 'metric.value', schemaVersion: 1, valueSchema: { type: 'boolean' },
    subjectKinds: ['learner'], periodKinds: ['local_day'], acceptedPublishers: ['source'],
    visibility: 'subscriber', validity: {}, ...overrides,
  });
}

function graphFor({ valueSchema = { type: 'boolean' }, expression, progress = null, subjectKinds = ['learner'], periodKinds = ['local_day'] }) {
  return PolicyGraph.create({
    schemaVersion: 1, policyRevision: 1, digest: 'matrix', publishers: { source: {} }, subjectSets: {},
    claimTypes: {
      'metric.value': {
        schemaVersion: 1, valueSchema, subjectKinds: ['learner'], periodKinds: ['local_day'],
        acceptedPublishers: ['source'], visibility: 'subscriber', validity: {},
      },
    },
    gates: {
      'matrix.gate': {
        schemaVersion: 1, subjectKinds, periodKinds,
        expression: expression ?? {
          kind: 'claim', claimTypeId: 'metric.value', publisherId: 'source',
          subject: '$subject', period: '$period', nodeId: 'claim',
        },
        progress,
      },
    },
    entitlements: { 'matrix.access': { gateId: 'matrix.gate', failurePosture: 'fail_closed' } },
  }, { timezone, publisherIds: ['source'], subjects: [learner] });
}

function assertionFor(graph, value, overrides = {}) {
  return Assertion.observe({
    id: 'source:metric:day', claimTypeId: 'metric.value', subject: learner, period: day,
    publisherId: 'source', value, sourceRevision: 1, observedAt: now, validFrom: now,
    ...overrides,
  }, graph.claimTypes.get('metric.value'), { now }).assertion;
}

describe('State Gates domain verification matrix', () => {
  it.each([
    [{ type: 'boolean' }, true, 'yes'],
    [{ type: 'integer', min: 0, max: 10 }, 4, 4.5],
    [{ type: 'number', min: 0, max: 10 }, 4.5, Number.NaN],
    [{ type: 'string', maxLength: 5, pattern: '^[a-z]+$' }, 'okay', 'TOO-LONG'],
    [{ type: 'enum', values: ['red', 'blue'] }, 'red', 'green'],
    [{ type: 'duration', min: 0, unit: 'millisecond' }, 5_000, 'PT5S'],
  ])('enforces the closed typed-value schema %#', (valueSchema, valid, invalid) => {
    const definition = claim({ valueSchema });
    expect(definition.validateValue(valid)).toBe(valid);
    expect(() => definition.validateValue(invalid)).toThrowError(expect.objectContaining({
      code: expect.stringMatching(/^VALUE_|NOT_ALLOWED/),
    }));
  });

  it('enforces actor, future-skew, and period-contained assertion invariants', () => {
    const definition = claim({
      validity: {
        maxFutureSkewMs: 1_000, mustFitPeriod: true, actorRequired: true,
        acceptedActorRoles: ['parent'],
      },
    });
    const base = {
      id: 'a1', claimTypeId: definition.id, subject: learner, period: day,
      publisherId: 'source', value: true, sourceRevision: 1,
      observedAt: now, validFrom: now, validUntil: now + 1_000,
    };
    expect(() => Assertion.observe(base, definition, { now })).toThrowError(expect.objectContaining({ code: 'ACTOR_REQUIRED' }));
    expect(() => Assertion.observe({ ...base, actor: { id: 'adult', roles: ['member'] } }, definition, { now }))
      .toThrowError(expect.objectContaining({ code: 'ACTOR_ROLE_NOT_ACCEPTED' }));
    expect(() => Assertion.observe({ ...base, observedAt: now + 1_001, validFrom: now, actor: { id: 'adult', roles: ['parent'] } }, definition, { now }))
      .toThrowError(expect.objectContaining({ code: 'FUTURE_OBSERVATION' }));
    expect(() => Assertion.observe({ ...base, validUntil: day.endsAt + 1, actor: { id: 'adult', roles: ['parent'] } }, definition, { now }))
      .toThrowError(expect.objectContaining({ code: 'VALIDITY_OUTSIDE_PERIOD' }));
    expect(Assertion.observe({ ...base, actor: { id: 'adult', roles: ['parent'] } }, definition, { now }).assertion.actor)
      .toMatchObject({ id: 'adult', roles: ['parent'] });
  });

  it.each([
    ['eq', 5, 5, 'satisfied'],
    ['neq', 5, 4, 'satisfied'],
    ['lt', 4, 5, 'satisfied'],
    ['lte', 5, 5, 'satisfied'],
    ['gt', 6, 5, 'satisfied'],
    ['gte', 4, 5, 'unsatisfied'],
  ])('evaluates numeric comparison %s', (op, actual, target, state) => {
    const expression = {
      kind: 'comparison',
      claim: { claimTypeId: 'metric.value', publisherId: 'source', subject: '$subject', period: '$period' },
      op, value: target, unit: 'minute', nodeId: 'comparison',
    };
    const graph = graphFor({ valueSchema: { type: 'number', unit: 'minute' }, expression });
    expect(evaluateGate({ graph, assertions: [assertionFor(graph, actual)], gateId: 'matrix.gate', subject: learner, period: day, now, timezone }).state)
      .toBe(state);
  });

  it('supports enum membership and rejects comparison unit drift at activation', () => {
    const membership = {
      kind: 'comparison',
      claim: { claimTypeId: 'metric.value', publisherId: 'source', subject: '$subject', period: '$period' },
      op: 'in', value: ['ready', 'done'], nodeId: 'membership',
    };
    const graph = graphFor({ valueSchema: { type: 'enum', values: ['ready', 'done', 'blocked'] }, expression: membership });
    expect(evaluateGate({ graph, assertions: [assertionFor(graph, 'ready')], gateId: 'matrix.gate', subject: learner, period: day, now, timezone }).state)
      .toBe('satisfied');

    expect(() => graphFor({
      valueSchema: { type: 'number', unit: 'minute' },
      expression: {
        kind: 'comparison',
        claim: { claimTypeId: 'metric.value', publisherId: 'source', subject: '$subject', period: '$period' },
        op: 'gte', value: 30, unit: 'second', nodeId: 'comparison',
      },
    })).toThrowError(expect.objectContaining({ code: 'UNIT_MISMATCH' }));
  });

  it.each([
    ['atLeast', 2, [true, false, null], 'indeterminate'],
    ['atLeast', 2, [true, false, false], 'unsatisfied'],
    ['atMost', 1, [true, null, false], 'indeterminate'],
    ['atMost', 1, [true, true, false], 'unsatisfied'],
    ['exactly', 2, [true, true, false], 'satisfied'],
    ['exactly', 2, [true, null, false], 'indeterminate'],
    ['exactly', 2, [true, true, true], 'unsatisfied'],
  ])('evaluates count threshold %s=%d with bounded uncertainty', (thresholdKind, target, values, expectedState) => {
    const members = values.map((_value, index) => new SubjectRef({ kind: 'learner', id: `learner-${index}` }));
    const household = new SubjectRef({ kind: 'household', id: 'home' });
    const candidate = {
      schemaVersion: 1, policyRevision: 1, digest: 'count', publishers: { source: {} },
      subjectSets: { learners: members },
      claimTypes: {
        'metric.value': {
          schemaVersion: 1, valueSchema: { type: 'boolean' }, subjectKinds: ['learner'],
          periodKinds: ['local_day'], acceptedPublishers: ['source'], visibility: 'subscriber', validity: {},
        },
      },
      gates: {
        'matrix.gate': {
          schemaVersion: 1, subjectKinds: ['household'], periodKinds: ['local_day'],
          expression: {
            kind: 'count', over: 'learners', as: 'learner', threshold: { [thresholdKind]: target }, nodeId: 'count',
            where: {
              kind: 'claim', claimTypeId: 'metric.value', publisherId: 'source',
              subject: '$learner', period: '$period', nodeId: 'where',
            },
          },
          progress: ['atLeast', 'exactly'].includes(thresholdKind) ? { basisNodeId: 'count' } : null,
        },
      },
      entitlements: {},
    };
    const graph = PolicyGraph.create(candidate, {
      timezone, publisherIds: ['source'], subjects: [...members, household],
    });
    const assertions = values.flatMap((value, index) => value == null ? [] : [Assertion.observe({
      id: `a${index}`, claimTypeId: 'metric.value', subject: members[index], period: day,
      publisherId: 'source', value, sourceRevision: 1, observedAt: now, validFrom: now,
    }, graph.claimTypes.get('metric.value'), { now }).assertion]);
    const evaluation = evaluateGate({
      graph, assertions, gateId: 'matrix.gate', subject: household, period: day, now, timezone,
    });
    expect(evaluation.state).toBe(expectedState);
    if (thresholdKind === 'atLeast' || thresholdKind === 'exactly') {
      expect(evaluation.progress).toMatchObject({ target, unit: 'count' });
    }
  });

  it('treats incompatible instances as not applicable and grants without degradation', () => {
    const graph = graphFor({});
    const occurrence = new PeriodRef({ kind: 'occurrence', id: 'lesson-1', startsAt: now, endsAt: now + 60_000 });
    const evaluation = evaluateGate({
      graph, assertions: [], gateId: 'matrix.gate', subject: learner, period: occurrence, now, timezone,
    });
    expect(evaluation).toMatchObject({ state: 'not_applicable', reasons: [{ code: 'NOT_APPLICABLE' }] });
    expect(decideEntitlement({ definition: graph.entitlements.get('matrix.access'), evaluation }))
      .toMatchObject({ decision: 'granted', basisState: 'not_applicable', degraded: false });
  });

  it.each([
    ['overnight', '2026-08-30T00:00:00-07:00', '2026-08-30T01:00:00-07:00', ['sat'], '22:00', '02:00', '2026-08-30T02:00:00-07:00'],
    ['spring gap', '2026-03-08T00:00:00-08:00', '2026-03-08T03:00:00-07:00', ['sun'], '01:30', '03:30', '2026-03-08T03:30:00-07:00'],
    ['fall fold', '2026-11-01T00:00:00-07:00', '2026-11-01T01:30:00-08:00', ['sun'], '00:30', '02:30', '2026-11-01T02:30:00-08:00'],
  ])('evaluates %s schedule windows with timezone boundaries', (_label, periodStart, instant, days, start, end, expectedBoundary) => {
    const current = Date.parse(instant);
    const graph = graphFor({
      expression: { kind: 'schedule', days, start, end, nodeId: 'schedule' },
    });
    const period = new PeriodRef({
      kind: 'local_day', id: periodStart.slice(0, 10), startsAt: Date.parse(periodStart),
      endsAt: Date.parse(expectedBoundary) + 24 * 60 * 60 * 1_000,
    });
    const evaluation = evaluateGate({
      graph, assertions: [], gateId: 'matrix.gate', subject: learner, period, now: current, timezone,
    });
    expect(evaluation.state).toBe('satisfied');
    expect(evaluation.nextBoundary).toEqual({ at: Date.parse(expectedBoundary), kind: 'schedule' });
  });

  it('builds both DST local-day lengths and validates local-week identities', () => {
    expect(PeriodRef.localDay('2026-03-08', timezone).endsAt - PeriodRef.localDay('2026-03-08', timezone).startsAt)
      .toBe(23 * 60 * 60 * 1_000);
    expect(PeriodRef.localDay('2026-11-01', timezone).endsAt - PeriodRef.localDay('2026-11-01', timezone).startsAt)
      .toBe(25 * 60 * 60 * 1_000);
    expect(PeriodRef.localWeek('2026-W35', timezone).id).toBe('2026-W35');
    expect(() => PeriodRef.localWeek('2026-W99', timezone)).toThrowError(expect.objectContaining({ code: 'INVALID_LOCAL_WEEK' }));
  });
});
