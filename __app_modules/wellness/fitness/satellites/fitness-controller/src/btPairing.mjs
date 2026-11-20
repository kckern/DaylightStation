/**
 * btPairing — Bluetooth pairing + forget, driven from the bus.
 *
 * PAIR: the frontend publishes `bt.pair.request` { requestId, durationMs, mode,
 * targets, address } (relayed by the backend). This box spawns
 * `bt_pair_helper.py`, which owns the whole lifecycle over BlueZ D-Bus. Two
 * modes:
 *
 *   repair   (no `mode`, the default; `POST /api/v1/emulator/bt/pair` sends
 *            none) re-pair a configured pad. `targets` come from the household
 *            controller config (media/emulation/input.yml
 *            `controllers[].pairing`): name regex, MAC prefix and legacy PIN.
 *            BR/EDR discovery.
 *   address  pair exactly one address the person picked from the Bluetooth
 *            screen's nearby list. `targets` is reduced to one
 *            { id, label, address, pin? } (the configured controller the
 *            screen matched, if any). BR/EDR + LE discovery; an old bond is
 *            tried before it is replaced.
 *
 * The blind `add` mode (pair the first input-looking device) was retired
 * 2026-11-20: it, and any unknown mode, is refused with
 * `done { reason: 'unsupported-mode' }`; a malformed address with
 * `done { reason: 'invalid-address' }`. Neither spawns the helper.
 *
 * The helper does discovery, a PIN-answering default agent (which also
 * reports a passkey or PIN the person must type on the device), Pair while
 * discovering, automatic remove-and-retry once, Trusted, Paired+Bonded check,
 * Connect, and waiting for the kernel INPUT DEVICE (disconnect/reconnect
 * once). Each line it prints is one transition, relayed as `bt.pair.progress`:
 *
 *   scanning → seen → found → [stale-bond-removed] → pairing → [passkey|pincode]
 *            → [retry] → bonded → connecting → hid-wait → [hid-retry] → paired → done
 *
 * `error` carries a short `code` (auth-failed, auth-canceled, timeout,
 * unreachable, already-paired, busy, no-input, unknown) next to the raw
 * `message`, which is for logs only.
 *
 * The window always ends with exactly one `done`, even if the helper crashes,
 * and only one window runs at a time. A running nearby search is stopped
 * first (`stopScan`), and `onWindow(open)` lets the server pause the
 * inventory poll + reconnect loop while a window is open, so no other
 * bluetoothctl client races the pairing.
 *
 * FORGET: `bt.remove` → `bluetoothctl remove <mac>`, result on
 * `bt.remove.result`; a failure reports `error: 'remove-failed'` (the raw
 * text stays in this box's log).
 *
 * Every shell-out is injected (`spawnHelper`, `exec`) so the window is tested
 * with no hardware.
 */

import { exec as nodeExec, spawn as nodeSpawn } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const defaultExec = promisify(nodeExec);

const HELPER_PATH = fileURLToPath(new URL("./bt_pair_helper.py", import.meta.url));

const MAC_RE = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

const PAIR_MODES = new Set(['repair', 'address']);

/**
 * The one helper target for an address request: the picked address plus the
 * configured controller's id, label and PIN when the screen matched one.
 */
export function addressTarget(message) {
  const t = Array.isArray(message?.targets) && message.targets[0] && typeof message.targets[0] === 'object'
    ? message.targets[0] : {};
  const out = {
    id: t.id != null ? String(t.id) : null,
    label: t.label != null ? String(t.label) : null,
    address: String(message?.address || '').toUpperCase(),
  };
  if (t.pin != null && /^[0-9A-Za-z]{1,16}$/.test(String(t.pin))) out.pin = String(t.pin);
  return out;
}

/**
 * Keep only well-formed targets, so nothing odd reaches the helper's argv.
 *
 * @param {Array<object>} targets
 * @returns {Array<{ id: string|null, label: string|null, name?: string, macPrefix?: string, pin?: string }>}
 */
export function sanitizeTargets(targets) {
  if (!Array.isArray(targets)) return [];
  const out = [];
  for (const t of targets) {
    if (!t || typeof t !== 'object') continue;
    const clean = { id: t.id != null ? String(t.id) : null, label: t.label != null ? String(t.label) : null };
    if (typeof t.name === 'string' && t.name) {
      try { new RegExp(t.name, 'i'); clean.name = t.name; } catch { /* drop a bad regex */ }
    }
    if (typeof t.macPrefix === 'string' && /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){0,5}$/.test(t.macPrefix)) {
      clean.macPrefix = t.macPrefix.toUpperCase();
    }
    if (t.pin != null && /^[0-9A-Za-z]{1,16}$/.test(String(t.pin))) clean.pin = String(t.pin);
    if (clean.name || clean.macPrefix) out.push(clean);
  }
  return out;
}

/**
 * Parse one helper stdout line. Non-JSON lines → null.
 * @param {string} line
 * @returns {object|null}
 */
export function parseHelperLine(line) {
  const s = String(line || '').trim();
  if (!s.startsWith('{')) return null;
  try {
    const v = JSON.parse(s);
    return v && typeof v.phase === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** Default helper spawner: `python3 bt_pair_helper.py '<json>'`. */
function defaultSpawnHelper(argJson) {
  return nodeSpawn('python3', [HELPER_PATH, argJson], { stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Run a single pairing window.
 *
 * @param {object}   opts
 * @param {Function} [opts.spawnHelper]  (argJson) => ChildProcess-like (stdout/stderr emitters, 'close').
 * @param {number}   [opts.durationMs]   how long to wait for a pad to appear.
 * @param {Array}    [opts.targets]      controller targets from the request.
 * @param {Function} opts.send           (topic, payload) => void — emits bt.pair.progress.
 * @param {object}   [opts.logger]       console-like.
 * @param {string}   [opts.requestId]    correlation id echoed into every progress event.
 * @param {'repair'|'address'} [opts.mode]  repair a configured pad (default) or pair one picked address.
 * @returns {Promise<Array<{address,name}>>} the devices that paired.
 */
export function runPairingWindow({
  spawnHelper = defaultSpawnHelper,
  durationMs = 60000,
  targets = [],
  send,
  logger = console,
  requestId,
  mode = 'repair',
} = {}) {
  const progress = (extra) => {
    try {
      send?.('bt.pair.progress', requestId === undefined ? extra : { requestId, ...extra });
    } catch (err) {
      logger?.error?.(`❌ bt.pair.progress send failed: ${err?.message}`);
    }
  };

  return new Promise((resolve) => {
    let paired = [];
    let doneSent = false;
    let sawScanning = false;
    const finish = (extra) => {
      if (doneSent) return;
      doneSent = true;
      progress({ phase: 'done', paired, ...extra });
      resolve(paired);
    };

    let child;
    try {
      const helperMode = PAIR_MODES.has(mode) ? mode : 'repair';
      const helperTargets = helperMode === 'address' ? targets : sanitizeTargets(targets);
      child = spawnHelper(JSON.stringify({ targets: helperTargets, durationMs, mode: helperMode }));
    } catch (err) {
      progress({ phase: 'scanning', durationMs });
      progress({ phase: 'error', code: 'unknown', message: `pairing helper failed to start: ${err?.message}` });
      logger?.error?.(`❌ bt.pair helper failed to start: ${err?.message}`);
      finish({ reason: 'helper-failed' });
      return;
    }

    let buf = '';
    child.stdout?.on('data', (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        const ev = parseHelperLine(line);
        if (!ev) continue;
        if (ev.phase === 'scanning') sawScanning = true;
        if (ev.phase === 'done') {
          if (Array.isArray(ev.paired)) paired = ev.paired;
          const { phase: _p, paired: _pd, ...rest } = ev;
          finish(rest);
          continue;
        }
        if (ev.phase === 'paired' && ev.device) paired = [ev.device];
        logger?.info?.(`🎮 bt.pair ${ev.phase}${ev.device ? ` ${ev.device.address} (${ev.device.name})` : ''}${ev.message ? ` — ${ev.message}` : ''}`);
        progress(ev);
      }
    });
    child.stderr?.on('data', (chunk) => {
      const s = chunk.toString().trim();
      if (s) logger?.warn?.(`⚠️  bt.pair helper stderr: ${s.slice(0, 500)}`);
    });
    child.on?.('error', (err) => {
      if (!sawScanning) progress({ phase: 'scanning', durationMs });
      progress({ phase: 'error', code: 'unknown', message: `pairing helper failed: ${err?.message}` });
      finish({ reason: 'helper-failed' });
    });
    child.on?.('close', (code) => {
      if (!doneSent) {
        progress({ phase: 'error', code: 'unknown', message: `pairing helper exited (code ${code}) without finishing` });
        finish({ reason: 'helper-crashed' });
      }
    });
  });
}

let activeWindow = null;

/** True while a pairing window is open. */
export function isPairingWindowOpen() {
  return activeWindow !== null;
}

/**
 * Bus entry point the server calls when it receives a `bt.pair.request` topic.
 * A request that arrives while a window is open is ignored — the open window's
 * progress already drives the UI.
 *
 * @param {object} message                 the parsed bus message.
 * @param {object} deps                    { spawnHelper, send, logger, onWindow, stopScan }.
 * @returns {Promise<Array>}               the paired devices.
 */
export async function handleBtPairRequest(message, { spawnHelper, send, logger = console, onWindow, stopScan } = {}) {
  const requestId = message?.requestId;
  const durationMs = Math.min(Math.max(Number(message?.durationMs) || 60000, 5000), 180000);
  const mode = message?.mode == null ? 'repair' : message.mode;
  const refuse = (reason) => {
    try { send?.('bt.pair.progress', { requestId, phase: 'done', paired: [], reason }); }
    catch (err) { logger?.error?.(`❌ bt.pair.progress send failed: ${err?.message}`); }
    return [];
  };
  if (!PAIR_MODES.has(mode)) {
    logger?.warn?.(`⚠️  bt.pair.request ${requestId} refused — unsupported mode ${String(mode).slice(0, 20)}`);
    return refuse('unsupported-mode');
  }
  let targets = Array.isArray(message?.targets) ? message.targets : [];
  if (mode === 'address') {
    if (!MAC_RE.test(String(message?.address || ''))) {
      logger?.warn?.(`⚠️  bt.pair.request ${requestId} refused — malformed address`);
      return refuse('invalid-address');
    }
    targets = [addressTarget(message)];
  }
  if (activeWindow) {
    logger?.warn?.(`⚠️  bt.pair.request ${requestId} ignored — window ${activeWindow} already open`);
    return [];
  }
  logger?.info?.(`🎮 bt.pair.request received (requestId=${requestId}, durationMs=${durationMs}, targets=${targets.length}, mode=${mode}${mode === 'address' ? `, address=${targets[0].address}` : ''})`);
  activeWindow = requestId ?? 'anonymous';
  try { await stopScan?.(); } catch { /* a search that will not stop must not block pairing */ }
  try { onWindow?.(true); } catch { /* pausing is best-effort */ }
  try {
    return await runPairingWindow({ spawnHelper, durationMs, targets, send, logger, requestId, mode });
  } finally {
    activeWindow = null;
    try { onWindow?.(false); } catch { /* best-effort */ }
  }
}

/**
 * Forget/unpair a controller: `bluetoothctl remove <mac>`. Validates the MAC
 * (it is interpolated into a shell command) and never throws — the result is
 * reported via the `bt.remove.result` bus topic.
 *
 * @param {object} message  parsed bus message ({ requestId, address }).
 * @param {object} deps     { exec, send, logger }.
 */
export async function handleBtRemoveRequest(message, { exec = defaultExec, send, logger = console } = {}) {
  const requestId = message?.requestId;
  const address = String(message?.address || '');
  const reply = (extra) => {
    try { send?.('bt.remove.result', { requestId, address, ...extra }); }
    catch (e) { logger?.error?.(`❌ bt.remove.result send failed: ${e?.message}`); }
  };
  if (!MAC_RE.test(address)) {
    logger?.warn?.(`⚠️  bt.remove rejected malformed address: ${address}`);
    reply({ success: false, error: 'invalid-address' });
    return;
  }
  // A remove mid-window would pull a bond out from under the pairing helper
  // (or delete the bond it is making). The panel disables Forget while a
  // window runs; this covers a stale panel or another client.
  if (isPairingWindowOpen()) {
    logger?.warn?.(`⚠️  bt.remove refused for ${address}: pairing window open (requestId=${requestId})`);
    reply({ success: false, error: 'pairing-in-progress' });
    return;
  }
  try {
    await exec(`bluetoothctl --agent off remove ${address}`);
    logger?.info?.(`🎮 bt.remove removed ${address}`);
    reply({ success: true });
  } catch (err) {
    logger?.warn?.(`⚠️  bt.remove failed for ${address}: ${err?.message}`);
    reply({ success: false, error: 'remove-failed' });
  }
}
