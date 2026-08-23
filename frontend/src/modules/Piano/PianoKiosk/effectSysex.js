// effectSysex.js — build the MIDI System Exclusive messages that actually change
// reverb/chorus on the piano. Pure: no React, no I/O, no transport.
//
// WHY THIS EXISTS (2026-08-22). The kiosk has always had a working reverb/chorus UI
// that sent Control Change (`typeCC`/`levelCC`). The MDG-400 **ignores CC for
// effects** — `piano/config.yml` says so outright ("sysex works; cc is ignored by
// this unit") — so every tone change was transmitted correctly and discarded by the
// instrument. Nothing was broken enough to look broken.
//
// SysEx could not be sent from the browser at all: the FKB WebView is permanently
// denied Web MIDI SysEx (`requestMIDIAccess({sysex:true})` → NotAllowedError,
// re-verified on Chrome 151). These bytes therefore go out over the piano-bridge
// APK's `midi.raw` WebSocket command, which writes them straight to BLE.
//
// The byte sequences and the checksum rule are transcribed from the verified block
// in `data/household/piano/config.yml`.

/**
 * Roland GS checksum: 128 - (sum of the address+data bytes mod 128), where a
 * result of 128 wraps to 0. Applies to the bytes AFTER the 12h command id and
 * BEFORE the terminating F7.
 */
export function gsChecksum(bytes) {
  const sum = bytes.reduce((a, b) => a + (b & 0xff), 0);
  return (128 - (sum % 128)) % 128;
}

const GS_HEAD = [0xf0, 0x41, 0x10, 0x42, 0x12];

/** One GS parameter write: F0 41 10 42 12 <addr…> <data…> <checksum> F7 */
export function gsMessage(addr, data) {
  const body = [...addr, ...data];
  return [...GS_HEAD, ...body, gsChecksum(body), 0xf7];
}

// GS addresses, from the config's verified table.
const GS_ADDR = {
  reverbType: [0x40, 0x01, 0x30],
  reverbLevel: [0x40, 0x01, 0x33],
  chorusType: [0x40, 0x01, 0x38],
  chorusLevel: [0x40, 0x01, 0x3b],
};

/**
 * GM2 effect-type message. Two bytes shorter than GS, no checksum, and — per the
 * config — measurably more reliable across the JamCorder's BLE→DIN hop, which
 * occasionally drops a message from a longer 3-message GS sequence.
 *   F0 7F 7F 04 05 01 01 01 01 01 <kind> <type> F7
 * `kind` is 00 for reverb, 02 for chorus. Level still rides on its CC.
 */
export function gm2Message(kind, type) {
  return [0xf0, 0x7f, 0x7f, 0x04, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01,
    kind & 0x7f, type & 0x7f, 0xf7];
}

const clamp7 = (n) => Math.max(0, Math.min(127, Math.round(Number(n) || 0)));

/**
 * Plan the wire ops for one effect.
 *
 * @param {'reverb'|'chorus'} name
 * @param {{type:number, level:number, on:boolean}} eff
 * @param {{dialect?:'gm2'|'gs', levelCC?:number}} opts
 * @returns {Array<{kind:'sysex', bytes:number[]} | {kind:'cc', cc:number, value:number}>}
 *
 * Level follows the UI's existing semantics exactly: `on:false` sends level 0
 * rather than a separate disable message, matching what setEffect already did over
 * CC. That keeps the on/off toggle behaving identically — only the transport for
 * TYPE changes, plus (in GS) the level.
 */
export function planEffectSysex(name, eff, opts = {}) {
  if (name !== 'reverb' && name !== 'chorus') return [];
  if (!eff || eff.type == null) return [];
  const dialect = opts.dialect === 'gs' ? 'gs' : 'gm2';
  const level = eff.on ? clamp7(eff.level) : 0;
  const type = clamp7(eff.type);
  const ops = [];

  if (dialect === 'gs') {
    ops.push({ kind: 'sysex', bytes: gsMessage(GS_ADDR[`${name}Type`], [type]) });
    ops.push({ kind: 'sysex', bytes: gsMessage(GS_ADDR[`${name}Level`], [level]) });
    return ops;
  }

  // GM2: SysEx carries the type; the level stays on its Control Change, which the
  // unit DOES honour for send level (only effect TYPE is CC-deaf).
  ops.push({ kind: 'sysex', bytes: gm2Message(name === 'reverb' ? 0x00 : 0x02, type) });
  if (opts.levelCC != null) ops.push({ kind: 'cc', cc: opts.levelCC, value: level });
  return ops;
}

/** Hex string for logging/CLI (`pbctl midi "…"`), uppercase, space separated. */
export function toHex(bytes) {
  return bytes.map((b) => (b & 0xff).toString(16).padStart(2, '0').toUpperCase()).join(' ');
}
