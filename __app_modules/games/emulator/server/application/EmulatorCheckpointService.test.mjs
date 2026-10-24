// @vitest-environment node
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EmulatorCheckpointService } from './EmulatorCheckpointService.mjs';
import { FilesystemEmulatorCheckpointRepository } from '../adapters/FilesystemEmulatorCheckpointRepository.mjs';
import { FilesystemEmulatorAssetRepository } from '../adapters/FilesystemEmulatorAssetRepository.mjs';
import { FilesystemEmulatorSaveRepository } from '../adapters/FilesystemEmulatorSaveRepository.mjs';
const key = { system: 'gb', gameId: 'example-quest', user: 'user_5' };
const resource = bytes => ({ open: () => Readable.from([bytes]) });
let root, repository, saves, service, assets, config;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'emulator-checkpoint-policy-'));
  repository = new FilesystemEmulatorCheckpointRepository({ emulationDir: root });
  saves = new FilesystemEmulatorSaveRepository({ emulationDir: root });
  config = { systems: { gb: { core: 'gb' } }, games: [{ id: key.gameId, system: 'gb', saveMode: 'battery', saveOwner: 'user_5' }] };
  assets = { getRomResource: () => resource(Buffer.from('rom-one')), getResourceDigest: FilesystemEmulatorAssetRepository.prototype.getResourceDigest, getEngineResource: () => resource(Buffer.from('core-one')) };
  service = new EmulatorCheckpointService({ checkpointRepository: repository, saveRepository: saves, assetRepository: assets, loadConfig: () => config, makeId: randomUUID });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const input = (description, extra = {}) => ({
  expectedRevision: description.head?.revision ?? null, provenance: description.provenance,
  captureId: 'capture-one', sessionId: 'session-one', sequence: 1,
  snapshot: Buffer.from('new-state'), battery: Buffer.from('new-battery'), ...extra,
});
describe('checkpoint application policy', () => {
  it('imports the legacy baseline without changing or deleting source files', async () => {
    const artifact = text => ({ async *chunks() { yield Buffer.from(text); } });
    await saves.storeStateArtifact({ ...key, slot: 'auto' }, artifact('legacy-state'));
    await saves.storeSaveArtifact(key, artifact('legacy-battery'));
    const baseline = await service.read(key);
    expect(baseline.head.kind).toBe('baseline');
    expect(baseline.head.snapshot.toString()).toBe('legacy-state');
    expect(fs.readFileSync(path.join(root, 'gb/saves/user_5/example-quest.srm'), 'utf8')).toBe('legacy-battery');
    const next = await service.commit(key, input(baseline));
    expect(next.snapshot.toString()).toBe('new-state');
    expect(await repository.history(key)).toHaveLength(2);
  });
  it('refuses another player and a mismatched system even if the game ID exists', async () => {
    await expect(service.read({ ...key, user: 'user_4' })).rejects.toMatchObject({ code: 'ESAVEOWNER' });
    await expect(service.read({ ...key, system: 'gba' })).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('requires all normal capture bytes, actual provenance and an explicit parent', async () => {
    const empty = await service.read(key);
    expect(empty.head).toBeNull();
    await expect(service.commit(key, input(empty, { battery: null }))).rejects.toMatchObject({ code: 'ECHECKPOINTINVALID' });
    await expect(service.commit(key, input(empty, { provenance: { ...empty.provenance, romHash: 'c'.repeat(64) } })))
      .rejects.toMatchObject({ code: 'ECHECKPOINTCOMPAT' });
    await expect(service.commit(key, input(empty, { expectedRevision: undefined }))).rejects.toMatchObject({ code: 'ECHECKPOINTINVALID' });
    expect(await repository.read(key)).toBeNull();
  });
  it('never migrates an older battery when reading a preferred legacy snapshot fails', async () => {
    saves.getStateResource = () => { throw Object.assign(new Error('disk read failed'), { code: 'EIO' }); };
    saves.getSaveResource = () => resource(Buffer.from('older-battery'));
    await expect(service.read(key)).rejects.toMatchObject({ code: 'EIO' });
    expect(await repository.read(key)).toBeNull();
  });
  it('preserves resets and explicit recovery as new revisions and rejects prior writers', async () => {
    const first = await service.commit(key, input(await service.read(key)));
    const reset = await service.reset(key, { ...input({ head: first, provenance: first.provenance }), captureId: 'reset-one', sequence: 2 });
    expect(reset.kind).toBe('reset');
    await expect(service.commit(key, input({ head: first, provenance: first.provenance }, { captureId: 'late', sequence: 3 })))
      .rejects.toMatchObject({ code: 'ECHECKPOINTCONFLICT' });
    const recovered = await service.recover(key, { ...input({ head: reset, provenance: reset.provenance }), captureId: 'recover-one', sequence: 3, sourceRevision: first.revision });
    expect(recovered.kind).toBe('recover');
    expect(recovered.snapshot).toEqual(first.snapshot);
    expect(recovered.restoredFrom).toBe(first.revision);
    expect(await repository.history(key)).toHaveLength(3);
  });
  it('marks a changed ROM/core as requiring explicit recovery and blocks routine overwrites', async () => {
    const first = await service.commit(key, input(await service.read(key)));
    assets.getEngineResource = () => resource(Buffer.from('different-core'));
    const changed = await service.read(key);
    expect(changed.compatible).toBe(false);
    await expect(service.commit(key, input(changed, { captureId: 'overwrite', sequence: 2 })))
      .rejects.toMatchObject({ code: 'ECHECKPOINTCOMPAT' });
    expect((await repository.read(key)).revision).toBe(first.revision);
  });
  it('allows explicit recovery when current artifact bytes are damaged, without silently falling back', async () => {
    const empty = await service.read(key);
    const first = await service.commit(key, input(empty));
    const second = await service.commit(key, input({ ...empty, head: first }, { captureId: 'capture-two', sequence: 2, snapshot: Buffer.from('second') }));
    fs.writeFileSync(path.join(root, '_checkpoints/gb/user_5/example-quest/blobs', `${second.artifacts.snapshot.hash}.bin`), 'damaged');
    await expect(service.read(key)).rejects.toMatchObject({ code: 'ECHECKPOINTCORRUPT' });
    const recovered = await service.recover(key, input({ ...empty, head: second }, { captureId: 'recover-corrupt', sequence: 3, sourceRevision: first.revision }));
    expect(recovered.snapshot).toEqual(first.snapshot);
    expect((await repository.history(key)).map(item => item.revision)).toContain(second.revision);
  });

});
