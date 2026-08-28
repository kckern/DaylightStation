import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AbcRenderer } from '../../../../MusicNotation/renderers/AbcRenderer.jsx';
import { instanceToAbc } from './exerciseAbc.js';

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
  return <AbcRenderer abc={abc} scale={preview ? 0.72 : 1} singleLine={!preview} fitContent onRender={rendered} />;
}
