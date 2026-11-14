// voicePatches.js — the per-piano correction table between a catalog voice and
// the MIDI address that actually plays it on THIS instrument.
//
// The device catalog (suzukiMdg400.js) was transcribed from an older Suzuki
// Micro Grand manual; the MDG-400 is a later engine, so a catalog address can
// play the wrong sound. The Patch finder (maintenance drawer) lets a person
// audition addresses by ear and save the one that is right. Saved patches live
// in the piano config under `voicePatches`, keyed by the voice's CATALOG
// identity (`pc:bank`) — the same key presets use (usePianoPreset.soundVoiceKey)
// — so a saved favourite keeps meaning the same voice after its address is
// corrected. Only the SEND address changes.
//
//   voicePatches:
//     "0:0": { msb: 0, lsb: 3, pc: 0, name: Acoustic Grand }
//
// Pure: no React, no MIDI.

const clamp7 = (n) => Math.max(0, Math.min(127, Math.trunc(Number(n))));
const is7 = (n) => Number.isInteger(Number(n)) && Number(n) >= 0 && Number(n) <= 127;

/** Catalog identity of a voice: "pc:bank". Null when the voice has no program. */
export function catalogKey(voice) {
  if (!voice || voice.pc == null) return null;
  return `${Number(voice.pc)}:${Number(voice.bank || 0)}`;
}

/** The address the catalog itself gives a voice. */
export function catalogAddress(voice) {
  if (!voice || voice.pc == null) return null;
  return { msb: clamp7(voice.bank || 0), lsb: 0, pc: clamp7(voice.pc) };
}

/**
 * Normalize the raw config block into { [catalogKey]: { msb, lsb, pc, name? } }.
 * Drops malformed entries rather than guessing: a bad row must never send a
 * random program to the piano.
 */
export function normalizePatches(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!/^\d{1,3}:\d{1,3}$/.test(String(key)) || !value || typeof value !== 'object') continue;
    const { msb = 0, lsb = 0, pc } = value;
    if (!is7(msb) || !is7(lsb) || !is7(pc)) continue;
    out[key] = { msb: Number(msb), lsb: Number(lsb), pc: Number(pc), ...(value.name ? { name: String(value.name) } : {}) };
  }
  return out;
}

/**
 * The address to SEND for a voice: its saved patch when there is one, else the
 * catalog address. `patched` says which.
 */
export function addressFor(voice, patches) {
  const base = catalogAddress(voice);
  if (!base) return null;
  const p = patches?.[catalogKey(voice)];
  return p ? { msb: p.msb, lsb: p.lsb, pc: p.pc, patched: true } : { ...base, patched: false };
}

export const ADDRESS_FIELDS = Object.freeze(['msb', 'lsb', 'pc']);

/** Step one field of an address, wrapping within 0–127. */
export function stepAddress(address, field, delta) {
  if (!ADDRESS_FIELDS.includes(field)) return address;
  const next = (((Number(address[field]) || 0) + delta) % 128 + 128) % 128;
  return { ...address, [field]: next };
}

/** Set one field from typed input. Out-of-range or non-numeric input is refused (returns the address unchanged). */
export function setAddressField(address, field, value) {
  if (!ADDRESS_FIELDS.includes(field) || !is7(value)) return address;
  return { ...address, [field]: Number(value) };
}

export const sameAddress = (a, b) => !!a && !!b && a.msb === b.msb && a.lsb === b.lsb && a.pc === b.pc;

/** Compact display, e.g. "Bank 0/3 · Prog 0". Program is shown 0-based (the wire value). */
export const formatAddress = (a) => (a ? `Bank ${a.msb}/${a.lsb} · Prog ${a.pc}` : '—');

/** The YAML value a saved patch is written as. */
export function patchEntry(address, voice) {
  return { msb: address.msb, lsb: address.lsb, pc: address.pc, ...(voice?.name ? { name: voice.name } : {}) };
}
