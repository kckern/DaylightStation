import { describe, expect, it, vi } from 'vitest';
import { YamlStateGatesStateEngine } from '#adapters/state-gates/persistence/YamlStateGatesStateEngine.mjs';

const JSON_PATH = id => `/virtual/${id}/current.json`;
const YML_PATH = id => `/virtual/${id}/current.yml`;

// A v1 file exactly as the YAML engine stored it: snake_case outside the
// dynamic maps, one published and one unpublished revision batch.
function legacyV1({ revision = 2 } = {}) {
  return {
    schema: 'daylight.state-gates-state/v1',
    projection: {
      schema_version: 1, household_revision: revision, active_policy_candidate: {
        claim_types: { 'school.dailyDone': { schema_version: 1 } },
      },
      assertions: [{ id: 'a1', observed_at: 1790371529737 }], evaluations: [], decisions: [],
    },
    journal: [
      { transition_id: 't1', household_revision: 1, ordinal: 0, occurred_at: Date.now(), kind: 'StateObservation', payload: {}, published: true },
      { transition_id: 't2', household_revision: 2, ordinal: 0, occurred_at: Date.now(), kind: 'StateObservation', payload: {}, published: false },
    ],
    compacted_through: 0,
    delivery_checkpoint: 1,
  };
}

function engineWith({ json = null, yml = null, jsonAt = null, ymlAt = null } = {}) {
  const files = new Map();
  if (json !== null) files.set(JSON_PATH('home'), json);
  const legacy = new Map();
  if (yml !== null) legacy.set(YML_PATH('home'), yml);
  const times = new Map([[JSON_PATH('home'), jsonAt], [YML_PATH('home'), ymlAt]]);
  const logger = { info: vi.fn(), warn: vi.fn(), sampled: vi.fn() };
  const engine = new YamlStateGatesStateEngine({
    resolveFilePath: JSON_PATH,
    resolveLegacyFilePath: YML_PATH,
    load: p => files.has(p) ? JSON.parse(files.get(p)) : null,
    loadLegacy: p => legacy.has(p) ? structuredClone(legacy.get(p)) : null,
    save: (p, content) => { files.set(p, content); times.set(p, Date.now() + 1e6); },
    mtime: p => times.get(p) ?? null,
    logger,
  });
  return { engine, files, legacy, logger };
}

describe('State Gates JSON migration', () => {
  it('reads a v1 YAML file, and the first commit writes v2 JSON with the same content', async () => {
    // Captured once: legacyV1() stamps occurred_at with Date.now(), and real
    // time elapses over the async work below, so a second call would not
    // equal the first — that's wall-clock drift, not a mutation. `original`
    // is kept untouched off to the side; the map is seeded with an
    // INDEPENDENT clone (`seed`) so the final comparison is a real check
    // against a copy, not the map entry compared against itself.
    const original = legacyV1();
    const seed = structuredClone(original);
    const { engine, files, legacy, logger } = engineWith({ yml: seed });
    const before = await engine.loadProjection('home');
    expect(before.householdRevision).toBe(2);
    expect(before.activePolicyCandidate.claimTypes['school.dailyDone']).toEqual({ schemaVersion: 1 });
    expect(logger.info).toHaveBeenCalledWith('state-gates.state.migrated', { householdId: 'home', householdRevision: 2 });

    await engine.commit('home', 2, { ...before, householdRevision: 3 }, []);
    const disk = JSON.parse(files.get(JSON_PATH('home')));
    expect(disk.schema).toBe('daylight.state-gates-state/v2');
    expect(disk.projection.assertions).toEqual([{ id: 'a1', observedAt: 1790371529737 }]);
    expect(disk.journal.map(e => [e.transitionId, e.published])).toEqual([['t1', true], ['t2', false]]);
    expect(legacy.get(YML_PATH('home'))).toEqual(original); // never touched
  });

  it('pending delivery and the delivery checkpoint survive the migration', async () => {
    const { engine, files } = engineWith({ yml: legacyV1() });
    expect((await engine.pending('home')).map(e => e.transitionId)).toEqual(['t2']);
    await engine.markPublished('home', ['t2']);
    const disk = JSON.parse(files.get(JSON_PATH('home')));
    expect(disk.deliveryCheckpoint).toBe(2);
    expect(await engine.pending('home')).toEqual([]);
  });

  it('when both files exist and the JSON file is newer, JSON wins', async () => {
    const json = JSON.stringify({ schema: 'daylight.state-gates-state/v2', projection: { householdRevision: 9 }, journal: [], compactedThrough: 0, deliveryCheckpoint: 0 });
    const { engine } = engineWith({ json, yml: legacyV1(), jsonAt: 2000, ymlAt: 1000 });
    expect((await engine.loadProjection('home')).householdRevision).toBe(9);
  });

  it('refuses to start when the legacy YAML is newer than the JSON (an older build ran)', async () => {
    const json = JSON.stringify({ schema: 'daylight.state-gates-state/v2', projection: { householdRevision: 9 }, journal: [], compactedThrough: 0, deliveryCheckpoint: 0 });
    const { engine } = engineWith({ json, yml: legacyV1({ revision: 10 }), jsonAt: 1000, ymlAt: 2000 });
    await expect(engine.loadProjection('home')).rejects.toMatchObject({
      code: 'STATE_GATES_STATE_UNAVAILABLE', status: 503,
      cause: { code: 'LEGACY_STATE_NEWER', message: 'Legacy YAML state (revision 10) is newer than the JSON state (revision 9)' },
    });
  });

  it('a newer-mtime yml with the same or a lower revision serves the JSON and logs legacy-touched', async () => {
    const json = JSON.stringify({ schema: 'daylight.state-gates-state/v2', projection: { householdRevision: 9 }, journal: [], compactedThrough: 0, deliveryCheckpoint: 0 });
    const { engine, logger } = engineWith({ json, yml: legacyV1({ revision: 9 }), jsonAt: 1000, ymlAt: 2000 });
    expect((await engine.loadProjection('home')).householdRevision).toBe(9);
    expect(logger.warn).toHaveBeenCalledWith('state-gates.state.legacy-touched', {
      householdId: 'home', legacyRevision: 9, jsonRevision: 9,
    });
  });

  it('a newer-mtime yml that fails to load serves the JSON and logs legacy-touched with an error', async () => {
    const json = JSON.stringify({ schema: 'daylight.state-gates-state/v2', projection: { householdRevision: 9 }, journal: [], compactedThrough: 0, deliveryCheckpoint: 0 });
    const logger = { info: vi.fn(), warn: vi.fn(), sampled: vi.fn() };
    const engine = new YamlStateGatesStateEngine({
      resolveFilePath: JSON_PATH,
      resolveLegacyFilePath: YML_PATH,
      load: p => p === JSON_PATH('home') ? JSON.parse(json) : null,
      loadLegacy: () => { throw new Error('legacy read boom'); },
      save: () => {},
      mtime: p => p === JSON_PATH('home') ? 1000 : 2000,
      logger,
    });
    expect((await engine.loadProjection('home')).householdRevision).toBe(9);
    expect(logger.warn).toHaveBeenCalledWith('state-gates.state.legacy-touched', {
      householdId: 'home', jsonRevision: 9, error: 'legacy read boom',
    });
  });

  it('corrupt JSON is a read failure and never falls back to the YAML', async () => {
    const { engine } = engineWith({ json: '{"schema": "daylight.state-', yml: legacyV1(), jsonAt: 2000, ymlAt: 1000 });
    await expect(engine.loadProjection('home')).rejects.toMatchObject({ code: 'STATE_GATES_STATE_UNAVAILABLE' });
  });

  it('an unknown schema in either file is UNSUPPORTED_STATE_SCHEMA', async () => {
    const odd = engineWith({ yml: { ...legacyV1(), schema: 'daylight.state-gates-state/v0' } });
    await expect(odd.engine.loadProjection('home')).rejects.toMatchObject({ cause: { code: 'UNSUPPORTED_STATE_SCHEMA' } });
    const oddJson = engineWith({ json: JSON.stringify({ schema: 'something-else' }) });
    await expect(oddJson.engine.loadProjection('home')).rejects.toMatchObject({ cause: { code: 'UNSUPPORTED_STATE_SCHEMA' } });
  });

  it('a household with neither file starts empty, and its first commit creates the JSON', async () => {
    const { engine, files } = engineWith();
    expect(await engine.loadProjection('home')).toBeNull();
    await engine.commit('home', 0, { schemaVersion: 1, householdRevision: 1, assertions: [], evaluations: [], decisions: [] }, []);
    expect(JSON.parse(files.get(JSON_PATH('home'))).projection.householdRevision).toBe(1);
  });

  it('toLegacyV1 turns JSON state back into a v1 file the migration reads identically', async () => {
    const { toLegacyV1 } = await import('#adapters/state-gates/persistence/YamlStateGatesStateEngine.mjs');
    const first = engineWith({ yml: legacyV1() });
    const migrated = await first.engine.loadProjection('home');
    await first.engine.commit('home', 2, { ...migrated, householdRevision: 3 }, []);
    const jsonState = JSON.parse(first.files.get(JSON_PATH('home')));

    const back = toLegacyV1(jsonState);
    expect(back.schema).toBe('daylight.state-gates-state/v1');
    expect(back.projection.household_revision).toBe(3);
    expect(back.projection.active_policy_candidate.claim_types['school.dailyDone']).toEqual({ schema_version: 1 });

    const second = engineWith({ yml: back });
    const { schema, ...expected } = jsonState;
    expect(await second.engine.loadProjection('home')).toEqual(expected.projection);
    expect(await second.engine.pending('home')).toEqual(await first.engine.pending('home'));
    expect(await second.engine.oldestAvailableRevision('home')).toBe(await first.engine.oldestAvailableRevision('home'));
  });
});
