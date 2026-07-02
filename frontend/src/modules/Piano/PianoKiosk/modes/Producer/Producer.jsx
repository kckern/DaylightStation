/**
 * Producer — the three-band, workspace-driven jam shell (Task 4.4, design §7).
 *
 * Band 1: TransportBar (play/stop · bar:beat · BPM/tap · key · click · rec stub)
 * Band 2: Stage — Mix | Song tabs. Mix = front-door entry cards when the
 *         workspace is empty, DAW-style ChannelStrips once it isn't (glyph,
 *         voice chip → VoicePicker, M/S, GainStrip, 2-tap remove).
 *         Song = placeholder (Task 7.2).
 *         The library surface is full-bleed (LibraryBrowser — consonance
 *         guardrails, facets, "goes with →" pivot; Task 5.1).
 * Band 3: PianoKeyboard, always live — the person's OWN playing goes through
 *         the untouched pressNote/releaseNote path; loop playback is a
 *         separate path entirely (workspaceReducer → toTransportLayers →
 *         useProducerTransport → voiceRouter → tiers).
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
  workspaceReducer, initialWorkspace, toTransportLayers,
  addLayer, removeLayer, toggleMute, toggleSolo, setGain, setVoice,
  nudgeKey, setBpm, toggleMetronome,
} from '../../producer/workspaceReducer.js';
import { useProducerTransport } from '../../producer/useProducerTransport.js';
import { createVoiceRouter } from '../../producer/voiceRouter.js';
import { createOnboardGmTier } from '../../producer/tiers/onboardGmTier.js';
import { createGmSynthTier } from '../../producer/tiers/gmSynthTier.js';
import { createGmSynth } from '../../producer/gmSynth.js';
import { makeLoopNotesTap } from '../../producer/noteTapFilter.js';
import { TransportBar } from '../../producer/TransportBar.jsx';
import { ChannelStrip } from '../../producer/ChannelStrip.jsx';
import { LibraryBrowser } from '../../producer/LibraryBrowser.jsx';
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
  const [tab, setTab] = useState('mix'); // 'mix' | 'song'
  const [overlay, setOverlay] = useState(null); // null | { role: null|'chords' }
  const [showRoman, setShowRoman] = useState(false);
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

  // ── configureLayer on add / voice / gain changes (diffed per channel) ──────
  const cfgRef = useRef({ router: null, map: new Map() });
  useEffect(() => {
    const cfg = cfgRef.current;
    if (cfg.router !== router) { cfg.router = router; cfg.map = new Map(); }
    const next = new Map();
    for (const l of state.layers) {
      next.set(l.channel, { program: l.gmProgram, gain: l.gain });
      const prev = cfg.map.get(l.channel);
      if (!prev || prev.program !== l.gmProgram || prev.gain !== l.gain) {
        router.configureLayer(l.channel, {
          ...(l.gmProgram != null ? { program: l.gmProgram } : {}),
          gain: l.gain,
        });
      }
    }
    cfg.map = next;
  }, [state.layers, router]);

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
  const transport = useProducerTransport({
    router,
    layers: transportLayers,
    bpm: state.bpm,
    metronome: state.metronome,
  });
  const transportRef = useRef(transport); transportRef.current = transport;
  useKeepScreenAwake('producer', transport.isPlaying);

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
    logger.info('piano.producer.play', { layers: stateRef.current.layers.length });
    transportRef.current.play();
  }, [ensureAudio, logger]);

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
      const rest = { ...prev };
      delete rest[id];
      return rest;
    });
  }, []);

  const handleToggleMute = useCallback((id) => dispatch(toggleMute(id)), []);
  const handleToggleSolo = useCallback((id) => dispatch(toggleSolo(id)), []);
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

  return (
    <section className="piano-mode piano-producer-mode">
      {lib.loading && <PianoEmpty loading />}
      {lib.error && <PianoEmpty message={`Couldn't load the loop library: ${lib.error}`} />}

      {lib.loops && !overlayOpen && (
        <>
          <TransportBar
            isPlaying={transport.isPlaying}
            canPlay={state.layers.length > 0}
            onTogglePlay={handleTogglePlay}
            positionRef={transport.positionRef}
            bpm={state.bpm}
            onBpm={(next) => dispatch(setBpm(next))}
            keyLabel={keyLabel}
            onKeyNudge={(delta) => dispatch(nudgeKey(delta))}
            metronome={state.metronome}
            onToggleMetronome={() => dispatch(toggleMetronome())}
          />

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
                  <button type="button" className="piano-producer-mode__door" disabled title="Recording arrives soon">
                    <span className="piano-producer-mode__door-title">Record my own</span>
                    <span className="piano-producer-mode__door-blurb">Coming soon</span>
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
                        onRemove={handleRemove}
                        onGain={handleSetGain}
                        onVoice={handleSetVoice}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    className="piano-producer-mode__add-layer"
                    onClick={() => openOverlay(null, null)}
                  >+ Add layer</button>
                  {state.lastError === 'channels-exhausted' && (
                    <p className="piano-producer-mode__toast" role="alert">
                      All 15 voice channels are in use — remove a layer to add another.
                    </p>
                  )}
                </div>
              )
            )}

            {tab === 'song' && (
              <div className="piano-producer-mode__song-placeholder">
                Build sections from your jam — coming next
              </div>
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
