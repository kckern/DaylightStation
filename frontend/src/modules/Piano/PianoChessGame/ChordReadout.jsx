/**
 * What the game heard.
 *
 * Without this, a board that does not respond is ambiguous three ways: the game
 * misheard the chord, heard a chord that is not a square, or heard the right
 * square and refused the move. This says which.
 */
export default function ChordReadout({
  heldNotes = [], chord = null, square = null, connected = true, settling = false,
}) {
  const held = heldNotes.length;
  let state = 'idle';
  if (!connected) state = 'offline';
  else if (chord && square) state = 'square';
  else if (held >= 3 && settling) state = 'settling';
  else if (held >= 3) state = 'unmapped';
  else if (held > 0) state = 'partial';

  return (
    <div className={`chess-readout chess-readout--${state}`} aria-live="polite">
      <span className="chess-readout__chord">{chord?.symbol ?? (held > 0 ? `${held} note${held === 1 ? '' : 's'}` : '—')}</span>
      <span className="chess-readout__says">
        {state === 'offline' && 'Piano not connected'}
        {state === 'idle' && 'Listening'}
        {state === 'partial' && 'Keep holding — a square is three notes'}
        {state === 'settling' && 'Reading…'}
        {state === 'unmapped' && 'Not a square on this board'}
        {state === 'square' && 'names'}
      </span>
      {state === 'square' && <span className="chess-readout__square">{square}</span>}
    </div>
  );
}
