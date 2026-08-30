import { describe, expect, it } from 'vitest';
import { RequirementsContainer } from '#apps/requirements/RequirementsContainer.mjs';

function fixture() {
  const now = Date.parse('2026-08-30T12:00:00-07:00');
  const candidate = {
    schemaVersion: 1, policyRevision: 1, digest: 'policy-one', publishers: { school: {} }, subjectSets: {},
    claimTypes: { 'school.done': { schemaVersion: 1, valueSchema: { type: 'boolean' }, subjectKinds: ['learner'], periodKinds: ['local_day'], acceptedPublishers: ['school'], visibility: 'subscriber' } },
    requirements: { 'school.required': { schemaVersion: 1, subjectKinds: ['learner'], periodKinds: ['local_day'], expression: { kind: 'claim', claimTypeId: 'school.done', publisherId: 'school', subject: '$subject', period: '$period', nodeId: 'claim' } } },
    entitlements: { 'piano.games': { requirementId: 'school.required', failurePosture: 'fail_closed' } },
  };
  let snapshot = null;
  const journal = [];
  const published = [];
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
  const container = new RequirementsContainer({
    policySource: { loadCandidate: async () => structuredClone(candidate) }, projectionRepository, transitionRepository,
    eventPublisher: { publish: async events => published.push(...events) },
    administrationAuthorizer: { authorize: async () => ({ allowed: true }) },
    loadSubjects: async () => [{ kind: 'household', id: 'home' }, { kind: 'learner', id: 'learner-a' }],
    publisherIds: async () => ['school'], now: () => now, timezone: () => 'America/Los_Angeles',
  });
  return { container, now, candidate, journal, published, snapshot: () => snapshot };
}

describe('RequirementsContainer', () => {
  it('atomically activates, observes, decides, and idempotently retries', async () => {
    const f = fixture();
    expect(await f.container.activatePolicyGraph('home')).toMatchObject({ result: 'activated', currentRevision: 1 });
    expect(f.journal.filter(event => event.householdRevision === 1).some(event => event.kind === 'RequirementStateChanged')).toBe(false);
    expect(f.journal.filter(event => event.householdRevision === 1 && event.kind === 'StateObservation').every(event => event.payload.initial)).toBe(true);
    const command = {
      assertionId: 'school:a:day', claimTypeId: 'school.done', publisherId: 'school',
      subject: { kind: 'learner', id: 'learner-a' },
      period: { kind: 'local_day', id: '2026-08-30', startsAt: Date.parse('2026-08-30T00:00:00-07:00'), endsAt: Date.parse('2026-08-31T00:00:00-07:00') },
      value: true, sourceRevision: 1, observedAt: f.now, validFrom: f.now,
    };
    expect(await f.container.observeAssertion('home', command)).toMatchObject({ result: 'observed', currentRevision: 2 });
    expect(await f.container.observeAssertion('home', command)).toMatchObject({ result: 'idempotent', currentRevision: 2 });
    expect((await f.container.getCurrentRequirements('home')).items).toEqual(expect.arrayContaining([expect.objectContaining({ evaluation: expect.objectContaining({ state: 'satisfied' }) })]));
    expect((await f.container.getCurrentEntitlements('home')).items).toEqual(expect.arrayContaining([expect.objectContaining({ decision: 'granted', degraded: false })]));
    expect(f.journal.some(event => event.kind === 'RequirementStateChanged')).toBe(true);
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
    await expect(f.container.getCurrentRequirements('home')).resolves.toMatchObject({ currentRevision: 1 });
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
});
