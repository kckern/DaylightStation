// @vitest-environment node
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from '../../../../../tests/_lib/memory-http/request.mjs';
import { createEmulatorRouter } from './emulator.mjs';
import { EmulatorCheckpointService } from '../application/EmulatorCheckpointService.mjs';
import { FilesystemEmulatorCheckpointRepository } from '../adapters/FilesystemEmulatorCheckpointRepository.mjs';
import { FilesystemEmulatorAssetRepository } from '../adapters/FilesystemEmulatorAssetRepository.mjs';
import { FilesystemEmulatorSaveRepository } from '../adapters/FilesystemEmulatorSaveRepository.mjs';
let root, app;
const url = '/api/v1/emulator/checkpoint/gb/example-quest?user=user_5';
const bytes = label => Buffer.from(label).toString('base64');
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'emulator-checkpoint-api-'));
  const resource = text => ({ open: () => Readable.from([Buffer.from(text)]) });
  const service = new EmulatorCheckpointService({
    checkpointRepository: new FilesystemEmulatorCheckpointRepository({ emulationDir: root }),
    saveRepository: new FilesystemEmulatorSaveRepository({ emulationDir: root }),
    makeId: randomUUID,
    assetRepository: { getResourceDigest: FilesystemEmulatorAssetRepository.prototype.getResourceDigest, getRomResource: () => resource('rom'), getEngineResource: () => resource('core') },
    loadConfig: () => ({ systems: { gb: { core: 'gb' } }, games: [{ id: 'example-quest', system: 'gb', saveMode: 'battery', saveOwner: 'user_5' }] }),
  });
  app = express();
  app.use('/api/v1/emulator', createEmulatorRouter({ emulatorResources: {}, emulatorLibrary: { getLibrary: () => ({ games: [] }) }, checkpointService: service }));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const payload = (description, extra = {}) => ({
  expectedRevision: description.head?.revision ?? null, provenance: description.provenance,
  captureId: 'capture-one', sessionId: 'session-one', sequence: 1,
  snapshot: bytes('state-one'), battery: bytes('battery-one'), ...extra,
});
describe('checkpoint HTTP contract with real persistence', () => {
  it('offers explicit sealed recovery when the current pointer is damaged, using a compare-and-swap token', async () => {
    const empty = (await request(app).get(url)).body;
    const first = (await request(app).put(url).send(payload(empty))).body.head;
    const second = (await request(app).put(url).send(payload({ ...empty, head: first }, { captureId: 'second', sequence: 2, snapshot: bytes('state-two') }))).body.head;
    const headFile = path.join(root, '_checkpoints', 'gb', 'user_5', 'example-quest', 'head.json');
    fs.writeFileSync(headFile, 'damaged-pointer');
    expect((await request(app).get(url)).status).toBe(422);
    const inspection = await request(app).get(url.replace('?', '/recovery?'));
    expect(inspection.status).toBe(200); expect(inspection.headers['cache-control']).toBe('no-store');
    expect(inspection.body.damagedHead).toBe(true);
    expect(inspection.body.checkpoints.filter(item => item.usable)).toHaveLength(2);
    expect(inspection.body.provenance).toEqual(empty.provenance);
    const selected = await request(app).get(url.replace('?', `/recovery/revision/${first.revision}?`));
    expect(selected.status).toBe(200); expect(selected.body.head.snapshot).toBe(first.snapshot);
    const body = { ...payload(empty, { captureId: 'repaired', sequence: 3 }), sourceRevision: first.revision, expectedHeadToken: inspection.body.headToken };
    expect((await request(app).post(url.replace('?', '/repair?')).send({ ...body, expectedHeadToken: 'wrong' })).status).toBe(409);
    const repaired = await request(app).post(url.replace('?', '/repair?')).send(body);
    expect(repaired.status).toBe(200); expect(repaired.body.head.snapshot).toBe(first.snapshot);
    expect(repaired.body.head.restoredFrom).toBe(first.revision);
    const preserved = await request(app).get(url.replace('?', `/recovery/revision/${second.revision}?`));
    expect(preserved.body.head.snapshot).toBe(second.snapshot);
    expect((await request(app).get(url.replace('?', '/recovery?').replace('user_5', 'user_4'))).status).toBe(403);
  });
  it('repairs from an explicitly imported local branch when no current pointer can be read', async () => {
    const empty = (await request(app).get(url)).body;
    const first = (await request(app).put(url).send(payload(empty))).body.head;
    fs.unlinkSync(path.join(root, '_checkpoints', 'gb', 'user_5', 'example-quest', 'head.json'));
    const imported = await request(app).post(url.replace('?', '/repair?')).send(payload(empty, {
      captureId: 'local-repair', intent: 'import', sourceRevision: null, expectedHeadToken: 'missing', snapshot: bytes('local-progress'),
    }));
    expect(imported.status).toBe(200); expect(imported.body.head.kind).toBe('import');
    expect(imported.body.head.snapshot).toBe(bytes('local-progress'));
    expect((await request(app).get(url.replace('?', `/recovery/revision/${first.revision}?`))).body.head.snapshot).toBe(first.snapshot);
  });
  it('preserves a legacy baseline before presenting recovery or claim choices', async () => {
    const saves = path.join(root, 'gb', 'saves', 'user_5'); fs.mkdirSync(saves, { recursive: true });
    fs.writeFileSync(path.join(saves, 'example-quest.srm'), 'legacy-battery');
    const result = await request(app).get(url.replace('?', '/recovery?'));
    expect(result.status).toBe(200); expect(result.body.checkpoints).toHaveLength(1);
    expect(result.body.checkpoints[0].kind).toBe('baseline');
    const selected = await request(app).get(url.replace('?', `/recovery/revision/${result.body.checkpoints[0].revision}?`));
    expect(selected.body.head.battery).toBe(bytes('legacy-battery'));
    expect(fs.readFileSync(path.join(saves, 'example-quest.srm'), 'utf8')).toBe('legacy-battery');
  });
  it('explicitly repairs damaged protection metadata while preserving the chosen point and damaged marker', async () => {
    const empty = (await request(app).get(url)).body;
    const first = (await request(app).put(url).send(payload(empty))).body.head;
    const directory = path.join(root, '_checkpoints', 'gb', 'user_5', 'example-quest');
    fs.writeFileSync(path.join(directory, 'protected.json'), 'damaged-marker');
    expect((await request(app).get(url)).status).toBe(422);
    const inspection = await request(app).get(url.replace('?', '/recovery?'));
    expect(inspection.status).toBe(200); expect(inspection.body.damagedHead).toBe(false); expect(inspection.body.requiresRepair).toBe(true);
    const result = await request(app).post(url.replace('?', '/repair?')).send(payload(empty, { captureId: 'marker-repair', sequence: 2,
      sourceRevision: first.revision, expectedHeadToken: inspection.body.headToken }));
    expect(result.status).toBe(200); expect(result.body.head.snapshot).toBe(first.snapshot);
    expect((await request(app).get(url)).status).toBe(200);
    const damaged = fs.readdirSync(path.join(directory, 'damaged')).filter(file => file.startsWith('protected-'));
    expect(damaged).toHaveLength(1); expect(fs.readFileSync(path.join(directory, 'damaged', damaged[0]), 'utf8')).toBe('damaged-marker');
  });
  it('reads absent progress and round-trips an atomic checkpoint without caching', async () => {
    const empty = await request(app).get(url);
    expect(empty.status).toBe(200);
    expect(empty.headers['cache-control']).toBe('no-store');
    expect(empty.body.head).toBeNull();
    const put = await request(app).put(url).send(payload(empty.body));
    expect(put.status).toBe(200);
    expect(put.headers['cache-control']).toBe('no-store');
    const loaded = await request(app).get(url);
    expect(loaded.body.head.revision).toBe(put.body.head.revision);
    expect(loaded.body.head.snapshot).toBe(bytes('state-one'));
    expect(loaded.body.head.battery).toBe(bytes('battery-one'));
  });
  it('rejects a stale client, retains history and supports an explicit reset/recovery', async () => {
    const empty = (await request(app).get(url)).body;
    const first = await request(app).put(url).send(payload(empty));
    expect(first.status).toBe(200);
    const reset = await request(app).post(url.replace('?','/reset?')).send(payload({ ...empty, head: first.body.head }, { captureId: 'reset', sequence: 2 }));
    expect(reset.status).toBe(200);
    expect(reset.body.head.kind).toBe('reset');
    const stale = await request(app).put(url).send(payload({ ...empty, head: first.body.head }, { captureId: 'stale', sequence: 3 }));
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ECHECKPOINTCONFLICT');
    expect(stale.headers['cache-control']).toBe('no-store');
    const recover = await request(app).post(url.replace('?', '/recover?')).send(payload({ ...empty, head: reset.body.head }, { captureId: 'recover', sequence: 3, sourceRevision: first.body.head.revision }));
    expect(recover.status).toBe(200);
    expect(recover.body.head.snapshot).toBe(bytes('state-one'));
    const history = await request(app).get(url.replace('?', '/history?'));
    expect(history.status).toBe(200);
    expect(history.body.checkpoints).toHaveLength(3);
    expect(history.body.checkpoints[0]).not.toHaveProperty('snapshot');
  });
  it('handles game-sized JSON before the default small JSON parser', async () => {
    const empty = (await request(app).get(url)).body;
    const snapshot = Buffer.alloc(200_000, 17).toString('base64');
    const put = await request(app).put(url).send(payload(empty, { snapshot }));
    expect(put.status).toBe(200);
    expect((await request(app).get(url)).body.head.snapshot).toBe(snapshot);
  });
  it('refuses invalid base64, missing bytes and unconditional writes', async () => {
    const empty = (await request(app).get(url)).body;
    for (const extra of [{ snapshot: 'not base64!' }, { battery: null }, { expectedRevision: undefined }]) {
      const result = await request(app).put(url).send(payload(empty, extra));
      expect(result.status).toBe(400);
    }
    expect((await request(app).get(url)).body.head).toBeNull();
  });
  it('refuses another owner and unsafe identities before touching progress', async () => {
    expect((await request(app).get(url.replace('user_5','user_4'))).status).toBe(403);
    expect((await request(app).get(url.replace('user=user_5','user=..'))).status).toBe(400);
    expect((await request(app).get(url.replace('gb/example-quest', 'gba/example-quest'))).status).toBe(404);
  });
  it('rejects oversized individual artifacts while preserving the current checkpoint', async () => {
    const empty = (await request(app).get(url)).body;
    const first = await request(app).put(url).send(payload(empty));
    const tooLarge = Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64');
    const result = await request(app).put(url).send(payload({ ...empty, head: first.body.head }, { snapshot: tooLarge, captureId: 'huge', sequence: 2 }));
    expect(result.status).toBe(413);
    expect((await request(app).get(url)).body.head.revision).toBe(first.body.head.revision);
  });
  it('imports battery progress explicitly and invalidates writers from before the import', async () => {
    const empty = (await request(app).get(url)).body;
    const first = (await request(app).put(url).send(payload(empty))).body.head;
    const imported = await request(app).post(url.replace('?', '/import?')).send(payload({ ...empty, head: first }, {
      captureId: 'imported', sequence: 2, snapshot: null, battery: bytes('imported-progress'),
    }));
    expect(imported.status).toBe(200);
    expect(imported.body.head.kind).toBe('import');
    expect(imported.body.head.battery).toBe(bytes('imported-progress'));
    const stale = await request(app).put(url).send(payload({ ...empty, head: first }, { captureId: 'before-import', sequence: 3 }));
    expect(stale.status).toBe(409);
    expect((await request(app).get(url)).body.head.revision).toBe(imported.body.head.revision);
  });

});
