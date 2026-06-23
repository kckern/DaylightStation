import { isWhiteKey } from '../../../noteUtils.js';

// Split-keyboard mapping for Decks: white keys below the split point fire the
// kit's one-shots (cycling through them); everything else stays melodic.

/** Default split point — MIDI 48 (C3) and below is the drum zone. */
export const DEFAULT_SPLIT = 48;

/** Count of white keys in [0, note] (so the lowest white key is index 0). */
function whiteIndex(note) {
  let c = -1;
  for (let n = 0; n <= note; n++) if (isWhiteKey(n)) c++;
  return c;
}

/**
 * One-shot id a pressed key should trigger, or null if it's a melodic key.
 * @param {number} note - MIDI note
 * @param {number} splitNote - drum zone is note < splitNote
 * @param {Array<{id:string}>} oneshots
 */
export function drumForNote(note, splitNote, oneshots) {
  if (note >= splitNote || !isWhiteKey(note) || !oneshots?.length) return null;
  return oneshots[whiteIndex(note) % oneshots.length].id;
}
