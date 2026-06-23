import { createContext, useContext, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoMidi } from './PianoMidiContext.jsx';

/**
 * PianoMix — the single owner of the two software output levels that share the
 * BT speaker's one physical slider: the onboard Suzuki voice (driven by MIDI
 * CC7 / channel volume) and BT media audio (the media element's .volume). Both
 * levels persist; the physical slider stays the master above them.
 */
const PIANO_KEY = 'piano.mix.pianoLevel';
const MEDIA_KEY = 'piano.mix.mediaLevel';
const CC_VOLUME = 7; // MIDI Channel Volume (GM Main Volume)

const clamp01 = (v) => Math.max(0, Math.min(1, Math.round(v * 10) / 10));
const readLevel = (key) => {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return 1;
    const n = Number(raw);
    return Number.isFinite(n) ? clamp01(n) : 1;
  } catch { return 1; }
};

const FALLBACK = { pianoLevel: 1, mediaLevel: 1, setPianoLevel: () => {}, setMediaLevel: () => {} };
const Ctx = createContext(FALLBACK);

export function PianoMixProvider({ children }) {
  const { connected, sendControlChange } = usePianoMidi();
  const logger = useMemo(() => getLogger().child({ component: 'piano-mix' }), []);
  const [pianoLevel, setPianoLevelState] = useState(() => readLevel(PIANO_KEY));
  const [mediaLevel, setMediaLevelState] = useState(() => readLevel(MEDIA_KEY));
  const pianoRef = useRef(pianoLevel);
  pianoRef.current = pianoLevel;

  const setPianoLevel = useCallback((v) => {
    const level = clamp01(v);
    setPianoLevelState(level);
    try { localStorage.setItem(PIANO_KEY, String(level)); } catch { /* storage unavailable */ }
    const cc = Math.round(level * 127);
    sendControlChange(CC_VOLUME, cc);
    logger.info('piano.mix.piano-level', { level, cc });
  }, [sendControlChange, logger]);

  const setMediaLevel = useCallback((v) => {
    const level = clamp01(v);
    setMediaLevelState(level);
    try { localStorage.setItem(MEDIA_KEY, String(level)); } catch { /* storage unavailable */ }
    logger.info('piano.mix.media-level', { level });
  }, [logger]);

  // Re-assert the piano CC7 level whenever MIDI (re)connects, so a reconnect or
  // keyboard power-cycle restores the chosen balance.
  useEffect(() => {
    if (!connected) return;
    const cc = Math.round(pianoRef.current * 127);
    sendControlChange(CC_VOLUME, cc);
    logger.info('piano.mix.cc7-assert', { level: pianoRef.current, cc });
  }, [connected, sendControlChange, logger]);

  const value = useMemo(
    () => ({ pianoLevel, mediaLevel, setPianoLevel, setMediaLevel }),
    [pianoLevel, mediaLevel, setPianoLevel, setMediaLevel],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const usePianoMix = () => useContext(Ctx);

export default Ctx;
