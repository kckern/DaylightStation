import { useMemo } from 'react';
import { useStableChord } from '../components/useStableChord.js';
import { SETTLE_MS, HOLD_MS, readingSignature, readingFor } from './chordReadoutModel.js';

export default function ChordReadout({
  heldNotes = [], chord = null, square = null, connected = true, settling = false, minNotes = 3,
  isReading = false,
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
      <span className="piano-chess__slot-label">Heard</span>
      {/* ONE value line, always. These used to be siblings of the label, so the
          "square" state added a fourth grid row and the whole read-out grew by
          40px the moment a chord landed — shoving everything below it down at
          exactly the moment the player was watching. Reading "Am names a4"
          across one line is also how you would say it aloud. */}
      <span className="chess-readout__line">
        {!isReading && (
          <span className="chess-readout__chord">{symbol ?? (held > 0 ? `${held} note${held === 1 ? '' : 's'}` : '—')}</span>
        )}
        <span className="chess-readout__says">
          {state === 'offline' && 'piano not connected'}
          {state === 'idle' && 'nothing yet'}
          {state === 'partial' && (isReading ? 'one more, other staff' : 'keep holding — three notes')}
          {state === 'settling' && 'reading…'}
          {state === 'unmapped' && 'is not a square'}
          {state === 'square' && 'names'}
        </span>
        {state === 'square' && <span className="chess-readout__square">{shown.square}</span>}
      </span>
    </div>
  );
}
