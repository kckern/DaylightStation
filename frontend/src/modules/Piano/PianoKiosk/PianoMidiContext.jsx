import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useWebMidiBLE } from './useWebMidiBLE.js';
import { usePianoBridgeNotes } from './usePianoBridgeNotes.js';

const PianoMidiContext = createContext(null);

/**
 * Provides the single MIDI connection to every piano mode, so games, lessons,
 * studio and chrome all share one note-in stream + output sender.
 *
 * Note-IN is ADAPTIVE, bridge-first with a Web-MIDI fallback:
 *  - KIOSK (garage tablet): the native piano-bridge APK is the sole BLE-MIDI
 *    reader and broadcasts notes over WebSocket (usePianoBridgeNotes). Web MIDI
 *    input stays OFF (acquireInput:false) — a second Web MIDI input subscription
 *    would fight the APK for the one BLE connection, causing flapping/drops.
 *  - NON-KIOSK (e.g. a laptop with a MIDI keyboard): no bridge listens on
 *    ws://localhost:8770, so once it's deemed unavailable we flip
 *    acquireInput:true and read notes over Web MIDI directly.
 *
 * Web MIDI OUTPUT is always used for program/voice changes + studio playback,
 * regardless of which note-in path is active.
 */
export function PianoMidiProvider({ children, preferredInputName }) {
  // Stable onNote that forwards to midi.feedNote. Created BEFORE the bridge so
  // there's no temporal circular dependency (midi needs bridge.unavailable;
  // bridge needs midi's feedNote) — the ref is filled in right after midi is
  // built. Harmless in fallback: the bridge never delivers a note there.
  const feedRef = useRef(null);
  const onNote = useCallback((type, note, velocity) => {
    feedRef.current?.(type, note, velocity);
  }, []);

  const bridge = usePianoBridgeNotes({ onNote });
  const acquireInput = bridge.unavailable; // Web MIDI INPUT only when NO bridge
  const midi = useWebMidiBLE({ preferredInputName, acquireInput });
  feedRef.current = midi.feedNote;

  // Initialize Web MIDI on mount, keyed on Web MIDI's OWN status (not the
  // bridge-derived status below). On the kiosk the bridge makes the outer
  // `status` 'connected' immediately, so PianoApp's idle→connect trigger never
  // fires — leaving the MIDI OUTPUT port (voice/note OUT) unbound. Driving
  // connect() off midi.status here guarantees OUTPUT always initializes,
  // independent of the note-IN path.
  const rawConnect = midi.connect;
  const rawStatus = midi.status;
  useEffect(() => {
    if (rawStatus === 'idle') rawConnect();
  }, [rawStatus, rawConnect]);

  const bridgeConnected = bridge.link === 'connected';
  // Gate opens on the bridge note link (kiosk) OR, in fallback, on Web MIDI's
  // own connected status. Web MIDI OUTPUT health stays separate (outputConnected).
  const connected = bridgeConnected || (bridge.unavailable && midi.status === 'connected');
  const status = bridgeConnected ? 'connected'
    : bridge.unavailable ? midi.status // fallback: reflect Web MIDI (no-input/requesting/connected)
      : 'requesting'; // bridge-first, still trying

  // Unified MIDI health — ONE signal covering BOTH directions. IN and OUT travel
  // different transports (bridge WS vs Web MIDI output on jam-7e6) and fail
  // independently, so without this a consumer can read "connected" while OUT is
  // silently dead (the failure this whole surface is meant to make visible).
  //   in:  'bridge' | 'webmidi' | 'down'  — which note-in path is live
  //   out: 'up' | 'down'                  — real output-port liveness
  const inHealth = bridgeConnected ? 'bridge'
    : (bridge.unavailable && midi.status === 'connected') ? 'webmidi' : 'down';
  const outHealth = midi.outputConnected ? 'up' : 'down';
  const midiHealth = useMemo(() => ({
    in: inHealth,
    out: outHealth,
    healthy: inHealth !== 'down' && outHealth === 'up',
  }), [inHealth, outHealth]);

  const value = useMemo(() => ({
    ...midi,
    bridgeLink: bridge.link,
    bridgeUnavailable: bridge.unavailable,
    connected,
    status,
    midiHealth,
  }), [midi, bridge.link, bridge.unavailable, connected, status, midiHealth]);
  return <PianoMidiContext.Provider value={value}>{children}</PianoMidiContext.Provider>;
}

/** Access the shared piano MIDI surface (see useWebMidiBLE for its shape). */
export function usePianoMidi() {
  const ctx = useContext(PianoMidiContext);
  if (!ctx) throw new Error('usePianoMidi must be used within a PianoMidiProvider');
  return ctx;
}

/**
 * Live-note state (activeNotes / sustainPedal / noteHistory / isPlaying) via
 * subscription. ONLY components that render live notes should use this — it
 * re-renders per note event by design. Everything else uses usePianoMidi(),
 * whose value is now identity-stable across note traffic (2026-07-06 audit R1).
 */
export function usePianoMidiNotes() {
  const { notes } = usePianoMidi();
  return useSyncExternalStore(notes.subscribe, notes.getSnapshot, notes.getSnapshot);
}

export default PianoMidiContext;
