/**
 * Producer — the three-band, workspace-driven jam shell.
 *
 * Band 1: TransportBar (play/stop · bar:beat · BPM/tap · key · click · record)
 * Band 2: Stage — Loop | Song tabs. Loop = front-door entry cards when the
 *         workspace is empty, DAW-style ChannelStrips once it isn't (glyph,
 *         voice chip → VoicePicker, M/S, carry pin, GainStrip, 2-tap remove),
 *         plus the promote door ("Add to song" / "Update section").
 *         Song = the structure rail (SongView): template picker,
 *         slot fill, section sheets, scene-launch jumps.
 *         The library surface is full-bleed (LibraryBrowser — consonance
 *         guardrails, facets, "goes with →" pivot).
 * Band 3: PianoKeyboard, always live — the person's OWN playing goes through
 *         the untouched pressNote/releaseNote path; loop playback is a
 *         separate path entirely (workspaceReducer → toTransportLayers →
 *         useProducerTransport → voiceRouter → tiers).
 *
 * SONG PLAYBACK MODE IS STICKY (documented design call): what the play button
 * starts depends on the ACTIVE TAB at play time — Song tab with a playable
 * arrangement plays the SONG, anything else plays the jam stack — and the
 * chosen mode is then locked (`lockedMode`) until stop. Switching tabs
 * mid-play must NOT flip the transport's mode (a mode flip is a hard content
 * restart); browsing the Loop tab while the song plays is a read, not a command.
 * Exception: an open CAPTURE SESSION forces stack mode (the capture card's
 * geometry reads transport.lengthMs as the jam cycle; you record against the
 * workspace) — closing it restores whatever mode was armed/locked.
 *
 * SONG-MODE PROGRAM MAP: toSchedulerInputs deliberately strips gmProgram, so
 * the shell owns voice config. ONE shared last-applied map (`appliedCfgRef`)
 * has two writers: the workspace writer (stack mode / idle — configures the
 * jam layers' channels) and the song writer (on every onBlock section change
 * — configures the incoming section's sectionProgramMap). Both diff against
 * the same map, so a mode handoff re-pushes exactly the channels whose
 * program/gain actually differ, and neither writer leaves the other's stale
 * values behind.
 *
 * DRAFT ↔ WORKSPACE SEAMS: "Add to song" PROMOTEs the live jam (first promote
 * materializes the draft and auto-switches to the Song tab); opening a section
 * LOAD_STACKs its resolved stack WITH draft.meta.bpm/keyShift (section stacks
 * carry no key/tempo) and tags editingSectionId — the Loop badge then offers
 * Update (re-promote into that section) / Discard (clears ONLY the badge; the
 * workspace keeps the stack for further jamming — clearing sound out from
 * under someone is never the answer). Song and loop persistence use the
 * versioned Producer record API.
 *
 * "Every surface earns its pixels": while the overlay is open the transport
 * and keyboard bands unmount; a now-playing pill floats if the jam is looping.
 *
 * Sound wiring: ONE voiceRouter per mount over [onboardGmTier, gmSynthTier].
 * The gmSynth's AudioContext is created LAZILY on the first user gesture that
 * needs sound (ensureAudio — FKB WebView starts contexts suspended); until
 * then the gm tier's facade no-ops and the onboard tier (if the GM probe
 * verified the piano, config.producer.voiceTiers.onboardGm) carries sound.
 */
import { useEffect, useMemo, useState, useCallback, useReducer, useRef } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { usePianoMidi, usePianoMidiNotes } from '../../PianoMidiContext.jsx';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import { PianoKeyboard } from '../../../components/PianoKeyboard.jsx';
import { useKeepScreenAwake } from '../../usePianoScreensaver.jsx';
import PianoEmpty from '../../PianoEmpty.jsx';
import { SkeletonList } from '../../Skeleton.jsx';
import { useLoopLibrary } from '../../useLoopLibrary.js';
import { roleOf } from '@shared-music/layerMatch.mjs';
import { detectChords } from '../Lessons/theory/theoryEngine.js';
import { romanAnalysis, bestTonic } from '@shared-music/romanAnalysis.mjs';
import {
  workspaceReducer, initialWorkspace, toTransportLayers, takeToSource,
  addLayer, removeLayer, toggleMute, toggleSolo, setGain, setVoice,
  toggleCarried, nudgeKey, setBpm, setLengthBars, toggleMetronome, loadStack, setEditingSection,
  clearWorkspace, restoreWorkspace,
} from '../../producer/workspaceReducer.js';
import {
  draftReducer, promote, hydrate, applyTemplate, slotFill,
  resolveSectionStack, toSchedulerInputs, sectionProgramMap, draftReferencesLayer,
  resetDraft,
} from '../../producer/draftReducer.js';
import { useProducerStore } from '../../producer/useProducerStore.js';
import { usePrefabs } from '../../producer/usePrefabs.js';
import {
  PREFAB_INCOMPLETE_CODE, resolvePrefabStack, resolvePrefabSong,
} from '../../producer/prefabHydrate.js';
import { useResumeSnapshot } from '../../producer/useResumeSnapshot.js';
import { SongView } from '../../producer/SongView.jsx';
import { SongPicker } from '../../producer/SongPicker.jsx';
import { useProducerTransport } from '../../producer/useProducerTransport.js';
import { createVoiceRouter } from '../../producer/voiceRouter.js';
import { createOnboardGmTier } from '../../producer/tiers/onboardGmTier.js';
import { createGmSynthTier } from '../../producer/tiers/gmSynthTier.js';
import { createGmSynth } from '../../producer/gmSynth.js';
import { makeLoopNotesTap } from '../../producer/noteTapFilter.js';
import { TransportBar } from '../../producer/TransportBar.jsx';
import { ChannelStrip } from '../../producer/ChannelStrip.jsx';
import { LibraryBrowser } from '../../producer/LibraryBrowser.jsx';
import { CaptureCard } from '../../producer/CaptureCard.jsx';
import { LoopMeter } from '../../producer/LoopMeter.jsx';
import { AddLayerSheet } from '../../producer/AddLayerSheet.jsx';
import { DrumSequencer } from '../../producer/DrumSequencer.jsx';
import { ChordBuilder } from '../../producer/ChordBuilder.jsx';
import { targetKeyPc } from '../../producer/keyModel.js';
import { useTakePreview } from '../../producer/useTakePreview.js';
import './Producer.scss';

const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const LIBRARY_LOOP_UNPLAYABLE_CODE = 'PRODUCER_LIBRARY_LOOP_UNPLAYABLE';
const SAVED_LOOP_UNPLAYABLE_CODE = 'PRODUCER_SAVED_LOOP_UNPLAYABLE';

function libraryLoadError(entry) {
  const error = new Error(`Library loop is unavailable or has no playable notes: ${entry?.path ?? entry?.slug ?? 'unknown'}`);
  error.code = LIBRARY_LOOP_UNPLAYABLE_CODE;
  return error;
}

function savedLoopError(layer) {
  const error = new Error(`Saved loop has no playable notes: ${layer?.id ?? 'unknown'}`);
  error.code = SAVED_LOOP_UNPLAYABLE_CODE;
  return error;
}

function resolvedDraftLayers(draft) {
  return (draft?.sections || []).flatMap((section) => (section.stack || [])
    .map((entry) => (entry?.carriedRef != null ? draft.carriedLayers?.[entry.carriedRef] : entry))
    .filter(Boolean));
}

function userLoadMessage(error, { prefab = false } = {}) {
  if (error?.code === PREFAB_INCOMPLETE_CODE) return 'Load stopped — this starter is incomplete.';
  if (error?.code === LIBRARY_LOOP_UNPLAYABLE_CODE) return 'Load stopped — a library loop is missing or unreadable.';
  if (error?.code === SAVED_LOOP_UNPLAYABLE_CODE) return 'Load stopped — a saved loop is missing or damaged.';
  if (error?.message?.includes('incomplete')) return 'Load stopped — a saved loop is missing or damaged.';
  return prefab ? "Couldn't load that starter." : 'Load failed — try again.';
}

export function Producer() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-producer' }), []);
  const { config } = usePianoKioskConfig();
  const kb = config?.keyboard || { startNote: 21, endNote: 108 };
  const midi = usePianoMidi();
  const { pressNote, releaseNote } = midi;
  const { activeNotes } = usePianoMidiNotes();
  const lib = useLoopLibrary();

  // ── workspace state ─────────────────────────────────────────────────────────
  const [state, reduceWorkspace] = useReducer(workspaceReducer, initialWorkspace);
  const stateRef = useRef(state); stateRef.current = state;
  const undoStackRef = useRef([]);
  const [undoCount, setUndoCount] = useState(0);
  const dispatch = useCallback((action) => {
    const before = stateRef.current;
    const after = workspaceReducer(before, action);
    if (after === before) return;
    if (action.type !== 'RESTORE') {
      undoStackRef.current = [...undoStackRef.current.slice(-49), {
        workspace: before,
        // Undo must restore sound as well as strips. A removed library layer's
        // note payload is intentionally pruned from the live cache below.
        notesById: notesByIdRef.current,
      }];
      setUndoCount(undoStackRef.current.length);
    }
    // Keep sequential dispatches in one event honest before React re-renders.
    stateRef.current = after;
    reduceWorkspace(action);
  }, []);
  /** layerId → { notes, ppq, barSpan } — loaded lazily per pick; pruned on remove. */
  const [notesById, setNotesById] = useState({});
  const notesByIdRef = useRef(notesById); notesByIdRef.current = notesById;
  const [tab, setTab] = useState('mix'); // 'mix' | 'song'
  // ── draft (song) state — materializes on first PROMOTE / template ──────────
  const [draft, draftDispatch] = useReducer(draftReducer, null);
  const draftRef = useRef(draft); draftRef.current = draft;
  /** Persisted identity of the user song being edited. Prefabs/resume/new
   * drafts deliberately have none, so their first save is always a create. */
  const [savedSong, setSavedSong] = useState(null);
  /** Sticky playback mode: 'stack' | 'song' while playing, null when idle
   * (see the header — tab switches must not flip a playing transport). */
  const [lockedMode, setLockedMode] = useState(null);
  /** Live arrangement position from onBlock: which compiled block/section. */
  const [songPos, setSongPos] = useState({ blockIndex: -1, sectionId: null });
  /** Queued scene-launch target (block index) for the SongView "next" chip. */
  const [pendingTarget, setPendingTarget] = useState(null);
  const [overlay, setOverlay] = useState(null); // null | { role: null|'chords' }
  const [addSheet, setAddSheet] = useState(false); // the unified Add Layer sheet (§8)
  const [builder, setBuilder] = useState(null); // null | 'drums' | 'chords' (§9)
  const [showRoman, setShowRoman] = useState(false);
  const [clearArmed, setClearArmed] = useState(false);
  const [newProjectArmed, setNewProjectArmed] = useState(false);
  const [fillFromLoopsSectionId, setFillFromLoopsSectionId] = useState(null);
  // Capture session (Task 6.2): the card overlays the STAGE band only.
  const [captureOpen, setCaptureOpen] = useState(false);
  // Count-in lives HERE (not in the card) because the transport's play() reads
  // it from a render-assigned ref — the card's chip tap must land a render
  // BEFORE the arm tap calls play(). Two separate gestures guarantee that.
  const [recCountIn, setRecCountIn] = useState(1);
  // Transient pick-failure toast (mirrors the reducer's lastError pattern:
  // set on failure, cleared by the next pick attempt — nothing else reads it).
  const [loadError, setLoadError] = useState(null);
  // ── persistence (Task 8.2): household pool store + resume net ───────────────
  const store = useProducerStore();
  // ── prefabs (Task 9.1): curated read-only stacks/songs from the media tree ──
  const prefabs = usePrefabs();
  const [songPicker, setSongPicker] = useState(false); // saved-song front door
  // A stack awaiting a "replace current jam?" confirm — loading one REPLACES
  // the workspace, and an idle unsaved jam only snapshots while playing, so a
  // silent replace could lose work. Holds { item, source:'user'|'prefab' } so
  // the confirm resolves from the right place. Null unless armed.
  const [pendingReplaceStack, setPendingReplaceStack] = useState(null);
  const [saveToast, setSaveToast] = useState(null); // transient save/keep confirm
  const toastTimerRef = useRef(null);
  const showToast = useCallback((msg) => {
    setSaveToast(msg);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setSaveToast(null), 3200);
  }, []);
  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  useEffect(() => {
    logger.info('piano.producer.mounted', {});
    return () => logger.info('piano.producer.unmounted', {});
  }, [logger, dispatch]);

  // ── sound: tiers → router (one per mount; onboard tier only on flag change) ─
  const midiRef = useRef(midi); midiRef.current = midi;
  const onboardEnabled = !!config?.producer?.voiceTiers?.onboardGm;
  const onboardTier = useMemo(() => createOnboardGmTier({
    enabled: onboardEnabled,
    // Live closures over the context ref: BLE flap flips isConnected without
    // recreating the tier; the hook's senders are (note, …, channel)-ordered.
    sendMidi: {
      isConnected: () => !!midiRef.current?.connected,
      sendNote: (note, velocity, channel) => midiRef.current?.sendNote?.(note, velocity, channel),
      sendNoteOff: (note, channel) => midiRef.current?.sendNoteOff?.(note, channel),
      sendProgramChange: (program, channel) => midiRef.current?.sendProgramChange?.(program, channel),
      sendControlChange: (cc, value, channel) => midiRef.current?.sendControlChange?.(cc, value, channel),
    },
  }), [onboardEnabled]);

  const synthRef = useRef(null);
  const audioCtxRef = useRef(null);
  // Lazy facade: the real synth doesn't exist until the first sound gesture
  // (ensureAudio); until then these delegate to nothing and drop safely.
  const gmTier = useMemo(() => createGmSynthTier({
    synth: {
      noteOn: (ch, note, vel) => synthRef.current?.noteOn(ch, note, vel),
      noteOff: (ch, note) => synthRef.current?.noteOff(ch, note),
      setChannelProgram: (ch, program) => synthRef.current?.setChannelProgram(ch, program),
      setChannelGain: (ch, gain) => synthRef.current?.setChannelGain(ch, gain),
      allNotesOff: (ch) => synthRef.current?.allNotesOff(ch),
    },
  }), []);

  // Keyboard visualization: router tap → sounding-notes set, filtered to the
  // non-groove layer channels (design §5: the backing visibly plays the piano;
  // percussion doesn't).
  const [loopNotes, setLoopNotes] = useState(null);
  const loopNotesTap = useMemo(() => makeLoopNotesTap({ onSet: setLoopNotes }), []);

  const router = useMemo(
    () => createVoiceRouter({ tiers: [onboardTier, gmTier], onNotes: loopNotesTap }),
    [onboardTier, gmTier, loopNotesTap],
  );
  const routerRef = useRef(router); routerRef.current = router;
  useEffect(() => () => { router.dispose(); }, [router]);

  /**
   * First-gesture audio unlock: create + resume the gmSynth's AudioContext
   * (FKB WebView starts suspended), then re-push every layer's program/gain —
   * configureLayer calls made before the synth existed no-op'd on its facade.
   */
  const ensureAudio = useCallback(() => {
    if (!synthRef.current) {
      const Ctx = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
      if (!Ctx) {
        logger.warn('piano.producer.audio-unavailable', {});
        return;
      }
      try {
        const ctx = new Ctx();
        audioCtxRef.current = ctx;
        synthRef.current = createGmSynth({ audioContext: ctx });
      } catch (err) {
        logger.error('piano.producer.audio-init-failed', { error: err?.message });
        return;
      }
      // Field telemetry: is the onboard GM tier actually live out there?
      let onboard = false;
      try { onboard = !!onboardTier.supports(0); } catch { onboard = false; }
      logger.info('piano.producer.tier-availability', { onboardGm: onboard, gmSynth: true });
      // INVARIANT: this loop deliberately BYPASSES appliedCfgRef /
      // applyChannelCfg. The shared map records these exact values as already
      // applied (they were — to the facade, which no-op'd without a synth),
      // so routing through the diff would SKIP the push and the freshly
      // created synth would never hear them. Pushing the same values directly
      // re-materializes them on the real synth while leaving the map's
      // records true — both writers stay coherent.
      for (const l of stateRef.current.layers) {
        routerRef.current.configureLayer(l.channel, {
          ...(l.gmProgram != null ? { program: l.gmProgram } : {}),
          gain: l.gain,
        });
      }
      synthRef.current.loadDrums().catch(() => {}); // metronome + grooves live on ch 9
    }
    synthRef.current.resume().catch(() => {});
  }, [logger, onboardTier]);

  // ── channel config: ONE shared last-applied map, two writers ───────────────
  // (See the header's SONG-MODE PROGRAM MAP note.) applyChannelCfg diffs a
  // channel's {program, gain} against what was last pushed to THIS router and
  // only calls configureLayer on real change — the workspace writer (below)
  // and the song-section writer (after the transport) both go through it.
  const appliedCfgRef = useRef({ router: null, map: new Map() });
  const applyChannelCfg = useCallback((channel, program, gain) => {
    const a = appliedCfgRef.current;
    if (a.router !== router) { a.router = router; a.map = new Map(); }
    const prev = a.map.get(channel);
    if (prev && prev.program === program && prev.gain === gain) return;
    router.configureLayer(channel, { ...(program != null ? { program } : {}), gain });
    a.map.set(channel, { program, gain });
  }, [router]);

  // Visible channels for the keyboard feed follow the non-groove layers.
  useEffect(() => {
    loopNotesTap.setVisibleChannels(state.layers.filter((l) => l.role !== 'groove').map((l) => l.channel));
  }, [state.layers, loopNotesTap]);

  // Layer add/remove logging (diffed here so the assigned channel is exact).
  const prevLayersRef = useRef([]);
  useEffect(() => {
    const prev = prevLayersRef.current;
    const prevIds = new Set(prev.map((l) => l.id));
    const nextIds = new Set(state.layers.map((l) => l.id));
    for (const l of state.layers) {
      if (!prevIds.has(l.id)) {
        logger.info('piano.producer.layer-add', { slug: l.source?.entry?.slug ?? l.id, role: l.role, channel: l.channel });
      }
    }
    for (const l of prev) {
      if (!nextIds.has(l.id)) {
        logger.info('piano.producer.layer-remove', { id: l.id, role: l.role, channel: l.channel });
      }
    }
    prevLayersRef.current = state.layers;
  }, [state.layers, logger]);

  // ── transport ───────────────────────────────────────────────────────────────
  // CALLER CONTRACT (useProducerTransport): memoize the layers input — identity
  // churn queues a bar-boundary swap every bar. Narrow the state so unrelated
  // dispatches (metronome, bpm) don't rebuild the array.
  const transportLayers = useMemo(
    () => toTransportLayers({ layers: state.layers, keyShift: state.keyShift }, notesById),
    [state.layers, state.keyShift, notesById],
  );
  // Song inputs (memoized: identity churn queues transport swaps every bar).
  const songInputs = useMemo(() => toSchedulerInputs(draft, notesById), [draft, notesById]);
  /** Playable song = an arrangement referencing at least one FILLED section
   * (empty template slots compile to zero-length blocks — no time, no play). */
  const songPlayable = useMemo(() => {
    if (!draft || !draft.arrangement.length) return false;
    const referenced = new Set(draft.arrangement.map((e) => e.sectionId));
    return draft.sections.some((s) => referenced.has(s.id) && s.stack.length > 0);
  }, [draft]);
  // What a play() started THIS render would play: the sticky lockedMode while
  // playing; otherwise the active tab decides (Song tab + playable song →
  // arrangement, else jam stack). A CAPTURE SESSION forces the jam stack
  // regardless — the capture card's whole geometry (bar dial, "match jam",
  // punch-at-loop) reads transport.lengthMs as the STACK cycle; recording
  // happens against the workspace, never against the arrangement.
  const armedMode = captureOpen
    ? 'stack'
    : (lockedMode ?? ((tab === 'song' && songPlayable) ? 'song' : 'stack'));
  const armedModeRef = useRef(armedMode); armedModeRef.current = armedMode;

  /** onBlock: track the sounding block/section for the SongView glow and the
   * program-map writer; a landed jump (pendingJumpRef drained) clears the
   * "next" chip. Fires only at block boundaries — cheap enough for setState. */
  const handleBlock = useCallback((blockIndex, block) => {
    setSongPos((prev) => (
      prev.blockIndex === blockIndex && prev.sectionId === (block?.sectionId ?? null)
        ? prev
        : { blockIndex, sectionId: block?.sectionId ?? null }
    ));
    if (!transportRef.current?.pendingJumpRef?.current) {
      setPendingTarget((p) => (p === null ? p : null));
    }
  }, []);

  const transport = useProducerTransport({
    router,
    layers: transportLayers,
    // Arrangement mode iff armed for song: the shell decides the mode, the
    // transport keeps it bar-aligned. While playing, armedMode is locked, so
    // tab switches can't flip this prop mid-play (no accidental mode flip).
    arrangement: armedMode === 'song' ? songInputs : null,
    // Key/tempo are SONG-GLOBAL once a draft exists (design §1) — song
    // playback runs at the draft's meta bpm; the jam stack keeps its own.
    bpm: armedMode === 'song' && draft ? draft.meta.bpm : state.bpm,
    // Loop length override (design §4) — stack mode only; song mode gets its
    // length from each section's own lengthBars.
    forceLengthBars: armedMode === 'song' ? null : state.lengthBars,
    metronome: state.metronome,
    // Count-in only applies while a capture session is open — the capture
    // card's metronome path starts the transport with it. (A Play tap during
    // card setup also gets the count-in; harmless — they're about to record.)
    countInBars: captureOpen ? recCountIn : 0,
    onBlock: handleBlock,
  });
  const transportRef = useRef(transport); transportRef.current = transport;
  const builderPreview = useTakePreview({
    router,
    bpm: state.bpm,
    keyShift: state.keyShift,
    layers: state.layers,
    onAudioGesture: ensureAudio,
  });
  // A generated-take preview is audible even while the main transport is
  // stopped. Treat every active sound path as a performance so the kiosk
  // cannot black out mid-audition. Library peeks own a sibling hold inside
  // LibraryBrowser because that hook and its state live there.
  useKeepScreenAwake('producer', transport.isPlaying || builderPreview.isPreviewing);

  // ── resume net (Task 8.2): sample the bar ~2Hz while playing as the snapshot
  // throttle clock (positionRef is a ref — no per-frame renders), and snapshot
  // the live jam + draft every few bars. Never auto-applies; the shell surfaces
  // a quiet resume chip on next visit.
  const [snapshotBar, setSnapshotBar] = useState(0);
  useEffect(() => {
    if (!transport.isPlaying) return undefined;
    let raf = 0;
    let last = 0;
    const tick = (t) => {
      if (t - last >= 500) {
        last = t;
        const b = transportRef.current?.positionRef?.current?.bar ?? 0;
        setSnapshotBar((prev) => (prev === b ? prev : b));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [transport.isPlaying]);
  const getSnapshotState = useCallback(() => ({
    workspace: stateRef.current,
    draft: draftRef.current,
    notesById: notesByIdRef.current,
  }), []);
  const resume = useResumeSnapshot({
    getState: getSnapshotState,
    isPlaying: transport.isPlaying,
    bar: snapshotBar,
  });

  // The sticky lock rides isPlaying EDGES: the rising edge latches the mode
  // that was armed when playback actually started (play() can refuse — e.g. a
  // song armed before its notes load compiles to totalMs 0 — and a lock
  // without playback would freeze the tab-driven arming while idle); the
  // falling edge (user stop OR the transport stopping itself on a degenerate
  // arrangement) releases it and clears song-position UI state.
  useEffect(() => {
    if (transport.isPlaying) {
      setLockedMode((m) => m ?? armedModeRef.current);
      return;
    }
    setLockedMode((m) => (m === null ? m : null));
    setSongPos((p) => (p.blockIndex === -1 && p.sectionId === null ? p : { blockIndex: -1, sectionId: null }));
    setPendingTarget((p) => (p === null ? p : null));
  }, [transport.isPlaying]);

  // NOTE the capture gate: opening a capture over a playing song flips the
  // TRANSPORT to stack content (armedMode above), so channel-config ownership
  // must hand back to the workspace writer in the same breath — otherwise the
  // jam layers and kept takes would sound with the stale section's programs
  // for the whole session. lockedMode stays 'song' throughout; closing the
  // card hands both content and config back to the song.
  const songActive = transport.isPlaying && lockedMode === 'song' && !captureOpen;

  // Workspace writer: configure the jam layers' channels whenever they change
  // — paused while a song plays (the song writer owns the router then; the
  // songActive dep re-runs this on handback, re-pushing real differences).
  useEffect(() => {
    if (songActive) return;
    for (const l of state.layers) {
      applyChannelCfg(l.channel, l.role === 'groove' ? null : (l.gmProgram ?? null), l.gain);
    }
  }, [state.layers, songActive, applyChannelCfg]);

  // Song writer: on every block-boundary section change, configure the
  // incoming section's program map (repaired channels — the same ones the
  // scheduler drives). `draft` in the deps re-applies live edits to the
  // sounding section (e.g. MUTATE_CARRIED gain) without waiting for a
  // boundary.
  useEffect(() => {
    if (!songActive || !songPos.sectionId) return;
    for (const e of sectionProgramMap(draftRef.current, songPos.sectionId)) {
      applyChannelCfg(e.channel, e.program, e.gain);
    }
  }, [songActive, songPos.sectionId, draft, applyChannelCfg]);

  // Keys lit by a stopped transport are stale — clear the tap's sounding set.
  useEffect(() => {
    if (!transport.isPlaying) loopNotesTap.clear();
  }, [transport.isPlaying, loopNotesTap]);

  // Unmount: stop the transport (it panics the router) and tear down audio.
  useEffect(() => () => {
    transportRef.current.stop();
    synthRef.current?.dispose();
    synthRef.current = null;
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    try { ctx?.close?.()?.catch?.(() => {}); } catch { /* already closed */ }
  }, []);

  // ── handlers ────────────────────────────────────────────────────────────────
  const handleTogglePlay = useCallback(() => {
    if (transportRef.current.isPlaying) {
      logger.info('piano.producer.stop', {});
      transportRef.current.stop();
      return;
    }
    ensureAudio();
    // play() installs the CURRENT render's inputs, which armedMode already
    // shaped (idle → lockedMode null → the tab decided). The sticky lock
    // itself latches on the isPlaying rising edge (effect above), so a
    // refused play() never strands a lock.
    logger.info('piano.producer.play', {
      layers: stateRef.current.layers.length, mode: armedModeRef.current,
    });
    transportRef.current.play();
  }, [ensureAudio, logger]);

  // ── draft verbs (Task 7.2): promote / template / slot fill / open / jump ───
  /** "Add to song" / "Update section" / "Start from your jam": PROMOTE the
   * live jam — into editingSectionId when set (re-promote), else a new
   * section. First promote materializes the draft and shows the Song tab. */
  const handlePromote = useCallback(() => {
    const wsState = stateRef.current;
    if (!wsState.layers.length) return;
    const editing = wsState.editingSectionId;
    const isFirst = draftRef.current == null;
    logger.info('piano.producer.promote', {
      layers: wsState.layers.length, sectionId: editing ?? null, first: isFirst,
    });
    draftDispatch(promote({
      workspaceState: wsState,
      notesById: notesByIdRef.current,
      sectionId: editing ?? undefined,
      // Carry a forced loop length into the section (design §4); null → the
      // section derives its natural length as before.
      lengthBars: wsState.lengthBars ?? undefined,
    }));
    if (editing) dispatch(setEditingSection(null));
    if (isFirst) setTab('song');
  }, [logger, dispatch]);

  /** Discard the editing badge ONLY — the workspace keeps the loaded stack
   * (documented design call: the person may want to keep jamming on it;
   * clearing sound out from under them is never the answer). */
  const handleDiscardEditing = useCallback(() => {
    logger.info('piano.producer.editing-discard', { sectionId: stateRef.current.editingSectionId });
    dispatch(setEditingSection(null));
  }, [logger, dispatch]);

  const handleApplyTemplate = useCallback((template) => {
    logger.info('piano.producer.template-apply', { template: template?.id });
    // The workspace state seeds meta key/tempo iff this materializes the draft.
    draftDispatch(applyTemplate(template, stateRef.current));
  }, [logger]);

  const handleUseJam = useCallback((sectionId) => {
    const wsState = stateRef.current;
    if (!wsState.layers.length) return;
    logger.info('piano.producer.slot-fill', { sectionId, layers: wsState.layers.length });
    draftDispatch(slotFill({ sectionId, workspaceState: wsState, notesById: notesByIdRef.current }));
  }, [logger]);

  const handleUndoWorkspace = useCallback(() => {
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    stateRef.current = previous.workspace;
    notesByIdRef.current = previous.notesById;
    setNotesById(previous.notesById);
    reduceWorkspace(restoreWorkspace(previous.workspace));
    setUndoCount(undoStackRef.current.length);
    setClearArmed(false);
    logger.info('piano.producer.undo', { layers: previous.workspace.layers.length });
  }, [logger]);

  const handleClearLoop = useCallback(() => {
    if (!clearArmed) { setClearArmed(true); return; }
    dispatch(clearWorkspace());
    setClearArmed(false);
    logger.info('piano.producer.clear-loop');
  }, [clearArmed, dispatch, logger]);

  const handleNewProject = useCallback(() => {
    transportRef.current.stop?.();
    stateRef.current = initialWorkspace;
    reduceWorkspace(clearWorkspace());
    draftDispatch(resetDraft());
    setNotesById({});
    undoStackRef.current = [];
    setUndoCount(0);
    setSavedSong(null);
    setClearArmed(false);
    setNewProjectArmed(false);
    setFillFromLoopsSectionId(null);
    setTab('mix');
    resume.clear();
    logger.info('piano.producer.new-project');
  }, [logger, resume]);

  /** Resolve every library layer before committing a saved/prefab load.
   * Loading a partial stack or song is a false success: it can remove the
   * harmony, bass, or groove while leaving a plausible-looking UI. This is an
   * all-or-nothing boundary; takes already carry their notes in `source`. */
  const preloadLayerNotes = useCallback(async (layers, seedNotes = notesByIdRef.current) => {
    const base = seedNotes && typeof seedNotes === 'object' ? seedNotes : {};
    const pending = new Map();
    for (const layer of layers) {
      if (layer?.source?.kind === 'take') {
        if (!layer.source.notes?.length) throw savedLoopError(layer);
        continue;
      }
      if (layer?.source?.kind !== 'library') throw savedLoopError(layer);
      if (base[layer.id]?.notes?.length) continue;
      pending.set(layer.id, layer);
    }
    const loaded = {};
    await Promise.all([...pending.values()].map(async (layer) => {
      let notes;
      try { notes = await lib.loadNotes(layer.source.entry); } catch { throw libraryLoadError(layer.source.entry); }
      if (!notes?.notes?.length) throw libraryLoadError(layer.source.entry);
      loaded[layer.id] = {
        notes: notes.notes,
        ppq: notes.ppq,
        barSpan: layer.source.entry.barSpan,
      };
    }));
    const next = Object.keys(loaded).length ? { ...base, ...loaded } : base;
    notesByIdRef.current = next;
    setNotesById(next);
    return next;
  }, [lib]);

  /** Fill an empty Song slot directly from a kept stack or section. */
  const handleFillFromMyLoops = useCallback(async (item) => {
    const sectionId = fillFromLoopsSectionId;
    if (!sectionId) return;
    try {
      const { layers } = await store.loadCrateStack(item.id);
      const loadedNotes = await preloadLayerNotes(layers);
      draftDispatch(slotFill({
        sectionId,
        workspaceState: { ...stateRef.current, layers },
        notesById: loadedNotes,
      }));
      setFillFromLoopsSectionId(null);
      logger.info('piano.producer.slot-fill-my-loops', { sectionId, crateId: item.id, layers: layers.length });
    } catch (err) {
      logger.error('piano.producer.slot-fill-my-loops-failed', { sectionId, crateId: item.id, error: err?.message });
      showToast(userLoadMessage(err));
    }
  }, [fillFromLoopsSectionId, store, preloadLayerNotes, logger, showToast]);

  /** Open a section for editing: LOAD_STACK its resolved stack WITH the
   * song's key/tempo (the resolveSectionStack doc seam — stacks carry
   * neither), tag editingSectionId, land in Loop. Works for EMPTY template
   * sections too ("Open in Loop to build" clears the stage). */
  const handleOpenSection = useCallback(async (sectionId) => {
    const d = draftRef.current;
    const stack = resolveSectionStack(d, sectionId);
    if (!stack) return;
    const section = d?.sections?.find((s) => s.id === sectionId);
    try {
      await preloadLayerNotes(stack);
      logger.info('piano.producer.section-open', { sectionId, layers: stack.length });
      dispatch(loadStack({
        layers: stack,
        bpm: d.meta.bpm,
        keyShift: d.meta.keyShift,
        // Editing a section adopts its structural length so the loop meter and
        // playback match the section you're editing (design §4).
        lengthBars: Number.isFinite(section?.lengthBars) ? section.lengthBars : undefined,
        editingSectionId: sectionId,
      }));
      setTab('mix');
    } catch (err) {
      logger.error('piano.producer.section-open-failed', { sectionId, error: err?.message });
      showToast(userLoadMessage(err));
    }
  }, [preloadLayerNotes, logger, showToast, dispatch]);

  /** Scene launch: queue the jump, and show the chip only if the transport
   * accepted it (it no-ops unless playing the arrangement). */
  const handleQueueJump = useCallback((blockIndex, jumpMode) => {
    logger.info('piano.producer.jump-request', { blockIndex, mode: jumpMode });
    transportRef.current.queueJump(blockIndex, jumpMode);
    if (transportRef.current.pendingJumpRef?.current) setPendingTarget(blockIndex);
  }, [logger]);

  // ── persistence flows (Task 8.2): save / load / keep / resume ──────────────
  /** Crystallize + persist the current draft as a song (auto-persists embedded
   * takes as loops first). Optional inline title. */
  const handleSaveSong = useCallback(async (mode = 'update', title) => {
    const d = draftRef.current;
    if (!d || !d.sections?.length) return;
    try {
      const update = mode === 'update' && savedSong?.source === 'user';
      const rec = await store.saveSong(d, {
        title: title || undefined,
        id: update ? savedSong.id : null,
        revision: update ? savedSong.revision : null,
        saveAs: mode === 'save-as',
      });
      setSavedSong({ id: rec.id, revision: rec.revision ?? 1, title: rec.title ?? null, source: 'user' });
      logger.info('piano.producer.save-song', {
        id: rec.id, mode: update ? 'update' : 'save-as', sections: d.sections.length,
      });
      showToast(`Saved “${rec.title || 'song'}”`);
      resume.clear();
    } catch (err) {
      logger.error('piano.producer.save-song-failed', { error: err?.message });
      showToast('Save failed — try again');
    }
  }, [store, savedSong, resume, showToast, logger]);

  /** Load a song → resolve refs → HYDRATE the draft → re-fetch the library
   * layers' notes → land on the Song tab. `source` selects where the record
   * comes from: 'user' = the household API (store.loadSong, resolves persisted
   * loop refs), 'prefab' = a curated media-tree payload (resolvePrefabSong
   * against the live loop index). Both yield the SAME draft shape → identical
   * HYDRATE path (Task 9.1). */
  const loadSongBySource = useCallback(async (id, source) => {
    try {
      let loaded;
      let stored = null;
      if (source === 'prefab') {
        const payload = await prefabs.getFull('songs', id);
        ({ draft: loaded } = resolvePrefabSong(payload, lib.loops || []));
      } else {
        stored = await store.loadSong(id);
        ({ draft: loaded } = stored);
      }
      // Library layers (across sections, carried refs expanded) must all load
      // before the draft changes; take layers carry notes in their sources.
      const layers = resolvedDraftLayers(loaded);
      await preloadLayerNotes(layers);
      draftDispatch(hydrate(loaded));
      setSavedSong(source === 'prefab' ? null : {
        id: stored.id,
        revision: stored.revision ?? 1,
        title: stored.title ?? loaded.meta?.title ?? null,
        source: 'user',
      });
      setSongPicker(false);
      setTab('song');
      resume.clear();
      logger.info('piano.producer.load-song', { id, source, sections: loaded.sections?.length ?? 0 });
    } catch (err) {
      logger.error('piano.producer.load-song-failed', { id, source, error: err?.message });
      showToast(userLoadMessage(err, { prefab: source === 'prefab' }));
    }
  }, [store, prefabs, lib, preloadLayerNotes, resume, showToast, logger]);

  const handleLoadSong = useCallback((id) => loadSongBySource(id, 'user'), [loadSongBySource]);
  const handleLoadExample = useCallback((id) => loadSongBySource(id, 'prefab'), [loadSongBySource]);

  /** Apply the resume snapshot: restore the workspace stack + draft + notes.
   * A user act — the chip is only a prompt, never auto-applied. */
  const handleApplyResume = useCallback(async () => {
    const data = resume.resumeData;
    if (!data) return;
    const ws = data.workspace || {};
    try {
      await preloadLayerNotes([
        ...(ws.layers || []),
        ...resolvedDraftLayers(data.draft),
      ], data.notesById);
      resume.applyResume();
      dispatch(loadStack({ layers: ws.layers || [], bpm: ws.bpm, keyShift: ws.keyShift }));
      if (data.draft) draftDispatch(hydrate(data.draft));
      setSavedSong(null);
      resume.clear();
      setSongPicker(false);
      logger.info('piano.producer.resume-apply', { layers: (ws.layers || []).length });
    } catch (err) {
      logger.error('piano.producer.resume-apply-failed', { error: err?.message });
      showToast(userLoadMessage(err));
    }
  }, [resume, preloadLayerNotes, logger, showToast, dispatch]);

  /** Keep the whole workspace stack to the Crate (recorded takes persist as
   * loops first, then the stack stores refs — design §6). */
  const handleKeepStack = useCallback(async () => {
    const layers = stateRef.current.layers;
    if (!layers.length) return;
    try {
      await store.saveCrateItem('stack', {
        layers,
        lengthBars: stateRef.current.lengthBars ?? transportRef.current.loopBars,
      });
      logger.info('piano.producer.keep-stack', { layers: layers.length });
      showToast('Saved to My Loops');
    } catch (err) {
      logger.error('piano.producer.keep-stack-failed', { error: err?.message });
      showToast('Keep failed — try again');
    }
  }, [store, showToast, logger]);

  /** Keep a section (its resolved stack — carried refs expanded) to the Crate. */
  const handleKeepSection = useCallback(async (sectionId) => {
    const stack = resolveSectionStack(draftRef.current, sectionId);
    if (!stack || !stack.length) return;
    try {
      const section = draftRef.current?.sections?.find((item) => item.id === sectionId);
      await store.saveCrateItem('section', { layers: stack, lengthBars: section?.lengthBars });
      logger.info('piano.producer.keep-section', { sectionId, layers: stack.length });
      showToast('Saved to My Loops');
    } catch (err) {
      logger.error('piano.producer.keep-section-failed', { sectionId, error: err?.message });
      showToast('Keep failed — try again');
    }
  }, [store, showToast, logger]);

  /** Keep a single RECORDED layer (take source) to the household loop pool. */
  const handleKeepLoop = useCallback(async (layer) => {
    if (layer?.source?.kind !== 'take') return;
    try {
      await store.saveLoop({ ...layer.source, kind: layer.role });
      logger.info('piano.producer.keep-loop', { id: layer.id, role: layer.role });
      showToast('Saved to My Loops');
    } catch (err) {
      logger.error('piano.producer.keep-loop-failed', { id: layer.id, error: err?.message });
      showToast('Keep failed — try again');
    }
  }, [store, showToast, logger]);

  /** Fetch + LOAD_STACK a stack, from EITHER source. 'user' = a household Crate
   * stack (loop refs resolved to takes; library layers re-fetch). 'prefab' = a
   * curated media-tree stack (resolvePrefabStack against the live loop index —
   * prefabs hold only library refs, so no API loop fetch). Both yield the same
   * workspace-ready layers → one LOAD_STACK path. REPLACES the workspace —
   * callers gate with the confirm. */
  const doLoadStack = useCallback(async (item, source) => {
    ensureAudio();
    setOverlay(null);
    setPendingReplaceStack(null);
    setLoadError(null);
    try {
      let layers;
      if (source === 'prefab') {
        const payload = await prefabs.getFull('stacks', item.id);
        ({ layers } = resolvePrefabStack(payload, lib.loops || []));
      } else {
        ({ layers } = await store.loadCrateStack(item.id));
      }
      await preloadLayerNotes(layers);
      dispatch(loadStack({ layers, bpm: stateRef.current.bpm, keyShift: stateRef.current.keyShift }));
      logger.info('piano.producer.stack-pick', { source, id: item.id, layers: layers.length });
    } catch (err) {
      logger.error('piano.producer.stack-pick-failed', { source, id: item.id, error: err?.message });
      setLoadError(userLoadMessage(err, { prefab: source === 'prefab' }));
    }
  }, [store, prefabs, lib, ensureAudio, preloadLayerNotes, logger, dispatch]);

  /** Arm the destructive stack load: an existing jam gets a "Replace?" confirm
   * (holding the source); an empty workspace loads immediately. */
  const armStackLoad = useCallback((item, source) => {
    if (stateRef.current.layers.length > 0) {
      setOverlay(null);
      setPendingReplaceStack({ item, source });
      logger.info('piano.producer.stack-replace-arm', { source, id: item.id });
      return;
    }
    doLoadStack(item, source);
  }, [doLoadStack, logger]);

  /** 'Ours' library facet pick: add a kept loop (embedded notes, non-destructive)
   * or load a kept stack (arms the replace confirm when there's a jam to lose). */
  const handlePickOurs = useCallback(async (kind, item) => {
    if (kind === 'loop') {
      ensureAudio();
      setOverlay(null);
      setLoadError(null);
      try {
        const rec = await store.getFull('loops', item.id);
        if (!rec?.notes?.length) { setLoadError("That kept loop is empty."); return; }
        dispatch(addLayer({
          source: {
            kind: 'take', takeId: rec.id, notes: rec.notes, ppq: rec.ppq ?? 480,
            lengthBars: rec.lengthBars, timeline: rec.timeline ?? null, drumMode: !!rec.drumMode,
            persistedLoopId: rec.id, persistedContentHash: rec.contentHash ?? null,
          },
          role: rec.kind === 'groove' ? 'groove' : (rec.kind || 'idea'),
        }));
        logger.info('piano.producer.ours-pick', { kind, id: rec.id });
      } catch (err) {
        logger.error('piano.producer.ours-pick-failed', { kind, id: item.id, error: err?.message });
        setLoadError("Couldn't load that from My Loops.");
      }
      return;
    }
    armStackLoad(item, 'user');
  }, [store, ensureAudio, armStackLoad, logger, dispatch]);

  /** 'Prefabs' library facet pick: load a curated stack (same confirm gate). */
  const handlePickPrefab = useCallback((item) => {
    armStackLoad(item, 'prefab');
  }, [armStackLoad]);

  // ── capture session (Task 6.2) ──────────────────────────────────────────────
  const openCapture = useCallback((via) => {
    logger.info('piano.producer.capture-open', { via });
    if (via === 'record-door') logger.info('piano.producer.front-door', { door: 'record' });
    setCaptureOpen(true);
  }, [logger]);

  const closeCapture = useCallback(() => {
    logger.info('piano.producer.capture-close', {});
    setCaptureOpen(false);
  }, [logger]);

  /** Set-semantics facade over the reducer's TOGGLE (the card forces the
   * click on for metronome sessions and restores it on close). */
  const handleSetMetronome = useCallback((on) => {
    if (stateRef.current.metronome !== on) dispatch(toggleMetronome());
  }, [dispatch]);

  /** Confirmed take → workspace layer (channel assigned per kind by the
   * reducer: groove → 9, melodic/harmonic → lowest free). takeToSource
   * normalizes non-groove pitches to canonical (midi − keyShift, timeline
   * root shifted with them) — the recorder heard the transposed jam but
   * played real pitches, and toTransportLayers transposes on playback; a
   * verbatim store would transpose TWICE. It also carries timeline+drumMode
   * on the source (citizenship for sections/Crate). */
  const handleCaptureKeep = useCallback((take) => {
    const keyShift = stateRef.current.keyShift;
    logger.info('piano.producer.capture-keep', {
      takeId: take.takeId, kind: take.kind, notes: take.notes.length,
      lengthBars: take.lengthBars, keyShift,
    });
    dispatch(addLayer({
      source: takeToSource(take, keyShift),
      role: take.kind === 'groove' ? 'groove' : take.kind,
    }));
  }, [logger, dispatch]);

  /** Add a builder's output (drum sequencer / chord builder) as a layer. The
   * notes are already CANONICAL — drums are GM drum-map slots (never transposed)
   * and chords are C-rooted (Roman I = C) — so the source is added directly;
   * toTransportLayers applies the jam keyShift on playback (design §9). */
  const handleBuilderCommit = useCallback((take) => {
    builderPreview.stopPreview();
    ensureAudio();
    logger.info('piano.producer.builder-commit', {
      kind: take.kind, notes: take.notes.length, lengthBars: take.lengthBars,
    });
    dispatch(addLayer({
      source: {
        kind: 'take', takeId: take.takeId, notes: take.notes, ppq: take.ppq ?? 480,
        lengthBars: take.lengthBars, timeline: take.timeline ?? null, drumMode: !!take.drumMode,
        builder: take.builder ?? null,
      },
      role: take.kind === 'groove' ? 'groove' : take.kind,
    }));
  }, [builderPreview, ensureAudio, logger, dispatch]);

  const openOverlay = useCallback((role, door) => {
    // door is one of the four entry cards; the "+ Add layer" path passes null.
    if (door) logger.info('piano.producer.front-door', { door });
    logger.info('piano.producer.overlay-open', { role: role ?? 'all', via: door ?? 'add-layer' });
    setOverlay({ role });
  }, [logger]);

  const closeOverlay = useCallback(() => {
    logger.info('piano.producer.overlay-close', {});
    setOverlay(null);
  }, [logger]);

  const handlePick = useCallback(async (entry) => {
    ensureAudio();
    setOverlay(null);
    setLoadError(null);
    // Layer ids == entry.path (the browser filters already-stacked entries
    // from its grid), so notesById stays keyed 1:1 with layers.
    if (stateRef.current.layers.some((l) => l.id === entry.path)) return;
    const role = (entry.type === 'groove' || entry.kind === 'groove') ? 'groove' : roleOf(entry);
    dispatch(addLayer({ source: { kind: 'library', entry }, role, bpmHint: entry.bpm }));
    let notes = null;
    try { notes = await lib.loadNotes(entry); } catch { notes = null; }
    if (!notes?.notes?.length) {
      // Failed/empty load would leave a zombie row with a dead Play — the
      // layer never joins the cycle (toTransportLayers omits it). Remove it
      // and say why instead.
      logger.warn('piano.producer.layer-load-failed', { path: entry.path, role });
      dispatch(removeLayer(entry.path));
      setLoadError(`Couldn't load "${entry.title || entry.slug || 'that loop'}" — try another.`);
      return;
    }
    // Guard the async landing: if the layer was removed while its notes were
    // in flight, don't strand an orphan entry in notesById (memory hygiene —
    // the lib's own cache still makes a re-add instant).
    if (stateRef.current.layers.some((l) => l.id === entry.path)) {
      setNotesById((prev) => ({
        ...prev,
        [entry.path]: { notes: notes.notes, ppq: notes.ppq, barSpan: entry.barSpan },
      }));
    }
  }, [ensureAudio, lib, logger, dispatch]);

  const handleRemove = useCallback((id) => {
    dispatch(removeLayer(id));
    setNotesById((prev) => {
      if (!(id in prev)) return prev;
      // Keep the notes when the SONG still references this layer — notesById
      // is the only notes store for library layers; pruning here would make
      // the section play silently (draftReferencesLayer doc).
      if (draftReferencesLayer(draftRef.current, id)) return prev;
      const rest = { ...prev };
      delete rest[id];
      return rest;
    });
  }, [dispatch]);

  const handleToggleMute = useCallback((id) => dispatch(toggleMute(id)), [dispatch]);
  const handleToggleSolo = useCallback((id) => dispatch(toggleSolo(id)), [dispatch]);
  const handleToggleCarried = useCallback((id) => {
    logger.info('piano.producer.carry-toggle', { id });
    dispatch(toggleCarried(id));
  }, [logger, dispatch]);
  const handleSetGain = useCallback((id, gain) => {
    logger.sampled('piano.producer.gain-set', { id, gain }, { maxPerMinute: 20, aggregate: true });
    dispatch(setGain(id, gain));
  }, [logger, dispatch]);
  // Voice select is a user gesture — a fine moment to unlock audio, so the
  // newly picked program is audible immediately (the configureLayer diff
  // effect pushes it to the router as the reducer state lands).
  const handleSetVoice = useCallback((id, program) => {
    logger.info('piano.producer.voice-set', { id, program });
    ensureAudio();
    dispatch(setVoice(id, program));
  }, [ensureAudio, logger, dispatch]);

  // ── display derivations ─────────────────────────────────────────────────────
  const splitNote = useMemo(() => Math.floor((kb.startNote + kb.endNote) / 2), [kb.startNote, kb.endNote]);

  // Pitch class Roman `I` sounds at in the current jam — the tonic behind the
  // "Key X" label (design §7). ChordLanes key their concrete chord names to it,
  // so the names always agree with the displayed key.
  const keyPc = targetKeyPc(state.keyShift);
  const keyLabel = NOTE_NAMES[keyPc];

  // Left-hand roman chord readout (ported behavior): detect below the split.
  const handLabel = useMemo(() => {
    if (!showRoman) return null;
    const left = [...activeNotes.keys()].filter((n) => n < splitNote);
    if (left.length < 2) return null;
    try {
      const detected = detectChords(left);
      if (!detected?.length) return null;
      const tonic = bestTonic(detected);
      return romanAnalysis(detected, tonic)[0] || null;
    } catch {
      return null;
    }
  }, [showRoman, activeNotes, splitNote]);

  const pillMaterials = useMemo(
    () => state.layers.map((l) => (l.source?.kind === 'library' ? l.source.entry : { kind: 'take', id: l.id })),
    [state.layers],
  );

  // Shared-drum-channel honesty (ChannelStrip): >1 groove → gain edits on one
  // groove strip audibly affect all of them (they share synth channel 9).
  const grooveCount = useMemo(
    () => state.layers.filter((l) => l.role === 'groove').length,
    [state.layers],
  );

  const overlayOpen = overlay !== null;
  // Full-bleed surfaces (library OR the saved-song picker) reclaim the
  // transport + keyboard bands.
  const surfaceOpen = overlayOpen || songPicker;

  const editingSectionName = state.editingSectionId
    ? (draft?.sections.find((s) => s.id === state.editingSectionId)?.name ?? state.editingSectionId)
    : null;

  // Breadcrumb: makes the Loop⊂Song nesting explicit at all times (design §3).
  // Editing a section → `Song › Verse`; a song exists but free-jamming → the
  // song title on Song, `Loop · scratch` on Loop; no song yet → `Loop · scratch`.
  const songTitle = draft?.meta?.title || (draft ? 'Untitled song' : null);
  const breadcrumb = editingSectionName
    ? `Song › ${editingSectionName}`
    : tab === 'song'
      ? (songTitle ? `Song · ${songTitle}` : 'Song · new')
      : 'Loop · scratch';

  return (
    <section className="piano-mode piano-producer-mode">
      {lib.loading && <SkeletonList rows={6} />}
      {lib.error && <PianoEmpty message={`Couldn't load the loop library: ${lib.error}`} />}
      {store.error && (
        <div className="piano-producer-mode__data-error" role="alert">
          <span>Saved work unavailable: {store.error}</span>
          <button type="button" onClick={store.refresh}>Retry</button>
        </div>
      )}
      {saveToast && (
        <p className="piano-producer-mode__save-toast" role="status">{saveToast}</p>
      )}

      {lib.loops && !surfaceOpen && (
        <>
          {resume.hasResume && (
            <div className="piano-producer-mode__resume-chip" role="status">
              <span>Resume where you left off?</span>
              <button type="button" className="piano-chip is-on" onClick={handleApplyResume}>Resume</button>
              <button type="button" className="piano-chip" aria-label="dismiss resume" onClick={resume.dismiss}>✕</button>
            </div>
          )}
          <TransportBar
            isPlaying={transport.isPlaying}
            // While playing, the button is Stop — it must stay tappable even
            // if the content that made it playable was just removed.
            canPlay={transport.isPlaying
              || (armedMode === 'song' ? songPlayable : state.layers.length > 0)}
            onTogglePlay={handleTogglePlay}
            positionRef={transport.positionRef}
            loopBars={transport.loopBars}
            bpm={state.bpm}
            onBpm={(next) => dispatch(setBpm(next))}
            keyLabel={keyLabel}
            keyPc={keyPc}
            onKeyNudge={(delta) => dispatch(nudgeKey(delta))}
            metronome={state.metronome}
            onToggleMetronome={() => dispatch(toggleMetronome())}
            recActive={captureOpen}
            onRecord={() => (captureOpen ? closeCapture() : openCapture('record-arm'))}
            // Tempo/tap/key are locked during a capture session: the engine
            // freezes geometry at arm (a mid-capture change would shear
            // ticks), and a key nudge would desync heard-vs-stored pitch.
            locked={captureOpen}
          />

          <div className="piano-producer-mode__stage-wrap">
          <div className="piano-producer-mode__stage">
            <div className="piano-producer-mode__tabbar">
              {/* Segmented Loop|Song control — the two levels (design §3). The
                  internal tab token stays 'mix' (state/CSS); only the label is
                  the taxonomy word "Loop". */}
              <div className="piano-producer-mode__tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'mix'}
                  className={`piano-producer-mode__tab${tab === 'mix' ? ' is-on' : ''}`}
                  onClick={() => setTab('mix')}
                >Loop</button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'song'}
                  className={`piano-producer-mode__tab${tab === 'song' ? ' is-on' : ''}`}
                  onClick={() => setTab('song')}
                >Song</button>
              </div>
              <span className="piano-producer-mode__breadcrumb" aria-label="location">{breadcrumb}</span>
              <button
                type="button"
                className="piano-chip piano-producer-mode__new"
                onClick={() => setNewProjectArmed(true)}
              >New</button>
              <button
                type="button"
                className={`piano-chip piano-producer-mode__roman-toggle${showRoman ? ' is-on' : ''}`}
                aria-label="roman"
                aria-pressed={showRoman}
                onClick={() => setShowRoman((v) => !v)}
              >Roman</button>
            </div>

            {newProjectArmed && (
              <div className="piano-producer-mode__replace-confirm" role="alertdialog" aria-label="new project">
                <span className="piano-producer-mode__replace-label">
                  Start a new project? The current Loop and Song will be cleared.
                </span>
                <button type="button" className="piano-producer-mode__replace-go" onClick={handleNewProject}>
                  Start new
                </button>
                <button type="button" onClick={() => setNewProjectArmed(false)}>Cancel</button>
              </div>
            )}

            {fillFromLoopsSectionId && (
              <div className="piano-producer-mode__my-loops-picker" role="dialog" aria-label="choose from My Loops">
                <strong>Fill from My Loops</strong>
                {store.crate.length === 0 ? (
                  <p>No saved stacks or sections yet.</p>
                ) : (
                  store.crate.map((item) => (
                    <button key={item.id} type="button" onClick={() => handleFillFromMyLoops(item)}>
                      {item.title || (item.kind === 'section' ? 'Saved section' : 'Saved stack')}
                      <span>{item.layerCount ?? 0} layers</span>
                    </button>
                  ))
                )}
                <button type="button" onClick={() => setFillFromLoopsSectionId(null)}>Cancel</button>
              </div>
            )}

            {tab === 'mix' && loadError && (
              <p className="piano-producer-mode__toast" role="alert">{loadError}</p>
            )}

            {tab === 'mix' && state.editingSectionId && (
              <div className="piano-producer-mode__editing" role="status">
                <span className="piano-producer-mode__editing-label">
                  Editing section {editingSectionName}
                </span>
                <button type="button" onClick={handlePromote} disabled={state.layers.length === 0}>
                  Update
                </button>
                <button type="button" onClick={handleDiscardEditing}>Discard</button>
              </div>
            )}

            {tab === 'mix' && pendingReplaceStack && (
              <div className="piano-producer-mode__replace-confirm" role="alertdialog" aria-label="replace jam">
                <span className="piano-producer-mode__replace-label">
                  Replace your current jam with “{pendingReplaceStack.item.title || (pendingReplaceStack.source === 'prefab' ? 'prefab stack' : 'kept stack')}”?
                </span>
                <button
                  type="button"
                  className="piano-producer-mode__replace-go"
                  onClick={() => doLoadStack(pendingReplaceStack.item, pendingReplaceStack.source)}
                >Replace</button>
                <button
                  type="button"
                  className="piano-producer-mode__replace-cancel"
                  onClick={() => setPendingReplaceStack(null)}
                >Cancel</button>
              </div>
            )}

            {tab === 'mix' && (
              state.layers.length === 0 ? (
                <>
                  {undoCount > 0 && (
                    <button
                      type="button"
                      className="piano-producer-mode__undo piano-producer-mode__undo--empty"
                      onClick={handleUndoWorkspace}
                    >Undo last change</button>
                  )}
                  <div className="piano-producer-mode__doors">
                  <button type="button" className="piano-producer-mode__door" onClick={() => openOverlay(null, 'browse')}>
                    <span className="piano-producer-mode__door-title">Browse the library</span>
                    <span className="piano-producer-mode__door-blurb">Loops, grooves & ideas to start from</span>
                  </button>
                  <button type="button" className="piano-producer-mode__door" onClick={() => openOverlay('chords', 'loop')}>
                    <span className="piano-producer-mode__door-title">Start from a loop</span>
                    <span className="piano-producer-mode__door-blurb">Pick a chord loop, stack from there</span>
                  </button>
                  <button type="button" className="piano-producer-mode__door" onClick={() => openCapture('record-door')}>
                    <span className="piano-producer-mode__door-title">Record my own</span>
                    <span className="piano-producer-mode__door-blurb">Loop-record over a metronome</span>
                  </button>
                  <button
                    type="button"
                    className="piano-producer-mode__door"
                    onClick={() => { logger.info('piano.producer.front-door', { door: 'songs' }); setSongPicker(true); }}
                  >
                    <span className="piano-producer-mode__door-title">Songs &amp; Resume</span>
                    <span className="piano-producer-mode__door-blurb">
                      {resume.hasResume ? 'Pick up where you left off, or load a saved song' : 'Load a saved song'}
                    </span>
                  </button>
                  </div>
                </>
              ) : (
                <div className="piano-producer-mode__mix">
                  {/* The bounded loop made visible (design §4): one segment per
                      bar, sweeping playhead, resets at the boundary — plus the
                      settable length (2/4/8/16, tap again for Auto/natural). */}
                  <div className="piano-producer-mode__loop-head">
                    <LoopMeter
                      loopBars={transport.loopBars}
                      positionRef={transport.positionRef}
                      isPlaying={transport.isPlaying}
                    />
                    <div className="piano-producer-mode__loop-len" role="group" aria-label="loop length">
                      {[2, 4, 8, 16].map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={`piano-producer-mode__loop-len-btn${state.lengthBars === n ? ' is-on' : ''}`}
                          aria-pressed={state.lengthBars === n}
                          title={`${n}-bar loop`}
                          onClick={() => dispatch(setLengthBars(state.lengthBars === n ? null : n))}
                        >{n}</button>
                      ))}
                    </div>
                  </div>
                  <div className="piano-producer-mode__layers">
                    {state.layers.map((l) => (
                      <ChannelStrip
                        key={l.id}
                        layer={l}
                        grooveCount={grooveCount}
                        onboardGm={onboardEnabled}
                        notesBundle={notesById[l.id]}
                        positionRef={transport.positionRef}
                        isPlaying={transport.isPlaying}
                        keyPc={keyPc}
                        onToggleMute={handleToggleMute}
                        onToggleSolo={handleToggleSolo}
                        onToggleCarried={handleToggleCarried}
                        onRemove={handleRemove}
                        onGain={handleSetGain}
                        onVoice={handleSetVoice}
                        onKeepToCrate={handleKeepLoop}
                      />
                    ))}
                  </div>
                  <div className="piano-producer-mode__mix-actions">
                    <button
                      type="button"
                      className="piano-producer-mode__undo"
                      disabled={undoCount === 0}
                      onClick={handleUndoWorkspace}
                    >Undo</button>
                    <button
                      type="button"
                      className={`piano-producer-mode__clear${clearArmed ? ' is-armed' : ''}`}
                      onClick={handleClearLoop}
                    >{clearArmed ? 'Confirm clear' : 'Clear loop'}</button>
                    {clearArmed && (
                      <button type="button" onClick={() => setClearArmed(false)}>Cancel clear</button>
                    )}
                    <button
                      type="button"
                      className="piano-producer-mode__add-layer"
                      onClick={() => setAddSheet(true)}
                    >+ Add layer</button>
                    <button
                      type="button"
                      className="piano-producer-mode__keep-stack"
                      onClick={handleKeepStack}
                    >Keep to My Loops</button>
                    <button
                      type="button"
                      className="piano-producer-mode__promote"
                      onClick={handlePromote}
                    >{state.editingSectionId ? 'Update section' : 'Add to song'}</button>
                  </div>
                  {state.lastError === 'channels-exhausted' && (
                    <p className="piano-producer-mode__toast" role="alert">
                      All 15 voice channels are in use — remove a layer to add another.
                    </p>
                  )}
                </div>
              )
            )}

            {tab === 'song' && (
              <SongView
                draft={draft}
                dispatch={draftDispatch}
                hasJamLayers={state.layers.length > 0}
                onStartFromJam={handlePromote}
                onApplyTemplate={handleApplyTemplate}
                onUseJam={handleUseJam}
                onOpenSection={handleOpenSection}
                isSongPlaying={songActive}
                activeBlockIndex={songPos.blockIndex}
                pendingBlockIndex={pendingTarget}
                onQueueJump={handleQueueJump}
                onSaveSong={handleSaveSong}
                savedSong={savedSong}
                onOpenSongPicker={() => setSongPicker(true)}
                onKeepSection={handleKeepSection}
                hasMyLoops={store.crate.length > 0}
                onFromMyLoops={setFillFromLoopsSectionId}
              />
            )}
          </div>

          {captureOpen && (
            // Overlay card above the stage ONLY — the keyboard band stays
            // playable (you record BY playing) and the transport stays live.
            // Mounted on the stage WRAP (not the scrollable stage itself) so
            // a scrolled stage can never carry the scrim/card out of view.
            <CaptureCard
              bpm={state.bpm}
              transport={transport}
              router={router}
              subscribeMidi={midi.subscribe}
              metronome={state.metronome}
              onSetMetronome={handleSetMetronome}
              countInBars={recCountIn}
              onCountInBars={setRecCountIn}
              hasLayers={state.layers.length > 0}
              onKeep={handleCaptureKeep}
              onClose={closeCapture}
              onAudioGesture={ensureAudio}
            />
          )}

          {addSheet && (
            <AddLayerSheet
              onPickRole={(role) => { setAddSheet(false); openOverlay(role, null); }}
              onRecord={() => { setAddSheet(false); openCapture('add-layer'); }}
              onBuildDrums={() => { setAddSheet(false); setBuilder('drums'); }}
              onBuildChords={() => { setAddSheet(false); setBuilder('chords'); }}
              onClose={() => setAddSheet(false)}
            />
          )}

          {builder === 'drums' && (
            <DrumSequencer
              lengthBars={transport.loopBars || state.lengthBars || 2}
              onCommit={handleBuilderCommit}
              onPreview={builderPreview.previewTake}
              onStopPreview={builderPreview.stopPreview}
              isPreviewing={builderPreview.isPreviewing}
              onClose={() => { builderPreview.stopPreview(); setBuilder(null); }}
            />
          )}
          {builder === 'chords' && (
            <ChordBuilder
              keyPc={keyPc}
              lengthBars={transport.loopBars || state.lengthBars || 4}
              onCommit={handleBuilderCommit}
              onPreview={builderPreview.previewTake}
              onStopPreview={builderPreview.stopPreview}
              isPreviewing={builderPreview.isPreviewing}
              onClose={() => { builderPreview.stopPreview(); setBuilder(null); }}
            />
          )}
          </div>

          <div className="piano-producer-mode__keys">
            <PianoKeyboard
              activeNotes={activeNotes}
              loopNotes={loopNotes}
              startNote={kb.startNote}
              endNote={kb.endNote}
              splitNote={showRoman ? splitNote : null}
              handChordLabel={handLabel}
              onNoteOn={pressNote}
              onNoteOff={releaseNote}
            />
          </div>
        </>
      )}

      {lib.loops && overlayOpen && (
        <LibraryBrowser
          lib={lib}
          layers={state.layers}
          initialRole={overlay.role}
          onPick={handlePick}
          onClose={closeOverlay}
          isPlaying={transport.isPlaying}
          positionRef={transport.positionRef}
          pillMaterials={pillMaterials}
          // Explicit card audition (with hold as a compatibility shortcut)
          // rides the SAME
          // router on reserved channels while the jam keeps looping, and
          // conforms to the live key/tempo. ensureAudio unlocks the gmSynth
          // in the card's pointer-down gesture context.
          router={router}
          bpm={state.bpm}
          keyShift={state.keyShift}
          onAudioGesture={ensureAudio}
          ours={{ loops: store.loops, crate: store.crate }}
          onPickOurs={handlePickOurs}
          prefabs={{ stacks: prefabs.stacks }}
          onPickPrefab={handlePickPrefab}
        />
      )}

      {songPicker && (
        <SongPicker
          songs={store.songs}
          loading={store.loading}
          onLoad={handleLoadSong}
          onClose={() => setSongPicker(false)}
          onRemove={(id) => store.remove('songs', id).catch(() => showToast('Delete failed'))}
          hasResume={resume.hasResume}
          onResume={handleApplyResume}
          onDismissResume={resume.dismiss}
          examples={prefabs.songs}
          onLoadExample={handleLoadExample}
        />
      )}
    </section>
  );
}

export default Producer;
