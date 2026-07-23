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
import { record, intern, KIND, startRecorder, stopRecorder } from '../../../../../lib/logging/inputRecorder.js';
import { inputTelemetryEnabled, makeInputSender } from '../../../../../lib/logging/inputTelemetryGate.js';
import { midiToRecord } from '../SheetMusic/midiTap.js';
import { initEditor, serializeFromEditor, undo, redo, makeRest } from './model/index.js';
import { useComposerInput } from './useComposerInput.js';
import { useAutosave } from './useAutosave.js';
import { useScoreTransport } from '../../score/useScoreTransport.js';
import { buildComposerTimeline } from './playTimeline.js';
import { useWetInk } from './wetInk.js';
import { CaretLayer, CARET_GAP, CARET_WIDTH, NOTE_WIDTH_FALLBACK, MEASURE_START_UNITS, staveCaretMetrics, systemForY } from './CaretLayer.jsx';
import { PendingLayer, WET_ADVANCE_UNITS, WET_RX_UNITS } from './PendingLayer.jsx';
import { DurationPalette } from './DurationPalette.jsx';
import { ComposerHelp } from './ComposerHelp.jsx';
import { IconUndo, IconRedo, IconPlay, IconPause, IconSongs, IconInfo } from './icons.jsx';

// The overlays own their own geometry; this file imports it rather than
// restating it, because the anchor below has to land ON the glyphs PendingLayer
// draws and the caret has to clear them by the same margin CaretLayer uses.
// MEASURE_START_UNITS in particular is SHARED with the caret's blank-staff
// position: tier 3 below and that caret must name the same spot, or a blank
// draft would promise the first note one place and paint it in another.

// ZOOM. The Composer used to engrave at OSMD zoom 1 inside a fixed 60rem page:
// on the 8" kiosk tablet that put a tiny staff in the corner of a big blank
// card. Notation for a child should be the largest thing on the screen, so the
// default is 1.4 and `config.composer.zoom` can move it.
//
// ONE NUMBER, TWO CONSUMERS — this is the correctness constraint. OSMD's layout
// output is already in ZOOMED screen pixels: `staves[].lineSpacing` is
// 10px/unit x zoom (osmdRender.js) and `steps[].x/width` are DOM boxes. So
// anything derived from those is zoom-correct for free — which is why
// PendingLayer, written entirely in lineSpacing multiples, needs no zoom at
// all. What is NOT free are CaretLayer's fixed-pixel constants (CARET_GAP,
// CARET_WIDTH, its 40px height floor): it multiplies those by its own `scale`
// prop. Feed CaretLayer a `scale` that differs from the engrave zoom and the
// caret sits (zoom - 1) * CARET_GAP away from the notehead it is supposed to
// clear. Hence: the value below goes to MusicXmlRenderer's `scale` AND to
// CaretLayer's `scale` AND to the wet-caret override's gap term — never a
// literal, never a second constant.
export const DEFAULT_ZOOM = 1.4;

// How many measures a sheet shows even when the model has fewer. Manuscript
// paper is ruled ahead of what is written on it; a lone bar fragment on a big
// white card reads as a broken widget instead of something to fill in.
export const DISPLAY_MIN_BARS = 4;

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
export function withDisplayRests(score) {
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

/**
 * DISPLAY copy padded out to look like ruled manuscript paper: bars the model
 * does not have, appended so the sheet always shows something to fill in.
 *
 * Two rules, whichever asks for more:
 *  - a floor of `minBars`, so an untouched draft is a page of empty systems
 *    rather than one bar fragment adrift on a white card;
 *  - one empty RUNWAY bar past the last bar that has notes, so a kid writing
 *    into the last bar can always see where the next one goes.
 *
 * The runway is measured from the last FILLED bar, not from the model's length,
 * so the empty trailing bar ensureMeasure already opened counts AS the runway
 * instead of earning a second one behind it.
 *
 * Purely additive and non-mutating: the bars are appended to a copy. Autosave
 * serializes editorState directly (useAutosave), so none of this is ever saved.
 */
export function padDisplayMeasures(score, minBars = DISPLAY_MIN_BARS) {
  const parts = score?.parts || [];
  if (!parts.length) return score;
  let lastFilled = -1;
  let modelBars = 0;
  for (const p of parts) {
    const ms = p.measures || [];
    if (ms.length > modelBars) modelBars = ms.length;
    for (let i = 0; i < ms.length; i++) if ((ms[i].notes || []).length) lastFilled = Math.max(lastFilled, i);
  }
  const wanted = Math.max(minBars, lastFilled + 2); // +1 index→count, +1 runway
  if (wanted <= modelBars) return score;
  return {
    ...score,
    parts: parts.map((p) => {
      const measures = (p.measures || []).slice();
      while (measures.length < wanted) measures.push({ number: measures.length + 1, notes: [] });
      return { ...p, measures };
    }),
  };
}

// Pad FIRST, then rest: the bars padding appends are note-less, and a note-less
// bar is exactly what OSMD cannot engrave.
export function serializeForDisplay(editorState, minBars = DISPLAY_MIN_BARS) {
  const score = withDisplayRests(padDisplayMeasures(editorState?.score, minBars));
  return serializeFromEditor({ ...editorState, score });
}

/**
 * The song's NAME, and the only way in the mode to give it one.
 *
 * A draft used to show no name anywhere and offer no control to set one, so a
 * kid's song stayed "Untitled" in the gallery no matter how much work went into
 * it. Naming it is the first step of the work having a life off this screen.
 *
 * Tap-to-edit rather than a permanent field: the toolbar is already dense on an
 * 8" tablet, and the name is read far more often than it is written. Commits on
 * Enter AND on blur, because a kid finishing a name taps the staff to get back
 * to work — they do not press Enter. Escape abandons.
 *
 * ONE-SHOT COMMIT: Enter sets `editing` false, which in a real browser also
 * fires blur on the disappearing input. `doneRef` makes the second call a
 * no-op, and is also what keeps Escape's blur from committing the discarded
 * draft — the bug that would make Escape silently mean "save anyway".
 *
 * Commits UNCONDITIONALLY (even when the name is unchanged) and leaves
 * "is this actually different from what's on disk?" to useAutosave, which is
 * the layer that knows what was persisted.
 */
function TitleControl({ title, onRename, logger, onTap }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const doneRef = useRef(false);

  const open = useCallback(() => {
    setDraft(title || '');
    doneRef.current = false;
    setEditing(true);
    onTap?.('title');
    logger.debug('composer.title.edit-start', { named: !!title });
  }, [title, logger, onTap]);

  const commit = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    setEditing(false);
    const next = (draft || '').trim(); // whitespace-only is no name at all
    logger.info('composer.title.rename', { length: next.length, named: !!next });
    onRename?.(next);
  }, [draft, onRename, logger]);

  const cancel = useCallback(() => {
    doneRef.current = true;
    setEditing(false);
    logger.debug('composer.title.edit-cancel', {});
  }, [logger]);

  if (editing) {
    return (
      <input
        className="composer-toolbar__title-input"
        aria-label="Song name"
        value={draft}
        // autoFocus so naming is ONE tap, not tap-then-tap-again.
        autoFocus
        maxLength={60}
        placeholder="Name your song"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') cancel();
        }}
        onBlur={commit}
      />
    );
  }
  return (
    <button
      type="button"
      className={`composer-toolbar__title${title ? '' : ' is-unnamed'}`}
      onClick={open}
      aria-label={title ? `Rename ${title}` : 'Name your song'}
      title={title ? 'Rename your song' : 'Name your song'}
    >
      {title || 'Name your song'}
    </button>
  );
}

export function EditorSurface({ initialScore, songId = null, initialRevision = 1, save, create, title, onRename, onMaterialized, onSongs, config = {}, logger: loggerProp }) {
  // Derive the editor's `composer-editor` child from the mode logger when hosted
  // by Composer (so its events inherit app + sessionLog routing), and fall back
  // to a bare root child when mounted standalone (the verification harnesses and
  // several tests do exactly that).
  const logger = useMemo(
    () => (loggerProp ? loggerProp.child({ component: 'composer-editor' }) : getLogger().child({ component: 'composer-editor' })),
    [loggerProp],
  );
  // UI-intent + input→paint tap for toolbar controls (mirrors SheetMusic's
  // ScorePlayer.tapIntent). Records the intent immediately, then the input→paint
  // latency for the same control on the next frame. The editor has no cursor step
  // to tag, so slot c is 0. intern caches the control name, so repeats are cheap.
  const tapIntent = useCallback((name) => {
    const id = intern(name);
    record(KIND.UI_INTENT, id, 0, 0, 0);
    const t0 = performance.now();
    requestAnimationFrame(() => record(KIND.TAP, id, Math.round(performance.now() - t0), 0, 0));
  }, []);

  const [editorState, setEditorState] = useState(() => initEditor(initialScore));
  const [layout, setLayout] = useState({ steps: [], staves: [] });
  const [helpOpen, setHelpOpen] = useState(false);
  const { steps, staves } = layout;
  const { subscribe, subscribeRaw, sendNoteAt, sendNoteOffAt, sendPanic } = usePianoMidi();
  // See DEFAULT_ZOOM: this single value drives the engrave AND every caret term
  // that is measured in fixed pixels. They must not diverge.
  const zoom = config.zoom ?? DEFAULT_ZOOM;
  const minBars = config.display_min_bars ?? DISPLAY_MIN_BARS;

  // ---- PLAYBACK -----------------------------------------------------------
  // The mode's only way to HEAR what you wrote. Driven by the shared
  // useScoreTransport (score/), the same two-plane transport SheetMusic uses:
  // audio is handed to the MIDI service AHEAD of time with wall timestamps, so
  // it stays in tempo through main-thread jank on the kiosk tablet.
  //
  // The timeline is a SNAPSHOT taken when playback starts, not a live derivation
  // of editorState. useScoreTransport indexes into the array it was last handed;
  // swapping it mid-run under those indices would skip, repeat or strand notes.
  // So an edit made while playing changes the score for the NEXT run, and the
  // current run finishes coherently.
  const [playSpec, setPlaySpec] = useState(null);
  const playTimeline = useMemo(
    () => (playSpec ? buildComposerTimeline(playSpec.score, { startAtMeasure: playSpec.startAtMeasure }) : []),
    [playSpec],
  );

  // Everything the transport has sounded and not yet released. Playback is the
  // ONLY sender here, so a panic can never cut off a note the kid is holding on
  // the piano — but the ledger still avoids a pointless broadcast when silent.
  const soundingRef = useRef(new Set());
  const transportRef = useRef(null);
  const flushTimerRef = useRef(null);
  // Sends already handed to the MIDI service CANNOT be recalled (useScoreTransport's
  // header; MIDIOutput.clear() is unreliable on this WebView). So flush TWICE, the
  // contract ScorePlayer's silenceScheduled established: once now for everything
  // sounding, and once more after the lookahead window for note-ons that dispatch
  // after the first flush. Every pending timestamp is <= now + lookahead, so the
  // delayed panic covers the whole tail.
  const silenceScheduled = useCallback(() => {
    if (soundingRef.current.size) {
      soundingRef.current.clear();
      sendPanic?.();
    }
    clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => sendPanic?.(), (transportRef.current?.lookaheadMs ?? 400) + 60);
  }, [sendPanic]);

  const transport = useScoreTransport({
    timeline: playTimeline,
    // AUDIO PLANE — runs up to lookaheadMs ahead of due time and must touch no
    // React state; the sends carry the transport's wall timestamp so the MIDI
    // service dispatches them in tempo even if this tick woke late.
    onSchedule: (e, atWall) => {
      if (e.type === 'note_on') {
        sendNoteAt?.(e.note, e.velocity ?? 80, atWall);
        soundingRef.current.add(e.note);
      } else {
        sendNoteOffAt?.(e.note, atWall);
        soundingRef.current.delete(e.note);
      }
    },
    onDone: () => {
      // Note-offs are gated to 90%, so the last one is already scheduled — but
      // flush anyway: a note whose off was dropped (unplayable type, echo of a
      // mid-run edit) would otherwise drone forever with the transport stopped.
      silenceScheduled();
      logger.info('composer.transport.done', { events: playTimeline.length });
    },
  });
  transportRef.current = transport;

  const playingRef = useRef(false);
  playingRef.current = transport.playing;

  const togglePlay = useCallback(() => {
    tapIntent('play'); // capture the transport tap on both the play and pause edges
    if (playingRef.current) {
      transportRef.current?.pause();
      silenceScheduled();
      logger.info('composer.transport.pause', {});
      return;
    }
    setPlaySpec({ score: editorState.score, startAtMeasure: editorState.caret.measureIdx });
  }, [editorState.score, editorState.caret.measureIdx, silenceScheduled, logger, tapIntent]);

  // Start on the render AFTER the snapshot lands, because useScoreTransport reads
  // its timeline from the props of the current render — calling play() inside
  // togglePlay would run the PREVIOUS snapshot (or, on the first play, nothing).
  const startedRef = useRef(null);
  useEffect(() => {
    if (!playSpec || startedRef.current === playSpec) return;
    startedRef.current = playSpec;
    if (!playTimeline.length) {
      logger.info('composer.transport.empty', { startAtMeasure: playSpec.startAtMeasure });
      return;
    }
    transportRef.current?.stop(); // rewind: this is a fresh timeline, not a resume
    transportRef.current?.play();
    logger.info('composer.transport.play', {
      startAtMeasure: playSpec.startAtMeasure,
      tempo: playSpec.score?.tempo ?? null,
      events: playTimeline.length,
    });
  }, [playSpec, playTimeline, logger]);

  // Leaving the mode mid-playback must not leave the piano droning. No
  // clearTimeout here on purpose: silenceScheduled's delayed panic is DESIRED
  // after we're gone, since sends already dispatched into the lookahead window
  // would otherwise sound with no note-off. sendPanic comes from the MIDI
  // context, which outlives this component.
  useEffect(() => () => { transportRef.current?.stop(); silenceScheduled(); }, [silenceScheduled]);

  const { hud, setDuration, toggleDot, toggleArm, addRest, deleteBack } = useComposerInput({
    setEditorState, subscribe, logger, onTogglePlay: togglePlay, playing: transport.playing,
  });
  // Autosave consumes the LIVE editorState, never settledScore: the two-plane
  // split below is a RENDER concern, and persistence must never wait on an
  // engrave (a kid closing the mode mid-bar would lose the wet notes).
  // `meta` is what actually carries a RENAME to the server: the PUT applies
  // `meta.title ?? current`, so before this the editor sent `meta: undefined`
  // and a renamed song kept its old name on disk forever. MEMOIZED on purpose —
  // a fresh object each render would change useAutosave's doSave identity every
  // render, which re-arms its debounce every render and means it never fires.
  const meta = useMemo(() => ({ title: (title || '').trim() }), [title]);
  const { status, flush } = useAutosave({
    editorState,
    id: songId,
    revision: initialRevision,
    save,
    create,
    title,
    meta,
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

  // Raw-input telemetry: mirror the FULL-fidelity MIDI byte stream (note-on/off,
  // sustain, CC) into the zero-alloc recorder ring, independent of the editor's
  // parsed `subscribe` (which only relays note-ons for armed entry). Reuses
  // SheetMusic's pure midiToRecord classifier. Always on — recording is cheap and
  // shipping is gated elsewhere. emitRaw wraps bytes as { data, time }, so the
  // listener reads evt?.data (NOT the bare byte array).
  useEffect(() => {
    if (!subscribeRaw) return undefined;
    const off = subscribeRaw((evt) => { const r = midiToRecord(evt?.data); if (r) record(r.kind, r.a, r.b, 0, 0); });
    return off;
  }, [subscribeRaw]);

  // ── Input-telemetry recorder lifecycle (config-gated shipping) ────────────────
  // The ring records unconditionally (raw MIDI above, toolbar taps via tapIntent);
  // this only controls DRAINING it to the backend. start/stop are shared by the
  // config-gated auto lifecycle and the window.__INPUT_REC__ kill switch, so the
  // manual lever and the config path use the same one-event-per-batch sender.
  // Copied from SheetMusic's ScorePlayer with composer-specific args: the
  // piano-composer app tag, a draft-safe score id, and this file's `config` prop.
  const inputSessionRef = useRef(null);
  const startInputRec = useCallback(() => {
    const session = new Date().toISOString();
    inputSessionRef.current = session;
    startRecorder({ session, score: songId ?? 'draft', ctx: { user: config?.user?.id }, send: makeInputSender('piano-composer'), flushMs: 1000 });
  }, [songId, config]);
  const stopInputRec = useCallback(() => { stopRecorder(); inputSessionRef.current = null; }, []);

  // Kill switch: a deploy-free off/on lever, installed regardless of config so the
  // recorder can be started/stopped from the console even when shipping is off.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__INPUT_REC__ = {
      start: startInputRec,
      stop: stopInputRec,
      status: () => ({ enabled: inputSessionRef.current != null, session: inputSessionRef.current }),
    };
    return () => { if (window.__INPUT_REC__) window.__INPUT_REC__ = undefined; };
  }, [startInputRec, stopInputRec]);

  // Config-gated auto lifecycle: ship input telemetry for this song only when the
  // household config opts in. Re-arms on a song change; stops on unmount/disable.
  useEffect(() => {
    if (!inputTelemetryEnabled(config, 'composer')) return undefined;
    startInputRec();
    return () => stopInputRec();
  }, [songId, config, startInputRec, stopInputRec]);

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
  const musicXml = useMemo(() => serializeForDisplay({ score: settledScore }, minBars), [settledScore, minBars]);

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
      x: Math.min(lastCentre + ls * WET_RX_UNITS + CARET_GAP * zoom, staff.right - CARET_WIDTH * zoom),
      // Vertical extent comes from CaretLayer's own helper, so the wet caret,
      // the blank-staff caret and the engraved caret all occupy the same band —
      // the caret must not change HEIGHT or jump vertically when ink dries.
      ...staveCaretMetrics(staff, zoom),
    };
  }, [pending, anchor, staves, zoom]);

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
    record(KIND.EDIT, intern('undo'), 0, 0, 0);
    tapIntent('undo');
    setEditorState((s) => undo(s));
  }, [canUndo, editorState, logger, tapIntent]);
  const doRedo = useCallback(() => {
    if (!canRedo) return;
    logger.info('composer.editor.redo', { remainingFuture: (editorState.history?.future?.length || 1) - 1 });
    record(KIND.EDIT, intern('redo'), 0, 0, 0);
    tapIntent('redo');
    setEditorState((s) => redo(s));
  }, [canRedo, editorState, logger, tapIntent]);
  const statusLabel = STATUS_LABEL[status] || '';

  // The help panel's open state used to live in the deleted bottom bar. It sits
  // here now for the same reason it sat there: nothing outside the toolbar that
  // owns the toggle needs to know the reference sheet is showing.
  const toggleHelp = useCallback(() => {
    tapIntent('help');
    setHelpOpen((v) => { logger.info('composer.help.toggle', { open: !v }); return !v; });
  }, [logger, tapIntent]);
  const closeHelp = useCallback(() => {
    logger.info('composer.help.toggle', { open: false });
    setHelpOpen(false);
  }, [logger]);

  return (
    <div className="composer-editor">
      <div className="composer-toolbar">
        {/* DOCUMENT cluster: what the song is called, and whether it is saved.
            The status used to sit at the far right as its own flex item, which
            worked only while the toolbar had spare width — once the title
            joined the row, "Saved" appearing was enough to overflow it and
            wrap a control onto a second line. Stacking the status UNDER the
            title costs no horizontal space at all (the cluster is as wide as
            the title alone) and reads better anyway: "Saved" is a fact about
            the thing the title names. */}
        <div className="composer-toolbar__doc">
          <TitleControl title={title} onRename={onRename} logger={logger} onTap={tapIntent} />
          <span className={`composer-toolbar__status is-${status}`} aria-live="polite">{statusLabel}</span>
        </div>
        <div className="composer-toolbar__history">
          {/* Icons, not `↶`/`↷`: those characters have no glyph in the kiosk
              WebView's fonts, so undo and redo painted as two blank boxes on
              the only device this mode runs on. */}
          <button type="button" onClick={doUndo} disabled={!canUndo} aria-label="Undo" title="Undo"><IconUndo size={24} /></button>
          <button type="button" onClick={doRedo} disabled={!canRedo} aria-label="Redo" title="Redo"><IconRedo size={24} /></button>
        </div>
        <DurationPalette hud={hud} setDuration={setDuration} toggleDot={toggleDot} toggleArm={toggleArm} addRest={addRest} deleteBack={deleteBack} onTap={tapIntent} />
        {/* The mode's transport. Deliberately NOT next to the Write toggle: the
            audit found a kid tapping the most play-looking control (then named
            "Play") and hearing nothing, because it only armed note entry.
            Icon AND word: the drawn triangle is what a returning kid finds at
            speed, the word is what a new one reads. */}
        <button
          type="button"
          className={`composer-toolbar__play${transport.playing ? ' is-playing' : ''}`}
          onClick={togglePlay}
          disabled={!transport.playing && !scoreHasNotes(editorState.score)}
          aria-pressed={transport.playing}
          aria-label={transport.playing ? 'Pause your song' : 'Play your song'}
          title={transport.playing ? 'Pause (numpad Enter)' : 'Play from the caret (numpad Enter)'}
        >
          {transport.playing ? <IconPause size={20} /> : <IconPlay size={20} />}
          <span>{transport.playing ? 'Pause' : 'Play'}</span>
        </button>
        {/* Mode NAV, right-aligned before the save status. These two lived in a
            full-width bottom bar that spent ~70px of an 8" tablet's height on
            exactly two buttons, starving the notation. Icon + word, drawn
            rather than typeset. "Songs" is rendered only when the host gives it
            somewhere to go, so the editor stays mountable standalone (the
            verification harnesses do exactly that). */}
        <div className="composer-toolbar__nav">
          {onSongs && (
            <button
              type="button"
              className="composer-toolbar__nav-btn"
              onClick={() => { logger.debug('composer.nav.songs', {}); tapIntent('songs'); onSongs(); }}
              aria-label="Your songs"
              title="Your saved songs"
            >
              <IconSongs size={18} />
              <span>Songs</span>
            </button>
          )}
          <button
            type="button"
            className="composer-toolbar__nav-btn"
            onClick={toggleHelp}
            aria-label="How to write music"
            aria-expanded={helpOpen}
            title="How to write music"
          >
            <IconInfo size={18} />
            <span>Help</span>
          </button>
        </div>
      </div>
      {helpOpen && <ComposerHelp onClose={closeHelp} />}
      {/* Ink-on-paper: OSMD paints BLACK notation, so the staff lives on a white
          "sheet" page (like every notation app) — legible and it reads as real
          sheet music, not a dark widget. The caret positions against this page. */}
      <div className="composer-page">
        {/* `manuscript`: engrave this as a writing surface, not a reading one.
            Without it OSMD collapses the padded runway bars into a
            multi-measure rest ("3" over one bar) and stops the system where the
            content stops — which is precisely the lonely-fragment look the
            padding above exists to remove. */}
        <MusicXmlRenderer musicXml={musicXml} flow="wrapped" scale={zoom} manuscript onLayout={onLayout}>
          <PendingLayer staves={staves} anchorX={anchor?.x ?? 0} anchorSystem={anchor?.system ?? 0} pending={pending.notes} clef={clef} />
          <CaretLayer steps={steps} staves={staves} caretStepIndex={stepIdx} scale={zoom} override={caretOverride} />
        </MusicXmlRenderer>
        {/* The invitation. Blank-staff-first is the design, but the arm toggle
            defaults OFF, so without this a kid sits down, plays, and nothing at
            all happens. Reads off the LIVE score (not settledScore), so it
            clears on the first note while that note is still wet ink.
            COPY COUPLING: "Write" is the literal label DurationPalette's arm
            button carries, in BOTH states. Rename one and you must rename the
            other in the same change — EditorSurface.test.jsx asserts the hint
            contains that button's actual rendered label, so drift fails loudly
            rather than leaving the hint pointing at a button that no longer
            exists by that name. */}
        {!scoreHasNotes(editorState.score) && !pending.notes.length && (
          <p className="composer-page__hint">Pick a note length, then play a key on the piano. Turn on Write so your notes land here.</p>
        )}
      </div>
    </div>
  );
}
