import { describe, expect, it, vi } from 'vitest';
import { YamlStateGatesPolicySource } from '#adapters/state-gates/config/YamlStateGatesPolicySource.mjs';
import { YamlStateGatesStateEngine } from '#adapters/state-gates/persistence/YamlStateGatesStateEngine.mjs';
import { YamlStateGatesProjectionRepository } from '#adapters/state-gates/persistence/YamlStateGatesProjectionRepository.mjs';
import { YamlStateGatesTransitionRepository } from '#adapters/state-gates/persistence/YamlStateGatesTransitionRepository.mjs';
import { IStateGatesProjectionRepository } from '#apps/state-gates/ports/IStateGatesProjectionRepository.mjs';
import { IStateGatesTransitionRepository } from '#apps/state-gates/ports/IStateGatesTransitionRepository.mjs';
import { AuthenticatedStateGatesIngress } from '#adapters/state-gates/ingress/AuthenticatedStateGatesIngress.mjs';
import { HttpStateGatesIdentityAdapter } from '#adapters/state-gates/ingress/HttpStateGatesIdentityAdapter.mjs';
import { ConfigStateGatesSubjectCatalog } from '#adapters/state-gates/config/ConfigStateGatesSubjectCatalog.mjs';
import { RoleStateGatesAdministrationAuthorizer } from '#adapters/state-gates/auth/RoleStateGatesAdministrationAuthorizer.mjs';
import { StateGatesEventBusPublisher } from '#adapters/state-gates/eventbus/StateGatesEventBusPublisher.mjs';

describe('State Gates adapters', () => {
  it('maps household YAML into a typed candidate with a semantic digest', async () => {
    const raw = {
      schema: 'daylight.state-gates-policy/v1', policy_revision: 1,
      publishers: { school: {} }, subject_sets: {},
      claim_types: { 'school.done': { schema_version: 1, value: { type: 'boolean' }, subject_kinds: ['learner'], period_kinds: ['local_day'], accepted_publishers: ['school'], visibility: 'subscriber', validity: { max_age: 'P2D' } } },
      gates: { 'school.required': { schema_version: 1, subject_kinds: ['learner'], period_kinds: ['local_day'], expression: { claim: { type: 'school.done', publisher: 'school', subject: '$subject', period: '$period' } } } },
      entitlements: { 'piano.games': { gate: 'school.required', failure_posture: 'fail_closed' } },
    };
    const source = new YamlStateGatesPolicySource({ load: async () => raw });
    const candidate = await source.loadCandidate('home');
    expect(candidate.claimTypes['school.done'].validity.maxAgeMs).toBe(172_800_000);
    expect(candidate.gates['school.required'].expression).toMatchObject({ kind: 'claim', publisherId: 'school' });
    expect(candidate.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('decodes every authored expression form and explicit progress paths', async () => {
    const raw = {
      schema: 'daylight.state-gates-policy/v1', policy_revision: 1,
      publishers: { school: {} },
      subject_sets: { learners: { kind: 'learner', members: ['a', 'b'] } },
      claim_types: {
        'school.done': {
          schema_version: 1, value: { type: 'boolean' }, subject_kinds: ['learner'],
          period_kinds: ['local_day'], accepted_publishers: ['school'], visibility: 'subscriber', validity: {},
        },
        'school.minutes': {
          schema_version: 1, value: { type: 'number', unit: 'minute' }, subject_kinds: ['learner'],
          period_kinds: ['local_day'], accepted_publishers: ['school'], visibility: 'subscriber', validity: {},
        },
      },
      gates: {
        'school.base': {
          schema_version: 1, subject_kinds: ['learner'], period_kinds: ['local_day'],
          expression: { claim: { type: 'school.done', publisher: 'school' } },
        },
        'school.matrix': {
          schema_version: 1, subject_kinds: ['learner'], period_kinds: ['local_day'],
          expression: {
            all: [
              { any: [{ reference: 'school.base' }, { not: { claim: { type: 'school.done', publisher: 'school' } } }] },
              { comparison: { claim: { type: 'school.minutes', publisher: 'school' }, op: 'gte', value: { amount: 30, unit: 'minute' } } },
              { count: { over: 'learners', as: 'learner', where: { claim: { type: 'school.done', publisher: 'school', subject: '$learner' } }, threshold: { at_least: 1 } } },
              { schedule: { days: ['mon'], start: '08:00', end: '09:00' } },
            ],
          },
          progress: { from: '/all/1' },
        },
      },
      entitlements: {},
    };
    const candidate = await new YamlStateGatesPolicySource({ load: async () => raw }).loadCandidate('home');
    const expression = candidate.gates['school.matrix'].expression;
    expect(expression).toMatchObject({
      kind: 'all', nodeId: 'school.matrix/expression',
      children: [
        { kind: 'any', children: [{ kind: 'reference', gateId: 'school.base' }, { kind: 'not' }] },
        { kind: 'comparison', op: 'gte', value: 30, unit: 'minute' },
        { kind: 'count', over: 'learners', as: 'learner', threshold: { atLeast: 1 } },
        { kind: 'schedule', days: ['mon'], start: '08:00', end: '09:00' },
      ],
    });
    expect(candidate.gates['school.matrix'].progress).toEqual({
      basisNodeId: 'school.matrix/expression/1',
    });
  });

  it.each([
    [0, 0],
    ['P0D', 0],
    ['PT1.5S', 1_500],
    ['P1W', 604_800_000],
    ['P1DT2H', 93_600_000],
  ])('accepts strict non-negative duration form %j', async (maxAge, expected) => {
    const raw = {
      schema: 'daylight.state-gates-policy/v1', policy_revision: 1,
      publishers: {}, subject_sets: {}, gates: {}, entitlements: {},
      claim_types: {
        'school.done': {
          schema_version: 1, value: { type: 'boolean' }, subject_kinds: ['learner'],
          period_kinds: ['local_day'], accepted_publishers: [], visibility: 'subscriber',
          validity: { max_age: maxAge },
        },
      },
    };
    const candidate = await new YamlStateGatesPolicySource({ load: async () => raw }).loadCandidate('home');
    expect(candidate.claimTypes['school.done'].validity.maxAgeMs).toBe(expected);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, '5 minutes', '5000', '-PT1M', 'P', 'PT', 'P1W2D', {}])(
    'rejects invalid duration %j with its authored field path',
    async maxAge => {
      const raw = {
        schema: 'daylight.state-gates-policy/v1', policy_revision: 1,
        publishers: {}, subject_sets: {}, gates: {}, entitlements: {},
        claim_types: {
          'school.done': {
            schema_version: 1, value: { type: 'boolean' }, subject_kinds: ['learner'],
            period_kinds: ['local_day'], accepted_publishers: [], visibility: 'subscriber',
            validity: { max_age: maxAge },
          },
        },
      };
      await expect(new YamlStateGatesPolicySource({ load: async () => raw }).loadCandidate('home'))
        .rejects.toMatchObject({
          name: 'ValidationError', code: 'INVALID_DURATION',
          field: 'claim_types.school.done.validity.max_age',
        });
    },
  );

  it('atomically stores projections and replays whole revision batches', async () => {
    const memory = new Map();
    const engine = new YamlStateGatesStateEngine({ resolveFilePath: householdId => `/virtual/${householdId}/current.yml`, load: path => memory.get(path) ?? null, save: (path, value) => memory.set(path, value) });
    const projections = new YamlStateGatesProjectionRepository({ engine });
    const transitions = new YamlStateGatesTransitionRepository({ engine });
    expect(projections).toBeInstanceOf(IStateGatesProjectionRepository);
    expect(transitions).toBeInstanceOf(IStateGatesTransitionRepository);
    const events = [0, 1].map(ordinal => ({ schema: 'daylight.state-gates-event/v1', transitionId: `t${ordinal}`, householdRevision: 1, ordinal, occurredAt: Date.now(), kind: 'StateObservation', payload: {} }));
    expect(await projections.commitRevision('home', 0, { householdRevision: 1, activePolicyCandidate: null, assertions: [], evaluations: [], decisions: [] }, events)).toMatchObject({ committed: true });
    expect((await transitions.pending('home'))).toHaveLength(2);
    await transitions.markPublished('home', ['t0', 't1']);
    const replay = await transitions.replayAfter('home', 0, 1);
    expect(replay.events).toHaveLength(2);
    expect(replay.nextRevision).toBe(1);
    expect(await projections.load('other')).toBeNull();
  });

  it('accepts only publisher principals authenticated by the injected boundary', async () => {
    const fixedPrincipal = Object.freeze({ service: 'school' });
    const observed = [];
    const ingress = new AuthenticatedStateGatesIngress({
      observeAssertion: async (_householdId, command) => observed.push(command),
      retractAssertion: async () => {},
      resolvePublisher: principal => principal === fixedPrincipal ? 'school' : null,
    });
    await ingress.observe('home', fixedPrincipal, { assertionId: 'a1' });
    expect(observed[0].publisherId).toBe('school');
    await expect(ingress.observe('home', { publisherId: 'school' }, { assertionId: 'a2' })).rejects.toMatchObject({ code: 'PUBLISHER_UNAUTHENTICATED' });
  });

  it('injects publisher authority for both observation and retraction ingress', async () => {
    const principal = Object.freeze({ service: 'school' });
    const observeAssertion = vi.fn(async () => ({ result: 'observed' }));
    const retractAssertion = vi.fn(async () => ({ result: 'retracted' }));
    const ingress = new AuthenticatedStateGatesIngress({
      observeAssertion, retractAssertion,
      resolvePublisher: candidate => candidate === principal ? 'school' : null,
    });
    await ingress.observe('home', principal, { assertionId: 'a1', publisherId: 'forged' });
    await ingress.retract('home', principal, { assertionId: 'a1', publisherId: 'forged', sourceRevision: 2 });
    expect(observeAssertion).toHaveBeenCalledWith('home', { assertionId: 'a1', publisherId: 'school' });
    expect(retractAssertion).toHaveBeenCalledWith('home', {
      assertionId: 'a1', publisherId: 'school', sourceRevision: 2,
    });
  });

  it('derives HTTP identity only from token or trusted-network context', () => {
    const identity = new HttpStateGatesIdentityAdapter();
    expect(identity.actorFromRequest({ user: { sub: 'parent-a', roles: ['parent'] }, roles: ['admin'] }))
      .toEqual({ id: 'parent-a', kind: 'user', roles: ['admin'], authenticatedBy: 'token' });
    expect(identity.actorFromRequest({ isLocal: true, roles: ['parent'], headers: { 'x-daylight-device': 'forged' } }))
      .toEqual({ id: 'trusted-local-network', kind: 'network', roles: ['parent'], authenticatedBy: 'network_trust' });
    expect(() => identity.actorFromRequest({ headers: { 'x-daylight-device': 'device-a' } }))
      .toThrowError(expect.objectContaining({ code: 'UNAUTHENTICATED', status: 401 }));
  });

  it('builds a deduplicated household subject catalog from configuration', async () => {
    const catalog = new ConfigStateGatesSubjectCatalog({
      configService: {
        getHouseholdUsers: () => ['learner-a', { id: 'learner-b' }, { username: 'learner-c' }],
        getHouseholdDevices: () => ({
          devices: {
            tablet: { room: 'yellow-room' }, television: { location: 'yellow-room' }, speaker: { room: 'kitchen' },
          },
        }),
      },
    });
    expect(await catalog.load('home')).toEqual([
      { kind: 'household', id: 'home' },
      { kind: 'learner', id: 'learner-a' },
      { kind: 'learner', id: 'learner-b' },
      { kind: 'learner', id: 'learner-c' },
      { kind: 'device', id: 'tablet' },
      { kind: 'device', id: 'television' },
      { kind: 'device', id: 'speaker' },
      { kind: 'room', id: 'yellow-room' },
      { kind: 'room', id: 'kitchen' },
    ]);
  });

  it('maps established roles to attestation and administrative capabilities', async () => {
    const authorizer = new RoleStateGatesAdministrationAuthorizer();
    await expect(authorizer.authorize({ id: 'p', roles: ['parent'] }, 'attest')).resolves.toEqual({ allowed: true });
    await expect(authorizer.authorize({ id: 'p', roles: ['parent'] }, 'activate_policy')).resolves.toEqual({ allowed: false });
    await expect(authorizer.authorize({ id: 'a', roles: ['admin'] }, 'activate_policy')).resolves.toEqual({ allowed: true });
  });

  it('surfaces corrupt durable state instead of silently replacing it', async () => {
    const engine = new YamlStateGatesStateEngine({
      filePath: '/virtual/corrupt.yml',
      load: () => { throw new Error('bad yaml'); },
      save: () => {},
    });
    await expect(engine.loadProjection('home')).rejects.toMatchObject({ name: 'PersistenceError', code: 'STATE_GATES_STATE_UNAVAILABLE', status: 503 });
  });

  it('serializes retirement envelopes on the State Gates topic without adding provenance', async () => {
    const eventBus = { publish: vi.fn() };
    const publisher = new StateGatesEventBusPublisher({ eventBus });
    const envelope = {
      transitionId: 'state-gates:home:3:00001:StateRetired:gate-key',
      householdRevision: 3,
      ordinal: 1,
      occurredAt: Date.parse('2026-08-30T12:00:00-07:00'),
      kind: 'StateRetired',
      payload: {
        observationKind: 'gate', key: 'gate-key', gateId: 'school.required',
        subject: { kind: 'learner', id: 'learner-a' },
        period: { kind: 'local_day', id: '2026-08-30' },
        cause: 'policy_activated', policyRevision: 3,
      },
    };

    await publisher.publish([envelope]);

    expect(eventBus.publish).toHaveBeenCalledWith('state-gates', {
      schema: 'daylight.state-gates-event/v1', ...envelope,
    });
    expect(eventBus.publish.mock.calls[0][1].payload).not.toHaveProperty('previous');
    expect(eventBus.publish.mock.calls[0][1].payload).not.toHaveProperty('assertion');
  });
});
