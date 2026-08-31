import { describe, expect, it, vi } from 'vitest';
import { StateGatesContainer } from '#apps/state-gates/StateGatesContainer.mjs';

function fixture({ logger = null } = {}) {
  const now = Date.parse('2026-08-30T12:00:00-07:00');
  const candidate = {
    schemaVersion: 1, policyRevision: 1, digest: 'policy-one', publishers: { school: {} }, subjectSets: {},
    claimTypes: { 'school.done': { schemaVersion: 1, valueSchema: { type: 'boolean' }, subjectKinds: ['learner'], periodKinds: ['local_day'], acceptedPublishers: ['school'], visibility: 'subscriber' } },
    gates: { 'school.required': { schemaVersion: 1, subjectKinds: ['learner'], periodKinds: ['local_day'], expression: { kind: 'claim', claimTypeId: 'school.done', publisherId: 'school', subject: '$subject', period: '$period', nodeId: 'claim' } } },
    entitlements: { 'piano.games': { gateId: 'school.required', failurePosture: 'fail_closed' } },
  };
  let snapshot = null;
  const journal = [];
  const published = [];
  let candidateError = null;
  const projectionRepository = {
    load: async () => snapshot,
    commitRevision: async (_hid, expected, next, events) => {
      if ((snapshot?.householdRevision ?? 0) !== expected) return { committed: false };
      snapshot = next;
      journal.push(...events.map(event => ({ ...event, published: false })));
      return { committed: true };
    },
  };
  const transitionRepository = {
    pending: async () => journal.filter(item => !item.published),
    markPublished: async (_hid, ids) => journal.forEach(item => { if (ids.includes(item.transitionId)) item.published = true; }),
    replayAfter: async (_hid, revision) => ({ events: journal.filter(item => item.householdRevision > revision) }),
    oldestAvailableRevision: async () => 1,
    compactThrough: async () => {},
  };
  const container = new StateGatesContainer({
    policySource: { loadCandidate: async () => {
      if (candidateError) throw candidateError;
      return structuredClone(candidate);
    } }, projectionRepository, transitionRepository,
    eventPublisher: { publish: async events => published.push(...events) },
    administrationAuthorizer: { authorize: async () => ({ allowed: true }) },
    loadSubjects: async () => [{ kind: 'household', id: 'home' }, { kind: 'learner', id: 'learner-a' }],
    publisherIds: async () => ['school'], now: () => now, timezone: () => 'America/Los_Angeles', logger,
  });
  return {
    container, now, candidate, journal, published, snapshot: () => snapshot,
    setCandidateError: error => { candidateError = error; },
  };
}

describe('StateGatesContainer', () => {
  it('atomically activates, observes, decides, and idempotently retries', async () => {
    const f = fixture();
    expect(await f.container.activatePolicyGraph('home')).toMatchObject({ result: 'activated', currentRevision: 1 });
    expect(f.journal.filter(event => event.householdRevision === 1).some(event => event.kind === 'GateStateChanged')).toBe(false);
    expect(f.journal.filter(event => event.householdRevision === 1 && event.kind === 'StateObservation').every(event => event.payload.initial)).toBe(true);
    const command = {
      assertionId: 'school:a:day', claimTypeId: 'school.done', publisherId: 'school',
      subject: { kind: 'learner', id: 'learner-a' },
      period: { kind: 'local_day', id: '2026-08-30', startsAt: Date.parse('2026-08-30T00:00:00-07:00'), endsAt: Date.parse('2026-08-31T00:00:00-07:00') },
      value: true, sourceRevision: 1, observedAt: f.now, validFrom: f.now,
    };
    expect(await f.container.observeAssertion('home', command)).toMatchObject({ result: 'observed', currentRevision: 2 });
    expect(await f.container.observeAssertion('home', command)).toMatchObject({ result: 'idempotent', currentRevision: 2 });
    expect((await f.container.getCurrentGates('home')).items).toEqual(expect.arrayContaining([expect.objectContaining({ evaluation: expect.objectContaining({ state: 'satisfied' }) })]));
    expect((await f.container.getCurrentEntitlements('home')).items).toEqual(expect.arrayContaining([expect.objectContaining({ decision: 'granted', degraded: false })]));
    expect(f.journal.some(event => event.kind === 'GateStateChanged')).toBe(true);
  });

  it('rejects source conflicts without allocating a household revision', async () => {
    const f = fixture();
    await f.container.activatePolicyGraph('home');
    const base = {
      assertionId: 'a1',
      claimTypeId: 'school.done',
      publisherId: 'school',
      subject: { kind: 'learner', id: 'learner-a' },
      period: {
        kind: 'local_day',
        id: '2026-08-30',
        startsAt: Date.parse('2026-08-30T00:00:00-07:00'),
        endsAt: Date.parse('2026-08-31T00:00:00-07:00'),
      },
      sourceRevision: 1,
      observedAt: f.now,
      validFrom: f.now,
    };
    await f.container.observeAssertion('home', { ...base, value: true });
    await expect(f.container.observeAssertion('home', { ...base, value: false })).rejects.toMatchObject({ code: 'SOURCE_REVISION_CONFLICT', status: 409 });
    expect(f.snapshot().householdRevision).toBe(2);
  });

  it('retains a last valid graph when startup sees an invalid candidate', async () => {
    const f = fixture();
    await f.container.activatePolicyGraph('home');
    f.candidate.policyRevision = 2;
    f.candidate.digest = 'bad';
    f.candidate.entitlements['piano.games'].failurePosture = null;
    const result = await f.container.reconcile('home');
    expect(result.activation.result).toBe('retained');
    expect(f.snapshot().activePolicyCandidate.digest).toBe('policy-one');
    await expect(f.container.getCurrentGates('home')).resolves.toMatchObject({ currentRevision: 1 });
  });

  it('recovers committed but unpublished envelopes during reconciliation', async () => {
    const f = fixture();
    // The fake publisher used by fixture has already proven normal delivery;
    // simulate the persisted outbox interruption directly at its semantic port.
    await f.container.activatePolicyGraph('home');
    const pending = f.journal.filter(item => item.householdRevision === 1);
    pending.forEach(item => { item.published = false; });
    expect(pending.length).toBeGreaterThan(0);
    const result = await f.container.reconcile('home');
    expect(result.activation.result).toBe('unchanged');
    expect(pending.every(item => item.published)).toBe(true);
  });

  it('retires removed gate and entitlement instances without exposing their prior state', async () => {
    const f = fixture();
    await f.container.activatePolicyGraph('home');

    f.candidate.policyRevision = 2;
    f.candidate.digest = 'policy-two';
    f.candidate.gates['school.required'].reasonLabels = { THRESHOLD_NOT_MET: 'Keep trying' };
    await f.container.activatePolicyGraph('home');
    expect(f.journal.filter(event => event.householdRevision === 2 && event.kind === 'StateRetired')).toHaveLength(0);

    f.candidate.policyRevision = 3;
    f.candidate.digest = 'policy-three';
    f.candidate.gates = {};
    f.candidate.entitlements = {};
    await f.container.activatePolicyGraph('home');

    expect(await f.container.getCurrentGates('home')).toMatchObject({ definitions: [], items: [] });
    expect(await f.container.getCurrentEntitlements('home')).toMatchObject({ definitions: [], items: [] });
    const retirements = f.journal.filter(event => event.householdRevision === 3 && event.kind === 'StateRetired');
    expect(retirements).toHaveLength(2);
    expect(retirements.map(event => event.payload.observationKind).sort()).toEqual(['entitlement', 'gate']);
    for (const event of retirements) {
      expect(event.payload).toMatchObject({ cause: 'policy_activated', policyRevision: 3 });
      expect(event.payload).not.toHaveProperty('current');
      expect(event.payload).not.toHaveProperty('previous');
      expect(event.payload).not.toHaveProperty('assertion');
      expect(event.payload).not.toHaveProperty('evidenceRef');
    }
  });

  it('logs sanitized assertion lifecycle events only after durable state changes', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const f = fixture({ logger });
    await f.container.activatePolicyGraph('home');
    const command = {
      assertionId: 'a1', claimTypeId: 'school.done', publisherId: 'school',
      subject: { kind: 'learner', id: 'learner-a' },
      period: {
        kind: 'local_day', id: '2026-08-30',
        startsAt: Date.parse('2026-08-30T00:00:00-07:00'),
        endsAt: Date.parse('2026-08-31T00:00:00-07:00'),
      },
      value: true, sourceRevision: 1, observedAt: f.now, validFrom: f.now,
      evidenceRef: 'private-evidence',
    };
    await f.container.observeAssertion('home', command);
    await f.container.observeAssertion('home', command);
    await expect(f.container.observeAssertion('home', { ...command, value: 'invalid', sourceRevision: 2 })).rejects.toBeTruthy();
    await f.container.observeAssertion('home', { ...command, value: false, sourceRevision: 2 });
    await f.container.retractAssertion('home', {
      assertionId: command.assertionId, publisherId: command.publisherId,
      sourceRevision: 3, retractedAt: f.now + 1, evidenceRef: 'private-retraction',
    });

    const lifecycle = logger.info.mock.calls.filter(([name]) => name.startsWith('state-gates.assertion.'));
    expect(lifecycle.map(([name]) => name)).toEqual([
      'state-gates.assertion.observed',
      'state-gates.assertion.corrected',
      'state-gates.assertion.retracted',
    ]);
    expect(lifecycle.map(([, fields]) => fields.sourceRevision)).toEqual([1, 2, 3]);
    expect(lifecycle[1][1]).toMatchObject({ fromSourceRevision: 1, toSourceRevision: 2, householdRevision: 3 });
    expect(lifecycle[2][1]).toMatchObject({ fromSourceRevision: 2, toSourceRevision: 3, householdRevision: 4 });
    for (const [, fields] of lifecycle) {
      expect(fields).not.toHaveProperty('value');
      expect(fields).not.toHaveProperty('evidenceRef');
      expect(fields).not.toHaveProperty('subject');
      expect(fields).not.toHaveProperty('actor');
      expect(fields).not.toHaveProperty('roles');
      expect(fields).not.toHaveProperty('claimTypeId');
    }
  });

  it('records source and revision failures in candidate diagnostics while retaining the active graph', async () => {
    const f = fixture();
    const sourceError = Object.assign(new Error('policy source missing'), { code: 'POLICY_SOURCE_MISSING' });
    f.setCandidateError(sourceError);
    await expect(f.container.activatePolicyGraph('home')).rejects.toBe(sourceError);
    expect(await f.container.getDiagnostics('home', { id: 'admin' })).toMatchObject({
      policy: {
        active: null,
        candidateValidation: { valid: false, digest: null, errors: [{ code: 'POLICY_SOURCE_MISSING' }] },
      },
    });

    f.setCandidateError(null);
    await f.container.activatePolicyGraph('home');
    f.setCandidateError(sourceError);
    expect(await f.container.reconcile('home')).toMatchObject({ activation: { result: 'retained' } });
    expect(await f.container.getDiagnostics('home', { id: 'admin' })).toMatchObject({
      policy: {
        active: { digest: 'policy-one', policyRevision: 1 },
        candidateValidation: { valid: false, digest: null, errors: [{ code: 'POLICY_SOURCE_MISSING' }] },
      },
    });

    f.setCandidateError(null);
    f.candidate.digest = 'conflicting-revision';
    await expect(f.container.activatePolicyGraph('home')).rejects.toMatchObject({ code: 'POLICY_REVISION_CONFLICT' });
    expect((await f.container.getDiagnostics('home', { id: 'admin' })).policy.candidateValidation)
      .toMatchObject({ valid: false, digest: 'conflicting-revision', errors: [{ code: 'POLICY_REVISION_CONFLICT' }] });

    f.candidate.policyRevision = 2;
    f.candidate.digest = 'policy-two';
    await f.container.activatePolicyGraph('home');
    expect((await f.container.getDiagnostics('home', { id: 'admin' })).policy.candidateValidation)
      .toMatchObject({ valid: true, digest: 'policy-two', errors: [] });
  });
});
