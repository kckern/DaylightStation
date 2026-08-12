import { useMemo } from 'react';
import { useStableChord } from '../components/useStableChord.js';

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
const SETTLE_MS = 140;
const HOLD_MS = 600;

/** Everything that makes one reading different from another. */
const readingSignature = (reading) => (reading.state === 'idle' ? '' : [reading.state, reading.symbol, reading.square].join('|'));

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

export default function ChordReadout({
  heldNotes = [], chord = null, square = null, connected = true, settling = false, minNotes = 3,
}) {
  const reading = useMemo(
    () => readingFor({ heldNotes, chord, square, connected, settling, minNotes }),
    [heldNotes, chord, square, connected, settling, minNotes],
  );
  // Offline is a standing condition, not a moment of play: it must not wait out
  // a settle window behind a stale reading, because it is the answer to "why is
  // nothing happening" and every second of it is a second of confusion.
  const stable = useStableChord(reading, { settleMs: SETTLE_MS, holdMs: HOLD_MS, signature: readingSignature });
  const shown = reading.state === 'offline' ? reading : (stable ?? reading);
  const { state, held, symbol } = shown;

  return (
    <div className={`chess-readout chess-readout--${state}`} aria-live="polite">
      <span className="chess-readout__chord">{symbol ?? (held > 0 ? `${held} note${held === 1 ? '' : 's'}` : '—')}</span>
      <span className="chess-readout__says">
        {state === 'offline' && 'Piano not connected'}
        {state === 'idle' && 'Listening'}
        {state === 'partial' && `Keep holding — a square is ${minNotes === 2 ? 'a note on each staff' : 'three notes'}`}
        {state === 'settling' && 'Reading…'}
        {state === 'unmapped' && 'Not a square on this board'}
        {state === 'square' && 'names'}
      </span>
      {state === 'square' && <span className="chess-readout__square">{shown.square}</span>}
    </div>
  );
}
