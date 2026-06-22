/**
 * btInventory — OS-level Bluetooth device inventory via `bluetoothctl`.
 *
 * This is identity/inventory ONLY: it reports which BT devices BlueZ considers
 * connected (address/name/connected/battery) so the frontend can show OS-level
 * truth alongside the browser's Gamepad-API slots. It does NOT touch input.
 *
 * The poll shells out to `bluetoothctl`:
 *   - `bluetoothctl devices Connected`  → the connected device list
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
 * Parse `bluetoothctl devices Connected` output.
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

/**
 * Poll BlueZ for the current connected-device inventory.
 * Each shell-out is wrapped so one failure can't sink the whole poll; if the
 * `devices Connected` call itself fails (e.g. bluetoothctl unavailable) → [].
 *
 * @param {object} [opts]
 * @param {Function} [opts.exec] - injected promisified exec ({stdout,stderr}).
 * @returns {Promise<Array<{ address, name, connected, battery }>>}
 */
export async function pollBtInventory({ exec = defaultExec } = {}) {
  let listOut;
  try {
    ({ stdout: listOut } = await exec('bluetoothctl devices Connected'));
  } catch {
    return [];
  }

  const devices = parseConnectedDevices(listOut);
  const results = [];
  for (const dev of devices) {
    let info = { connected: false, battery: null };
    try {
      const { stdout } = await exec(`bluetoothctl info ${dev.address}`);
      info = parseBattery(stdout);
    } catch {
      // Device may have vanished between list + info; report it as not
      // connected rather than dropping the whole poll.
      info = { connected: false, battery: null };
    }
    results.push({
      address: dev.address,
      name: dev.name,
      connected: info.connected,
      battery: info.battery,
    });
  }
  return results;
}

/**
 * Start an interval that polls the BT inventory and broadcasts it via `send`.
 * Skips the broadcast when the device list is byte-identical to the previous
 * poll (cheap JSON compare) to avoid spamming the WS.
 *
 * @param {object} opts
 * @param {Function} opts.send                - (topic, payload) => void
 * @param {number}   [opts.intervalMs=3000]
 * @param {Function} [opts.exec]
 * @param {object}   [opts.logger=console]
 * @returns {{ stop: Function }}
 */
export function startBtInventoryBroadcast({ send, intervalMs = 3000, exec, logger = console } = {}) {
  let lastJson = null;
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    let devices;
    try {
      devices = await pollBtInventory({ exec });
    } catch (err) {
      logger?.error?.(`❌ bt_inventory poll failed: ${err.message}`);
      return;
    }
    const json = JSON.stringify(devices);
    if (json === lastJson) return; // unchanged — skip the broadcast.
    lastJson = json;
    try {
      send('bt_inventory', { devices });
    } catch (err) {
      logger?.error?.(`❌ bt_inventory send failed: ${err.message}`);
    }
  };

  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  // Prime an immediate first poll.
  tick();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
