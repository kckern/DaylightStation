// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { createEmulatorCheckpointHarness, createMemoryCheckpointJournal } from '../../../../../tests/_lib/emulatorCheckpointHarness.mjs';
import { createCheckpointClient, checkpointDigest } from './checkpointClient.js';
import { createCheckpointConsoleLifecycle } from './checkpointConsoleLifecycle.js';
let env, client, journal, controllers;
const captured = label => ({ state: new Uint8Array(Buffer.from(`state-${label}`)), battery: new Uint8Array(Buffer.from(`battery-${label}`)) });
beforeEach(() => { env = createEmulatorCheckpointHarness(); client = createCheckpointClient({ fetchImpl: env.fetchImpl }); journal = createMemoryCheckpointJournal(); controllers = []; });
afterEach(async () => { for (const controller of controllers) controller.dispose(); await Promise.all(controllers.map(controller => controller.settled())); env.cleanup(); });
function engine() {
  let data = captured('boot'), provenance;
  const api = { pause: vi.fn(), resume: vi.fn(), setProgressPlayable: vi.fn(),
    captureState: vi.fn(() => data.state), captureSave: vi.fn(() => data.battery),
    restoreCheckpoint: vi.fn(async resume => {
      if (resume.kind === 'state') data = { state: resume.data, battery: data.battery };
      return { status: 'ok', verified: true, provenance, artifactHash: resume.data ? await checkpointDigest(resume.data) : null };
    }),
    advance: label => { data = captured(label); }, setProvenance: value => { provenance = value; },
  };
  return api;
}
function make(overrides = {}) {
  const native = engine();
  const controller = createCheckpointConsoleLifecycle({ engine: native, key: env.key, saveMode: 'battery', client, journal, makeId: randomUUID, ...overrides });
  controllers.push(controller); return { controller, native };
}
async function start(controller, native) {
  const point = await controller.prepare(); expect(point.status).toBe('ready'); native.setProvenance(point.provenance);
  expect((await controller.restore(point)).status).toBe('ok');
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
describe('console checkpoint lifecycle against real server persistence', () => {
  it('cannot capture startup bytes during a slow read or persist after a rejected native restore', async () => {
    const held = deferred(); const { controller, native } = make({ client: { ...client, getCheckpoint: async (...args) => { await held.promise; return client.getCheckpoint(...args); } } });
    const pending = controller.prepare(); expect((await controller.save()).status).toBe('skipped'); expect(native.captureState).not.toHaveBeenCalled();
    held.resolve(); const point = await pending; native.setProvenance(point.provenance);
    native.restoreCheckpoint.mockResolvedValue({ status: 'error' });
    expect((await controller.restore(point)).status).toBe('error'); await controller.interrupted();
    expect(native.captureState).not.toHaveBeenCalled(); expect(await env.repository.read(env.key)).toBeNull();
  });
  it('holds the exit until the final owned snapshot and battery are durably acknowledged', async () => {
    const held = deferred(); const { controller, native } = make({ client: { ...client, putCheckpoint: async (...args) => { await held.promise; return client.putCheckpoint(...args); } } });
    await start(controller, native); native.advance('final');
    let left = false; const closing = controller.exit().then(result => { left = result.status === 'ok'; return result; });
    await Promise.resolve(); expect(left).toBe(false); expect(controller.getState().canPlay).toBe(false);
    native.advance('after-capture'); held.resolve(); await closing;
    expect(left).toBe(true); expect((await env.repository.read(env.key)).snapshot.toString()).toBe('state-final');
    expect((await env.repository.read(env.key)).battery.toString()).toBe('battery-final');
  });
  it('pauses on a missing required capture instead of accepting a partial checkpoint', async () => {
    const { controller, native } = make(); await start(controller, native); native.captureSave.mockReturnValue(null);
    expect((await controller.save()).status).toBe('error'); expect(controller.getState().canPlay).toBe(false);
    expect(await env.repository.read(env.key)).toBeNull(); expect(native.pause).toHaveBeenCalled();
  });
  it('retries with the latest paused progress after local durability fails', async () => {
    const { controller, native } = make(); await start(controller, native); journal.failWrites = true;
    native.advance('earlier'); expect((await controller.save()).status).toBe('error');
    native.advance('latest-paused'); journal.failWrites = false;
    expect((await controller.retry()).status).toBe('ok');
    expect((await env.repository.read(env.key)).snapshot.toString()).toBe('state-latest-paused');
    expect(controller.getState().canPlay).toBe(true);
  });
  it('journals an interrupted exit before teardown and completes the already owned upload', async () => {
    const { controller, native } = make(); await start(controller, native); native.advance('interrupted');
    const saving = controller.interrupted(); controller.dispose(); native.advance('unrelated'); await saving;
    expect((await env.repository.read(env.key)).snapshot.toString()).toBe('state-interrupted');
  });
  it('retains the current game after reset fails and releases no false success', async () => {
    const { controller, native } = make({ client: { ...client, resetCheckpoint: async () => ({ status: 'error', code: 'ECHECKPOINTUNAVAILABLE' }) } });
    await start(controller, native); native.advance('latest'); expect((await controller.reset()).status).toBe('error');
    expect(controller.getState().canPlay).toBe(false); expect((await env.repository.read(env.key)).snapshot.toString()).toBe('state-latest');
  });
});

it('can cancel inspection and resume the same verified game after saving its latest paused bytes', async () => {
  const { controller, native } = make(); await start(controller, native); native.advance('latest'); await controller.save();
  expect((await controller.inspectRecovery()).status).toBe('ok'); expect(controller.getState().canPlay).toBe(false);
  expect((await controller.cancelRecovery()).status).toBe('ok'); expect(controller.getState().canPlay).toBe(true);
  expect((await env.repository.read(env.key)).snapshot.toString()).toBe('state-latest');
});
it('can exit directly from inspection and acknowledge the verified paused game', async () => {
  const { controller, native } = make(); await start(controller, native); native.advance('latest'); await controller.save();
  expect((await controller.inspectRecovery()).status).toBe('ok');
  expect((await controller.exit()).status).toBe('ok');
  expect((await env.repository.read(env.key)).snapshot.toString()).toBe('state-latest');
});
it.each(['running', 'recovery'])('can retry and exit after a rejected %s reset without losing native verification', async mode => {
  const { controller, native } = make({ client: { ...client, resetCheckpoint: async () => ({ status: 'error', code: 'ECHECKPOINTUNAVAILABLE' }) } });
  await start(controller, native); native.advance('latest');
  if (mode === 'recovery') await controller.inspectRecovery();
  expect((await controller[mode === 'recovery' ? 'resetFromRecovery' : 'reset']()).status).toBe('error');
  expect((await controller.retry()).status).toBe('ok'); expect(controller.getState().canPlay).toBe(true);
  expect((await controller.exit()).status).toBe('ok');
  expect((await env.repository.read(env.key)).snapshot.toString()).toBe('state-latest');
});

it('keeps the running native provenance when recovery inspection describes different assets', async () => {
  const { controller, native } = make({ client: { ...client, getRecoveryInspection: async (...args) => {
    const result = await client.getRecoveryInspection(...args);
    return { ...result, data: { ...result.data, provenance: { ...result.data.provenance,
      core: { ...result.data.provenance.core, bundleHash: 'f'.repeat(64) } } } };
  } } });
  await start(controller, native); native.advance('verified-assets');
  expect((await controller.inspectRecovery()).status).toBe('ok');
  expect((await controller.exit()).status).toBe('ok');
  expect((await env.repository.read(env.key)).snapshot.toString()).toBe('state-verified-assets');
});

describe('autosave through a save-server blip (a redeploy 502s for about a minute)', () => {
  // The gateway answers with an HTML 502 page while the app restarts.
  function blipClient() {
    const state = { down: false };
    const fetchImpl = (url, options) => state.down
      ? Promise.resolve(new Response('<html><body>502 Bad Gateway</body></html>', { status: 502, headers: { 'Content-Type': 'text/html' } }))
      : env.fetchImpl(url, options);
    return { state, client: createCheckpointClient({ fetchImpl }) };
  }
  it('keeps playing, shows it is behind, and uploads every queued capture when the server returns', async () => {
    const blip = blipClient(); let clock = 1_000_000;
    const { controller, native } = make({ client: blip.client, now: () => clock });
    await start(controller, native);
    native.advance('one'); expect((await controller.save()).status).toBe('ok');
    const pausesBefore = native.pause.mock.calls.length;
    blip.state.down = true;
    native.advance('two'); clock += 15_000; expect((await controller.save()).status).toBe('deferred');
    native.advance('three'); clock += 15_000; expect((await controller.save()).status).toBe('deferred');
    const behind = controller.getState();
    expect(behind.canPlay).toBe(true); expect(behind.canSave).toBe(true); expect(behind.error).toBeNull();
    expect(behind.behindSince).not.toBeNull(); expect(native.pause.mock.calls.length).toBe(pausesBefore);
    blip.state.down = false;
    native.advance('four'); clock += 15_000; expect((await controller.save()).status).toBe('ok');
    expect((await env.repository.read(env.key)).snapshot.toString()).toBe('state-four');
    expect(await journal.list(env.key)).toHaveLength(0);
    expect(controller.getState().behindSince).toBeNull(); expect(controller.getState().canPlay).toBe(true);
  });
  it('stops play for a review only after ten minutes without a confirmed save, and Retry resumes it', async () => {
    const blip = blipClient(); let clock = 1_000_000;
    const { controller, native } = make({ client: blip.client, now: () => clock });
    await start(controller, native);
    blip.state.down = true;
    native.advance('a'); expect((await controller.save()).status).toBe('deferred');
    clock += 9 * 60_000; native.advance('b'); expect((await controller.save()).status).toBe('deferred');
    expect(controller.getState().canPlay).toBe(true);
    clock += 60_000; native.advance('c');
    const stale = await controller.save();
    expect(stale.code).toBe('ECHECKPOINTSTALE'); expect(controller.getState().canPlay).toBe(false); expect(native.pause).toHaveBeenCalled();
    blip.state.down = false; native.advance('d');
    expect((await controller.retry()).status).toBe('ok');
    expect(controller.getState().canPlay).toBe(true);
    expect((await env.repository.read(env.key)).snapshot.toString()).toBe('state-d');
  });
  it('still stops on a real conflict', async () => {
    const conflicted = { ...client, putCheckpoint: async () => ({ status: 'error', httpStatus: 409, code: 'ECHECKPOINTCONFLICT', error: 'Progress changed since this game was loaded' }) };
    const { controller, native } = make({ client: conflicted });
    await start(controller, native); native.advance('x');
    expect((await controller.save()).status).toBe('error'); expect(controller.getState().canPlay).toBe(false);
  });
});
