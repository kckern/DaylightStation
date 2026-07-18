// EditorSurface.jsx — the Composer mode's integration surface: renders the score
// on TWO PLANES (spec §2.1) — a SETTLED score OSMD engraves rarely, and a
// wet-ink SVG layer that paints just-entered notes instantly — overlays the
// caret + sticky-duration HUD, wires MIDI note input + autosave, and hosts the
// in-editor toolbar (undo/redo + save status).
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
import { useWetInk } from './wetInk.js';
import { CaretLayer } from './CaretLayer.jsx';
import { PendingLayer } from './PendingLayer.jsx';
import { DurationPalette } from './DurationPalette.jsx';

// Wet-ink glyph geometry, in staff-line-spacing units. These MIRROR the private
// constants in PendingLayer.jsx (advance = lineSpacing * 2.4, notehead
// rx = lineSpacing * 0.62); that file exports no geometry and is owned
// elsewhere, so they are duplicated deliberately — keep the two in step or the
// anchor and the glyphs will disagree about where a note goes.
const WET_ADVANCE = 2.4;
const WET_RX = 0.62;
// Clef + key + time signature eat roughly this many staff spaces at the head of
// a system, so a bar with nothing engraved in it starts about here.
const MEASURE_START_UNITS = 8;

/** Which stave band a y pixel falls in — nearest band wins, so ledger-line notes
 *  above or below the staff still resolve to their own system. */
function systemForY(y, staves) {
  let best = 0;
  let bestDist = Infinity;
  staves.forEach((s, i) => {
    const bottom = s.top + s.lineSpacing * 4;
    const d = y < s.top ? s.top - y : (y > bottom ? y - bottom : 0);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}

/**
 * Where the FIRST wet-ink note should paint, in engraved pixel space, plus which
 * system it lands on. PendingLayer treats `anchorX` as a notehead CENTRE, while
 * an engraved step's `x` is its box LEFT edge — hence the half-width term.
 *
 * Three tiers, because the caret's bar is not always engraved:
 *  1. the caret's bar HAS engraved notes → one wet advance past the last one;
 *  2. it does not (a bar the previous settle just opened is still empty) → fall
 *     back to the last engraved note anywhere, plus a barline's breathing room;
 *  3. nothing is engraved at all (blank draft) → the head of the first system.
 * @returns {{x:number, system:number}|null} null when there is no geometry yet.
 */
export function wetInkAnchor({ steps = [], staves = [], caretMeasureIdx = 0 }) {
  if (!staves.length) return null;
  let inBar = null;
  for (let i = steps.length - 1; i >= 0; i--) {
    if ((steps[i].measure ?? 0) === caretMeasureIdx) { inBar = steps[i]; break; }
  }
  const box = (inBar || steps[steps.length - 1])?.notes?.[0];
  if (!box) return { x: staves[0].left + staves[0].lineSpacing * MEASURE_START_UNITS, system: 0 };

  const system = systemForY(box.top, staves);
  const staff = staves[system];
  const ls = staff.lineSpacing;
  const maxX = staff.right - ls * WET_RX; // never spill past the system's end
  const x = box.x + (box.width || ls) / 2 + ls * WET_ADVANCE;
  if (inBar) return { x: Math.min(x, maxX), system };

  // Tier 2: anchoring off the PREVIOUS bar's last note. If that bar ran to the
  // end of its system there is no room left, and OSMD would have opened the new
  // bar on the next system — follow it there rather than clamping several notes
  // into the margin, which stacks them into an unreadable pile.
  if (x > staff.right - ls * WET_ADVANCE * 2 && staves[system + 1]) {
    const next = staves[system + 1];
    return { x: next.left + next.lineSpacing * MEASURE_START_UNITS, system: system + 1 };
  }
  return { x: Math.min(x + ls, maxX), system };
}

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

/**
 * DISPLAY copy of the score in which every note-less measure carries a
 * full-measure rest. OSMD cannot engrave an empty measure (and a MusicXML bar
 * can't be truly empty), which makes this the fix for two shapes:
 *
 *  - the untouched DRAFT — a kid lands on a real clef'd staff to play into,
 *    rather than on nothing;
 *  - the EMPTY TRAILING BAR the two-plane split parks on. insertNote's
 *    exact-fill branch calls ensureMeasure, so the note that fills a bar opens
 *    an empty one behind it — exactly the state a 'structural' settle engraves.
 *    Serialized as-is OSMD throws ("Cannot read properties of undefined
 *    (reading 'StaffEntries')"), MusicXmlRenderer sets `failed` and stops
 *    rendering its children, so the staff AND both overlays blank out. Verified
 *    in headless Chromium 2026-07-18; it reproduces on the pre-split code too,
 *    where it self-heals on the next keystroke because that re-serializes.
 *    Under the split it persists for a whole bar.
 *
 * DRAWING the empty bar (rather than trimming it away) is also what gives wet
 * ink somewhere to go: the engraved system extends to cover the new bar, so the
 * anchor has room inside it. Trimmed, the system stops at the previous bar and
 * every pending note clamps onto its right margin in an unreadable pile —
 * observed, screenshotted, and fixed this way.
 *
 * Render-only and NEVER saved: autosave serializes editorState directly.
 */
function withDisplayRests(score) {
  const parts = score?.parts || [];
  if (!parts.some((p) => (p.measures || []).some((m) => !(m.notes || []).length))) return score;
  return {
    ...score,
    parts: parts.map((p) => ({
      ...p,
      measures: (p.measures || []).map((m) => ((m.notes || []).length ? m : { ...m, notes: [makeRest({ type: 'whole' })] })),
    })),
  };
}

export function serializeForDisplay(editorState) {
  return serializeFromEditor({ ...editorState, score: withDisplayRests(editorState?.score) });
}

export function EditorSurface({ initialScore, songId = null, initialRevision = 1, save, create, title, onMaterialized, config = {} }) {
  const logger = useMemo(() => getLogger().child({ component: 'composer-editor' }), []);
  const [editorState, setEditorState] = useState(() => initEditor(initialScore));
  const [layout, setLayout] = useState({ steps: [], staves: [] });
  const { steps, staves } = layout;
  const { subscribe } = usePianoMidi();
  const { hud, setDuration, toggleDot, toggleArm, addRest } = useComposerInput({ setEditorState, subscribe, logger });
  // Autosave consumes the LIVE editorState, never settledScore: the two-plane
  // split below is a RENDER concern, and persistence must never wait on an
  // engrave (a kid closing the mode mid-bar would lose the wet notes).
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

  // TWO RENDER PLANES (spec §2.1). OSMD engraves the SETTLED score only; notes
  // entered since then paint instantly as wet ink and dry at the next settle.
  const { settledScore, pending } = useWetInk({
    score: editorState.score,
    caretMeasureIdx: editorState.caret.measureIdx,
    idleMs: config.wetink_idle_ms || 600,
    logger,
  });

  // Keyed on settledScore ALONE, deliberately: re-serializing on every
  // editorState change is exactly the per-keypress engrave this split exists to
  // stop. Safe because serializeForDisplay reads nothing off editorState but
  // `.score` (serializeFromEditor → serializeMusicXml(state.score)).
  const musicXml = useMemo(
    () => serializeForDisplay({ ...editorState, score: settledScore }),
    [settledScore] // eslint-disable-line react-hooks/exhaustive-deps -- engrave the settled plane only
  );

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
  // The WHOLE extract is kept, not just `steps`: the wet-ink layer positions
  // against `staves` (per-system staff geometry), which is available even for a
  // note-less draft that has no steps at all.
  const onLayout = useCallback((res) => {
    const st = res?.steps || [];
    const sv = res?.staves || [];
    setLayout({ steps: st, staves: sv });
    logger.sampled('composer.editor.layout', { steps: st.length, staves: sv.length, width: res?.width, height: res?.height }, { maxPerMinute: 30, aggregate: true });
  }, [logger]);

  const stepIdx = caretStepIndex(settledScore, editorState.caret);

  const anchor = useMemo(
    () => wetInkAnchor({ steps, staves, caretMeasureIdx: editorState.caret.measureIdx }),
    [steps, staves, editorState.caret.measureIdx]
  );

  // While ink is wet the caret must stand past the LAST WET NOTE. Its engraved
  // position can't: caretStepIndex counts the model, `steps` is the last
  // engrave, and the difference is exactly the pending notes.
  const caretOverride = useMemo(() => {
    if (!pending.notes.length || !anchor) return null;
    const staff = staves[anchor.system];
    if (!staff) return null;
    const ls = staff.lineSpacing;
    return {
      x: Math.min(anchor.x + pending.notes.length * ls * WET_ADVANCE, staff.right),
      top: staff.top,
      height: Math.max(40, ls * 4),
    };
  }, [pending, anchor, staves]);

  const clef = editorState.score?.parts?.[0]?.clefs?.[1] || editorState.score?.parts?.[0]?.clefs?.['1'];

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
          <PendingLayer staves={staves} anchorX={anchor?.x ?? 0} anchorSystem={anchor?.system ?? 0} pending={pending.notes} clef={clef} />
          <CaretLayer steps={steps} caretStepIndex={stepIdx} scale={1} override={caretOverride} />
        </MusicXmlRenderer>
      </div>
    </div>
  );
}
