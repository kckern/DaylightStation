import { useMemo, useEffect } from 'react';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import { generateCardPitches, evaluateMatch } from '../../../PianoFlashcards/flashcardEngine.js';
import { ActionStaff } from '../../../components/ActionStaff.jsx';
import getLogger from '../../../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-engagement-gate' });
  return _logger;
}

/**
 * In-place overlay shown over the paused video when the inactivity gate fires.
 * Renders a single flashcard (the same staff the Flashcards game uses) and
 * prompts the student to play it; on a correct MIDI match calls onDismiss()
 * (the parent's dismissGate). Does not unmount the video.
 */
export default function EngagementGate({ open, onDismiss }) {
  const { activeNotes } = usePianoMidi();

  // Pick one random note when the gate opens (re-randomized each open).
  const targetPitches = useMemo(
    () => (open ? generateCardPitches([48, 72], 'single', false) : []),
    [open]
  );

  const matched = useMemo(
    () => Boolean(open && targetPitches.length && evaluateMatch(activeNotes, targetPitches) === 'correct'),
    [open, activeNotes, targetPitches]
  );

  useEffect(() => {
    if (!matched) return;
    logger().info('piano.engagement-gate.correct', { target: targetPitches });
    onDismiss?.();
  }, [matched, targetPitches, onDismiss]);

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
        <div
          className={[
            'piano-engagement-gate__card',
            matched && 'piano-engagement-gate__card--hit',
          ].filter(Boolean).join(' ')}
        >
          <ActionStaff targetPitches={targetPitches} matched={matched} activeNotes={activeNotes} />
        </div>
      </div>
    </div>
  );
}
