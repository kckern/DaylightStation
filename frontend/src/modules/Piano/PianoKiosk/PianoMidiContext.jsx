import { createContext, useContext } from 'react';
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

export default PianoMidiContext;
