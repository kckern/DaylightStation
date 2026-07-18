// EditorSurface.jsx — the Composer mode's integration surface: engraves the
// editor's score to MusicXML on every edit (P2: engrave-per-edit, no wet-ink
// pending layer), overlays the caret + sticky-duration HUD, and wires MIDI
// note input + autosave. This is the seam that ties Tasks 4-7 together into
// something a mode router can mount.
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { MusicXmlRenderer } from '../../../../MusicNotation/renderers/MusicXmlRenderer.jsx';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import getLogger from '../../../../../lib/logging/Logger.js';
import { initEditor, serializeFromEditor } from './model/index.js';
import { useComposerInput } from './useComposerInput.js';
import { useAutosave } from './useAutosave.js';
import { CaretLayer } from './CaretLayer.jsx';
import { StickyDurationHud } from './StickyDurationHud.jsx';

const logger = () => getLogger().child({ component: 'piano-composer' });

// Caret model position → engraved step index. The renderer's buildSteps
// (osmdRender.js) groups same-onset notes — chords — into a SINGLE step, but
// the model stores each chord note as its own array entry flagged `chord:
// true` (model/editor.js). So a step index must count ONSET notes only (i.e.
// notes where !note.chord), never raw note-array length, or the caret drifts
// right by (chord-size - 1) per chord at/before it. The renderer's buildSteps
// also EXCLUDES rests entirely (`n.isRest()` — osmdRender.js ~line 40), so a
// model rest (makeRest: `rest: true`, no `chord` field) must be excluded here
// too, or the caret drifts right by the rest count.
export function caretStepIndex(score, caret) {
  const measures = score?.parts?.[0]?.measures || [];
  const onsets = (notes = [], upto = notes.length) => notes.slice(0, upto).filter((n) => !n.chord && !n.rest).length;
  let idx = 0;
  for (let m = 0; m < caret.measureIdx; m++) idx += onsets(measures[m]?.notes);
  return idx + onsets(measures[caret.measureIdx]?.notes, caret.noteIdx);
}

export function EditorSurface({ initialScore, songId, initialRevision = 1, save, config = {} }) {
  const [editorState, setEditorState] = useState(() => initEditor(initialScore));
  const [steps, setSteps] = useState([]);
  const { subscribe } = usePianoMidi();
  const { hud } = useComposerInput({ setEditorState, subscribe });
  const { flush } = useAutosave({ editorState, id: songId, revision: initialRevision, save, idleMs: config.autosave_idle_ms || 3000 });

  // flush() closes over the LATEST autosave state via useAutosave's own
  // useCallback deps, but the unmount cleanup below only runs once — keep a
  // ref to the current flush so it always calls the up-to-date function
  // (autosave-on-exit: don't lose the last few keystrokes' edits).
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => { flushRef.current?.(); }, []);

  useEffect(() => { logger().info('composer.mounted', { songId }); }, [songId]);

  const musicXml = useMemo(() => serializeFromEditor(editorState), [editorState]);
  const onLayout = useCallback((res) => { setSteps(res?.steps || []); }, []);
  const stepIdx = caretStepIndex(editorState.score, editorState.caret);

  return (
    <div className="composer-editor">
      <StickyDurationHud hud={hud} />
      <MusicXmlRenderer musicXml={musicXml} flow="wrapped" scale={1} onLayout={onLayout}>
        <CaretLayer steps={steps} caretStepIndex={stepIdx} scale={1} />
      </MusicXmlRenderer>
    </div>
  );
}
