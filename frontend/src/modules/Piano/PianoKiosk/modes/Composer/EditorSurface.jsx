// EditorSurface.jsx — the Composer mode's integration surface: engraves the
// editor's score to MusicXML on every edit (P2: engrave-per-edit, no wet-ink
// pending layer), overlays the caret + sticky-duration HUD, wires MIDI note
// input + autosave, and hosts the in-editor toolbar (undo/redo + save status).
// This is the seam that ties Tasks 4-7 together into something a mode router
// can mount. It may edit a DRAFT (songId === null): the first edit materializes
// the song via `create`, and `onMaterialized(id, revision)` reports the new id.
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { MusicXmlRenderer } from '../../../../MusicNotation/renderers/MusicXmlRenderer.jsx';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import getLogger from '../../../../../lib/logging/Logger.js';
import { initEditor, serializeFromEditor, undo, redo } from './model/index.js';
import { useComposerInput } from './useComposerInput.js';
import { useAutosave } from './useAutosave.js';
import { CaretLayer } from './CaretLayer.jsx';
import { DurationPalette } from './DurationPalette.jsx';

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

// Autosave status → short human label for the toolbar. `idle` renders nothing
// (an untouched blank staff shouldn't shout a status at the kid).
const STATUS_LABEL = { saving: 'Saving…', saved: 'Saved', invalid: 'Fix note to save', error: "Couldn't save" };

export function EditorSurface({ initialScore, songId = null, initialRevision = 1, save, create, title, onMaterialized, config = {} }) {
  const [editorState, setEditorState] = useState(() => initEditor(initialScore));
  const [steps, setSteps] = useState([]);
  const { subscribe } = usePianoMidi();
  const { hud, setDuration, toggleDot, toggleArm, addRest } = useComposerInput({ setEditorState, subscribe });
  const { status, flush } = useAutosave({
    editorState,
    id: songId,
    revision: initialRevision,
    save,
    create,
    title,
    onMaterialized,
    idleMs: config.autosave_idle_ms || 3000,
  });

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

  const canUndo = (editorState.history?.past?.length || 0) > 0;
  const canRedo = (editorState.history?.future?.length || 0) > 0;
  const doUndo = useCallback(() => setEditorState((s) => undo(s)), []);
  const doRedo = useCallback(() => setEditorState((s) => redo(s)), []);
  const statusLabel = STATUS_LABEL[status] || '';

  return (
    <div className="composer-editor">
      <div className="composer-toolbar">
        <div className="composer-toolbar__history">
          <button type="button" onClick={doUndo} disabled={!canUndo} aria-label="Undo" title="Undo">↶</button>
          <button type="button" onClick={doRedo} disabled={!canRedo} aria-label="Redo" title="Redo">↷</button>
        </div>
        <DurationPalette hud={hud} setDuration={setDuration} toggleDot={toggleDot} toggleArm={toggleArm} addRest={addRest} />
        <span className={`composer-toolbar__status is-${status}`} aria-live="polite">{statusLabel}</span>
      </div>
      {/* Ink-on-paper: OSMD paints BLACK notation, so the staff lives on a white
          "sheet" page (like every notation app) — legible and it reads as real
          sheet music, not a dark widget. The caret positions against this page. */}
      <div className="composer-page">
        <MusicXmlRenderer musicXml={musicXml} flow="wrapped" scale={1} onLayout={onLayout}>
          <CaretLayer steps={steps} caretStepIndex={stepIdx} scale={1} />
        </MusicXmlRenderer>
      </div>
    </div>
  );
}
