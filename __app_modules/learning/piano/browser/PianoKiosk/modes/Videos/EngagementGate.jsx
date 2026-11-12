import { useMemo, useEffect } from 'react';
import { usePianoMidiNotes } from '../../PianoMidiContext.jsx';
import { generateCardPitches, evaluateMatch } from '../../../PianoFlashcards/flashcardEngine.js';
import { ActionStaff } from '../../../components/ActionStaff.jsx';
import getLogger from '../../../../../../../frontend/src/lib/logging/Logger.js';

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
 *
 * `humanNotes` (optional): the held keys a PERSON is playing (useHumanNotes).
 * When given, only those can answer — the piano's rhythm loop plays congas on
 * D4–E4, inside the prompt's C3–C5 range. `avoidPitches` (optional, a getter)
 * names pitches the loop is playing right now; the prompt never asks for one,
 * so a child can always answer it.
 */
export default function EngagementGate({ open, onDismiss, humanNotes, avoidPitches }) {
  const { activeNotes: storeNotes } = usePianoMidiNotes();
  const activeNotes = humanNotes ?? storeNotes;

  // Pick one random note when the gate opens (re-randomized each open).
  const targetPitches = useMemo(() => {
    if (!open) return [];
    const avoid = avoidPitches?.() ?? null;
    let pick = generateCardPitches([48, 72], 'single', false);
    for (let i = 0; avoid?.size && i < 50 && pick.some((p) => avoid.has(p)); i += 1) {
      pick = generateCardPitches([48, 72], 'single', false);
    }
    return pick;
  }, [open]); // picked once per open: a later loop change must not swap the card

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
