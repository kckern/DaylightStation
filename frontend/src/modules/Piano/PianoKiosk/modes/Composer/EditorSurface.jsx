// EditorSurface.jsx — the Composer mode's integration surface: engraves the
// editor's score to MusicXML on every edit (P2: engrave-per-edit, no wet-ink
// pending layer), overlays the caret + sticky-duration HUD, wires MIDI note
// input + autosave, and hosts the in-editor toolbar (undo/redo + save status).
// This is the seam that ties Tasks 4-7 together into something a mode router
// can mount. It may edit a DRAFT (songId === null): the first edit materializes
// the song via `create`, and `onMaterialized(id, revision)` reports the new id.
//
// OBSERVABILITY: this file is the diagnostic hub for the editor. Under the
// `composer-editor` child logger it emits the full edit→engrave→layout→caret
// loop — model state on every edit (debug), the engrave output + blank-staff
// fallback (debug), OSMD layout results (sampled, since resize re-fires),
// caret step resolution (debug), and undo/redo (info) — so any "note didn't
// appear / caret drifted / staff blank / didn't save" report is traceable from
// the logs alone.
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { MusicXmlRenderer } from '../../../../MusicNotation/renderers/MusicXmlRenderer.jsx';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import getLogger from '../../../../../lib/logging/Logger.js';
import { initEditor, serializeFromEditor, undo, redo, makeRest } from './model/index.js';
import { useComposerInput } from './useComposerInput.js';
import { useAutosave } from './useAutosave.js';
import { CaretLayer } from './CaretLayer.jsx';
import { DurationPalette } from './DurationPalette.jsx';

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

function scoreHasNotes(score) {
  return (score?.parts || []).some((p) => (p.measures || []).some((m) => (m.notes || []).length > 0));
}

function countNotes(score) {
  let n = 0;
  for (const p of score?.parts || []) for (const m of p.measures || []) n += (m.notes || []).length;
  return n;
}

// Blank-staff render: OSMD cannot engrave a note-less measure (and a MusicXML
// bar can't be truly empty), so an untouched draft is DISPLAYED as a single
// full-measure rest — a real clef'd staff, ready to play into. This copy is
// render-only and NEVER saved: autosave fires only once a real edit dirties the
// score, by which point it has genuine content and this branch no longer runs.
function serializeForDisplay(editorState) {
  if (scoreHasNotes(editorState?.score)) return serializeFromEditor(editorState);
  const score = editorState.score;
  const measures = score.parts[0].measures.slice();
  measures[0] = { ...measures[0], notes: [makeRest({ type: 'whole' })] };
  const parts = [{ ...score.parts[0], measures }, ...score.parts.slice(1)];
  return serializeFromEditor({ ...editorState, score: { ...score, parts } });
}

export function EditorSurface({ initialScore, songId = null, initialRevision = 1, save, create, title, onMaterialized, config = {} }) {
  const logger = useMemo(() => getLogger().child({ component: 'composer-editor' }), []);
  const [editorState, setEditorState] = useState(() => initEditor(initialScore));
  const [steps, setSteps] = useState([]);
  const { subscribe } = usePianoMidi();
  const { hud, setDuration, toggleDot, toggleArm, addRest } = useComposerInput({ setEditorState, subscribe, logger });
  const { status, flush } = useAutosave({
    editorState,
    id: songId,
    revision: initialRevision,
    save,
    create,
    title,
    onMaterialized,
    idleMs: config.autosave_idle_ms || 3000,
    logger,
  });

  // flush() closes over the LATEST autosave state via useAutosave's own
  // useCallback deps, but the unmount cleanup below only runs once — keep a
  // ref to the current flush so it always calls the up-to-date function
  // (autosave-on-exit: don't lose the last few keystrokes' edits).
  const flushRef = useRef(flush);
  flushRef.current = flush;
  const songIdRef = useRef(songId);
  songIdRef.current = songId;

  // Mount / unmount. songId in the mount log is the value at MOUNT (null for a
  // fresh draft); the unmount log reads the ref so a draft that materialized
  // mid-life reports the id it ended up with.
  useEffect(() => {
    logger.info('composer.editor.mounted', { songId: songId ?? null, isDraft: songId == null, initialRevision });
    return () => {
      logger.info('composer.editor.unmounted', { songId: songIdRef.current ?? null });
      flushRef.current?.(); // autosave-on-exit
    };
  }, [logger]); // eslint-disable-line react-hooks/exhaustive-deps -- mount-once lifecycle log

  const musicXml = useMemo(() => serializeForDisplay(editorState), [editorState]);

  // Model state + engrave output on EVERY edit (debug). One record per editorState
  // change carries the whole picture: note/measure counts, caret, dirty/revision,
  // undo depth, the engraved XML length, and whether the blank-staff fallback ran.
  useEffect(() => {
    const s = editorState;
    logger.debug('composer.editor.state', {
      measures: s.score?.parts?.[0]?.measures?.length || 0,
      notes: countNotes(s.score),
      caret: { measureIdx: s.caret.measureIdx, noteIdx: s.caret.noteIdx },
      dirty: s.dirty,
      revision: s.revision,
      historyPast: s.history?.past?.length || 0,
      historyFuture: s.history?.future?.length || 0,
      xmlLen: musicXml.length,
      blankStaff: !scoreHasNotes(s.score),
    });
  }, [editorState, musicXml, logger]);

  // OSMD layout result. Sampled — a ResizeObserver re-engrave re-fires onLayout
  // without any edit, so an unsampled log could storm on a flapping viewport.
  const onLayout = useCallback((res) => {
    const st = res?.steps || [];
    setSteps(st);
    logger.sampled('composer.editor.layout', { steps: st.length, width: res?.width, height: res?.height }, { maxPerMinute: 30, aggregate: true });
  }, [logger]);

  const stepIdx = caretStepIndex(editorState.score, editorState.caret);

  // Caret resolution: where the engraved caret landed vs the model caret. Keyed
  // on stepIdx so it logs on movement, not on every render.
  useEffect(() => {
    logger.debug('composer.editor.caret', {
      stepIdx,
      measureIdx: editorState.caret.measureIdx,
      noteIdx: editorState.caret.noteIdx,
      engravedSteps: steps.length,
      resolved: steps.length > 0 && stepIdx <= steps.length,
    });
  }, [stepIdx, logger]); // eslint-disable-line react-hooks/exhaustive-deps -- fire on caret-step change

  const canUndo = (editorState.history?.past?.length || 0) > 0;
  const canRedo = (editorState.history?.future?.length || 0) > 0;
  const doUndo = useCallback(() => {
    if (!canUndo) return;
    logger.info('composer.editor.undo', { remainingPast: (editorState.history?.past?.length || 1) - 1 });
    setEditorState((s) => undo(s));
  }, [canUndo, editorState, logger]);
  const doRedo = useCallback(() => {
    if (!canRedo) return;
    logger.info('composer.editor.redo', { remainingFuture: (editorState.history?.future?.length || 1) - 1 });
    setEditorState((s) => redo(s));
  }, [canRedo, editorState, logger]);
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
