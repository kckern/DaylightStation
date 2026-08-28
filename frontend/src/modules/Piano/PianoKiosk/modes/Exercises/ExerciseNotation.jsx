import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AbcRenderer } from '../../../../MusicNotation/renderers/AbcRenderer.jsx';
import { SvgSequenceStaff, sequenceStaffViewBox } from '../../../../MusicNotation/renderers/SvgSequenceStaff.jsx';
import { instanceToAbc } from './exerciseAbc.js';
import {
  accidentalForKey, clefForInstance, eventsToStaffNotes, instanceKeySignature,
} from './runPresentation.js';

const FEEDBACK = ['exercise-note-done', 'exercise-note-next', 'exercise-note-wrong'];

export default function ExerciseNotation({ instance, eventIndex = 0, wrong = false, complete = false, preview = false }) {
  const staffRef = useRef([]);
  const abc = useMemo(() => instanceToAbc(instance), [instance]);
  const paint = useCallback(() => {
    for (const staff of staffRef.current) {
      staff.forEach((note, index) => {
        note.els.forEach((element) => {
          element.classList.remove(...FEEDBACK);
          if (preview) return;
          if (complete || index < eventIndex) element.classList.add('exercise-note-done');
          else if (index === eventIndex) element.classList.add(wrong ? 'exercise-note-wrong' : 'exercise-note-next');
        });
      });
    }
  }, [complete, eventIndex, preview, wrong]);
  useEffect(paint, [paint]);
  const rendered = useCallback((_tune, staffNotes) => { staffRef.current = staffNotes; paint(); }, [paint]);
  // instanceToAbc returns '' for material this module has no business drawing
  // (ordering:'any' — that plays through KeysAsk/SvgSequenceStaff instead).
  // AbcRenderer given abc="" still mounts a real, empty-tune SVG; render
  // nothing rather than that hairline artifact.
  if (!abc) return null;
  return <AbcRenderer abc={abc} scale={preview ? 0.72 : 1} singleLine={!preview} fitContent onRender={rendered} />;
}

/**
 * The exercise browser's preview card — what an instance LOOKS like, before
 * anybody plays it.
 *
 * The card mounted `ExerciseNotation` alone, and `instanceToAbc` answers `''`
 * for `ordering: 'any'`, so the component rendered `null` and the card was
 * blank for every one of the 1,128 unordered instances the bank publishes:
 * `chords/*`, `intervals/all`, `notes/single`. Those had no notation anywhere —
 * the run stage draws them as lit keys, and the browser drew nothing at all,
 * which reads as an exercise with no music in it.
 *
 * `SvgSequenceStaff` is the renderer that CAN draw them: an unordered ask is
 * one simultaneity, and it takes exactly that as a single `{ midis: [...] }`
 * column. There is no cursor on a preview — `cursorIndex: -1` puts every column
 * in the `todo` state and draws no cursor rect — because nothing is being
 * played yet, and a "next note" marker on a card would be a promise the card
 * cannot keep. Ordered material keeps the ABC path it already had.
 */
export function ExercisePreview({ instance }) {
  const staffNotes = useMemo(
    () => (instance?.ordering === 'any' ? eventsToStaffNotes(instance.events) : null),
    [instance],
  );
  // Ordered material keeps the card it already had, props and all — this
  // component exists to fill a hole, not to restyle what was already drawn.
  if (!staffNotes) return <ExerciseNotation instance={instance} />;
  if (!staffNotes.length) return null;
  const viewBox = sequenceStaffViewBox(staffNotes.length);
  return (
    <div
      className="piano-exercises__preview-staff"
      style={{ '--staff-aspect': viewBox.width / viewBox.height }}
    >
      <SvgSequenceStaff
        notes={staffNotes}
        cursorIndex={-1}
        clef={clefForInstance(instance)}
        accidental={accidentalForKey(instanceKeySignature(instance))}
      />
    </div>
  );
}
