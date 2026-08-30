import { describe, expect, it } from 'vitest';
import { YamlRequirementsPolicySource } from '#adapters/requirements/config/YamlRequirementsPolicySource.mjs';
import { YamlRequirementsStateEngine } from '#adapters/requirements/persistence/YamlRequirementsStateEngine.mjs';
import { YamlRequirementsProjectionRepository } from '#adapters/requirements/persistence/YamlRequirementsProjectionRepository.mjs';
import { YamlRequirementsTransitionRepository } from '#adapters/requirements/persistence/YamlRequirementsTransitionRepository.mjs';
import { IRequirementsProjectionRepository } from '#apps/requirements/ports/IRequirementsProjectionRepository.mjs';
import { IRequirementsTransitionRepository } from '#apps/requirements/ports/IRequirementsTransitionRepository.mjs';
import { AuthenticatedRequirementsIngress } from '#adapters/requirements/ingress/AuthenticatedRequirementsIngress.mjs';
import { RoleRequirementsAdministrationAuthorizer } from '#adapters/requirements/auth/RoleRequirementsAdministrationAuthorizer.mjs';

describe('Requirements adapters', () => {
  it('maps household YAML into a typed candidate with a semantic digest', async () => {
    const raw = {
      schema: 'daylight.requirements-policy/v1', policy_revision: 1,
      publishers: { school: {} }, subject_sets: {},
      claim_types: { 'school.done': { schema_version: 1, value: { type: 'boolean' }, subject_kinds: ['learner'], period_kinds: ['local_day'], accepted_publishers: ['school'], visibility: 'subscriber', validity: { max_age: 'P2D' } } },
      requirements: { 'school.required': { schema_version: 1, subject_kinds: ['learner'], period_kinds: ['local_day'], expression: { claim: { type: 'school.done', publisher: 'school', subject: '$subject', period: '$period' } } } },
      entitlements: { 'piano.games': { requirement: 'school.required', failure_posture: 'fail_closed' } },
    };
    const source = new YamlRequirementsPolicySource({ load: async () => raw });
    const candidate = await source.loadCandidate('home');
    expect(candidate.claimTypes['school.done'].validity.maxAgeMs).toBe(172_800_000);
    expect(candidate.requirements['school.required'].expression).toMatchObject({ kind: 'claim', publisherId: 'school' });
    expect(candidate.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('atomically stores projections and replays whole revision batches', async () => {
    const memory = new Map();
    const engine = new YamlRequirementsStateEngine({ resolveFilePath: householdId => `/virtual/${householdId}/current.yml`, load: path => memory.get(path) ?? null, save: (path, value) => memory.set(path, value) });
    const projections = new YamlRequirementsProjectionRepository({ engine });
    const transitions = new YamlRequirementsTransitionRepository({ engine });
    expect(projections).toBeInstanceOf(IRequirementsProjectionRepository);
    expect(transitions).toBeInstanceOf(IRequirementsTransitionRepository);
    const events = [0, 1].map(ordinal => ({ schema: 'daylight.requirements-event/v1', transitionId: `t${ordinal}`, householdRevision: 1, ordinal, occurredAt: Date.now(), kind: 'StateObservation', payload: {} }));
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
    const ingress = new AuthenticatedRequirementsIngress({
      observeAssertion: async (_householdId, command) => observed.push(command),
      retractAssertion: async () => {},
      resolvePublisher: principal => principal === fixedPrincipal ? 'school' : null,
    });
    await ingress.observe('home', fixedPrincipal, { assertionId: 'a1' });
    expect(observed[0].publisherId).toBe('school');
    await expect(ingress.observe('home', { publisherId: 'school' }, { assertionId: 'a2' })).rejects.toMatchObject({ code: 'PUBLISHER_UNAUTHENTICATED' });
  });

  it('maps established roles to attestation and administrative capabilities', async () => {
    const authorizer = new RoleRequirementsAdministrationAuthorizer();
    await expect(authorizer.authorize({ id: 'p', roles: ['parent'] }, 'attest')).resolves.toEqual({ allowed: true });
    await expect(authorizer.authorize({ id: 'p', roles: ['parent'] }, 'activate_policy')).resolves.toEqual({ allowed: false });
    await expect(authorizer.authorize({ id: 'a', roles: ['admin'] }, 'activate_policy')).resolves.toEqual({ allowed: true });
  });

  it('surfaces corrupt durable state instead of silently replacing it', async () => {
    const engine = new YamlRequirementsStateEngine({
      filePath: '/virtual/corrupt.yml',
      load: () => { throw new Error('bad yaml'); },
      save: () => {},
    });
    await expect(engine.loadProjection('home')).rejects.toMatchObject({ name: 'PersistenceError', code: 'REQUIREMENTS_STATE_UNAVAILABLE', status: 503 });
  });
});
