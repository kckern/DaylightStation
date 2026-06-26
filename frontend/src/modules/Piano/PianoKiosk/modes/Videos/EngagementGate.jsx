import { useMemo, useEffect } from 'react';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import { generateCardPitches, evaluateMatch } from '../../../PianoFlashcards/flashcardEngine.js';
import getLogger from '../../../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-engagement-gate' });
  return _logger;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiToName = (n) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

/**
 * In-place overlay shown over the paused video when the inactivity gate fires.
 * Prompts the student to play a single note; on a correct MIDI match calls
 * onDismiss() (the parent's dismissGate). Does not unmount the video.
 */
export default function EngagementGate({ open, onDismiss }) {
  const { activeNotes } = usePianoMidi();

  // Pick one random note when the gate opens (re-randomized each open).
  const targetPitches = useMemo(
    () => (open ? generateCardPitches([48, 72], 'single', false) : []),
    [open]
  );

  useEffect(() => {
    if (!open || !targetPitches.length) return;
    const result = evaluateMatch(activeNotes, targetPitches);
    if (result === 'correct') {
      logger().info('piano.engagement-gate.correct', { target: targetPitches });
      onDismiss?.();
    }
  }, [open, activeNotes, targetPitches, onDismiss]);

  if (!open) return null;

  return (
    <div
      className="piano-engagement-gate"
      data-testid="engagement-gate"
      role="dialog"
      aria-modal="true"
      aria-label="Play along to continue"
    >
      <div className="piano-engagement-gate__content">
        <p className="piano-engagement-gate__prompt">Still there? Play this note to continue:</p>
        <p className="piano-engagement-gate__target">{targetPitches.map(midiToName).join(' + ')}</p>
      </div>
    </div>
  );
}
