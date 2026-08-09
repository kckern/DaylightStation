/**
 * inputKind — how a HELD note should be drawn against the score.
 *
 * The one thing to understand here is what held state can and cannot say.
 *
 * Holding a key is a CONDITION. Playing a note is an EVENT. "This is what you
 * played, and it was right" is a claim about an event, so it is reported by the
 * correct-note flash at the moment the note is judged — not from here. Deriving
 * it from held state instead gets two things wrong: the cursor advances in the
 * same task as the keypress, so held state is only ever read against the NEXT
 * note; and when a note repeats, a key still down from the previous step matches
 * the new one and would be drawn correct while the gate sits there waiting for a
 * fresh press it has not received. The page would say "right" and refuse to move
 * at the same time.
 *
 * So held state answers only the question it can actually answer: "what am I
 * holding that is not on the page here?" — a ghost. A held pitch that IS written
 * here draws nothing, because the event that judged it already reported it.
 *
 * Deliberately ignores the active hands outside the gate: it asks "is this pitch
 * on the page right now?", not "is this your job right now?" — the only question
 * that still means something in Listen, where the hand toggles pick what the
 * KIOSK performs rather than what the player owes.
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
 * @param {boolean} gateActive - Learn's gate is judging what you play
 * @returns {'ghost'|null} `null` means DRAW NOTHING, for one of two reasons:
 *   the pitch is written here, so the correct-note flash owns it as an event;
 *   or the gate is judging and called it wrong, so the red ink owns it. Either
 *   way a mark from here would be a second glyph for one keypress.
 */
export function inputKind(midi, writtenMidis, gateActive) {
  if (writtenMidis?.has(midi)) return null; // the flash reports this, as an event
  return gateActive ? null : 'ghost';       // the red ink reports this, as an event
}

export default { inputKind, writtenMidisAtStep };
