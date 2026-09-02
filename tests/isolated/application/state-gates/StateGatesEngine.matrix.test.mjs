import { describe, expect, it, vi } from 'vitest';
import { StateGatesEngine } from '#apps/state-gates/StateGatesEngine.mjs';

const start = Date.parse('2026-08-30T12:00:00-07:00');

function candidate({ maxAgeMs = null } = {}) {
  return {
    schemaVersion: 1, policyRevision: 1, digest: 'policy-one', publishers: { source: {} }, subjectSets: {},
    claimTypes: {
      'school.done': {
        schemaVersion: 1, valueSchema: { type: 'boolean' }, subjectKinds: ['learner'],
        periodKinds: ['local_day'], acceptedPublishers: ['source'], visibility: 'subscriber',
        validity: { maxAgeMs },
      },
    },
    gates: {
      'school.required': {
        schemaVersion: 1, subjectKinds: ['learner'], periodKinds: ['local_day'],
        expression: {
          kind: 'claim', claimTypeId: 'school.done', publisherId: 'source',
          subject: '$subject', period: '$period', nodeId: 'claim',
        },
      },
    },
    entitlements: { 'media.access': { gateId: 'school.required', failurePosture: 'fail_closed' } },
  };
}

function fixture({ policy = candidate(), commitOutcomes = [], authorize = async () => ({ allowed: true }) } = {}) {
  let now = start;
  let snapshot = null;
  const journal = [];
  const published = [];
  let commits = 0;
  const replayAfter = vi.fn(async (_householdId, afterRevision, limit) => ({
    schema: 'daylight.state-gates-replay/v1', afterRevision, nextRevision: snapshot?.householdRevision ?? 0,
    currentRevision: snapshot?.householdRevision ?? 0, oldestAvailableRevision: 1, hasMore: false,
    events: journal.filter(event => event.householdRevision > afterRevision).slice(0, limit),
  }));
  const engine = new StateGatesEngine({
    policySource: { loadCandidate: async () => structuredClone(policy) },
    projectionRepository: {
      load: async () => snapshot,
      commitRevision: async (_householdId, expectedRevision, next, events) => {
        const forced = commitOutcomes[commits];
        commits += 1;
        if (forced === false || (snapshot?.householdRevision ?? 0) !== expectedRevision) return { committed: false };
        snapshot = structuredClone(next);
        journal.push(...structuredClone(events));
        return { committed: true };
      },
    },
    transitionRepository: {
      pending: async () => [], markPublished: async () => {}, replayAfter,
      oldestAvailableRevision: async () => 1, compactThrough: async () => {},
    },
    eventPublisher: { publish: async events => published.push(...structuredClone(events)) },
    administrationAuthorizer: { authorize },
    loadSubjects: async () => [{ kind: 'household', id: 'home' }, { kind: 'learner', id: 'user_4' }],
    publisherIds: async () => ['source'], roleIds: async () => ['parent', 'admin'],
    now: () => now, timezone: () => 'America/Los_Angeles',
  });
  const command = (value, sourceRevision = 1) => ({
    assertionId: 'source:done:user_4:2026-08-30', claimTypeId: 'school.done', publisherId: 'source',
    subject: { kind: 'learner', id: 'user_4' },
    period: { kind: 'local_day', id: '2026-08-30' },
    value, sourceRevision, observedAt: start, validFrom: start,
  });
  return {
    engine, command, journal, published, replayAfter,
    snapshot: () => snapshot, commits: () => commits, setNow: value => { now = value; },
  };
}

describe('StateGatesEngine verification matrix', () => {
  it('retries compare-and-swap races and commits on the third attempt', async () => {
    const f = fixture({ commitOutcomes: [false, false, true] });
    await expect(f.engine.activatePolicyGraph('home')).resolves.toMatchObject({
      result: 'activated', currentRevision: 1,
    });
    expect(f.commits()).toBe(3);
    expect(f.snapshot().householdRevision).toBe(1);
    expect(f.journal.every(event => event.householdRevision === 1)).toBe(true);
  });

  it('fails after three compare-and-swap races without allocating a revision', async () => {
    const f = fixture({ commitOutcomes: [false, false, false] });
    await expect(f.engine.activatePolicyGraph('home')).rejects.toMatchObject({
      code: 'REVISION_CONFLICT', status: 409,
    });
    expect(f.commits()).toBe(3);
    expect(f.snapshot()).toBeNull();
    expect(f.journal).toEqual([]);
  });

  it('reevaluates corrections, retractions, and expiry with ordered transition batches', async () => {
    const f = fixture({ policy: candidate({ maxAgeMs: 1_000 }) });
    await f.engine.activatePolicyGraph('home');
    await f.engine.observeAssertion('home', f.command(true, 1));
    expect((await f.engine.getCurrentGates('home')).items[0].evaluation.state).toBe('satisfied');

    await f.engine.observeAssertion('home', f.command(false, 2));
    expect((await f.engine.getCurrentEntitlements('home')).items[0]).toMatchObject({
      decision: 'denied', basisState: 'unsatisfied', degraded: false,
    });
    const correction = f.journal.filter(event => event.householdRevision === 3);
    expect(correction.map(event => event.ordinal)).toEqual(correction.map((_event, index) => index));
    expect(correction.map(event => event.kind)).toEqual([
      'StateObservation', 'GateStateChanged', 'StateObservation', 'EntitlementDecisionChanged',
    ]);

    await f.engine.retractAssertion('home', {
      assertionId: f.command(false, 2).assertionId, publisherId: 'source', sourceRevision: 3,
      retractedAt: start + 1,
    });
    expect((await f.engine.getCurrentGates('home')).items[0].evaluation.state).toBe('indeterminate');
    expect((await f.engine.getCurrentEntitlements('home')).items[0]).toMatchObject({
      decision: 'denied', basisState: 'indeterminate', degraded: true,
    });

    const expiry = fixture({ policy: candidate({ maxAgeMs: 1_000 }) });
    await expiry.engine.activatePolicyGraph('home');
    await expiry.engine.observeAssertion('home', expiry.command(true, 1));
    expiry.setNow(start + 1_000);
    await expiry.engine.evaluateGates('home', 'validity_boundary');
    expect((await expiry.engine.getCurrentGates('home')).items[0].evaluation).toMatchObject({
      state: 'indeterminate', reasons: [{ code: 'CLAIM_STALE' }],
    });
    expect(expiry.journal.find(event => event.householdRevision === 3 && event.kind === 'GateStateChanged')?.payload)
      .toMatchObject({ from: 'satisfied', to: 'indeterminate', cause: 'validity_boundary' });
  });

  it('rejects forged manual authority before allocating state', async () => {
    const authorize = vi.fn(async (_actor, capability) => ({ allowed: capability !== 'attest' }));
    const f = fixture({ authorize });
    await f.engine.activatePolicyGraph('home');
    await expect(f.engine.observeManualAttestation('home', { id: 'member-a', roles: ['member'] }, f.command(true)))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(f.snapshot().householdRevision).toBe(1);
    expect(authorize).toHaveBeenCalledWith(
      { id: 'member-a', roles: ['member'] }, 'attest',
      expect.objectContaining({ claimTypeId: 'school.done' }),
    );
  });

  it('rejects authored local-period boundary drift before commit', async () => {
    const f = fixture();
    await f.engine.activatePolicyGraph('home');
    const command = f.command(true);
    command.period = {
      kind: 'local_day', id: '2026-08-30',
      startsAt: Date.parse('2026-08-30T00:00:00Z'), endsAt: Date.parse('2026-08-31T00:00:00Z'),
    };
    await expect(f.engine.observeAssertion('home', command)).rejects.toMatchObject({
      code: 'PERIOD_BOUNDARY_MISMATCH', field: 'period',
    });
    expect(f.snapshot().householdRevision).toBe(1);
  });

  it('caps replay pages at 500 revision batches and preserves the cursor', async () => {
    const f = fixture();
    await f.engine.activatePolicyGraph('home');
    await f.engine.replayTransitions('home', 0, 50_000);
    expect(f.replayAfter).toHaveBeenCalledWith('home', 0, 500);
  });
});
