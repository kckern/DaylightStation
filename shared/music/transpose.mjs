// Transposition primitives for the MIDI loop library. Pure, no DOM.
//
// One implementation shared by ingest (collapse 12 pre-rendered keys to one
// canonical store), live playback (conform a loop to the user's chosen key), and
// the matcher. Pitch classes wrap mod 12; MIDI note numbers keep their octave.

/** Normalise any integer into 0..11. */
export function mod12(n) {
  return ((n % 12) + 12) % 12;
}

/** Shift a pitch class (0..11) by N semitones, wrapping. */
export function transposePitchClass(pc, semitones) {
  return mod12(pc + semitones);
}

/** Shift an array of absolute MIDI note numbers by N semitones (no octave wrap). */
export function transposeNotes(notes, semitones) {
  return notes.map((n) => n + semitones);
}

/**
 * Minimal signed semitone shift to move `fromTonic` onto `canonicalTonic`,
 * folded into -6..+5 so transposed material stays near its original register.
 * @param {number} fromTonic pitch class of the loop's tonic
 * @param {number} canonicalTonic pitch class of the canonical key (default C = 0)
 */
export function semitonesToCanonical(fromTonic, canonicalTonic = 0) {
  const raw = mod12(canonicalTonic - fromTonic); // 0..11, upward
  return raw >= 6 ? raw - 12 : raw; // fold to -6..+5 (tritone resolves downward)
}

export default { mod12, transposePitchClass, transposeNotes, semitonesToCanonical };
