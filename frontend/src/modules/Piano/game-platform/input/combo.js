/**
 * True when every note in `comboNotes` is currently down AND they were struck
 * within `windowMs` of each other — i.e. played as a deliberate chord rather
 * than arrived at by chance while playing.
 *
 * Lived in PianoSpaceInvaders/spaceInvadersEngine.js until the note launcher
 * needed it too; a shared input predicate does not belong inside one game.
 *
 * @param {Map<number, {velocity: number, timestamp: number}>} activeNotes
 * @param {number[]} comboNotes - MIDI note numbers that must all be held
 * @param {number} windowMs - max spread between the first and last strike
 */
export function isComboHeld(activeNotes, comboNotes, windowMs) {
  if (!comboNotes || comboNotes.length === 0) return false;

  const timestamps = [];
  for (const note of comboNotes) {
    const active = activeNotes.get(note);
    if (!active) return false;
    timestamps.push(active.timestamp);
  }

  const span = Math.max(...timestamps) - Math.min(...timestamps);
  return span <= windowMs;
}

export default isComboHeld;
