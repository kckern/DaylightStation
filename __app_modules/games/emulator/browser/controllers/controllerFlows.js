// controllerFlows.js — the multi-step controller lifecycle, written against the
// useBluetoothManager api ({ command, waitFor, current }). Every step completes
// on OBSERVED bridge state, never on a 202.
//
//   fix     reconnect; if the pad will not answer, fall through to repair
//   repair  forget → pairing mode + search → pair → connect   (from scratch)
//   pair    pair → connect                                   (a pad found by a search)
//   connect connect
import { findDevice, repairCandidate } from './controllerModel.js';

export const STEP_LABEL = {
  connect: 'Reconnect',
  forget: 'Forget the old pairing',
  search: 'Put the controller in pairing mode',
  pair: 'Pair',
  link: 'Connect',
};

export function flowSteps(mode) {
  if (mode === 'fix') return ['connect', 'forget', 'search', 'pair', 'link'];
  if (mode === 'repair') return ['forget', 'search', 'pair', 'link'];
  if (mode === 'pair') return ['pair', 'link'];
  return ['link'];
}

export const SEARCH_MS = 120000;
const SCAN_MS = 30000;
const PAIR_MS = 60000;

export class FlowError extends Error {}

const isAbort = (error) => error?.name === 'AbortError';
const connected = (address) => (s) => findDevice(s, address)?.connected === true;

async function settle(api, signal, action, body, predicate, ms) {
  const after = await api.command(action, body);
  return api.waitFor(predicate, ms, { after, signal });
}

/** Try to bring a bonded pad's input link up; false if it never answers. */
async function link(api, signal, address, { attempts = 2, waitMs = 15000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    if (connected(address)(api.current())) return true;
    try {
      await settle(api, signal, 'connect', { address, profile: 'input' }, connected(address), waitMs);
      return true;
    } catch (error) {
      if (isAbort(error)) throw error;
    }
  }
  return false;
}

/**
 * Keep discovery running until the pad being paired appears. Android's own
 * inquiry stops after ~12 s, so the scan is re-issued whenever it lapses; each
 * new scan clears the bridge's list of unpaired devices, which is what makes a
 * match a fresh discovery rather than a leftover entry.
 */
async function search(api, signal, match, deadline) {
  while (Date.now() < deadline) {
    const after = await api.command('scan', { durationMs: SCAN_MS });
    try {
      const state = await api.waitFor(
        // Discovery reports as started a beat after the command; only a lapse
        // seen a few seconds in means Android's inquiry actually ended.
        (s) => Boolean(match(s)) || (!s.adapter.discovering && Date.now() - after > 4000),
        Math.min(SCAN_MS + 2000, deadline - Date.now()),
        { after, signal },
      );
      const found = match(state);
      if (found) return found;
    } catch (error) {
      if (isAbort(error)) throw error;
    }
  }
  throw new FlowError('The controller was not found. Make sure its light is blinking fast (pairing mode), then try again.');
}

async function pair(api, signal, address, prompts) {
  const after = await api.command('pair', { address });
  let answered = null;
  // createBond is asynchronous: a snapshot can still read 'none' just after
  // the 202, so 'none' is only a refusal once the bond was seen in progress.
  let started = false;
  const deadline = Date.now() + PAIR_MS;
  while (Date.now() < deadline) {
    const state = await api.waitFor((s) => {
      const d = findDevice(s, address);
      if (d?.bond === 'bonding') started = true;
      return d?.bond === 'bonded' || (started && d?.bond === 'none') || (s.pairing?.address === address && s.pairing.expiresAtMs !== answered);
    }, deadline - Date.now(), { after, signal });
    const device = findDevice(state, address);
    if (device?.bond === 'bonded') return;
    if (device?.bond === 'none' && !state.pairing) throw new FlowError('The controller refused the pairing. Put it back in pairing mode and try again.');
    const prompt = state.pairing;
    answered = prompt.expiresAtMs;
    if (prompt.variant === 'pin') {
      if (!state.capabilities?.pin) throw new FlowError('This controller asked for a PIN, which this TV cannot enter.');
      const pin = await prompts.pin(prompt);
      await api.command('pairing', { address, accept: Boolean(pin), ...(pin ? { pin } : {}) });
      if (!pin) throw new FlowError('Pairing cancelled.');
    } else if (!state.capabilities?.confirm) {
      await api.command('pairing', { address, accept: false }).catch(() => {});
      throw new FlowError('This controller asked Android to confirm a code, which the TV cannot answer from here. Turn it on in Android mode (see the steps) and try again.');
    } else {
      await api.command('pairing', { address, accept: true });
    }
  }
  throw new FlowError('Pairing did not finish in time. Put the controller back in pairing mode and try again.');
}

/**
 * Run a flow. `report(step, status, extra)` drives the on-screen checklist
 * (status: active | done | skipped | failed). Resolves with the address the pad
 * ended up on (a mode change can move it); rejects with FlowError for a
 * human-readable failure, or AbortError when cancelled.
 */
export async function runControllerFlow({ mode, device, api, signal, report, prompts }) {
  let address = device.address;
  const step = (id, status, extra) => report(id, status, extra);
  try {
    if (mode === 'connect') {
      step('link', 'active');
      if (!(await link(api, signal, address))) throw new FlowError('The controller did not connect. Press START to wake it, then try again — or choose Fix.');
      step('link', 'done');
      return address;
    }
    if (mode === 'fix') {
      step('connect', 'active');
      if (await link(api, signal, address, { attempts: 1, waitMs: 12000 })) {
        step('connect', 'done');
        for (const id of ['forget', 'search', 'pair', 'link']) step(id, 'skipped');
        return address;
      }
      step('connect', 'failed', { soft: true });
    }
    if (mode === 'fix' || mode === 'repair') {
      step('forget', 'active');
      if (findDevice(api.current(), address)?.bond === 'bonded') {
        await api.command('scan/stop').catch(() => {});
        await settle(api, signal, 'unpair', { address }, (s) => { const d = findDevice(s, address); return !d || d.bond === 'none'; }, 15000)
          .catch((error) => { if (isAbort(error)) throw error; throw new FlowError('Android did not forget the controller. Try again.'); });
      }
      step('forget', 'done');
      const endsAt = Date.now() + SEARCH_MS;
      step('search', 'active', { endsAt });
      const found = await search(api, signal, (s) => repairCandidate(s, { address, name: device.name }), endsAt);
      address = found.address;
      step('search', 'done');
    }
    step('pair', 'active');
    await pair(api, signal, address, prompts);
    step('pair', 'done');
    step('link', 'active');
    // A freshly bonded pad usually opens its own input link; give it a moment first.
    try { await api.waitFor(connected(address), 8000, { signal }); } catch (error) { if (isAbort(error)) throw error; }
    if (!(await link(api, signal, address))) throw new FlowError('Paired, but the controller did not connect. Press START to wake it, then choose Connect.');
    step('link', 'done');
    return address;
  } catch (error) {
    if (signal?.aborted || isAbort(error)) {
      await api.command('scan/stop').catch(() => {});
      throw Object.assign(new Error('Stopped'), { name: 'AbortError' });
    }
    if (error instanceof FlowError) throw error;
    throw new FlowError(error?.message ? `${error.message} Try again.` : 'Something went wrong. Try again.');
  }
}
