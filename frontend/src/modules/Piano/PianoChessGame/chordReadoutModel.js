// chordReadoutModel.js — reading-state derivation for ChordReadout.jsx, split
// out so Fast Refresh can hot-reload the readout component on its own.

/**
 * What the game heard.
 *
 * Without this, a board that does not respond is ambiguous three ways: the game
 * misheard the chord, heard a chord that is not a square, or heard the right
 * square and refused the move. This says which.
 *
 * It is stabilised the same way the chord plaque is, and for the same reason:
 * the notes of one chord land tens of milliseconds apart, so a read-out driven
 * straight off the held set flashes "2 notes" then "not a square" then the
 * answer, every single time. The settle window matches the cursor's, so the
 * read-out never announces a verdict sooner than the game is willing to decide
 * one — and the release hold keeps the last reading up long enough to be read
 * after the hands come off.
 */
export const SETTLE_MS = 140;
export const HOLD_MS = 600;

/** Everything that makes one reading different from another. */
export const readingSignature = (reading) => (reading.state === 'idle' ? '' : [reading.state, reading.symbol, reading.square].join('|'));

export function readingFor({ heldNotes = [], chord = null, square = null, connected = true, settling = false, minNotes = 3 }) {
  const held = heldNotes.length;
  let state = 'idle';
  if (!connected) state = 'offline';
  else if (chord && square) state = 'square';
  else if (held >= minNotes && settling) state = 'settling';
  else if (held >= minNotes) state = 'unmapped';
  else if (held > 0) state = 'partial';
  return { state, held, square, symbol: chord?.symbol ?? null };
}
