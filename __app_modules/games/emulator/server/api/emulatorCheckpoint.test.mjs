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
