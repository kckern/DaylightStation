// comboForKeyboard.js — pick the launcher combo for a given physical keyboard.
//
// The combo is "hold the lowest and highest key at once": the one gesture you
// can find on any board without looking, and one nobody plays by accident.
// Which MIDI notes those are depends on the board, so it cannot be a constant.
//
// It was a constant — [21, 108], the extremes of an 88-key board. The office
// keyboard is a 76-key running E1..G7 (28..103), so neither of those notes
// physically exists on it and the launcher was unreachable there. Observed
// 2026-08-18 09:05: ~30 correct attempts in 10s, both notes struck 0.0s apart
// every time, none of which could ever have matched.
//
// One fact per piano — its key range — rather than a separate combo setting to
// keep in sync with it.

/** Lowest and highest keys of an 88-key board; the fallback when nothing is configured. */
export const DEFAULT_COMBO_NOTES = Object.freeze([21, 108]);

const MIDI_MIN = 0;
const MIDI_MAX = 127;

const usable = (n) => Number.isInteger(n) && n >= MIDI_MIN && n <= MIDI_MAX;

/**
 * The combo notes for a configured keyboard range.
 *
 * Falls back to the 88-key extremes whenever the config is absent or unusable,
 * so a malformed entry degrades to today's behaviour rather than producing a
 * combo nobody can play (or, worse, one note repeated twice — which
 * `isComboHeld` would treat as a single key and fire on one finger).
 *
 * @param {{startNote?: number, endNote?: number}|null|undefined} keyboard
 * @returns {readonly [number, number]}
 */
export function comboNotesForKeyboard(keyboard) {
  const start = keyboard?.startNote;
  const end = keyboard?.endNote;
  if (!usable(start) || !usable(end)) return DEFAULT_COMBO_NOTES;
  // Equal endpoints would collapse the two-key combo into one key.
  if (start >= end) return DEFAULT_COMBO_NOTES;
  return Object.freeze([start, end]);
}

export default comboNotesForKeyboard;
