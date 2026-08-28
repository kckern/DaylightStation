import { useMemo } from 'react';
import { PianoKeyboard } from '../../../components/PianoKeyboard.jsx';
import { SvgSequenceStaff } from '../../../../MusicNotation/renderers/SvgSequenceStaff.jsx';
import { clefForAsk } from './runPresentation.js';
import './Exercises.scss';

/**
 * KeysAsk — the tier 0-1 lit-keyboard ask.
 *
 * A big keyboard with lit keys is the whole reading task a preschooler is
 * given: press the lit key(s). It renders as its own primary stage block, not
 * the footer strip ExerciseRun otherwise uses — the keyboard is what the child
 * looks at.
 *
 * Two shapes come through the same `events` prop the engine grades:
 *  - a TOGETHER ask is one event carrying every note (a chord, "play these at
 *    once") — every one of its notes lights at once, no badges.
 *  - a SEQUENCE ask is n events of one note each (an in-order run) — only the
 *    event at `cursorIndex` lights, and a 1..n badge row tracks the child's
 *    place, dimming the ones already played.
 *
 * `showStaff` adds the tier-1 reinforcement: a small `SvgSequenceStaff` above
 * the keys, fed the same cursor/wrong-note truth as the keyboard.
 *
 * `clef` must be the clef the ask was JUDGED to fit on. Left to the staff, it
 * is re-derived from the majority of the pitches with ties going treble — so a
 * two-note bass ask like G3+C4 (a 1-1 tie) draws on a treble staff, putting G3
 * five steps below the bottom line and off the bottom of the card. The host
 * that decided the staff may be shown decided which clef it fits on; the
 * default here answers with the same rule (`clefForAsk`) rather than a second
 * one, so the two can never disagree.
 */
export default function KeysAsk({
  events = [],
  cursorIndex = 0,
  activeNotes = new Map(),
  wrongMidi = null,
  showStaff = false,
  accidental = 'sharp',
  clef = null,
}) {
  const isSequence = events.length > 1;
  const currentEvent = isSequence
    ? events[Math.min(Math.max(cursorIndex, 0), events.length - 1)]
    : events[0];

  const targetNotes = useMemo(
    () => new Map((currentEvent?.notes || []).map((note) => [note.midi, { velocity: 1 }])),
    [currentEvent]
  );
  const wrongNotes = wrongMidi == null ? null : new Set([wrongMidi]);

  // The keyboard's range covers the WHOLE ask (every event), not just the
  // current one — the child needs to see where the next lit key can land,
  // same clamped idiom ExerciseRun's footer keyboard uses.
  const expected = events.flatMap((ev) => ev.notes.map((note) => note.midi));
  const startNote = expected.length ? Math.max(21, Math.min(...expected) - 3) : 21;
  const endNote = expected.length ? Math.min(108, Math.max(...expected) + 3) : 108;

  // The staff's own note shape: one entry per event, a chord entry when an
  // event carries more than one note.
  const staffNotes = useMemo(
    () => events.map((ev) => (ev.notes.length > 1 ? { midis: ev.notes.map((note) => note.midi) } : { midi: ev.notes[0]?.midi })),
    [events]
  );

  return (
    <div className="keys-ask">
      {showStaff && (
        <div className="keys-ask__staff">
          <SvgSequenceStaff
            notes={staffNotes}
            cursorIndex={cursorIndex}
            wrongMidi={wrongMidi}
            activeNotes={activeNotes}
            accidental={accidental}
            clef={clef ?? clefForAsk(events)}
          />
        </div>
      )}
      {isSequence && (
        <div className="keys-ask__badges">
          {events.map((_, index) => (
            <span
              key={index}
              className={`keys-ask__badge${index < cursorIndex ? ' is-done' : index === cursorIndex ? ' is-current' : ''}`}
            >
              {index + 1}
            </span>
          ))}
        </div>
      )}
      <div className="keys-ask__keys">
        <PianoKeyboard
          activeNotes={activeNotes}
          targetNotes={targetNotes}
          wrongNotes={wrongNotes}
          startNote={startNote}
          endNote={endNote}
        />
      </div>
    </div>
  );
}
