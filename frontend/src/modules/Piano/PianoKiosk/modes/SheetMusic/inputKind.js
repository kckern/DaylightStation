/**
 * inputKind — how a HELD note should be drawn in the cursor column.
 *
 * Deliberately ignores the active hands. The layer answers "is this pitch on the
 * page right now?", not "is this your job right now?" — the only question that
 * still means something in Listen, where the hand toggles pick what the KIOSK
 * performs rather than what the player owes.
 */

/** Every pitch written at a cursor step, both staves. Empty for a missing step. */
export function writtenMidisAtStep(step) {
  const out = new Set();
  for (const n of step?.notes || []) out.add(n.midi);
  return out;
}

/**
 * @param {number} midi - the held pitch
 * @param {Set<number>} writtenMidis - pitches written at the cursor
 * @param {boolean} gateActive - Learn's gate is grading this note
 * @returns {'match'|'ghost'|null} `null` means DRAW NOTHING: while the gate is
 *   grading, a non-match is already inked red by the wrong-note path, and a
 *   second glyph in the same column on the same keypress is exactly the visual
 *   doubling this design exists to avoid.
 */
export function inputKind(midi, writtenMidis, gateActive) {
  if (writtenMidis?.has(midi)) return 'match';
  return gateActive ? null : 'ghost';
}

export default { inputKind, writtenMidisAtStep };
