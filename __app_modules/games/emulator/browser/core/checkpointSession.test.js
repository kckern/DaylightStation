// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createEmulatorCheckpointHarness, createMemoryCheckpointJournal } from '../../../../../tests/_lib/emulatorCheckpointHarness.mjs';
import { createCheckpointClient } from './checkpointClient.js';
import { createCheckpointSession } from './checkpointSession.js';
let env, client, journal, sessions;
const captured = label => ({ state: new Uint8Array(Buffer.from(`state-${label}`)), battery: new Uint8Array(Buffer.from(`battery-${label}`)) });
beforeEach(() => { env = createEmulatorCheckpointHarness(); client = createCheckpointClient({ fetchImpl: env.fetchImpl }); journal = createMemoryCheckpointJournal(); sessions = []; });
afterEach(async () => { for (const session of sessions) session.dispose(); await Promise.all(sessions.map(session => session.flush())); env.cleanup(); });
function makeSession(overrides = {}) {
  const session = createCheckpointSession({ key: env.key, saveMode: 'battery', client, journal, makeId: randomUUID, ...overrides });
  sessions.push(session); return session;
}
async function ready(session) {
  const prepared = await session.prepare();
  expect(prepared.status).toBe('ready');
  expect(session.confirmRestored({ status: 'ok', verified: true, provenance: prepared.provenance, artifactHash: prepared.artifactHash }).status).toBe('ok');
  return prepared;
}
async function seed() {
  const description = (await client.getCheckpoint(env.key)).data;
  const result = await client.putCheckpoint(env.key, { expectedRevision: null, captureId: randomUUID(), sessionId: randomUUID(), sequence: 1,
    provenance: description.provenance, snapshot: captured('seed').state, battery: captured('seed').battery });
  expect(result.status).toBe('ok'); return result.data.head;
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
describe('checkpoint lifecycle against real server persistence', () => {
  it('enables writes only after verified restore and retires only acknowledged local bytes', async () => {
    const session = makeSession();
    const prepared = await session.prepare(); expect(prepared.status).toBe('ready');
    expect((await session.save(captured('before-restore'))).status).toBe('skipped');
    expect(await env.repository.read(env.key)).toBeNull();
    session.confirmRestored({ status: 'ok', verified: true, provenance: prepared.provenance });
    const saved = await session.save(captured('one'));
    expect(saved.status).toBe('ok');
    expect((await env.repository.read(env.key)).snapshot.toString()).toBe('state-one');
    expect(await journal.list(env.key)).toHaveLength(0);
  });
  it('cannot save fresh startup bytes after a failed load or rejected native restore', async () => {
    const first = await seed();
    const failed = makeSession({ client: { ...client, getCheckpoint: async () => ({ status: 'error', code: 'ECHECKPOINTUNAVAILABLE' }) } });
    expect((await failed.prepare()).status).toBe('error');
    expect((await failed.save(captured('fresh'))).status).toBe('skipped');
    const rejected = makeSession(); const prepared = await rejected.prepare();
    expect(rejected.confirmRestored({ status: 'ok', verified: false, provenance: prepared.provenance }).status).toBe('error');
    expect((await rejected.save(captured('fresh'))).status).toBe('skipped');
    expect((await env.repository.read(env.key)).revision).toBe(first.revision);
  });
  it('journals queued captures before slow uploads and commits them in capture order', async () => {
    const gate = deferred();
    const session = makeSession({ client: { ...client, putCheckpoint: async (...args) => { await gate.promise; return client.putCheckpoint(...args); } } });
    await ready(session);
    const one = captured('one'); const first = session.save(one); one.state.fill(0);
    const second = session.save(captured('two'));
    try { await vi.waitFor(async () => expect(await journal.list(env.key)).toHaveLength(2)); }
    finally { gate.resolve(); }
    expect((await first).status).toBe('ok'); expect((await second).status).toBe('ok');
    const history = await env.repository.history(env.key);
    expect(history).toHaveLength(2);
    expect((await env.repository.readRevision(env.key, history[1].revision)).snapshot.toString()).toBe('state-one');
    expect((await env.repository.read(env.key)).snapshot.toString()).toBe('state-two');
  });
  it('pauses on journal failure and retries the latest paused game before allowing play', async () => {
    const session = makeSession(); await ready(session); journal.failWrites = true;
    expect((await session.save(captured('held'))).status).toBe('error');
    expect(session.getState().canPlay).toBe(false);
    expect(await env.repository.read(env.key)).toBeNull();
    journal.failWrites = false;
    expect((await session.retry(captured('latest'))).status).toBe('ok');
    expect(session.getState().canPlay).toBe(true);
    expect((await env.repository.read(env.key)).snapshot.toString()).toBe('state-latest');
  });
  it('preserves a conflicting branch and never rebases its bytes over another writer', async () => {
    await seed(); const session = makeSession(); const prepared = await ready(session);
    const remote = await client.putCheckpoint(env.key, { expectedRevision: prepared.head.revision, captureId: randomUUID(), sessionId: randomUUID(), sequence: 1,
      provenance: prepared.provenance, snapshot: captured('remote').state, battery: captured('remote').battery });
    expect(remote.status).toBe('ok');
    expect((await session.save(captured('local'))).code).toBe('ECHECKPOINTCONFLICT');
    expect((await session.retry()).status).toBe('error');
    expect((await env.repository.read(env.key)).snapshot.toString()).toBe('state-remote');
    expect(await journal.list(env.key)).toHaveLength(1);
    session.dispose();
    const reopened = makeSession(); expect((await reopened.prepare()).status).toBe('recovery');
    expect(reopened.getState().canPlay).toBe(false);
    expect((await env.repository.read(env.key)).snapshot.toString()).toBe('state-remote');
  });
  it('recovers a nonconflicting unacknowledged local capture after reload', async () => {
    await seed();
    const session = makeSession({ client: { ...client, putCheckpoint: async () => ({ status: 'error', code: 'ECHECKPOINTUNAVAILABLE' }) } });
    await ready(session); await session.save(captured('pending')); session.dispose();
    expect(await journal.list(env.key)).toHaveLength(1);
    const reopened = makeSession(); const prepared = await reopened.prepare();
    expect(prepared.status).toBe('ready');
    expect(Buffer.from(prepared.resume.data).toString()).toBe('state-pending');
    expect((await env.repository.read(env.key)).snapshot.toString()).toBe('state-pending');
    expect(await journal.list(env.key)).toHaveLength(0);
  });
  it('recognizes an already accepted capture after acknowledgment loss without duplicating it', async () => {
    const session = makeSession({ client: { ...client, putCheckpoint: async (...args) => { await client.putCheckpoint(...args); return { status: 'error', code: 'ECHECKPOINTUNAVAILABLE' }; } } });
    await ready(session); await session.save(captured('accepted')); session.dispose();
    expect(await journal.list(env.key)).toHaveLength(1);
    const reopened = makeSession(); expect((await reopened.prepare()).status).toBe('ready');
    expect(await journal.list(env.key)).toHaveLength(0);
    expect(await env.repository.history(env.key)).toHaveLength(1);
  });
  it('waits for an old in-page exit write before reopening the same game', async () => {
    const gate = deferred();
    const old = makeSession({ client: { ...client, putCheckpoint: async (...args) => { await gate.promise; return client.putCheckpoint(...args); } } });
    await ready(old); const saving = old.save(captured('exit')); old.dispose();
    const reopened = makeSession(); let completed = false;
    const preparing = reopened.prepare().then(result => { completed = true; return result; });
    try { await vi.waitFor(async () => expect(await journal.list(env.key)).toHaveLength(1)); expect(completed).toBe(false); }
    finally { gate.resolve(); }
    await saving;
    expect(Buffer.from((await preparing).resume.data).toString()).toBe('state-exit');
  });
  it('rejects incomplete captures without replacing existing progress', async () => {
    const first = await seed(); const session = makeSession(); await ready(session);
    expect((await session.save({ state: null, battery: new Uint8Array([1]) })).status).toBe('error');
    expect((await env.repository.read(env.key)).revision).toBe(first.revision);
    expect(await journal.list(env.key)).toHaveLength(0);
  });
  it('retries journal cleanup after the server accepted a capture without falsely declaring a conflict', async () => {
    const original = journal.acknowledge.bind(journal); let fail = true;
    journal.acknowledge = async (...args) => { if (fail) throw Object.assign(new Error('journal cleanup failed'), { code: 'ECHECKPOINTJOURNALUNAVAILABLE' }); return original(...args); };
    const session = makeSession(); await ready(session);
    expect((await session.save(captured('accepted'))).status).toBe('error');
    expect((await env.repository.read(env.key)).snapshot.toString()).toBe('state-accepted');
    fail = false;
    expect((await session.retry(captured('after-retry'))).status).toBe('ok');
    expect((await env.repository.read(env.key)).snapshot.toString()).toBe('state-after-retry');
    expect(await journal.list(env.key)).toHaveLength(0);
  });
  it('retains a failed durable capture across in-page teardown until storage can be retried', async () => {
    const old = makeSession(); await ready(old); journal.failWrites = true;
    await old.save(captured('held-in-memory')); old.dispose(); journal.failWrites = false;
    const reopened = makeSession(); const prepared = await reopened.prepare();
    expect(prepared.status).toBe('ready');
    expect(Buffer.from(prepared.resume.data).toString()).toBe('state-held-in-memory');
  });
  it('requires explicit recovery when two pending branches share the same parent', async () => {
    const first = await seed(); const description = (await client.getCheckpoint(env.key)).data;
    for (const [label, time] of [['branch-a', 2000], ['branch-b', 1000]]) {
      await journal.put({ key: env.key, saveMode: 'battery', captureId: label, sessionId: label, sequence: 1,
        expectedRevision: first.revision, previousCaptureId: first.captureId, createdAt: time,
        provenance: description.provenance, snapshot: captured(label).state, battery: captured(label).battery });
    }
    const reopened = makeSession(); expect((await reopened.prepare()).status).toBe('recovery');
    expect((await env.repository.read(env.key)).revision).toBe(first.revision);
    expect(await journal.list(env.key)).toHaveLength(2);
  });

  it('cannot use a fresh boot or a different snapshot acknowledgment as proof of restoring saved progress', async () => {
    const first = await seed(); const session = makeSession(); const prepared = await session.prepare();
    expect(session.confirmRestored({ status: 'ok', verified: true, provenance: prepared.provenance, artifactHash: 'c'.repeat(64) }).status).toBe('error');
    expect((await session.save(captured('fresh'))).status).toBe('skipped');
    expect((await env.repository.read(env.key)).revision).toBe(first.revision);
  });

});


describe('explicit checkpoint recovery choices', () => {
  async function conflict() {
    const first = await seed();
    const interrupted = makeSession({ client: { ...client, putCheckpoint: async () => ({ status: 'error', code: 'ECHECKPOINTUNAVAILABLE' }) } });
    await ready(interrupted); await interrupted.save(captured('local'));
    const remote = await client.putCheckpoint(env.key, { expectedRevision: first.revision, captureId: randomUUID(), sessionId: randomUUID(), sequence: 1,
      provenance: first.provenance, snapshot: captured('remote').state, battery: captured('remote').battery });
    expect(remote.status).toBe('ok');
    const session = makeSession(); expect((await session.prepare()).status).toBe('recovery');
    return { session, remote: remote.data.head };
  }
  const proof = point => ({ status: 'ok', verified: true, provenance: point.provenance, artifactHash: point.artifactHash });
  it('restores only the explicitly chosen local branch and preserves the competing server and local copies', async () => {
    const { session, remote } = await conflict();
    const copies = await session.inspectRecovery(); expect(copies.status).toBe('ok');
    const point = await session.selectRecovery({ type: 'local', captureId: copies.pending[0].captureId });
    expect(point.status).toBe('ready'); expect(Buffer.from(point.resume.data).toString()).toBe('state-local');
    expect(session.getState().canPlay).toBe(false);
    expect((await session.confirmRecoveryRestored(proof(point))).status).toBe('ok');
    expect(session.getState().canPlay).toBe(true);
    expect((await env.repository.read(env.key)).snapshot.toString()).toBe('state-local');
    expect((await env.repository.readRecoveryRevision(env.key, remote.revision)).snapshot.toString()).toBe('state-remote');
    expect(await journal.list(env.key)).toHaveLength(0); expect(await journal.listArchived(env.key)).toHaveLength(1);
  });
  it('keeps a nonselected local branch available after choosing the current server copy', async () => {
    const { session, remote } = await conflict();
    await session.inspectRecovery();
    const point = await session.selectRecovery({ type: 'server', revision: remote.revision });
    expect((await session.confirmRecoveryRestored(proof(point))).status).toBe('ok');
    expect((await env.repository.read(env.key)).snapshot.toString()).toBe('state-remote');
    expect(Buffer.from((await journal.listArchived(env.key))[0].snapshot).toString()).toBe('state-local');
  });
  it('cannot publish an explicit recovery when the native selected-state proof fails', async () => {
    const { session, remote } = await conflict(); const copies = await session.inspectRecovery();
    await session.selectRecovery({ type: 'local', captureId: copies.pending[0].captureId });
    expect((await session.confirmRecoveryRestored({ status: 'error' })).status).toBe('error');
    expect(session.getState().canSave).toBe(false);
    expect((await env.repository.read(env.key)).revision).toBe(remote.revision); expect(await journal.list(env.key)).toHaveLength(1);
  });
  it('repairs a damaged head from the selected durable local copy after native verification', async () => {
    const { session } = await conflict();
    fs.writeFileSync(path.join(env.root, '_checkpoints', env.key.system, env.key.user, env.key.gameId, 'head.json'), 'damaged');
    const copies = await session.inspectRecovery(); expect(copies.inspection.damagedHead).toBe(true);
    const point = await session.selectRecovery({ type: 'local', captureId: copies.pending[0].captureId });
    expect((await session.confirmRecoveryRestored(proof(point))).status).toBe('ok');
    expect((await env.repository.read(env.key)).snapshot.toString()).toBe('state-local');
  });
  it('preserves the latest paused capture before offering recovery after a failed upload', async () => {
    await seed(); const session = makeSession({ client: { ...client, putCheckpoint: async () => ({ status: 'error', code: 'ECHECKPOINTUNAVAILABLE' }) } });
    await ready(session); await session.save(captured('earlier'));
    const copies = await session.inspectRecovery({ captured: captured('latest-paused') });
    expect(copies.pending.map(item => Buffer.from(item.snapshot).toString())).toContain('state-latest-paused');
    expect(session.getState().canPlay).toBe(false);
  });
  it('retries local archive cleanup after a recovery was acknowledged without publishing a second head', async () => {
    const { session, remote } = await conflict(); await session.inspectRecovery();
    const point = await session.selectRecovery({ type: 'server', revision: remote.revision });
    journal.failWrites = true;
    expect((await session.confirmRecoveryRestored(proof(point))).status).toBe('error');
    const committed = await env.repository.read(env.key);
    expect(session.getState().canPlay).toBe(false); expect(await journal.list(env.key)).toHaveLength(1);
    journal.failWrites = false;
    expect((await session.confirmRecoveryRestored(proof(point))).status).toBe('ok');
    expect((await env.repository.read(env.key)).revision).toBe(committed.revision);
  });
  it('does not silently resolve a local branch that arrived after the user saw the choices', async () => {
    const { session, remote } = await conflict(); await session.inspectRecovery();
    const point = await session.selectRecovery({ type: 'server', revision: remote.revision });
    await journal.put({ key: env.key, saveMode: 'battery', captureId: randomUUID(), sessionId: randomUUID(), sequence: 1,
      expectedRevision: remote.revision, previousCaptureId: remote.captureId, createdAt: 9999, provenance: remote.provenance,
      snapshot: captured('late-arrival').state, battery: captured('late-arrival').battery });
    expect((await session.confirmRecoveryRestored(proof(point))).status).toBe('recovery');
    expect(session.getState().canPlay).toBe(false); expect(await journal.list(env.key)).toHaveLength(1);
    expect(Buffer.from((await journal.list(env.key))[0].snapshot).toString()).toBe('state-late-arrival');
  });
  it('rejects a head change after selecting recovery instead of rebasing over it', async () => {
    const { session, remote } = await conflict(); await session.inspectRecovery();
    const point = await session.selectRecovery({ type: 'server', revision: remote.revision });
    const newer = await client.putCheckpoint(env.key, { expectedRevision: remote.revision, captureId: randomUUID(), sessionId: randomUUID(), sequence: 1,
      provenance: remote.provenance, snapshot: captured('even-newer').state, battery: captured('even-newer').battery });
    expect((await session.confirmRecoveryRestored(proof(point))).code).toBe('ECHECKPOINTCONFLICT');
    expect((await env.repository.read(env.key)).revision).toBe(newer.data.head.revision);
    expect(await journal.list(env.key)).toHaveLength(1); expect(session.getState().canPlay).toBe(false);
  });
  it('retries a lost damaged-head repair acknowledgment as the same operation', async () => {
    const { remote } = await conflict();
    fs.writeFileSync(path.join(env.root, '_checkpoints', env.key.system, env.key.user, env.key.gameId, 'head.json'), 'damaged');
    let loseAck = true;
    const session = makeSession({ client: { ...client, repairCheckpoint: async (...args) => {
      const response = await client.repairCheckpoint(...args);
      if (response.status === 'ok' && loseAck) { loseAck = false; return { status: 'error', code: 'ECHECKPOINTUNAVAILABLE' }; }
      return response;
    } } });
    await session.inspectRecovery(); const point = await session.selectRecovery({ type: 'server', revision: remote.revision });
    expect((await session.confirmRecoveryRestored(proof(point))).status).toBe('error');
    const committed = await env.repository.read(env.key);
    expect((await session.confirmRecoveryRestored(proof(point))).status).toBe('ok');
    expect((await env.repository.read(env.key)).revision).toBe(committed.revision);
  });
  it('claims current guest progress only after verified restoration and keeps the prior player checkpoint recoverable', async () => {
    const first = await seed(); const session = makeSession();
    const point = await session.prepareClaim(captured('guest'), { allowExisting: true });
    expect(point.status).toBe('ready'); expect((await env.repository.read(env.key)).revision).toBe(first.revision);
    expect(session.getState().canSave).toBe(false);
    expect((await session.confirmRecoveryRestored(proof(point))).status).toBe('ok');
    expect((await env.repository.read(env.key)).snapshot.toString()).toBe('state-guest');
    expect((await env.repository.readRecoveryRevision(env.key, first.revision)).snapshot.toString()).toBe('state-seed');
    expect(await journal.listArchived(env.key)).toHaveLength(1);
  });
  it('does not upload an interrupted claim on reload before native verification', async () => {
    const first = await seed(); const session = makeSession(); const input = captured('guest');
    const pending = session.prepareClaim(input, { allowExisting: true }); input.state.fill(0);
    const point = await pending; expect(point.status).toBe('ready');
    expect(Buffer.from(point.resume.data).toString()).toBe('state-guest');
    const reopened = makeSession(); const prepared = await reopened.prepare();
    expect(prepared.status).toBe('recovery'); expect(prepared.reason).toBe('verification');
    expect((await env.repository.read(env.key)).revision).toBe(first.revision);
    expect(Buffer.from((await journal.list(env.key))[0].snapshot).toString()).toBe('state-guest');
  });
  it('requires an explicit replacement choice if an apparently new claim finds existing saved progress', async () => {
    const first = await seed(); const session = makeSession();
    const point = await session.prepareClaim(captured('guest'));
    expect(point.status).toBe('recovery'); expect(point.reason).toBe('confirmation');
    expect((await env.repository.read(env.key)).revision).toBe(first.revision);
    expect(await journal.list(env.key)).toHaveLength(1);
  });
  it('can explicitly reset an unreadable head after inspection while retaining its prior recovery copies', async () => {
    const first = await seed(); const session = makeSession();
    fs.writeFileSync(path.join(env.root, '_checkpoints', env.key.system, env.key.user, env.key.gameId, 'head.json'), 'damaged');
    await session.inspectRecovery();
    expect((await session.resetFromRecovery()).status).toBe('ok');
    expect((await env.repository.read(env.key)).kind).toBe('reset');
    expect((await env.repository.readRecoveryRevision(env.key, first.revision)).snapshot.toString()).toBe('state-seed');
    expect(session.getState().canPlay).toBe(false);
  });
  it('does not restart or discard the running point when an explicit reset fails', async () => {
    const first = await seed(); const session = makeSession({ client: { ...client, resetCheckpoint: async () => ({ status: 'error', code: 'ECHECKPOINTUNAVAILABLE' }) } });
    await ready(session);
    expect((await session.resetProgress(captured('latest'))).status).toBe('error');
    expect(session.getState().canPlay).toBe(false);
    expect((await env.repository.read(env.key)).snapshot.toString()).toBe('state-latest');
    expect((await env.repository.readRecoveryRevision(env.key, first.revision)).snapshot.toString()).toBe('state-seed');
  });
});
