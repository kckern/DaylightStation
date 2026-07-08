import { createContext, useContext, useSyncExternalStore } from 'react';
import { useWebMidiBLE } from './useWebMidiBLE.js';

const PianoMidiContext = createContext(null);

/**
 * Provides the single Web-MIDI (BLE) connection to every piano mode, so games,
 * lessons, studio and chrome all share one input stream + output sender.
 */
export function PianoMidiProvider({ children, preferredInputName }) {
  const midi = useWebMidiBLE({ preferredInputName });
  return <PianoMidiContext.Provider value={midi}>{children}</PianoMidiContext.Provider>;
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
