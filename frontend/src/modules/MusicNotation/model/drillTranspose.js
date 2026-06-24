// MusicNotation model — diatonic transposition + lesson-drill expansion (pure).
//
// Lesson drills (e.g. Hanon) are stored compactly as a short seed figure plus a
// `transpose` rule. The full exercise — the figure climbing the scale step by
// step across N octaves and back — is GENERATED here, so the same expanded note
// sequence drives both the engraving and the MIDI follow-along (they can never
// disagree). Pure and unit-testable; the abcjs render call stays in AbcRenderer.

import { KEY_SIGNATURES } from './keySignature.js';

const DEGREES_PER_OCTAVE = 7;

/**
 * Transpose a MIDI note by a number of DIATONIC degrees within a key. A degree
 * is a scale step (C→D→E…), so +1 in C major turns C into D, E into F, etc.
 * Chromatic (out-of-scale) notes keep their accidental offset relative to the
 * nearest scale degree below them.
 *
 * @param {number} midi - source MIDI note
 * @param {number} degrees - diatonic steps (may be negative)
 * @param {string} [key='C'] - key name (see KEY_SIGNATURES)
 * @returns {number} transposed MIDI note
 */
export function diatonicTranspose(midi, degrees, key = 'C') {
  if (!degrees) return midi;
  const scale = KEY_SIGNATURES[key]?.scale || KEY_SIGNATURES.C.scale;
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12);

  let index = scale.indexOf(pc);
  let alter = 0;
  if (index === -1) {
    // Chromatic note: anchor to the nearest scale degree below, keep the offset.
    let best = 0;
    for (let i = 0; i < scale.length; i++) if (scale[i] <= pc && scale[i] >= scale[best]) best = i;
    // (scale is ascending, so the largest pc ≤ this one is the anchor)
    let anchor = 0;
    for (let i = 0; i < scale.length; i++) if (scale[i] <= pc) anchor = i;
    index = anchor;
    alter = pc - scale[anchor];
  }

  const pos = octave * DEGREES_PER_OCTAVE + index;
  const newPos = pos + degrees;
  const newOctave = Math.floor(newPos / DEGREES_PER_OCTAVE);
  const newIndex = ((newPos % DEGREES_PER_OCTAVE) + DEGREES_PER_OCTAVE) % DEGREES_PER_OCTAVE;
  return newOctave * 12 + scale[newIndex] + alter;
}

/** Transpose every note in a cell by `degrees`, preserving fingering/rests. */
function transposeCell(cell, degrees, key) {
  const notes = (cell?.notes || []).map((n) =>
    n?.rest ? { ...n } : { ...n, midi: diatonicTranspose(n.midi, degrees, key), name: undefined });
  return { notes };
}

/**
 * Expand a drill's seed figures into the full exercise per its `transpose` rule.
 *
 * The seed hands carry an `ascending` cell (the figure at its low starting
 * position) and a `descending` cell (the figure at its high turnaround). For a
 * `span_octaves` of N we emit 7·N ascending measures (the ascending seed shifted
 * up 0…7N-1 diatonic degrees) and, for an up-then-down rule, 7·N descending
 * measures (the descending seed shifted DOWN). Hands expand independently.
 *
 * A drill with no `transpose` rule is returned unchanged.
 *
 * @param {object} drill - { key, transpose:{span_octaves,direction}, hands:{right:[cell],left:[cell]} }
 * @returns {object} drill with hands.right / hands.left expanded to full measure lists
 */
export function expandDrill(drill) {
  if (!drill?.transpose || !drill?.hands) return drill;
  const key = drill.key || 'C';
  const span = Number(drill.transpose.span_octaves) || 1;
  const steps = DEGREES_PER_OCTAVE * span;
  const direction = drill.transpose.direction || 'up-then-down';
  const goesDown = direction.includes('down');
  const goesUp = direction.includes('up') || !goesDown;

  const expandHand = (cells) => {
    const list = Array.isArray(cells) ? cells : [];
    const asc = list.find((c) => c.role === 'ascending') || list[0];
    const desc = list.find((c) => c.role === 'descending') || list[list.length - 1];
    const out = [];
    if (goesUp && asc) for (let k = 0; k < steps; k++) out.push(transposeCell(asc, k, key));
    if (goesDown && desc) for (let k = 0; k < steps; k++) out.push(transposeCell(desc, -k, key));
    return out;
  };

  return {
    ...drill,
    hands: {
      right: expandHand(drill.hands.right),
      left: expandHand(drill.hands.left),
    },
    expanded: true,
  };
}

/** Flatten a hand's expanded cells into an ordered list of MIDI notes (skips rests). */
export function handMidiSequence(cells) {
  return (Array.isArray(cells) ? cells : [])
    .flatMap((cell) => (cell?.notes || []))
    .filter((n) => !n?.rest && n?.midi != null)
    .map((n) => n.midi);
}

export default expandDrill;
