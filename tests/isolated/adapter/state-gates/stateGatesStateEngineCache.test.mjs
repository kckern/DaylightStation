import { describe, expect, it } from 'vitest';
import { YamlStateGatesStateEngine } from '#adapters/state-gates/persistence/YamlStateGatesStateEngine.mjs';

function countingEngine() {
  const files = new Map();
  let loads = 0; let failSave = false;
  const engine = new YamlStateGatesStateEngine({
    resolveFilePath: (id) => `/virtual/${id}/current.yml`,
    load: (p) => { loads += 1; return files.has(p) ? structuredClone(files.get(p)) : null; },
    save: (p, v) => {
      if (failSave) throw new Error('simulated interrupted write');
      files.set(p, structuredClone(v));
    },
  });
  return { engine, loads: () => loads, failSave: (v) => { failSave = v; } };
}

const projection = (householdRevision, extras = {}) => ({
  schemaVersion: 1, householdRevision, activePolicyCandidate: null,
  assertions: [], evaluations: [], decisions: [], ...extras,
});
const event = (householdRevision, ordinal = 0) => ({
  transitionId: `state-gates:home:${householdRevision}:${ordinal}`,
  householdRevision, ordinal, occurredAt: Date.now(), kind: 'StateObservation', payload: {},
});

describe('YamlStateGatesStateEngine — in-memory state', () => {
  it('parses the file once and serves every later operation from memory', async () => {
    const { engine, loads } = countingEngine();
    await engine.commit('home', 0, projection(1), [event(1)]);
    await engine.markPublished('home', [event(1).transitionId]);
    await engine.loadProjection('home');
    await engine.pending('home');
    await engine.replayAfter('home', 0, 10);
    await engine.commit('home', 1, projection(2), [event(2)]);
    expect(loads()).toBe(1);
  });

  it('drops its copy when a write fails, so the next read comes from disk', async () => {
    const { engine, loads, failSave } = countingEngine();
    await engine.commit('home', 0, projection(1), [event(1)]);
    failSave(true);
    await expect(engine.commit('home', 1, projection(2), [event(2)]))
      .rejects.toMatchObject({ code: 'STATE_GATES_STATE_UNAVAILABLE' });
    failSave(false);
    expect((await engine.loadProjection('home')).householdRevision).toBe(1);
    expect(await engine.pending('home')).toHaveLength(1);
    expect(loads()).toBe(2);
  });

  it('never hands a caller a reference into its own copy', async () => {
    const { engine } = countingEngine();
    await engine.commit('home', 0, projection(1, { assertions: [{ id: 'a' }] }), [event(1)]);
    const leaked = await engine.loadProjection('home');
    leaked.assertions.push({ id: 'injected' });
    expect((await engine.loadProjection('home')).assertions).toHaveLength(1);
    const pending = await engine.pending('home');
    pending[0].payload.injected = true;
    expect((await engine.pending('home'))[0].payload).toEqual({});
  });

  it('drops its copy and wraps the error when serialisation itself fails', async () => {
    const { engine, failSave } = countingEngine();
    await engine.commit('home', 0, projection(1), [event(1)]);
    // A value plain()/mapKeys() cannot walk: self-referential.
    const circular = projection(2);
    circular.assertions = [{ id: 'loop' }];
    circular.assertions[0].self = circular.assertions[0];
    await expect(engine.commit('home', 1, circular, [event(2)]))
      .rejects.toMatchObject({ code: 'STATE_GATES_STATE_UNAVAILABLE' });
    failSave(false);
    expect((await engine.loadProjection('home')).householdRevision).toBe(1);
  });

  it('keeps households isolated', async () => {
    const { engine } = countingEngine();
    await engine.commit('home', 0, projection(1, { assertions: [{ id: 'h1' }] }), [event(1)]);
    await engine.commit('cabin', 0, projection(1, { assertions: [{ id: 'h2' }] }), [event(1)]);
    expect((await engine.loadProjection('home')).assertions).toEqual([{ id: 'h1' }]);
    expect((await engine.loadProjection('cabin')).assertions).toEqual([{ id: 'h2' }]);
  });
});
