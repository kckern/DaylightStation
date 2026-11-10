/**
 * btInventory — OS-level Bluetooth device inventory via `bluetoothctl`.
 *
 * This is identity/inventory ONLY: it reports which BT devices BlueZ has
 * bonded (address/name/connected/battery) so the frontend can show OS-level
 * truth alongside the browser's Gamepad-API slots. It does NOT touch input.
 *
 * The poll shells out to `bluetoothctl`:
 *   - `bluetoothctl devices Paired`  → every bonded device (connected or not),
 *     so a pad that is paired but switched off still reports `connected:false`
 *     and an unpaired one is absent — the UI offers "Forget" only for bonds that exist
 *   - `bluetoothctl info <MAC>`         → per-device connected + battery
 *
 * All `exec` calls are dependency-injected so the parsers + poll can be unit
 * tested against canned output with no hardware.
 */

import { exec as nodeExec } from 'child_process';
import { promisify } from 'util';

const defaultExec = promisify(nodeExec);

const MAC_RE = /^([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})$/;

/**
 * Parse `bluetoothctl devices Paired` output.
 * Lines look like: `Device AA:BB:CC:DD:EE:FF Some Name`.
 * Blank / malformed lines are skipped. A device with no name → name ''.
 *
 * @param {string} devicesOutput
 * @returns {Array<{ address: string, name: string }>}
 */
export function parseConnectedDevices(devicesOutput) {
  if (!devicesOutput || typeof devicesOutput !== 'string') return [];
  const out = [];
  for (const raw of devicesOutput.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('Device ')) continue;
    const rest = line.slice('Device '.length).trim();
    const sp = rest.indexOf(' ');
    const address = sp === -1 ? rest : rest.slice(0, sp);
    if (!MAC_RE.test(address)) continue;
    const name = sp === -1 ? '' : rest.slice(sp + 1).trim();
    out.push({ address, name });
  }
  return out;
}

/**
 * Parse `bluetoothctl info <MAC>` output for connection + battery.
 *   `Connected: yes` / `Connected: no`
 *   `Battery Percentage: 0x4b (75)`  → 75   (line may be absent → null)
 *
 * @param {string} infoOutput
 * @returns {{ connected: boolean, battery: number|null }}
 */
export function parseBattery(infoOutput) {
  if (!infoOutput || typeof infoOutput !== 'string') {
    return { connected: false, battery: null };
  }
  const connMatch = infoOutput.match(/^\s*Connected:\s*(yes|no)\s*$/im);
  const connected = connMatch ? connMatch[1].toLowerCase() === 'yes' : false;

  // Prefer the decimal in parentheses; fall back to the 0x hex value.
  const battMatch = infoOutput.match(/Battery Percentage:\s*(?:0x[0-9a-f]+\s*)?\((\d+)\)/i)
    || infoOutput.match(/Battery Percentage:\s*0x([0-9a-f]+)/i);
  let battery = null;
  if (battMatch) {
    battery = battMatch[0].includes('(')
      ? Number(battMatch[1])
      : parseInt(battMatch[1], 16);
    if (!Number.isFinite(battery)) battery = null;
  }
  return { connected, battery };
}


/** `Trusted: yes` in a `bluetoothctl info` blob. */
export function parseTrusted(infoOutput) {
  return /^\s*Trusted:\s*yes\s*$/im.test(String(infoOutput || ''));
}

/** `Icon: input-gaming` in a `bluetoothctl info` blob. */
export function parseIsGamepad(infoOutput) {
  return /^\s*Icon:\s*input-gaming\s*$/im.test(String(infoOutput || ''));
}

/** True when the kernel input table (/proc/bus/input/devices) lists this MAC. */
export function hasInputDevice(inputDevicesText, mac) {
  const want = String(mac || '').toLowerCase();
  if (!want) return false;
  return String(inputDevicesText || '').toLowerCase().split('\n')
    .some((l) => /^u:\s*uniq=/.test(l) && l.replace(/^u:\s*uniq=/, '').trim() === want);
}

async function defaultReadInputDevices() {
  const { readFile } = await import('fs/promises');
  return readFile('/proc/bus/input/devices', 'utf8');
}

/**
 * Poll BlueZ for every BONDED device. Each shell-out is wrapped so one failure
 * can't sink the whole poll; if the `devices Paired` call itself fails (e.g.
 * bluetoothctl unavailable) → [].
 *
 * `--agent off` keeps these one-shot clients from registering an agent of
 * their own, so they can never steal the pairing helper's PIN agent.
 *
 * @param {object} [opts]
 * @param {Function} [opts.exec] - injected promisified exec ({stdout,stderr}).
 * @param {Function} [opts.readInputDevices] - async () => /proc/bus/input/devices text.
 * @returns {Promise<Array<{ address, name, connected, battery, paired, trusted, gamepad, input }>>}
 *   Bonded devices (paired:true) plus any device connected right now WITHOUT a
 *   bond (paired:false — a pad dialing in on a bond this host dropped).
 */
export async function pollBtInventory({ exec = defaultExec, readInputDevices = defaultReadInputDevices } = {}) {
  let listOut;
  try {
    ({ stdout: listOut } = await exec('bluetoothctl --agent off devices Paired'));
  } catch {
    return [];
  }

  let inputTable = '';
  try { inputTable = await readInputDevices(); } catch { inputTable = ''; }

  const devices = parseConnectedDevices(listOut).map((d) => ({ ...d, paired: true }));
  // A pad that still remembers a bond this host has dropped keeps dialing in:
  // it shows up Connected but NOT paired, and the kernel rejects its HID
  // channel ("Rejected connection from !bonded device"). Report it as
  // paired:false so the UI can say "trying to connect — needs pairing".
  try {
    const { stdout } = await exec('bluetoothctl --agent off devices Connected');
    const known = new Set(devices.map((d) => d.address.toUpperCase()));
    for (const d of parseConnectedDevices(stdout)) {
      if (!known.has(d.address.toUpperCase())) devices.push({ ...d, paired: false });
    }
  } catch { /* the paired list alone is still a valid inventory */ }

  const results = [];
  for (const dev of devices) {
    let info = '';
    try {
      ({ stdout: info } = await exec(`bluetoothctl --agent off info ${dev.address}`));
    } catch {
      // Device may have vanished between list + info; report it as not
      // connected rather than dropping the whole poll.
      info = '';
    }
    const { connected, battery } = parseBattery(info);
    results.push({
      address: dev.address,
      name: dev.name,
      connected,
      battery,
      paired: dev.paired,
      trusted: parseTrusted(info),
      gamepad: parseIsGamepad(info),
      input: hasInputDevice(inputTable, dev.address),
    });
  }
  return results;
}

/**
 * Reconnect backoff for a trusted controller that is not connected. A pad that
 * is asleep (8BitDo: 1 min unconnected, 15 min idle) cannot be paged and
 * reconnects itself when START wakes it, so attempts back off fast and cap at
 * `maxMs` — a sleeping pad costs one ~5s page per cap interval, not one a minute.
 */
export function nextReconnectDelay(previousMs, { baseMs = 30000, maxMs = 600000 } = {}) {
  if (!previousMs) return baseMs;
  return Math.min(previousMs * 2, maxMs);
}

/**
 * Start an interval that polls the BT inventory and broadcasts it via `send`.
 * Skips the broadcast when the device list is byte-identical to the previous
 * poll (cheap JSON compare) to avoid spamming the WS.
 *
 * Also owns RECONNECT of trusted controllers (`gamepad` + `trusted`, not
 * connected), with per-device backoff. `pause()`/`resume()` stop both while a
 * pairing window is open so nothing else talks to BlueZ during the pair.
 *
 * @param {object} opts
 * @param {Function} opts.send                - (topic, payload) => void
 * @param {number}   [opts.intervalMs=3000]
 * @param {Function} [opts.exec]
 * @param {Function} [opts.readInputDevices]
 * @param {boolean}  [opts.reconnect=true]
 * @param {Function} [opts.now]               - () => ms clock (tests).
 * @param {object}   [opts.logger=console]
 * @returns {{ stop: Function, resend: Function, pause: Function, resume: Function }}
 */
export function startBtInventoryBroadcast({
  send, intervalMs = 3000, exec = defaultExec, readInputDevices, reconnect = true, now = Date.now,
  unbondedMemoryMs = 120000, logger = console,
} = {}) {
  let lastJson = null;
  let stopped = false;
  let paused = false;
  const backoff = new Map(); // address → { delayMs, nextAt }
  // An unbonded pad's connection lasts a moment before the kernel rejects it,
  // so a 3s poll catches it only sometimes. Remember each sighting for
  // `unbondedMemoryMs` so the UI state holds steady while it keeps dialing.
  const unbonded = new Map(); // address → { device, at }
  const withUnbondedMemory = (devices) => {
    const t = now();
    const out = devices.map((d) => {
      if (d.paired !== false) { unbonded.delete(d.address); return d; }
      const marked = { ...d, attempting: true };
      unbonded.set(d.address, { device: marked, at: t });
      return marked;
    });
    const present = new Set(out.map((d) => d.address));
    for (const [address, { device, at }] of unbonded) {
      if (t - at > unbondedMemoryMs) { unbonded.delete(address); continue; }
      if (!present.has(address)) out.push({ ...device, connected: false });
    }
    return out;
  };

  const maybeReconnect = async (devices) => {
    if (!reconnect) return;
    for (const d of devices) {
      if (!d.gamepad || !d.trusted) continue;
      if (d.connected) { backoff.delete(d.address); continue; }
      const b = backoff.get(d.address) || { delayMs: 0, nextAt: 0 };
      if (now() < b.nextAt) continue;
      const delayMs = nextReconnectDelay(b.delayMs);
      backoff.set(d.address, { delayMs, nextAt: now() + delayMs });
      try {
        await exec(`timeout 8 bluetoothctl --agent off connect ${d.address}`);
        logger?.info?.(`🎮 bt.reconnect ${d.address} (${d.name}) attempted; next in ${Math.round(delayMs / 1000)}s if still down`);
      } catch {
        logger?.info?.(`🎮 bt.reconnect ${d.address} (${d.name}) not reachable (asleep?) — next try in ${Math.round(delayMs / 1000)}s`);
      }
    }
  };

  const tick = async () => {
    if (stopped || paused) return;
    let devices;
    try {
      devices = await pollBtInventory({ exec, ...(readInputDevices ? { readInputDevices } : {}) });
    } catch (err) {
      logger?.error?.(`❌ bt_inventory poll failed: ${err.message}`);
      return;
    }
    devices = withUnbondedMemory(devices);
    const json = JSON.stringify(devices);
    if (json !== lastJson) {
      try {
        // Only a delivered inventory counts as sent. sendBus returns false when
        // the WS is not open; recording it anyway meant an unchanged inventory
        // was never sent at all (first poll races the initial connect).
        if (send('bt_inventory', { devices }) !== false) lastJson = json;
      } catch (err) {
        logger?.error?.(`❌ bt_inventory send failed: ${err.message}`);
      }
    }
    if (!paused) await maybeReconnect(devices);
  };

  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  // Prime an immediate first poll.
  tick();

  return {
    /** Re-send the current inventory, e.g. after the WS reconnects. */
    resend() {
      lastJson = null;
      return tick();
    },
    /** Stop polling + reconnecting (a pairing window is open). */
    pause() {
      paused = true;
    },
    /** Resume after a pairing window; re-sends and resets reconnect backoff. */
    resume() {
      paused = false;
      backoff.clear();
      lastJson = null;
      return tick();
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
