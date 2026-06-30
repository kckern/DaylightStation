// sysex.js — pure MIDI message builders for the reverb/chorus command probe.
// Each builder returns a raw byte array (a complete MIDI message). No I/O.
//
// We test the standard ways a GM/GM2/GS/XG sound engine accepts reverb/chorus
// control, because the MDG-400 ignores the owner's-manual CC mapping (CC 80/91,
// 81/93). Reverb *type* is set by SysEx on every standard; CC 91/93 are only the
// per-channel *send* levels (and only audible once a reverb program is active).

// ── Channel-voice helpers ────────────────────────────────────────────────────
export const cc = (controller, value, channel = 0) => [0xb0 | (channel & 0x0f), controller & 0x7f, value & 0x7f];
export const programChange = (program, channel = 0) => [0xc0 | (channel & 0x0f), program & 0x7f];

// ── Universal system-on ──────────────────────────────────────────────────────
export const GM_SYSTEM_ON = [0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7];
export const GM2_SYSTEM_ON = [0xf0, 0x7e, 0x7f, 0x09, 0x03, 0xf7];

// ── Roland GS ────────────────────────────────────────────────────────────────
// Checksum = (128 - (sum(address+data) mod 128)) mod 128, over the bytes after
// the 0x12 command up to (not including) the checksum.
export function rolandChecksum(addrAndData) {
  const sum = addrAndData.reduce((a, b) => a + b, 0) % 128;
  return (128 - sum) % 128;
}
export function gsParam(address, data) {
  const body = [...address, ...data];
  return [0xf0, 0x41, 0x10, 0x42, 0x12, ...body, rolandChecksum(body), 0xf7];
}
export const GS_RESET = gsParam([0x40, 0x00, 0x7f], [0x00]); // → F0 41 10 42 12 40 00 7F 00 41 F7
export const gsReverbMacro = (type) => gsParam([0x40, 0x01, 0x30], [type]); // 0..7 (4=Hall2)
export const gsReverbLevel = (level) => gsParam([0x40, 0x01, 0x33], [level]);
export const gsChorusMacro = (type) => gsParam([0x40, 0x01, 0x38], [type]); // 0..7 (2=Chorus3)
export const gsChorusLevel = (level) => gsParam([0x40, 0x01, 0x3b], [level]);

// ── Yamaha XG ────────────────────────────────────────────────────────────────
export function xgParam(address, data) {
  return [0xf0, 0x43, 0x10, 0x4c, ...address, ...data, 0xf7];
}
export const XG_SYSTEM_ON = [0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7];
export const xgReverbType = (msb, lsb) => xgParam([0x02, 0x01, 0x00], [msb, lsb]); // Hall1 = 01,00
export const xgReverbReturn = (level) => xgParam([0x02, 0x01, 0x0c], [level]);
export const xgChorusType = (msb, lsb) => xgParam([0x02, 0x01, 0x20], [msb, lsb]); // Chorus1 = 41,00
export const xgChorusReturn = (level) => xgParam([0x02, 0x01, 0x2c], [level]);

// ── GM2 Global Parameter Control (best-effort; reverb/chorus type) ───────────
export const gm2ReverbType = (type) => [0xf0, 0x7f, 0x7f, 0x04, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, type & 0x7f, 0xf7];
export const gm2ChorusType = (type) => [0xf0, 0x7f, 0x7f, 0x04, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x02, type & 0x7f, 0xf7];

export const isSysex = (bytes) => bytes[0] === 0xf0;
