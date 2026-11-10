// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { FilesystemEmulatorSaveRepository } from './FilesystemEmulatorSaveRepository.mjs';
import { FilesystemEmulatorCheckpointRepository } from './FilesystemEmulatorCheckpointRepository.mjs';

const key = { system: 'gb', gameId: 'example-quest', user: 'user_5' };
const provenance = { romHash: 'a'.repeat(64), core: { name: 'gambatte', bundleHash: 'b'.repeat(64), format: 1 } };
const capture = (label, expectedRevision = null, extra = {}) => ({
  expectedRevision, snapshot: Buffer.from(`state-${label}`), battery: Buffer.from(`battery-${label}`),
  provenance, captureId: `capture-${label}`, sessionId: 'session-one', sequence: 1, kind: 'save', ...extra,
});
let dir;
let repository;
const gameDir = () => path.join(dir, '_checkpoints', key.system, key.user, key.gameId);
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emulator-checkpoints-'));
  repository = new FilesystemEmulatorCheckpointRepository({ emulationDir: dir });
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(dir, { force: true, recursive: true }); });

describe('durable emulator checkpoints', () => {
  it('commits a complete bundle and reads the same verified bytes after process replacement', async () => {
    expect(await repository.read(key)).toBeNull();
    const committed = await repository.commit(key, capture('first'));
    const restarted = new FilesystemEmulatorCheckpointRepository({ emulationDir: dir });
    const actual = await restarted.read(key);
    expect(actual.revision).toBe(committed.revision);
    expect(actual.snapshot).toEqual(Buffer.from('state-first'));
    expect(actual.battery).toEqual(Buffer.from('battery-first'));
    expect(actual.provenance).toEqual(provenance);
  });

  it('rejects stale and concurrent writers across repository instances while preserving both accepted versions', async () => {
    const first = await repository.commit(key, capture('first'));
    const another = new FilesystemEmulatorCheckpointRepository({ emulationDir: dir });
    const results = await Promise.allSettled([
      repository.commit(key, capture('second', first.revision, { sequence: 2 })),
      another.commit(key, capture('stale', first.revision, { sequence: 2 })),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected').reason.code).toBe('ECHECKPOINTCONFLICT');
    const head = await repository.read(key);
    expect(head.snapshot).toEqual(Buffer.from('state-second'));
    expect((await repository.history(key)).map(r => r.revision)).toEqual([head.revision, first.revision]);
    expect((await repository.readRevision(key, first.revision)).snapshot).toEqual(Buffer.from('state-first'));
  });

  it('deduplicates a retried acknowledgment but rejects capture ID reuse with different bytes', async () => {
    const first = await repository.commit(key, capture('first'));
    expect((await repository.commit(key, capture('first'))).revision).toBe(first.revision);
    await expect(repository.commit(key, { ...capture('first'), snapshot: Buffer.from('different') }))
      .rejects.toMatchObject({ code: 'ECHECKPOINTCONFLICT' });
    expect(await repository.history(key)).toHaveLength(1);
  });

  it('does not publish a partial bundle when the manifest/head update fails', async () => {
    const first = await repository.commit(key, capture('first'));
    const rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (destination === path.join(gameDir(), 'head.json')) throw new Error('simulated disk failure');
      return rename(source, destination);
    });
    await expect(repository.commit(key, capture('second', first.revision, { sequence: 2 }))).rejects.toThrow('simulated disk failure');
    expect((await repository.read(key)).snapshot).toEqual(Buffer.from('state-first'));
    expect(await repository.history(key)).toHaveLength(1);
  });

  it('surfaces corrupted artifacts rather than falling back to an older checkpoint', async () => {
    const first = await repository.commit(key, capture('first'));
    const second = await repository.commit(key, capture('second', first.revision, { sequence: 2 }));
    fs.writeFileSync(path.join(gameDir(), 'blobs', `${second.artifacts.snapshot.hash}.bin`), 'corrupted');
    await expect(repository.read(key)).rejects.toMatchObject({ code: 'ECHECKPOINTCORRUPT' });
    expect((await repository.readRevision(key, first.revision)).snapshot).toEqual(Buffer.from('state-first'));
  });

  it('detects missing heads and corrupt revision records instead of treating them as new games', async () => {
    await repository.commit(key, capture('first'));
    fs.unlinkSync(path.join(gameDir(), 'head.json'));
    await expect(repository.read(key)).rejects.toMatchObject({ code: 'ECHECKPOINTCORRUPT' });
  });

  it('reset retains prior progress and invalidates pre-reset saves', async () => {
    const first = await repository.commit(key, capture('first'));
    const reset = await repository.commit(key, { ...capture('reset', first.revision, { sequence: 2 }), kind: 'reset', snapshot: null, battery: null });
    expect((await repository.read(key)).kind).toBe('reset');
    expect((await repository.readRevision(key, first.revision)).battery).toEqual(Buffer.from('battery-first'));
    await expect(repository.commit(key, capture('late', first.revision, { sequence: 3 })))
      .rejects.toMatchObject({ code: 'ECHECKPOINTCONFLICT' });
    expect((await repository.read(key)).revision).toBe(reset.revision);
  });

  it('contains all paths and rejects invalid metadata before creating progress', async () => {
    await expect(repository.commit({ ...key, gameId: '../escape' }, capture('first'))).rejects.toThrow();
    await expect(repository.commit(key, { ...capture('first'), sequence: -1 })).rejects.toMatchObject({ code: 'ECHECKPOINTINVALID' });
    expect(await repository.read(key)).toBeNull();
  });
  it('legacy save/state writes and deletes cannot bypass an established checkpoint head', async () => {
    await repository.commit(key, capture('first'));
    const legacy = new FilesystemEmulatorSaveRepository({ emulationDir: dir });
    const data = { async *chunks() { yield Buffer.from('older'); } };
    await expect(legacy.storeSaveArtifact(key, data)).rejects.toMatchObject({ code: 'ECHECKPOINTREQUIRED' });
    await expect(legacy.storeStateArtifact({ ...key, slot: 'auto' }, data)).rejects.toMatchObject({ code: 'ECHECKPOINTREQUIRED' });
    await expect(legacy.deleteSave(key)).rejects.toMatchObject({ code: 'ECHECKPOINTREQUIRED' });
    await expect(legacy.deleteState({ ...key, slot: 'auto' })).rejects.toMatchObject({ code: 'ECHECKPOINTREQUIRED' });
    expect((await repository.read(key)).snapshot).toEqual(Buffer.from('state-first'));
  });

  it('discovers users whose progress exists only in the checkpoint store', async () => {
    await repository.commit(key, capture('first'));
    const legacy = new FilesystemEmulatorSaveRepository({ emulationDir: dir });
    expect(legacy.listUsers(key.system, key.gameId)).toEqual([key.user]);
  });

  it('legacy exports serve the current verified checkpoint while retaining original files', async () => {
    const legacy = new FilesystemEmulatorSaveRepository({ emulationDir: dir });
    await legacy.storeSaveArtifact(key, { async *chunks() { yield Buffer.from('original'); } });
    const first = await repository.commit(key, capture('first'));
    const bytes = async resource => { const chunks = []; for await (const chunk of resource.open()) chunks.push(chunk); return Buffer.concat(chunks); };
    expect(await bytes(legacy.getSaveResource(key))).toEqual(Buffer.from('battery-first'));
    expect(await bytes(legacy.getStateResource({ ...key, slot: 'auto' }))).toEqual(Buffer.from('state-first'));
    expect(fs.readFileSync(path.join(dir, 'gb/saves/user_5/example-quest.srm'), 'utf8')).toBe('original');
    await repository.commit(key, { ...capture('reset', first.revision, { sequence: 2 }), kind: 'reset', snapshot: null, battery: null });
    expect(() => legacy.getSaveResource(key)).toThrow(expect.objectContaining({ code: 'ENOENT' }));
  });

  it('retries a lost acknowledgment after head publication without making another revision', async () => {
    const first = await repository.commit(key, capture('first'));
    const rename = fs.renameSync;
    let failOnce = true;
    vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      rename(source, destination);
      if (failOnce && destination === path.join(gameDir(), 'head.json')) { failOnce = false; throw new Error('acknowledgment lost after publication'); }
    });
    const next = capture('second', first.revision, { sequence: 2 });
    await expect(repository.commit(key, next)).rejects.toThrow('acknowledgment lost');
    const published = await repository.read(key);
    expect(published.snapshot).toEqual(Buffer.from('state-second'));
    expect((await repository.commit(key, next)).revision).toBe(published.revision);
    expect(await repository.history(key)).toHaveLength(2);
  });

});

describe('explicit damaged progress recovery', () => {
  it('inspects independently sealed revisions and repairs only the selected point with a matching damaged-head token', async () => {
    const first = await repository.commit(key, capture('first'));
    const second = await repository.commit(key, capture('second', first.revision, { sequence: 2 }));
    fs.writeFileSync(path.join(gameDir(), 'head.json'), 'damaged-pointer');
    await expect(repository.read(key)).rejects.toMatchObject({ code: 'ECHECKPOINTCORRUPT' });
    const inspection = await repository.inspectRecovery(key);
    expect(inspection.damagedHead).toBe(true);
    expect(inspection.checkpoints.filter(item => item.usable).map(item => item.revision)).toEqual(expect.arrayContaining([first.revision, second.revision]));
    await expect(repository.repairHead(key, { sourceRevision: first.revision, expectedHeadToken: 'wrong',
      provenance, captureId: 'repair-one', sessionId: 'repair-session', sequence: 1 })).rejects.toMatchObject({ code: 'ECHECKPOINTCONFLICT' });
    const recovered = await repository.repairHead(key, { sourceRevision: first.revision, expectedHeadToken: inspection.headToken,
      provenance, captureId: 'repair-one', sessionId: 'repair-session', sequence: 1 });
    expect(recovered.revision).not.toBe(first.revision);
    expect(recovered.snapshot).toEqual(first.snapshot);
    expect((await repository.read(key)).revision).toBe(recovered.revision);
    expect((await repository.readRecoveryRevision(key, second.revision)).snapshot).toEqual(second.snapshot);
    expect(fs.readFileSync(path.join(gameDir(), 'damaged', `head-${inspection.headToken}.json`), 'utf8')).toBe('damaged-pointer');
    await expect(repository.repairHead(key, { sourceRevision: first.revision, expectedHeadToken: inspection.headToken,
      provenance, captureId: 'repair-two', sessionId: 'repair-session', sequence: 2 })).rejects.toMatchObject({ code: 'ECHECKPOINTCONFLICT' });
  });
  it('does not accept a damaged revision merely because its filename is present', async () => {
    const first = await repository.commit(key, capture('first'));
    fs.unlinkSync(path.join(gameDir(), 'head.json'));
    fs.writeFileSync(path.join(gameDir(), 'revisions', `${first.revision}.json`), JSON.stringify({ ...first, createdAt: 'changed' }));
    const inspection = await repository.inspectRecovery(key);
    expect(inspection.damagedHead).toBe(true);
    expect(inspection.checkpoints.find(item => item.revision === first.revision).usable).toBe(false);
    await expect(repository.readRecoveryRevision(key, first.revision)).rejects.toMatchObject({ code: 'ECHECKPOINTCORRUPT' });
  });
  it('repairs a damaged content blob only from explicitly imported good bytes and retains the damage evidence', async () => {
    const first = await repository.commit(key, capture('first'));
    const descriptor = first.artifacts.snapshot;
    const file = path.join(gameDir(), 'blobs', `${descriptor.hash}.bin`);
    fs.writeFileSync(file, 'damaged-blob');
    await expect(repository.commit(key, capture('ordinary', first.revision, { snapshot: first.snapshot, sequence: 2 }))).rejects.toMatchObject({ code: 'ECHECKPOINTCORRUPT' });
    const repaired = await repository.commit(key, capture('repair', first.revision, { snapshot: first.snapshot, kind: 'import', sequence: 2 }));
    expect(repaired.snapshot).toEqual(first.snapshot);
    expect((await repository.readRevision(key, first.revision)).snapshot).toEqual(first.snapshot);
    const evidenceDir = path.join(gameDir(), 'damaged', 'blobs', descriptor.hash);
    expect(fs.readdirSync(evidenceDir)).toHaveLength(1);
    expect(fs.readFileSync(path.join(evidenceDir, fs.readdirSync(evidenceDir)[0]), 'utf8')).toBe('damaged-blob');
  });
});

it('can explicitly repair a damaged pointer from a durable local branch or reset without dropping prior recovery records', async () => {
  const first = await repository.commit(key, capture('first'));
  fs.unlinkSync(path.join(gameDir(), 'head.json'));
  const repaired = await repository.repairHead(key, { ...capture('local'), sourceRevision: null,
    expectedHeadToken: 'missing', intent: 'import' });
  expect(repaired.kind).toBe('import'); expect(repaired.snapshot.toString()).toBe('state-local');
  expect((await repository.readRecoveryRevision(key, first.revision)).snapshot).toEqual(first.snapshot);
  fs.writeFileSync(path.join(gameDir(), 'head.json'), 'damaged-again');
  const inspection = await repository.inspectRecovery(key);
  const reset = await repository.repairHead(key, { ...capture('reset'), snapshot: null, battery: null,
    sourceRevision: null, expectedHeadToken: inspection.headToken, intent: 'reset' });
  expect(reset.kind).toBe('reset'); expect(reset.snapshot).toBeNull();
  expect((await repository.readRecoveryRevision(key, repaired.revision)).snapshot.toString()).toBe('state-local');
});
