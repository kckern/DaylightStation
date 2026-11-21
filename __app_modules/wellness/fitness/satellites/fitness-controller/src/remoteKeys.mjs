/**
 * Bluetooth remote keys, per device.
 *
 * Runs remote_keys_helper.py, which reads every Bluetooth remote / keyboard
 * straight from the kernel tagged with its Bluetooth address (pads excluded).
 * Each press is:
 *  - logged to the log store as `bt.remote.key` (address, name, kernel code,
 *    HID usage, browser key name) — the low-level record of what arrived,
 *    whether or not it reached the page;
 *  - sent on the bus as `bt.remote.key`, so the app can tell two remotes of the
 *    same model apart (a browser KeyboardEvent carries no device identity).
 * A raw HID report the kernel turned into no key is logged as
 * `bt.remote.unmapped` (a button Linux drops). Device nodes opening / going
 * away (sleep, reconnect) are logged as `bt.remote.open` / `bt.remote.gone`.
 *
 * Read-only: nothing is grabbed, so keys still reach the browser as before.
 */
import { spawn as nodeSpawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const HELPER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'remote_keys_helper.py');

/** Kernel KEY_* code -> browser KeyboardEvent.key (what Firefox reports). */
const KEY_NAMES = {
  1: 'Escape', 14: 'Backspace', 15: 'Tab', 28: 'Enter', 57: ' ',
  103: 'ArrowUp', 105: 'ArrowLeft', 106: 'ArrowRight', 108: 'ArrowDown',
  102: 'Home', 107: 'End', 104: 'PageUp', 109: 'PageDown', 110: 'Insert', 111: 'Delete',
  113: 'AudioVolumeMute', 114: 'AudioVolumeDown', 115: 'AudioVolumeUp',
  116: 'Power', 128: 'MediaStop', 158: 'BrowserBack', 159: 'BrowserForward',
  163: 'MediaTrackNext', 164: 'MediaPlayPause', 165: 'MediaTrackPrevious',
  166: 'MediaStop', 168: 'MediaRewind', 172: 'BrowserHome', 207: 'MediaPlay',
  208: 'MediaFastForward', 212: 'Camera', 217: 'BrowserSearch', 226: 'MediaSelect',
  139: 'ContextMenu', 169: 'Phone', 200: 'MediaPlay', 201: 'MediaPause',
  29: 'Control', 42: 'Shift', 56: 'Alt', 125: 'Meta', 97: 'Control', 54: 'Shift', 100: 'AltGraph',
  12: '-', 13: '=', 26: '[', 27: ']', 39: ';', 40: "'", 41: '`', 43: '\\', 51: ',', 52: '.', 53: '/',
};
const LETTER_ROWS = [[16, 'qwertyuiop'], [30, 'asdfghjkl'], [44, 'zxcvbnm']];
for (const [start, letters] of LETTER_ROWS) [...letters].forEach((ch, i) => { KEY_NAMES[start + i] = ch; });
'1234567890'.split('').forEach((d, i) => { KEY_NAMES[2 + i] = d; });
[59, 60, 61, 62, 63, 64, 65, 66, 67, 68].forEach((c, i) => { KEY_NAMES[c] = `F${i + 1}`; });
KEY_NAMES[87] = 'F11'; KEY_NAMES[88] = 'F12';

/**
 * Remotes whose input arrives on a HID report their own report map does not
 * declare, so the kernel drops it; the helper reads it off the HCI monitor as
 * a `gatt` line and these decode it. Keyed by the remote's Bluetooth name.
 *
 * Magicsee R1 in gamepad mode (M + B): ATT handle 0x001f, 2 bytes. Byte 0 is
 * one bit per button; byte 1 bits 7-6 are the stick's Y (0 up, 1 centre,
 * 2 down) and bits 5-4 its X (0 left, 1 centre, 2 right). Captured on garage
 * 2026-11-20 and matching UbiquityRobotics/bt_joystick's bit table.
 */
const GATT_DECODERS = {
  'Magicsee R1': {
    att: 0x001f,
    decode(bytes) {
      if (bytes.length < 2) return null;
      const [b, stick] = bytes;
      const y = (stick >> 6) & 0x3;
      const x = (stick >> 4) & 0x3;
      return {
        ButtonA: !!(b & 0x10), ButtonB: !!(b & 0x01), ButtonC: !!(b & 0x08), ButtonD: !!(b & 0x02),
        TriggerCircle: !!(b & 0x40), TriggerBack: !!(b & 0x80),
        StickUp: y === 0, StickDown: y === 2, StickLeft: x === 0, StickRight: x === 2,
      };
    },
  },
};

/**
 * A gatt line -> key events, diffing against the remote's previous state.
 * @param {Map<string, object>} prev  per-address last decoded state (mutated)
 * @returns {Array<{key:string,state:'down'|'up'}>|null}  null = no decoder
 */
export function decodeGatt(prev, { address, name, att, value }) {
  const dec = GATT_DECODERS[name];
  if (!dec || dec.att !== att || typeof value !== 'string') return null;
  const bytes = (value.match(/../g) || []).map((h) => parseInt(h, 16));
  const now = dec.decode(bytes);
  if (!now) return null;
  const before = prev.get(address) || {};
  prev.set(address, now);
  const out = [];
  for (const [key, on] of Object.entries(now)) {
    if (on && !before[key]) out.push({ key, state: 'down' });
    else if (!on && before[key]) out.push({ key, state: 'up' });
  }
  return out;
}

export function keyName(code) {
  return KEY_NAMES[code] ?? `Unidentified(${code})`;
}

/**
 * One helper line -> { log, bus, extra } — log: [level, event, data] | null;
 * bus: payload | null; extra: further [log, bus] pairs (a gatt report can
 * press and release several controls at once).
 * @param {string} line
 * @param {Map<string, object>} [gattState]  per-remote decoded state
 */
export function interpretLine(line, gattState = new Map()) {
  let m;
  try { m = JSON.parse(line); } catch { return { log: null, bus: null }; }
  if (m?.type === 'monitor-unavailable') return { log: ['warn', 'bt.remote.monitor-unavailable', {}], bus: null };
  const address = typeof m?.address === 'string' ? m.address.toUpperCase() : null;
  if (!address) return { log: null, bus: null };
  switch (m.type) {
    case 'key': {
      const data = { address, name: m.name || null, code: m.code, key: keyName(m.code),
        usage: Number.isFinite(m.scan) ? `0x${m.scan.toString(16)}` : null, state: m.state };
      // Releases and repeats are debug: the press is the record people read.
      return { log: [m.state === 'down' ? 'info' : 'debug', 'bt.remote.key', data], bus: data };
    }
    case 'unmapped':
      return { log: ['warn', 'bt.remote.unmapped', { address, report: m.report }], bus: null };
    case 'gatt': {
      const raw = { address, name: m.name || null, att: `0x${Number(m.att).toString(16).padStart(4, '0')}`, value: m.value };
      const events = decodeGatt(gattState, { address, name: m.name, att: m.att, value: m.value });
      if (events == null) return { log: ['debug', 'bt.remote.gatt', raw], bus: null };
      const extra = events.map(({ key, state }) => {
        const data = { address, name: m.name || null, code: null, key, usage: `gatt:${raw.att}`, state, raw: m.value };
        return [[state === 'down' ? 'info' : 'debug', 'bt.remote.key', data], data];
      });
      return { log: ['debug', 'bt.remote.gatt', raw], bus: null, extra };
    }
    case 'monitor-unavailable':
      return { log: ['warn', 'bt.remote.monitor-unavailable', {}], bus: null };
    case 'open':
      return { log: ['info', 'bt.remote.open', { address, name: m.name || null, node: m.node, kind: m.kind }], bus: null };
    case 'gone':
      return { log: ['info', 'bt.remote.gone', { address, node: m.node }], bus: null };
    default:
      return { log: null, bus: null };
  }
}

/**
 * Start the reader. Restarts the helper if it exits (1 s, doubling to 60 s).
 * @param {object} opts
 * @param {(level:string, event:string, data:object) => void} opts.logEvent
 * @param {(topic:string, payload:object) => void} opts.send
 * @param {Function} [opts.spawn]
 * @param {object} [opts.logger]
 * @returns {{ stop(): void }}
 */
export function startRemoteKeys({ logEvent, send, spawn = nodeSpawn, logger = console } = {}) {
  let child = null;
  let stopped = false;
  let delay = 1000;
  let timer = null;

  const launch = () => {
    if (stopped) return;
    const startedAt = Date.now();
    child = spawn('python3', ['-u', HELPER], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    const gattState = new Map();
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        const { log, bus, extra = [] } = interpretLine(line, gattState);
        for (const [l, b] of [[log, bus], ...extra]) {
          if (l) {
            logEvent?.(...l);
            if (l[0] !== 'debug') logger?.log?.(`🎛️ ${l[1]} ${JSON.stringify(l[2])}`);
          }
          if (b) send?.('bt.remote.key', b);
        }
      }
    });
    child.stderr.on('data', (chunk) => logger?.error?.(`remote_keys_helper: ${chunk.toString().trim()}`));
    child.on('exit', (code, signal) => {
      child = null;
      if (stopped) return;
      if (Date.now() - startedAt > 60_000) delay = 1000;
      logEvent?.('warn', 'bt.remote.helper-exit', { code, signal, restartInMs: delay });
      timer = setTimeout(launch, delay);
      delay = Math.min(delay * 2, 60_000);
    });
  };

  launch();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      child?.kill('SIGTERM');
    },
  };
}
