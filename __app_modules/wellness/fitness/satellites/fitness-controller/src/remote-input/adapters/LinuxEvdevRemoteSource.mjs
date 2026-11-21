/**
 * Adapter: Bluetooth remote / keyboard keys read straight from the Linux kernel
 * (evdev key events + hidraw reports), tagged with the device's Bluetooth
 * address. Runs remote_keys_helper.py in `kernel` mode. Read-only: nothing is
 * grabbed, so keys still reach the browser.
 */
import { IRemoteInputSource } from '../ports/IRemoteInputSource.mjs';
import { runHelper, upperAddress } from './helperProcess.mjs';

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

export function keyName(code) {
  return KEY_NAMES[code] ?? `Unidentified(${code})`;
}

/**
 * One helper line (kernel mode) -> a normalized event, or null.
 * @param {object} m
 * @param {string} [source]
 */
export function kernelLineToEvent(m, source = 'kernel') {
  const address = upperAddress(m?.address);
  switch (m?.type) {
    case 'key':
      if (!address) return null;
      return { kind: 'control', source, address, name: m.name || null, control: keyName(m.code),
        state: m.state, code: m.code, usage: Number.isFinite(m.scan) ? `0x${m.scan.toString(16)}` : null };
    case 'unmapped':
      return address ? { kind: 'unrecognized', source, address, raw: m.report } : null;
    case 'open':
      return address ? { kind: 'device-open', source, address, name: m.name || null, node: m.node, nodeKind: m.kind } : null;
    case 'gone':
      return address ? { kind: 'device-gone', source, address, node: m.node } : null;
    default:
      return null;
  }
}

export class LinuxEvdevRemoteSource extends IRemoteInputSource {
  #runHelper; #spawn; #logger; #handle = null;

  constructor({ runHelper: run = runHelper, spawn, logger = console } = {}) {
    super();
    this.id = 'kernel';
    this.#runHelper = run; this.#spawn = spawn; this.#logger = logger;
  }

  start({ onEvent }) {
    this.#handle = this.#runHelper({
      mode: 'kernel', spawn: this.#spawn, logger: this.#logger,
      onLine: (m) => { const e = kernelLineToEvent(m, this.id); if (e) onEvent(e); },
      onExit: (info) => onEvent({ kind: 'source-exit', source: this.id, ...info }),
    });
  }

  stop() {
    this.#handle?.stop();
    this.#handle = null;
  }
}

export default LinuxEvdevRemoteSource;
