import { describe, expect, it } from 'vitest';
import { YamlStateGatesStateEngine } from '#adapters/state-gates/persistence/YamlStateGatesStateEngine.mjs';
import { YamlStateGatesProjectionRepository } from '#adapters/state-gates/persistence/YamlStateGatesProjectionRepository.mjs';
import { YamlStateGatesTransitionRepository } from '#adapters/state-gates/persistence/YamlStateGatesTransitionRepository.mjs';

function memoryEngine(options = {}) {
  const files = new Map();
  let failSave = false;
  const engine = new YamlStateGatesStateEngine({
    resolveFilePath: householdId => `/virtual/${householdId}/current.yml`,
    load: filePath => files.has(filePath) ? structuredClone(files.get(filePath)) : null,
    save: (filePath, value) => {
      if (failSave) throw new Error('simulated interrupted write');
      files.set(filePath, structuredClone(value));
    },
    ...options,
  });
  return { engine, files, failSave: value => { failSave = value; } };
}

function projection(householdRevision, extras = {}) {
  return {
    schemaVersion: 1, householdRevision, activePolicyCandidate: null,
    assertions: [], evaluations: [], decisions: [], ...extras,
  };
}

function event(householdRevision, ordinal = 0, extras = {}) {
  return {
    transitionId: `state-gates:home:${householdRevision}:${ordinal}`,
    householdRevision, ordinal, occurredAt: Date.now(), kind: 'StateObservation', payload: {}, ...extras,
  };
}

describe('State Gates durable-state verification matrix', () => {
  it('serializes concurrent household commits through compare-and-swap', async () => {
    const { engine } = memoryEngine();
    const [first, second] = await Promise.all([
      engine.commit('home', 0, projection(1, { assertions: [{ id: 'first' }] }), [event(1)]),
      engine.commit('home', 0, projection(1, { assertions: [{ id: 'second' }] }), [event(1, 0, { transitionId: 'second' })]),
    ]);
    expect([first.committed, second.committed].sort()).toEqual([false, true]);
    expect((await engine.loadProjection('home')).assertions).toHaveLength(1);
    expect(await engine.pending('home')).toHaveLength(1);
  });

  it('round-trips dynamic namespaced policy keys without snake-casing them', async () => {
    const { engine } = memoryEngine();
    const activePolicyCandidate = {
      claimTypes: { 'school.dailyDone': { schemaVersion: 1 } },
      gates: { 'school.dailyGate': { reasonLabels: { CLAIM_MISSING: 'Missing' } } },
      entitlements: { 'media.eveningAccess': { gateId: 'school.dailyGate' } },
    };
    await engine.commit('home', 0, projection(1, { activePolicyCandidate }), []);
    expect((await engine.loadProjection('home')).activePolicyCandidate).toEqual(activePolicyCandidate);
  });

  it('paginates whole revision batches with stable replay metadata', async () => {
    const { engine } = memoryEngine();
    for (let revision = 1; revision <= 3; revision += 1) {
      await engine.commit('home', revision - 1, projection(revision), [event(revision, 0), event(revision, 1)]);
    }
    const transitions = new YamlStateGatesTransitionRepository({ engine });
    const page = await transitions.replayAfter('home', 0, 2);
    expect(page).toMatchObject({
      afterRevision: 0, nextRevision: 2, currentRevision: 3,
      oldestAvailableRevision: 1, hasMore: true,
    });
    expect(page.events).toHaveLength(4);
    expect(new Set(page.events.map(item => item.householdRevision))).toEqual(new Set([1, 2]));
    expect(page.events.every(item => item.schema === 'daylight.state-gates-event/v1')).toBe(true);
  });

  it('compacts only complete published batches and expires older cursors', async () => {
    const { engine } = memoryEngine({ maxEntries: 2, maxAgeMs: 60_000 });
    await engine.commit('home', 0, projection(1), [event(1, 0), event(1, 1)]);
    await engine.markPublished('home', [event(1, 0).transitionId, event(1, 1).transitionId]);
    await engine.commit('home', 1, projection(2), [event(2, 0), event(2, 1)]);

    expect(await engine.pending('home')).toHaveLength(2);
    await expect(engine.replayAfter('home', 0, 10)).rejects.toMatchObject({
      code: 'CURSOR_EXPIRED', status: 410,
      details: { oldestAvailableRevision: 2, currentRevision: 2 },
    });
    expect((await engine.replayAfter('home', 1, 10)).events).toHaveLength(2);
  });

  it('never compacts through an unpublished revision batch', async () => {
    const { engine } = memoryEngine({ maxEntries: 1, maxAgeMs: 1 });
    await engine.commit('home', 0, projection(1), [event(1, 0), event(1, 1)]);
    await engine.commit('home', 1, projection(2), [event(2, 0)]);
    expect(await engine.pending('home')).toHaveLength(3);
    expect((await engine.replayAfter('home', 0, 10)).events).toHaveLength(3);
    expect(await engine.oldestAvailableRevision('home')).toBe(1);
  });

  it('leaves the prior durable projection readable when a save is interrupted', async () => {
    const memory = memoryEngine();
    const projections = new YamlStateGatesProjectionRepository({ engine: memory.engine });
    await projections.commitRevision('home', 0, projection(1), [event(1)]);
    memory.failSave(true);
    await expect(projections.commitRevision('home', 1, projection(2), [event(2)]))
      .rejects.toMatchObject({ name: 'PersistenceError', code: 'STATE_GATES_STATE_UNAVAILABLE' });
    memory.failSave(false);
    expect(await projections.load('home')).toMatchObject({ householdRevision: 1 });
    expect(await memory.engine.pending('home')).toHaveLength(1);
  });

  it('rejects replay cursors ahead of the durable projection', async () => {
    const { engine } = memoryEngine();
    await engine.commit('home', 0, projection(1), [event(1)]);
    await expect(engine.replayAfter('home', 2, 10)).rejects.toMatchObject({
      code: 'INVALID_REPLAY_CURSOR', status: 400,
    });
  });
});
