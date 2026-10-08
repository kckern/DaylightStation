import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { YamlStateGatesStateEngine } from '#adapters/state-gates/persistence/YamlStateGatesStateEngine.mjs';

// No injected load/loadLegacy/mtime here on purpose: this test exercises the
// engine's DEFAULT IO (writeFileAtomic, readYamlFromPath, fs.statSync-backed
// fileMtimeMs) against a real tmpdir. Every other migration/guard test
// injects those three, which would miss a bug in the real wiring.
function legacyV1Yaml() {
  return {
    schema: 'daylight.state-gates-state/v1',
    projection: {
      schema_version: 1, household_revision: 2, active_policy_candidate: {
        claim_types: { 'household_a.dailyDone': { schema_version: 1 } },
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

describe('State Gates JSON migration — real filesystem', () => {
  let dir;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('migrates a real v1 YAML file, commits real JSON, and refuses on a genuinely newer legacy revision', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-gates-realfs-'));
    const jsonPath = path.join(dir, 'current.json');
    const ymlPath = path.join(dir, 'current.yml');
    const original = legacyV1Yaml();
    fs.writeFileSync(ymlPath, yaml.dump(original), 'utf8');
    const ymlBytesBefore = fs.readFileSync(ymlPath, 'utf8');

    const engine = new YamlStateGatesStateEngine({ filePath: jsonPath, legacyFilePath: ymlPath });

    const projection = await engine.loadProjection('household_a');
    expect(projection.householdRevision).toBe(2);
    expect(projection.schemaVersion).toBe(1);
    expect(projection.activePolicyCandidate.claimTypes['household_a.dailyDone']).toEqual({ schemaVersion: 1 });

    const pending = await engine.pending('household_a');
    expect(pending.map(entry => entry.transitionId)).toEqual(['t2']);

    await engine.commit('household_a', 2, { ...projection, householdRevision: 3 }, []);

    expect(fs.existsSync(jsonPath)).toBe(true);
    const disk = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    expect(disk.schema).toBe('daylight.state-gates-state/v2');
    expect(disk.projection.householdRevision).toBe(3);

    // The yml is never touched by the engine.
    expect(fs.readFileSync(ymlPath, 'utf8')).toBe(ymlBytesBefore);

    // Bump the yml to a higher revision than the JSON's (3), and give it a
    // later mtime than the JSON file, then read through a fresh engine.
    const newerLegacy = { ...original, projection: { ...original.projection, household_revision: 4 } };
    fs.writeFileSync(ymlPath, yaml.dump(newerLegacy), 'utf8');
    const jsonMtime = fs.statSync(jsonPath).mtime;
    const laterMtime = new Date(jsonMtime.getTime() + 60_000);
    fs.utimesSync(ymlPath, laterMtime, laterMtime);

    const freshEngine = new YamlStateGatesStateEngine({ filePath: jsonPath, legacyFilePath: ymlPath });
    await expect(freshEngine.loadProjection('household_a')).rejects.toMatchObject({
      code: 'STATE_GATES_STATE_UNAVAILABLE',
      cause: { code: 'LEGACY_STATE_NEWER' },
    });
  });
});
