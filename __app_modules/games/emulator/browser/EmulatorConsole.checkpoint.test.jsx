import React from 'react';
import { webcrypto, randomUUID } from 'node:crypto';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { EmulatorConsole } from './EmulatorConsole.jsx';
import { createEmulatorCheckpointHarness, createMemoryCheckpointJournal } from '../../../../tests/_lib/emulatorCheckpointHarness.mjs';
import { createCheckpointClient, checkpointDigest } from './core/checkpointClient.js';
let env, client, journal, originalCrypto;
const captured = label => ({ state: new Uint8Array(Buffer.from(`state-${label}`)), battery: new Uint8Array(Buffer.from(`battery-${label}`)) });
beforeEach(() => {
  originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  env = createEmulatorCheckpointHarness(); client = createCheckpointClient({ fetchImpl: env.fetchImpl }); journal = createMemoryCheckpointJournal();
});
afterEach(async () => { cleanup(); await new Promise(done => setTimeout(done, 20)); env.cleanup(); if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto); });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function seed(label) {
  const description = (await client.getCheckpoint(env.key)).data;
  const data = captured(label);
  const result = await client.putCheckpoint(env.key, { expectedRevision: description.head?.revision ?? null,
    provenance: description.provenance, captureId: randomUUID(), sessionId: randomUUID(), sequence: 1,
    snapshot: data.state, battery: data.battery });
  expect(result.status).toBe('ok'); return result.data.head;
}
async function playable(view) {
  await waitFor(() => expect(view.engines.at(-1).setProgressPlayable).toHaveBeenLastCalledWith(true));
  await act(async () => {});
}
function setup({ protectedClient = client, props = {}, rejectRestore = false } = {}) {
  let data = captured('startup'), volume = 0;
  const engines = [];
  const factories = {
    createEngine: () => {
      const engine = { boot: vi.fn(async () => { data = captured('startup'); }), pause: vi.fn(), resume: vi.fn(), destroy: vi.fn(),
        setProgressPlayable: vi.fn(), captureState: vi.fn(() => data.state), captureSave: vi.fn(() => data.battery),
        setVolume: value => { volume = value; }, getEjsVolume: () => volume,
        confirmFirstFrame: async () => true,
        restoreCheckpoint: vi.fn(async resume => {
          if (rejectRestore) return { status: 'error', error: 'Could not restore saved progress.' };
          if (resume.kind === 'state') data = { state: resume.data, battery: data.battery };
          return { status: 'ok', verified: true, provenance: engine.provenance, artifactHash: resume.data ? await checkpointDigest(resume.data) : null };
        }),
      };
      engines.push(engine); return engine;
    },
    createMixer: ({ setGameVolume }) => ({ stopMusic() {}, playMusic() {}, playCue() {}, muteBus() {}, setBusVolume: (bus, value) => { if (bus === 'game') setGameVolume(value); } }),
    createSession: ({ engine, engineConfig }) => ({
      start: async () => { engine.provenance = engineConfig.checkpointProvenance; await engine.boot(); await engineConfig.afterBoot?.(engine); return {}; },
      destroy: () => engine.destroy(), getGameState: () => ({}), runActions() {},
    }),
    createClip: () => ({}),
  };
  const onExit = vi.fn(); let guard;
  const element = (overrides = {}) => (<EmulatorConsole
    game={{ id: env.key.gameId, system: env.key.system, title: 'Example Quest', romUrl: '/rom', presentation: { hotspots: [{ id: 'logo', action: 'exit', region: { x: 0, y: 0, width: 10, height: 10 } }, { id: 'power', action: 'reset', region: { x: 20, y: 0, width: 10, height: 10 } }] } }}
    engineConfig={{ core: 'gb', pathtodata: '/engine/' }}
    governanceGate={{ mode: 'open', isPlayable: () => true, getStatus: () => ({ state: 'playing' }), onChange: () => () => {} }}
    persistence={{ userId: env.key.user, persist: true, saveMode: 'battery', checkpoint: { key: env.key, client: protectedClient, journal, variant: 'wasm' } }}
    factories={factories} autosaveSeconds={0} showInputActivity={false} onExit={onExit}
    onExitGuardReady={next => { guard = next; }} {...props} {...overrides} />);
  const view = render(element());
  return { ...view, engines, onExit, rerenderProps: overrides => view.rerender(element(overrides)), getGuard: () => guard, advance: label => { data = captured(label); } };
}
describe('console protected checkpoint wiring', () => {
  it('keeps native boot and autosave behind a slow checkpoint read, including after unmount', async () => {
    const held = deferred();
    const view = setup({ protectedClient: { ...client, getCheckpoint: async (...args) => { await held.promise; return client.getCheckpoint(...args); } }, props: { autosaveSeconds: 0.01 } });
    await act(async () => { await new Promise(done => setTimeout(done, 35)); });
    expect(view.engines[0].boot).not.toHaveBeenCalled(); expect(view.engines[0].captureState).not.toHaveBeenCalled();
    view.unmount(); held.resolve(); await new Promise(done => setTimeout(done, 20));
    expect(view.engines[0].boot).not.toHaveBeenCalled(); expect(await env.repository.read(env.key)).toBeNull();
  });
  it('shows failed restoration and cannot persist fresh startup bytes on teardown', async () => {
    const previous = await seed('previous');
    const view = setup({ rejectRestore: true });
    await waitFor(() => expect(view.getByText(/Could not restore saved progress/)).toBeTruthy());
    view.unmount(); expect((await env.repository.read(env.key)).revision).toBe(previous.revision);
    expect(view.engines[0].captureState).not.toHaveBeenCalled();
  });
  for (const exit of ['bezel', 'menu', 'hotspot', 'host']) it(`awaits the final acknowledged bytes through the ${exit} exit`, async () => {
    const held = deferred();
    const view = setup({ protectedClient: { ...client, putCheckpoint: async (...args) => { await held.promise; return client.putCheckpoint(...args); } } });
    await waitFor(() => expect(view.engines[0].restoreCheckpoint).toHaveBeenCalled());
    await act(async () => {}); view.advance('final');
    let hostExit;
    if (exit === 'bezel') fireEvent.click(view.getByRole('button', { name: 'Exit emulator' }));
    if (exit === 'menu') { fireEvent.click(view.getByRole('button', { name: 'Game menu' })); fireEvent.click(view.getByRole('button', { name: 'Exit game' })); }
    if (exit === 'hotspot') fireEvent.click(view.container.querySelector('[data-hotspot-id="logo"]'));
    if (exit === 'host') hostExit = view.getGuard()();
    expect(view.onExit).not.toHaveBeenCalled(); expect(await env.repository.read(env.key)).toBeNull();
    held.resolve();
    if (exit === 'host') expect((await hostExit).status).toBe('ok');
    else await waitFor(() => expect(view.onExit).toHaveBeenCalledTimes(1));
    expect((await env.repository.read(env.key)).snapshot.toString()).toBe('state-final');
    expect((await env.repository.read(env.key)).battery.toString()).toBe('battery-final');
  });
});


describe('console recovery, claims and failed exits', () => {
  it('keeps the native game available after a failed exit, then retries the latest paused bytes', async () => {
    let fail = true;
    const view = setup({ protectedClient: { ...client, putCheckpoint: (...args) => fail ? Promise.resolve({ status: 'error', code: 'ECHECKPOINTUNAVAILABLE', error: 'Saving is unavailable' }) : client.putCheckpoint(...args) } });
    await playable(view); view.advance('final'); fireEvent.click(view.getByRole('button', { name: 'Exit emulator' }));
    await waitFor(() => expect(view.getByText('Saving is unavailable')).toBeTruthy());
    expect(view.onExit).not.toHaveBeenCalled(); expect(view.engines[0].destroy).not.toHaveBeenCalled();
    view.advance('latest-paused'); fail = false; fireEvent.click(view.getByRole('button', { name: 'Retry saving' }));
    await playable(view); expect((await env.repository.read(env.key)).snapshot.toString()).toBe('state-latest-paused');
  });
  it('leaves the running native game in place when reset fails', async () => {
    const view = setup({ protectedClient: { ...client, resetCheckpoint: async () => ({ status: 'error', code: 'ECHECKPOINTUNAVAILABLE', error: 'Reset is unavailable' }) } });
    await playable(view); view.advance('latest'); fireEvent.click(view.container.querySelector('[data-hotspot-id="power"]'));
    fireEvent.pointerDown(view.getByRole('button', { name: 'Start over' }));
    await waitFor(() => expect(view.getByText('Reset is unavailable')).toBeTruthy());
    expect(view.engines).toHaveLength(1); expect(view.engines[0].destroy).not.toHaveBeenCalled();
    expect((await env.repository.read(env.key)).snapshot.toString()).toBe('state-latest');
  });
  it('retains the current paused branch when explicitly restoring an earlier saved copy through a native reboot', async () => {
    const first = await seed('first'); const second = await seed('second');
    const view = setup(); await playable(view); view.advance('current-paused');
    fireEvent.click(view.getByRole('button', { name: 'Game menu' })); fireEvent.click(view.getByRole('button', { name: 'Recover progress' }));
    await waitFor(() => expect(view.getByRole('dialog', { name: 'Recover progress' })).toBeTruthy());
    const copies = await env.repository.inspectRecovery(env.key);
    const index = copies.checkpoints.filter(point => point.usable).findIndex(point => point.revision === first.revision) + 1;
    fireEvent.click(await view.findByRole('button', { name: new RegExp(`^Restore saved copy ${index}`) }));
    await waitFor(() => expect(view.engines).toHaveLength(2)); await playable(view);
    expect((await env.repository.read(env.key)).snapshot.toString()).toBe('state-first');
    expect((await env.repository.readRecoveryRevision(env.key, second.revision)).snapshot.toString()).toBe('state-second');
    expect(Buffer.from((await journal.listArchived(env.key))[0].snapshot).toString()).toBe('state-current-paused');
  });
  it('transfers an owned guest capture into the claimed identity without reverting to startup or reclaiming it after reset', async () => {
    const view = setup({ props: { persistence: { saveMode: 'battery', persist: false, userId: null } } });
    await waitFor(() => expect(view.engines[0].boot).toHaveBeenCalled()); await act(async () => {}); view.advance('guest');
    const persistence = { userId: env.key.user, persist: true, saveMode: 'battery', intent: 'claim', claimId: randomUUID(), checkpoint: { key: env.key, client, journal, variant: 'wasm' } };
    view.rerenderProps({ persistence }); await waitFor(() => expect(view.engines).toHaveLength(2)); await playable(view);
    expect((await env.repository.read(env.key)).snapshot.toString()).toBe('state-guest');
    fireEvent.click(view.container.querySelector('[data-hotspot-id="power"]')); fireEvent.pointerDown(view.getByRole('button', { name: 'Start over' }));
    await waitFor(() => expect(view.engines).toHaveLength(3)); await playable(view);
    expect((await env.repository.read(env.key)).kind).toBe('reset');
    expect(view.engines.at(-1).restoreCheckpoint.mock.calls[0][0].kind).toBe('fresh');
  });
  it('starts fresh only after an explicit recovery reset is acknowledged and preserves the previous record', async () => {
    const previous = await seed('previous'); const view = setup({ rejectRestore: true });
    await view.findByText(/Could not restore saved progress/);
    fireEvent.click(view.getByRole('button', { name: 'Review recovery copies' }));
    fireEvent.click(await view.findByRole('button', { name: 'Start a fresh game' }));
    fireEvent.pointerDown(view.getByRole('button', { name: 'Start over' }));
    await waitFor(async () => expect((await env.repository.read(env.key)).kind).toBe('reset'));
    expect((await env.repository.readRecoveryRevision(env.key, previous.revision)).snapshot.toString()).toBe('state-previous');
  });
});

it('lets keyboard/controller intent select a recovery copy after the game menu closes', async () => {
  const first = await seed('first'); const view = setup(); await playable(view);
  fireEvent.click(view.getByRole('button', { name: 'Game menu' })); fireEvent.click(view.getByRole('button', { name: 'Recover progress' }));
  const restore = await view.findByRole('button', { name: /^Restore saved copy/ }); restore.focus();
  fireEvent.keyDown(window, { key: 'Enter' });
  await waitFor(() => expect(view.engines).toHaveLength(2)); await playable(view);
  expect((await env.repository.read(env.key)).restoredFrom).toBe(first.revision);
});
it('supports keyboard reset confirmation and submits only one reset for pointer-down plus click', async () => {
  const resetCheckpoint = vi.fn((...args) => client.resetCheckpoint(...args));
  const view = setup({ protectedClient: { ...client, resetCheckpoint } }); await playable(view);
  fireEvent.click(view.container.querySelector('[data-hotspot-id="power"]'));
  const start = view.getByRole('button', { name: 'Start over' }); start.focus(); fireEvent.keyDown(window, { key: 'Enter' });
  await waitFor(() => expect(view.engines).toHaveLength(2)); await playable(view); expect(resetCheckpoint).toHaveBeenCalledTimes(1);
  fireEvent.click(view.container.querySelector('[data-hotspot-id="power"]'));
  const next = view.getByRole('button', { name: 'Start over' });
  fireEvent.pointerDown(next); fireEvent.click(next); await waitFor(() => expect(view.engines).toHaveLength(3));
  expect(resetCheckpoint).toHaveBeenCalledTimes(2);
});
