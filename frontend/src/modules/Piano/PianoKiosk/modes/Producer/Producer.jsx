/**
 * Producer — the three-band, workspace-driven jam shell (Task 4.4, design §7).
 *
 * Band 1: TransportBar (play/stop · bar:beat · BPM/tap · key · click · record)
 * Band 2: Stage — Mix | Song tabs. Mix = front-door entry cards when the
 *         workspace is empty, DAW-style ChannelStrips once it isn't (glyph,
 *         voice chip → VoicePicker, M/S, carry pin, GainStrip, 2-tap remove),
 *         plus the promote door ("Add to song" / "Update section").
 *         Song = the structure rail (SongView, Task 7.2): template picker,
 *         slot fill, section sheets, scene-launch jumps.
 *         The library surface is full-bleed (LibraryBrowser — consonance
 *         guardrails, facets, "goes with →" pivot; Task 5.1).
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
 * restart); browsing the Mix while the song plays is a read, not a command.
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
 * carry no key/tempo) and tags editingSectionId — the Mix badge then offers
 * Update (re-promote into that section) / Discard (clears ONLY the badge; the
 * workspace keeps the stack for further jamming — clearing sound out from
 * under someone is never the answer). Crystallize/persistence is Task 8.x
 * (SongView renders a disabled Save stub).
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
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import { PianoKeyboard } from '../../../components/PianoKeyboard.jsx';
import { useKeepScreenAwake } from '../../usePianoScreensaver.jsx';
import PianoEmpty from '../../PianoEmpty.jsx';
import { useLoopLibrary } from '../../useLoopLibrary.js';
import { roleOf } from '@shared-music/layerMatch.mjs';
import { detectKey } from '../../../../MusicNotation/index.js';
import { detectChords } from '../Lessons/theory/theoryEngine.js';
import { romanAnalysis, bestTonic } from '@shared-music/romanAnalysis.mjs';
import {
  workspaceReducer, initialWorkspace, toTransportLayers, takeToSource,
  addLayer, removeLayer, toggleMute, toggleSolo, setGain, setVoice,
  toggleCarried, nudgeKey, setBpm, toggleMetronome, loadStack, setEditingSection,
} from '../../producer/workspaceReducer.js';
import {
  draftReducer, promote, applyTemplate, slotFill,
  resolveSectionStack, toSchedulerInputs, sectionProgramMap, draftReferencesLayer,
} from '../../producer/draftReducer.js';
import { SongView } from '../../producer/SongView.jsx';
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
import './Producer.scss';

const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
/** detectKey() names → pitch class, for shifting the label by keyShift. */
const KEY_PC = { C: 0, G: 7, D: 2, A: 9, E: 4, B: 11, 'F#': 6, F: 5, Bb: 10, Eb: 3, Ab: 8, Db: 1, Gb: 6 };

export function Producer() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-producer' }), []);
  const { config } = usePianoKioskConfig();
  const kb = config?.keyboard || { startNote: 21, endNote: 108 };
  const midi = usePianoMidi();
  const { activeNotes, pressNote, releaseNote } = midi;
  const lib = useLoopLibrary();

  // ── workspace state ─────────────────────────────────────────────────────────
  const [state, dispatch] = useReducer(workspaceReducer, initialWorkspace);
  const stateRef = useRef(state); stateRef.current = state;
  /** layerId → { notes, ppq, barSpan } — loaded lazily per pick; pruned on remove. */
  const [notesById, setNotesById] = useState({});
  const notesByIdRef = useRef(notesById); notesByIdRef.current = notesById;
  const [tab, setTab] = useState('mix'); // 'mix' | 'song'
  // ── draft (song) state — materializes on first PROMOTE / template ──────────
  const [draft, draftDispatch] = useReducer(draftReducer, null);
  const draftRef = useRef(draft); draftRef.current = draft;
  /** Sticky playback mode: 'stack' | 'song' while playing, null when idle
   * (see the header — tab switches must not flip a playing transport). */
  const [lockedMode, setLockedMode] = useState(null);
  /** Live arrangement position from onBlock: which compiled block/section. */
  const [songPos, setSongPos] = useState({ blockIndex: -1, sectionId: null });
  /** Queued scene-launch target (block index) for the SongView "next" chip. */
  const [pendingTarget, setPendingTarget] = useState(null);
  const [overlay, setOverlay] = useState(null); // null | { role: null|'chords' }
  const [showRoman, setShowRoman] = useState(false);
  // Capture session (Task 6.2): the card overlays the STAGE band only.
  const [captureOpen, setCaptureOpen] = useState(false);
  // Count-in lives HERE (not in the card) because the transport's play() reads
  // it from a render-assigned ref — the card's chip tap must land a render
  // BEFORE the arm tap calls play(). Two separate gestures guarantee that.
  const [recCountIn, setRecCountIn] = useState(1);
  // Transient pick-failure toast (mirrors the reducer's lastError pattern:
  // set on failure, cleared by the next pick attempt — nothing else reads it).
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    logger.info('piano.producer.mounted', {});
    return () => logger.info('piano.producer.unmounted', {});
  }, [logger]);

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
    metronome: state.metronome,
    // Count-in only applies while a capture session is open — the capture
    // card's metronome path starts the transport with it. (A Play tap during
    // card setup also gets the count-in; harmless — they're about to record.)
    countInBars: captureOpen ? recCountIn : 0,
    onBlock: handleBlock,
  });
  const transportRef = useRef(transport); transportRef.current = transport;
  useKeepScreenAwake('producer', transport.isPlaying);

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
    }));
    if (editing) dispatch(setEditingSection(null));
    if (isFirst) setTab('song');
  }, [logger]);

  /** Discard the editing badge ONLY — the workspace keeps the loaded stack
   * (documented design call: the person may want to keep jamming on it;
   * clearing sound out from under them is never the answer). */
  const handleDiscardEditing = useCallback(() => {
    logger.info('piano.producer.editing-discard', { sectionId: stateRef.current.editingSectionId });
    dispatch(setEditingSection(null));
  }, [logger]);

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

  /** Restore notes for section layers whose lazy-loaded notes were pruned
   * (e.g. the layer was removed from the workspace since). Keyed by layer id.
   * The landing guard extends handlePick's: notes land while the layer lives
   * in the WORKSPACE **or** is still referenced by the DRAFT — a section
   * layer removed from the workspace mid-fetch must not lose its notes (the
   * song would play that section silently, forever). */
  const ensureLayerNotes = useCallback((layers) => {
    for (const l of layers) {
      if (l.source?.kind !== 'library' || notesByIdRef.current[l.id]) continue;
      const entry = l.source.entry;
      lib.loadNotes(entry).then((notes) => {
        if (!notes?.notes?.length) return;
        if (!stateRef.current.layers.some((x) => x.id === l.id)
          && !draftReferencesLayer(draftRef.current, l.id)) return;
        setNotesById((prev) => (prev[l.id]
          ? prev
          : { ...prev, [l.id]: { notes: notes.notes, ppq: notes.ppq, barSpan: entry.barSpan } }));
      }).catch(() => {
        logger.warn('piano.producer.section-notes-load-failed', { id: l.id });
      });
    }
  }, [lib, logger]);

  /** Open a section for editing: LOAD_STACK its resolved stack WITH the
   * song's key/tempo (the resolveSectionStack doc seam — stacks carry
   * neither), tag editingSectionId, land in Mix. Works for EMPTY template
   * sections too ("Open in Mix to build" clears the stage). */
  const handleOpenSection = useCallback((sectionId) => {
    const d = draftRef.current;
    const stack = resolveSectionStack(d, sectionId);
    if (!stack) return;
    logger.info('piano.producer.section-open', { sectionId, layers: stack.length });
    dispatch(loadStack({
      layers: stack,
      bpm: d.meta.bpm,
      keyShift: d.meta.keyShift,
      editingSectionId: sectionId,
    }));
    ensureLayerNotes(stack);
    setTab('mix');
  }, [ensureLayerNotes, logger]);

  /** Scene launch: queue the jump, and show the chip only if the transport
   * accepted it (it no-ops unless playing the arrangement). */
  const handleQueueJump = useCallback((blockIndex, jumpMode) => {
    logger.info('piano.producer.jump-request', { blockIndex, mode: jumpMode });
    transportRef.current.queueJump(blockIndex, jumpMode);
    if (transportRef.current.pendingJumpRef?.current) setPendingTarget(blockIndex);
  }, [logger]);

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
  }, []);

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
  }, [logger]);

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
  }, [ensureAudio, lib, logger]);

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
  }, []);

  const handleToggleMute = useCallback((id) => dispatch(toggleMute(id)), []);
  const handleToggleSolo = useCallback((id) => dispatch(toggleSolo(id)), []);
  const handleToggleCarried = useCallback((id) => {
    logger.info('piano.producer.carry-toggle', { id });
    dispatch(toggleCarried(id));
  }, [logger]);
  const handleSetGain = useCallback((id, gain) => {
    logger.sampled('piano.producer.gain-set', { id, gain }, { maxPerMinute: 20, aggregate: true });
    dispatch(setGain(id, gain));
  }, [logger]);
  // Voice select is a user gesture — a fine moment to unlock audio, so the
  // newly picked program is audible immediately (the configureLayer diff
  // effect pushes it to the router as the reducer state lands).
  const handleSetVoice = useCallback((id, program) => {
    logger.info('piano.producer.voice-set', { id, program });
    ensureAudio();
    dispatch(setVoice(id, program));
  }, [ensureAudio, logger]);

  // ── display derivations ─────────────────────────────────────────────────────
  const splitNote = useMemo(() => Math.floor((kb.startNote + kb.endNote) / 2), [kb.startNote, kb.endNote]);

  const baseLayer = state.layers[0] ?? null;
  const detectedKey = useMemo(() => {
    const loaded = baseLayer ? notesById[baseLayer.id] : null;
    if (!loaded?.notes?.length) return 'C';
    return detectKey(loaded.notes.map((n) => n.midi % 12));
  }, [baseLayer, notesById]);
  const keyLabel = useMemo(() => {
    const pc = KEY_PC[detectedKey] ?? 0;
    return NOTE_NAMES[(((pc + state.keyShift) % 12) + 12) % 12];
  }, [detectedKey, state.keyShift]);

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

  const editingSectionName = state.editingSectionId
    ? (draft?.sections.find((s) => s.id === state.editingSectionId)?.name ?? state.editingSectionId)
    : null;

  return (
    <section className="piano-mode piano-producer-mode">
      {lib.loading && <PianoEmpty loading />}
      {lib.error && <PianoEmpty message={`Couldn't load the loop library: ${lib.error}`} />}

      {lib.loops && !overlayOpen && (
        <>
          <TransportBar
            isPlaying={transport.isPlaying}
            // While playing, the button is Stop — it must stay tappable even
            // if the content that made it playable was just removed.
            canPlay={transport.isPlaying
              || (armedMode === 'song' ? songPlayable : state.layers.length > 0)}
            onTogglePlay={handleTogglePlay}
            positionRef={transport.positionRef}
            bpm={state.bpm}
            onBpm={(next) => dispatch(setBpm(next))}
            keyLabel={keyLabel}
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
            <div className="piano-producer-mode__tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'mix'}
                className={`piano-chip${tab === 'mix' ? ' is-on' : ''}`}
                onClick={() => setTab('mix')}
              >Mix</button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'song'}
                className={`piano-chip${tab === 'song' ? ' is-on' : ''}`}
                onClick={() => setTab('song')}
              >Song</button>
              <button
                type="button"
                className={`piano-chip piano-producer-mode__roman-toggle${showRoman ? ' is-on' : ''}`}
                aria-label="roman"
                aria-pressed={showRoman}
                onClick={() => setShowRoman((v) => !v)}
              >Roman</button>
            </div>

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

            {tab === 'mix' && (
              state.layers.length === 0 ? (
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
                  <button type="button" className="piano-producer-mode__door" disabled title="Saved songs arrive soon">
                    <span className="piano-producer-mode__door-title">Songs &amp; Resume</span>
                    <span className="piano-producer-mode__door-blurb">Coming soon</span>
                  </button>
                </div>
              ) : (
                <div className="piano-producer-mode__mix">
                  <div className="piano-producer-mode__layers">
                    {state.layers.map((l) => (
                      <ChannelStrip
                        key={l.id}
                        layer={l}
                        grooveCount={grooveCount}
                        onboardGm={onboardEnabled}
                        onToggleMute={handleToggleMute}
                        onToggleSolo={handleToggleSolo}
                        onToggleCarried={handleToggleCarried}
                        onRemove={handleRemove}
                        onGain={handleSetGain}
                        onVoice={handleSetVoice}
                      />
                    ))}
                  </div>
                  <div className="piano-producer-mode__mix-actions">
                    <button
                      type="button"
                      className="piano-producer-mode__add-layer"
                      onClick={() => openOverlay(null, null)}
                    >+ Add layer</button>
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
          // Press-and-hold audition (Task 5.2): the peek rides the SAME
          // router on reserved channels while the jam keeps looping, and
          // conforms to the live key/tempo. ensureAudio unlocks the gmSynth
          // in the card's pointer-down gesture context.
          router={router}
          bpm={state.bpm}
          keyShift={state.keyShift}
          onAudioGesture={ensureAudio}
        />
      )}
    </section>
  );
}

export default Producer;
