import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { YamlCharadesClueHistory } from "../adapters/persistence/YamlCharadesClueHistory.mjs";
import { createGamingApiModule } from "./gamingApi.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe('gaming API composition', () => {
  it('wires one durable Charades clue history into the application', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gaming-api-'));
    roots.push(root);
    const module = createGamingApiModule({
      definitionStore: {}, manifestStore: {},
      snapshotsDir: path.join(root, 'snapshots'), journalsDir: path.join(root, 'journals'),
      effectsDir: path.join(root, 'effects'), drawingCheckpointsDir: path.join(root, 'drawings'),
      historyDir: path.join(root, 'history'),
    });
    expect(module.clueHistory).toBeInstanceOf(YamlCharadesClueHistory);
    expect(module.gamingApplication.clueHistory).toBe(module.clueHistory);
  });
});

it('replays durable Jeopardy setup/presence events after JSONL and YAML serialization', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jeopardy-ready-journal-')); roots.push(root);
  const definition = { rounds: [{ mode: 'hosted', categories: [{ clues: [{ value: 100, clue: 'Question', answer: 'Answer' }] }] }] };
  const pinned = { definition, hash: 'a'.repeat(64) };
  const module = createGamingApiModule({
    definitionStore: { getCurrent: async () => pinned, pin: async () => pinned, getPinned: async () => definition }, manifestStore: {},
    snapshotsDir: path.join(root, 'snapshots'), journalsDir: path.join(root, 'journals'), effectsDir: path.join(root, 'effects'), drawingCheckpointsDir: path.join(root, 'drawings'), historyDir: path.join(root, 'history'),
  });
  const viewer = { role: 'host' };
  const created = await module.coordinator.create({ ruleset: { id: 'jeopardy', version: 1 }, definitionId: 'ready', seats: [{ id: 'red' }], viewer });
  const id = created.header.session_id;
  const envelope = (revision, command) => ({ command_id: `ready:${revision}`, actor_id: 'host', expected_revision: revision, logical_time: revision, command });
  await module.coordinator.dispatch(id, envelope(0, { type: 'BUZZER_SETUP', epoch: 'tv' }), viewer);
  expect((await module.coordinator.resume(id, viewer)).state.buzzerSetup.epoch).toBe('tv');
  await module.coordinator.dispatch(id, envelope(1, { type: 'BUZZER_PRESENCE', epoch: 'tv' }), viewer);
  expect((await module.coordinator.resume(id, viewer)).header.revision).toBe(2);
  const report = { type: 'BUZZER_REPORT', epoch: 'tv', teamId: 'red', generation: 0, slot: 'gamepad:0:Pad' };
  await module.coordinator.dispatch(id, envelope(2, { ...report, kind: 'assign' }), viewer);
  await module.coordinator.dispatch(id, envelope(3, { ...report, kind: 'test' }), viewer);
  await module.coordinator.dispatch(id, envelope(4, { type: 'START_ROUND' }), viewer);
  expect(await module.coordinator.resume(id, viewer)).toMatchObject({ header: { revision: 5 }, state: { phase: 'board' } });
});
