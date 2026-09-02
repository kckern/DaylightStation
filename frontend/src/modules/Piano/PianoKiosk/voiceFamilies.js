// voiceFamilies.js — the Sound sheet's rail: nine families a person can hear,
// not the sixteen General MIDI buckets the device profile ships. Membership is
// by GM program number (bank 0) with the device's bank-1 folk voices in World.
// A voice belongs to exactly one family; `voiceFamilies.test.js` proves it
// against the whole device catalog. Max family size is 24 — the grid ceiling.

const inRange = (lo, hi) => ({ pc, bank }) => bank === 0 && pc >= lo && pc <= hi;

export const FAMILIES = Object.freeze([
  { id: 'pianos', label: 'Pianos', icon: 'piano', match: inRange(0, 7) },
  { id: 'keys', label: 'Keys & Organs', icon: 'family-keys', match: inRange(8, 23) },
  { id: 'guitars', label: 'Guitars & Bass', icon: 'family-guitar', match: inRange(24, 39) },
  { id: 'strings', label: 'Strings', icon: 'family-strings', match: inRange(40, 51) },
  { id: 'voices', label: 'Voices', icon: 'studio', match: inRange(52, 54) },
  { id: 'winds', label: 'Winds & Brass', icon: 'family-winds', match: inRange(56, 79) },
  { id: 'synths', label: 'Synths', icon: 'family-synths', match: inRange(80, 103) },
  { id: 'world', label: 'World', icon: 'family-world', match: ({ pc, bank }) => bank !== 0 || (pc >= 104 && pc <= 111) },
  { id: 'fun', label: 'Drums & Fun', icon: 'family-fun', match: ({ pc, bank }) => bank === 0 && (pc === 55 || pc >= 112) },
]);

/** Family id for a voice ({ pc, bank? }), or null when it has no program. */
export function familyOf(voice) {
  if (!voice || voice.pc == null) return null;
  const probe = { pc: Number(voice.pc), bank: Number(voice.bank || 0) };
  return FAMILIES.find((family) => family.match(probe))?.id ?? null;
}

/** { [familyId]: voice[] } over the device's grouped catalog, device order kept. */
export function partitionVoices(groups) {
  const out = Object.fromEntries(FAMILIES.map((family) => [family.id, []]));
  for (const group of groups || []) {
    for (const voice of group.voices || []) {
      const id = familyOf(voice);
      if (id) out[id].push(voice);
    }
  }
  return out;
}
