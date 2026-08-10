/**
 * Producer key semantics.
 *
 * `keyShift` is historical storage/API naming. Its value is the absolute
 * target tonic in semitones relative to canonical C; it is not an additional
 * transpose applied on top of a loop's native key. Values may be outside
 * 0..11 because the circle-of-fifths picker preserves the nearest octave.
 *
 * Library notes remain in their authored key, described by `entry.tonicPc`.
 * Takes/builders are normalized to canonical C before entering the workspace.
 * Therefore every pitched playback surface uses exactly:
 *
 *   target tonic - source tonic
 *
 * Grooves never transpose because their MIDI pitches select instruments.
 */

function finiteSemitones(value, fallback = 0) {
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

/** Pitch-class form used only for labels and keyed chord names. */
export function targetKeyPc(keyShift = 0) {
  const value = finiteSemitones(keyShift);
  return ((value % 12) + 12) % 12;
}

/** The pitch class at which a source's authored `I` currently sounds. */
export function sourceTonicPc(source) {
  if (source?.kind !== 'library') return 0;
  return targetKeyPc(source.entry?.tonicPc);
}

/** Authoritative transpose for Loop, audition, Song, save, and reload paths. */
export function transposeToTargetKey(layer, keyShift = 0) {
  if (layer?.role === 'groove') return 0;
  return finiteSemitones(keyShift) - sourceTonicPc(layer?.source);
}

/** Shortest signed semitone step from one tonic pitch class to another. */
export function shortestKeyDelta(fromPc, toPc) {
  return (((toPc - fromPc) % 12) + 18) % 12 - 6;
}
