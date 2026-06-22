/**
 * btPairing — time-boxed BlueZ controller-pairing window driven from the bus.
 *
 * The frontend can put the garage box into "pair a game controller" mode without
 * SSH: the backend broadcasts a `bt.pair.request` bus topic, this box receives it
 * over the WS and runs a one-shot `bluetoothctl` scan window, then for each
 * discovered device that LOOKS like a game controller it attempts pair → trust →
 * connect. Progress is streamed back as `bt.pair.progress` bus events.
 *
 * Identity heuristics + parsing are pure (unit-tested against canned output). All
 * shell-out goes through an injected `exec` so the window can be tested with no
 * hardware. The window is best-effort: it never throws — failures become `error`
 * progress events and the window always terminates with a `done`.
 *
 * Caveat (on-box): BlueZ auto-pairing typically needs a default agent registered
 * (`bluetoothctl agent on` / `default-agent`) so PIN/confirm prompts are
 * auto-accepted. Verify the garage box has one configured.
 */

import { exec as nodeExec } from 'child_process';
import { promisify } from 'util';
import { parseConnectedDevices } from './btInventory.mjs';

const defaultExec = promisify(nodeExec);

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
 * Run a single time-boxed pairing window.
 *
 * @param {object}   opts
 * @param {Function} [opts.exec]          injected promisified exec ({stdout,stderr}).
 * @param {number}   [opts.durationMs]    scan window length.
 * @param {Function} opts.send            (topic, payload) => void — emits bt.pair.progress.
 * @param {object}   [opts.logger]        console-like.
 * @param {string}   [opts.requestId]     correlation id echoed into every progress event.
 * @returns {Promise<Array<{address,name}>>} the devices that paired (best-effort).
 */
export async function runPairingWindow({
  exec = defaultExec,
  durationMs = 30000,
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

  const paired = [];
  progress({ phase: 'scanning', durationMs });

  try {
    const scanSec = Math.max(1, Math.round(durationMs / 1000));
    // One-shot timed scan: bluetoothctl exits when the timeout elapses.
    try {
      await exec(`bluetoothctl --timeout ${scanSec} scan on`);
    } catch (err) {
      // A failed scan still lets us inspect whatever's already known, but if
      // bluetoothctl itself is unavailable the `devices` call below will throw
      // and we surface a single error. Log and continue.
      logger?.warn?.(`⚠️  bt.pair scan failed: ${err?.message}`);
    }

    const { stdout: devicesOut } = await exec('bluetoothctl devices');
    const discovered = parseDiscovered(devicesOut);

    for (const dev of discovered) {
      let info;
      try {
        ({ stdout: info } = await exec(`bluetoothctl info ${dev.address}`));
      } catch (err) {
        // Couldn't inspect — skip this device, don't sink the window.
        logger?.warn?.(`⚠️  bt.pair info failed for ${dev.address}: ${err?.message}`);
        continue;
      }
      if (!isLikelyGamepad(info)) continue;

      try {
        await exec(`bluetoothctl pair ${dev.address}`);
        await exec(`bluetoothctl trust ${dev.address}`);
        await exec(`bluetoothctl connect ${dev.address}`);
        paired.push({ address: dev.address, name: dev.name });
        progress({ phase: 'paired', device: { address: dev.address, name: dev.name } });
        logger?.info?.(`🎮 bt.pair paired ${dev.address} (${dev.name})`);
      } catch (err) {
        progress({
          phase: 'error',
          device: { address: dev.address, name: dev.name },
          message: err?.message || String(err),
        });
        logger?.warn?.(`⚠️  bt.pair failed for ${dev.address}: ${err?.message}`);
      }
    }
  } catch (err) {
    // Whole-window failure (e.g. bluetoothctl unavailable): single error event.
    progress({ phase: 'error', message: err?.message || String(err) });
    logger?.error?.(`❌ bt.pair window failed: ${err?.message}`);
  }

  progress({ phase: 'done', paired });
  return paired;
}

/**
 * Bus entry point the server calls when it receives a `bt.pair.request` topic.
 * Pulls `requestId` + `durationMs` off the message and runs one pairing window.
 *
 * @param {object} message            the parsed bus message.
 * @param {object} deps               { exec, send, logger }.
 * @returns {Promise<Array>}          the paired devices (from runPairingWindow).
 */
export async function handleBtPairRequest(message, { exec, send, logger = console } = {}) {
  const requestId = message?.requestId;
  const durationMs = Number(message?.durationMs) || 30000;
  logger?.info?.(`🎮 bt.pair.request received (requestId=${requestId}, durationMs=${durationMs})`);
  return runPairingWindow({ exec, durationMs, send, logger, requestId });
}
