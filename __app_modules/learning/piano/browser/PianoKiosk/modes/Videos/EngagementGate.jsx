import { useMemo, useEffect } from 'react';
import { usePianoMidiNotes } from '../../PianoMidiContext.jsx';
import { generateCardPitches, evaluateMatch } from '../../../PianoFlashcards/flashcardEngine.js';
import { ActionStaff } from '../../../components/ActionStaff.jsx';
import getLogger from '../../../../../../../frontend/src/lib/logging/Logger.js';
import LessonDrill from './LessonDrill.jsx';
import { checkInDrill } from '../../../../portable/practice/goodFaith.mjs';
import { CHECKIN_NOTE, CHECKIN_ONE_SCALE, CHECKIN_TWO_SCALES } from './lessonCreditCopy.js';

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
export default function EngagementGate({ open, onDismiss, humanNotes, avoidPitches, step = { kind: 'note' }, roots = undefined, rotation = 0, rootsSource = null }) {
  if (open && step?.kind === 'scales') {
    return <ScaleCheckIn count={step.count} scaleIndex={step.scaleIndex ?? 0} onDismiss={onDismiss} roots={roots} rotation={rotation} rootsSource={rootsSource} />;
  }
  return <NoteCheckIn open={open} onDismiss={onDismiss} humanNotes={humanNotes} avoidPitches={avoidPitches} />;
}

/**
 * The ladder's scale step: the scale drill in the paused video's place (one
 * rep per scale). No skip and no failure state — a missed scale is simply
 * played again; the check-in closes once every scale has passed.
 */
function ScaleCheckIn({ count, scaleIndex, onDismiss, roots, rotation, rootsSource }) {
  const drill = useMemo(() => {
    const spec = checkInDrill(count, { roots, rotation });
    return { reps: spec.sets * spec.reps, spec };
  }, [count, roots, rotation]);
  useEffect(() => {
    logger().info('piano.engagement-gate.scale-roots', { roots: drill.spec.roots, source: rootsSource, count, scaleIndex });
  }, [drill, rootsSource, count, scaleIndex]);
  return (
    <div className="piano-engagement-gate piano-engagement-gate--scales" data-testid="engagement-gate" role="dialog" aria-modal="true" aria-label="Play along to continue">
      <p className="piano-engagement-gate__heading">{count >= 2 ? CHECKIN_TWO_SCALES : CHECKIN_ONE_SCALE}</p>
      <div className="piano-engagement-gate__drill">
        <LessonDrill
          drill={drill}
          variant="checkin"
          context={{ checkIn: true, scales: count }}
          onRepPassed={(n) => logger().info('piano.engagement-gate.scale-passed', { n, of: drill.reps })}
          onComplete={() => onDismiss?.()}
          onLeave={() => {}}
        />
      </div>
    </div>
  );
}

function NoteCheckIn({ open, onDismiss, humanNotes, avoidPitches }) {
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
        <p className="piano-engagement-gate__prompt">{CHECKIN_NOTE}</p>
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
