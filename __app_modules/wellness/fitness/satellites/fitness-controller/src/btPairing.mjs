/**
 * btPairing — controller pairing + forget, driven from the bus.
 *
 * PAIR: the frontend publishes `bt.pair.request` { requestId, durationMs,
 * targets } (relayed by the backend). `targets` come from the household
 * controller config (media/emulation/input.yml `controllers[].pairing`): name
 * regex, MAC prefix and legacy PIN per controller. This box spawns
 * `bt_pair_helper.py`, which owns the whole lifecycle over BlueZ D-Bus —
 * BR/EDR discovery, a PIN-answering default agent, Pair while discovering,
 * automatic remove-and-retry once, Trusted, Paired+Bonded check, Connect, and
 * waiting for the kernel INPUT DEVICE (disconnect/reconnect once). Each line
 * the helper prints is one transition, relayed as `bt.pair.progress`:
 *
 *   scanning → seen → found → [stale-bond-removed] → pairing → [retry]
 *            → bonded → connecting → hid-wait → [hid-retry] → paired → done
 *
 * The window always ends with exactly one `done`, even if the helper crashes,
 * and only one window runs at a time. `onWindow(open)` lets the server pause
 * the inventory poll + reconnect loop while a window is open, so no other
 * bluetoothctl client races the pairing.
 *
 * FORGET: `bt.remove` → `bluetoothctl remove <mac>`, result on `bt.remove.result`.
 *
 * Every shell-out is injected (`spawnHelper`, `exec`) so the window is tested
 * with no hardware.
 */

import { exec as nodeExec, spawn as nodeSpawn } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { parseConnectedDevices } from "./btInventory.mjs";

const defaultExec = promisify(nodeExec);

const HELPER_PATH = fileURLToPath(new URL("./bt_pair_helper.py", import.meta.url));

const GAMEPAD_NAME_RE = /8bitdo|xbox|dualshock|dualsense|pro controller|gamepad|controller|joy-?con/i;

/**
 * Decide whether a `bluetoothctl info <mac>` blob describes a game controller.
 * True when ANY of:
 *   - `Icon: input-gaming`
 *   - a `Class:` whose major device class is Peripheral (0x05) AND the
 *     peripheral minor indicates a gamepad/joystick
 *   - the name matches the gamepad name regex
 *
 * @param {string} infoOutput
 * @returns {boolean}
 */
export function isLikelyGamepad(infoOutput) {
  if (!infoOutput || typeof infoOutput !== 'string') return false;

  if (/^\s*Icon:\s*input-gaming\s*$/im.test(infoOutput)) return true;

  const nameMatch = infoOutput.match(/^\s*Name:\s*(.+?)\s*$/im);
  if (nameMatch && GAMEPAD_NAME_RE.test(nameMatch[1])) return true;

  const classMatch = infoOutput.match(/^\s*Class:\s*0x([0-9a-f]+)/im);
  if (classMatch) {
    const cls = parseInt(classMatch[1], 16);
    if (Number.isFinite(cls)) {
      // Major device class = bits 8..12. Peripheral = 0x05.
      const major = (cls >> 8) & 0x1f;
      // Peripheral minor = bits 2..7. Bits 6..7 are the major-minor category:
      // 0b01 = keyboard, 0b10 = pointing, and the minor sub-field (bits 2..5)
      // encodes joystick (0x01), gamepad (0x02), remote (0x03)...
      const minor = (cls >> 2) & 0x3f;
      const sub = minor & 0x0f;
      if (major === 0x05 && (sub === 0x01 || sub === 0x02)) return true;
    }
  }

  return false;
}

/**
 * Parse `bluetoothctl devices` output → [{address,name}]. Reuses the
 * `Device <MAC> <Name>` line parser from btInventory (identical line shape).
 *
 * @param {string} devicesOutput
 * @returns {Array<{ address: string, name: string }>}
 */
export function parseDiscovered(devicesOutput) {
  return parseConnectedDevices(devicesOutput);
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
 * @returns {Promise<Array<{address,name}>>} the devices that paired.
 */
export function runPairingWindow({
  spawnHelper = defaultSpawnHelper,
  durationMs = 60000,
  targets = [],
  send,
  logger = console,
  requestId,
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
      child = spawnHelper(JSON.stringify({ targets: sanitizeTargets(targets), durationMs }));
    } catch (err) {
      progress({ phase: 'scanning', durationMs });
      progress({ phase: 'error', message: `pairing helper failed to start: ${err?.message}` });
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
      progress({ phase: 'error', message: `pairing helper failed: ${err?.message}` });
      finish({ reason: 'helper-failed' });
    });
    child.on?.('close', (code) => {
      if (!doneSent) {
        progress({ phase: 'error', message: `pairing helper exited (code ${code}) without finishing` });
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
 * @param {object} deps                    { spawnHelper, send, logger, onWindow }.
 * @returns {Promise<Array>}               the paired devices.
 */
export async function handleBtPairRequest(message, { spawnHelper, send, logger = console, onWindow } = {}) {
  const requestId = message?.requestId;
  const durationMs = Math.min(Math.max(Number(message?.durationMs) || 60000, 5000), 180000);
  const targets = Array.isArray(message?.targets) ? message.targets : [];
  if (activeWindow) {
    logger?.warn?.(`⚠️  bt.pair.request ${requestId} ignored — window ${activeWindow} already open`);
    return [];
  }
  logger?.info?.(`🎮 bt.pair.request received (requestId=${requestId}, durationMs=${durationMs}, targets=${targets.length})`);
  activeWindow = requestId ?? 'anonymous';
  try { onWindow?.(true); } catch { /* pausing is best-effort */ }
  try {
    return await runPairingWindow({ spawnHelper, durationMs, targets, send, logger, requestId });
  } finally {
    activeWindow = null;
    try { onWindow?.(false); } catch { /* best-effort */ }
  }
}

const MAC_RE = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

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
  try {
    await exec(`bluetoothctl --agent off remove ${address}`);
    logger?.info?.(`🎮 bt.remove removed ${address}`);
    reply({ success: true });
  } catch (err) {
    logger?.warn?.(`⚠️  bt.remove failed for ${address}: ${err?.message}`);
    reply({ success: false, error: err?.message || String(err) });
  }
}
