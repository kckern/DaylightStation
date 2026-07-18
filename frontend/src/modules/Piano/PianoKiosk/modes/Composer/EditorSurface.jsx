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
import { CaretLayer, CARET_GAP, CARET_WIDTH, NOTE_WIDTH_FALLBACK, MEASURE_START_UNITS, staveCaretMetrics } from './CaretLayer.jsx';
import { PendingLayer, WET_ADVANCE_UNITS, WET_RX_UNITS } from './PendingLayer.jsx';
import { DurationPalette } from './DurationPalette.jsx';

// The overlays own their own geometry; this file imports it rather than
// restating it, because the anchor below has to land ON the glyphs PendingLayer
// draws and the caret has to clear them by the same margin CaretLayer uses.
// MEASURE_START_UNITS in particular is SHARED with the caret's blank-staff
// position: tier 3 below and that caret must name the same spot, or a blank
// draft would promise the first note one place and paint it in another.

// The Composer engraves at a fixed zoom; kept as a named value so the caret's
// scale-dependent terms read the same here as they do inside CaretLayer.
const SCALE = 1;

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
 *
 * @param {number} pendingCount how many notes will paint from this anchor. Tier
 *   2 needs it: the wrap decision has to consider where the LAST note of the run
 *   lands, not the first. A bar of sixteenths can leave 8+ notes pending, and
 *   judging by note 0 alone would let notes 3-8 clamp onto the margin in a pile.
 * @returns {{x:number, system:number}|null} null when there is no geometry yet.
 */
export function wetInkAnchor({ steps = [], staves = [], caretMeasureIdx = 0, pendingCount = 1 }) {
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
  const maxX = staff.right - ls * WET_RX_UNITS; // never spill past the system's end
  const x = box.x + (box.width || NOTE_WIDTH_FALLBACK) / 2 + ls * WET_ADVANCE_UNITS;

  // Tier 1 has NO wrap escape, deliberately: the caret's bar is already engraved
  // on THIS system, so its notes belong here. Moving them to the next system
  // would be wrong, not merely unimplemented — the clamp is the only option.
  if (inBar) return { x: Math.min(x, maxX), system };

  // Tier 2: anchoring off the PREVIOUS bar's last note. If the pending run
  // wouldn't fit before the end of this system, OSMD will have opened the new
  // bar on the next one — follow it there rather than clamping the tail of the
  // run into the margin, which stacks those notes into an unreadable pile.
  const runEnd = x + Math.max(0, pendingCount - 1) * ls * WET_ADVANCE_UNITS;
  if (runEnd > maxX && staves[system + 1]) {
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
  // stop. The score is passed on its OWN rather than spread over editorState so
  // that this is trivially true — nothing else can leak in and go stale behind
  // the dependency list.
  const musicXml = useMemo(() => serializeForDisplay({ score: settledScore }), [settledScore]);

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
    () => wetInkAnchor({ steps, staves, caretMeasureIdx: editorState.caret.measureIdx, pendingCount: pending.notes.length }),
    [steps, staves, editorState.caret.measureIdx, pending.notes.length]
  );

  // While ink is wet the caret must stand past the LAST WET NOTE. Its engraved
  // position can't: caretStepIndex counts the model, `steps` is the last
  // engrave, and the difference is exactly the pending notes.
  //
  // COORDINATE CARE: `anchor.x` is a notehead CENTRE (PendingLayer draws with
  // it as `cx`), but CaretLayer positions by LEFT EDGE. So this walks to the
  // last wet note's centre, out to its right edge (+rx), then clears it by the
  // same CARET_GAP the engraved path uses.
  //
  // The caret still shifts a little when ink dries, and that is EXPECTED —
  // measured against a real engrave (2026-07-18, lineSpacing 10): ~11.6px of it
  // is the NOTE itself moving, because the wet layer lays notes at a fixed
  // advance while OSMD spaces them by duration and justifies the bar. The rest
  // (~6px) is the engraved caret measuring from the layout box of the whole
  // stavenote (notehead + stem) where this measures from the notehead alone.
  // Neither is fixable here; chasing them by padding this number would only
  // mis-place the caret against the glyph actually drawn.
  const caretOverride = useMemo(() => {
    if (!pending.notes.length || !anchor) return null;
    const staff = staves[anchor.system];
    if (!staff) return null;
    const ls = staff.lineSpacing;
    const lastCentre = anchor.x + (pending.notes.length - 1) * ls * WET_ADVANCE_UNITS;
    return {
      // Clamp the caret's RIGHT edge to the system end, so the caret itself
      // can't spill into the margin the noteheads are kept out of.
      x: Math.min(lastCentre + ls * WET_RX_UNITS + CARET_GAP * SCALE, staff.right - CARET_WIDTH * SCALE),
      // Vertical extent comes from CaretLayer's own helper, so the wet caret,
      // the blank-staff caret and the engraved caret all occupy the same band —
      // the caret must not change HEIGHT or jump vertically when ink dries.
      ...staveCaretMetrics(staff, SCALE),
    };
  }, [pending, anchor, staves]);

  const clef = editorState.score?.parts?.[0]?.clefs?.[1];

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
        <MusicXmlRenderer musicXml={musicXml} flow="wrapped" scale={SCALE} onLayout={onLayout}>
          <PendingLayer staves={staves} anchorX={anchor?.x ?? 0} anchorSystem={anchor?.system ?? 0} pending={pending.notes} clef={clef} />
          <CaretLayer steps={steps} staves={staves} caretStepIndex={stepIdx} scale={SCALE} override={caretOverride} />
        </MusicXmlRenderer>
        {/* The invitation. Blank-staff-first is the design, but the arm toggle
            defaults OFF, so without this a kid sits down, plays, and nothing at
            all happens. Reads off the LIVE score (not settledScore), so it
            clears on the first note while that note is still wet ink.
            COPY COUPLING: "Play" is the literal label DurationPalette's arm
            button carries while disarmed. A later task renames it to "Write" —
            rename it here in the same change (EditorSurface.test.jsx asserts
            the two match, so it will fail loudly if they drift). */}
        {!scoreHasNotes(editorState.score) && !pending.notes.length && (
          <p className="composer-page__hint">Pick a note length, then play a key on the piano. Tap Play to arm it so your notes land here.</p>
        )}
      </div>
    </div>
  );
}
