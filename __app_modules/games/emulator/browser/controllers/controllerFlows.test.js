import { it, expect, vi, afterEach, beforeEach } from 'vitest';
import { runControllerFlow, FlowError } from './controllerFlows.js';

const PAD = 'E4:17:D8:1C:7C:7A';

/**
 * A fake audio bridge with Android's timing quirks: createBond and discovery
 * report a beat late, inquiry lapses after 12 s, a fresh bond opens its own
 * input link, and a new scan clears unpaired entries.
 */
function fakeBridge({ inPairingModeAfterMs = 0, pinPrompt = false, confirmPrompt = false, wakes = true, rejectConnect = false, rejectFirstScans = 0, pairIgnored = false, staleBonding = false } = {}) {
  const pad = { address: PAD, name: '8Bitdo SN30 Pro', manageable: true, bond: 'bonded', connected: false, profiles: [] };
  const state = { ok: true, adapter: { supported: true, enabled: true, discovering: false }, devices: [pad, { address: '3C:6D:66:06:E4:B5', name: 'Remote', manageable: false, bond: 'bonded', connected: true }], pairing: null, capabilities: { scan: true, pair: true, unpair: true, input: true, pin: true, confirm: false } };
  const t0 = Date.now();
  const log = [];
  const later = (ms, fn) => setTimeout(fn, ms);
  const bridge = {
    state, log,
    command: vi.fn(async (action, body) => {
      log.push(action);
      if (action === 'connect' && rejectConnect) { state.lastError = 'Controller connection service is starting; try again'; throw new Error('Bluetooth did not accept the action.'); }
      if (action === 'scan' && rejectFirstScans > 0) { rejectFirstScans -= 1; throw new Error('Bluetooth did not accept the action.'); }
      if (action === 'pair' && state.devices[0].bond === 'bonding') throw new Error('Bluetooth did not accept the action.');
      if (action === 'pair' && pairIgnored) return Date.now();
      if (action === 'connect') { if (pad.bond === 'bonded' && wakes) later(1500, () => { pad.connected = true; pad.profiles = ['input']; }); }
      if (action === 'unpair') later(800, () => { pad.bond = 'none'; pad.connected = false; });
      if (action === 'scan') {
        state.devices = state.devices.filter((d) => d.bond !== 'none');
        later(500, () => { state.adapter.discovering = true; });
        later(12000, () => { state.adapter.discovering = false; });
        const appearIn = Math.max(2000, inPairingModeAfterMs - (Date.now() - t0));
        later(appearIn, () => { if (state.adapter.discovering && !state.devices.includes(pad)) state.devices.push(pad); });
      }
      if (action === 'scan/stop') state.adapter.discovering = false;
      if (action === 'pair') {
        expect(body.address).toBe(PAD);
        later(700, () => {
          pad.bond = 'bonding';
          if (pinPrompt || confirmPrompt) state.pairing = { address: PAD, variant: pinPrompt ? 'pin' : 'confirm', expiresAtMs: Date.now() + 60000 };
          else later(1500, () => { pad.bond = 'bonded'; later(2000, () => { pad.connected = true; pad.profiles = ['input']; }); });
        });
      }
      if (action === 'pairing') {
        state.pairing = null;
        if (body.accept) later(1000, () => { pad.bond = 'bonded'; later(2000, () => { pad.connected = true; pad.profiles = ['input']; }); });
        else later(500, () => { pad.bond = 'none'; });
      }
      return Date.now();
    }),
  };
  // The hook's contract: waitFor sees snapshots read after `after`, polled each second.
  bridge.api = {
    current: () => structuredClone(state),
    command: bridge.command,
    waitFor: (predicate, ms, { after = 0, signal } = {}) => new Promise((resolve, reject) => {
      const end = Date.now() + ms;
      const tick = () => {
        if (signal?.aborted) return reject(Object.assign(new Error('Stopped'), { name: 'AbortError' }));
        const readAt = Date.now();
        const snap = structuredClone(state);
        if (readAt >= after && predicate(snap)) return resolve(snap);
        if (Date.now() >= end) return reject(Object.assign(new Error('Timed out'), { name: 'TimeoutError' }));
        setTimeout(tick, 1000);
      };
      setTimeout(tick, 0);
    }),
  };
  if (staleBonding) { pad.bond = 'bonding'; setTimeout(() => { pad.bond = 'none'; }, 40000); }
  return bridge;
}

const run = async (bridge, mode, extra = {}) => {
  const steps = [];
  const report = (id, status) => steps.push(`${id}:${status}`);
  const promise = runControllerFlow({ mode, device: bridge.state.devices[0], api: bridge.api, report, prompts: { pin: async () => '0000' }, ...extra });
  const settled = promise.then((v) => ({ value: v }), (e) => ({ error: e }));
  await vi.advanceTimersByTimeAsync(200000);
  return { ...(await settled), steps };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('re-pairs a bonded pad from scratch: forget → find → pair → connect', async () => {
  const bridge = fakeBridge({ inPairingModeAfterMs: 20000 });
  const { value, error, steps } = await run(bridge, 'repair');
  expect(error).toBeUndefined();
  expect(value).toBe(PAD);
  expect(bridge.log.filter((a) => a !== 'scan')).toEqual(['scan/stop', 'unpair', 'pair']);
  expect(bridge.log.filter((a) => a === 'scan').length).toBeGreaterThan(1); // inquiry lapsed at 12 s and was re-issued
  expect(steps.filter((s, i) => s !== steps[i - 1])).toEqual(['forget:active', 'forget:done', 'search:active', 'search:done', 'pair:active', 'pair:done', 'link:active', 'link:done']);
  expect(bridge.state.devices[0]).toMatchObject({ bond: 'bonded', connected: true });
});

it('fix reconnects a sleeping pad without touching its pairing', async () => {
  const bridge = fakeBridge();
  const { value, steps } = await run(bridge, 'fix');
  expect(value).toBe(PAD);
  expect(bridge.log).toEqual(['connect']);
  expect(steps).toContain('forget:skipped');
});

it('fix falls through to a full re-pair when the pad never answers', async () => {
  const bridge = fakeBridge({ wakes: false, inPairingModeAfterMs: 5000 });
  // A pad that will not connect on its old bond comes back fine on a new one.
  const { value, steps } = await run(bridge, 'fix');
  expect(steps.slice(0, 2)).toEqual(['connect:active', 'connect:failed']);
  expect(bridge.log).toContain('unpair');
  expect(bridge.log).toContain('pair');
  expect(steps.at(-1)).toBe('link:done');
  expect(value).toBe(PAD);
});

it('answers a legacy PIN prompt and finishes the bond', async () => {
  const bridge = fakeBridge({ pinPrompt: true });
  const { value } = await run(bridge, 'repair');
  expect(value).toBe(PAD);
  expect(bridge.command).toHaveBeenCalledWith('pairing', { address: PAD, accept: true, pin: '0000' });
});

it('fails fast with an explanation when Android wants a confirmation the TV cannot give', async () => {
  const bridge = fakeBridge({ confirmPrompt: true });
  const { error } = await run(bridge, 'repair');
  expect(error).toBeInstanceOf(FlowError);
  expect(error.message).toMatch(/cannot answer/);
  expect(bridge.command).toHaveBeenCalledWith('pairing', { address: PAD, accept: false });
});

it('gives up searching with instructions when the pad never enters pairing mode', async () => {
  const bridge = fakeBridge({ inPairingModeAfterMs: 10 ** 9 });
  const { error } = await run(bridge, 'repair');
  expect(error).toBeInstanceOf(FlowError);
  expect(error.message).toMatch(/blinking fast/);
});

it('cancel stops discovery and rejects as an abort', async () => {
  const bridge = fakeBridge({ inPairingModeAfterMs: 10 ** 9 });
  const abort = new AbortController();
  setTimeout(() => abort.abort(), 5000);
  const { error } = await run(bridge, 'repair', { signal: abort.signal });
  expect(error.name).toBe('AbortError');
  expect(bridge.log.at(-1)).toBe('scan/stop');
});

it('fix never forgets a pad when the TV itself refuses to connect', async () => {
  const bridge = fakeBridge({ rejectConnect: true });
  const { error, steps } = await run(bridge, 'fix');
  expect(error).toBeInstanceOf(FlowError);
  expect(error.message).toMatch(/would not start the connection.*service is starting/);
  expect(bridge.log).not.toContain('unpair');
  expect(bridge.log.filter((a) => a === 'connect')).toHaveLength(3);
  expect(steps).not.toContain('forget:active');
});

it('a refused scan is retried, not the end of the search', async () => {
  const bridge = fakeBridge({ rejectFirstScans: 2, inPairingModeAfterMs: 6000 });
  const { value, error } = await run(bridge, 'repair');
  expect(error).toBeUndefined();
  expect(value).toBe(PAD);
});

it('a pad that stopped listening fails pairing in seconds, not after the 60 s window', async () => {
  const bridge = fakeBridge({ pairIgnored: true });
  const started = Date.now();
  let failedAt;
  const promise = runControllerFlow({ mode: 'pair', device: { ...bridge.state.devices[0], bond: 'none' }, api: bridge.api, report: () => {}, prompts: {} })
    .catch((e) => { failedAt = Date.now(); return e; });
  bridge.state.devices[0].bond = 'none';
  await vi.advanceTimersByTimeAsync(70000);
  const error = await promise;
  expect(error.message).toMatch(/did not accept the pairing/);
  expect(failedAt - started).toBeLessThan(15000);
});

it('re-pair waits out a pairing left running by a cancelled attempt', async () => {
  const bridge = fakeBridge({ staleBonding: true, inPairingModeAfterMs: 45000 });
  const { value, error } = await run(bridge, 'repair');
  expect(error).toBeUndefined();
  expect(value).toBe(PAD);
  expect(bridge.log).not.toContain('unpair'); // it ended unbonded on its own
});
