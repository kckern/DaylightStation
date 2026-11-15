import { createContext, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';
import { usePianoMidi } from './PianoMidiContext.jsx';
import { usePianoKioskConfigOptional } from './PianoConfig.jsx';
import { checkBridgeMediaVolume } from './bridgeAudioVolume.js';

/**
 * PianoMix — the single owner of the two software output levels that share the
 * BT speaker's one physical slider: the onboard Suzuki voice (driven by MIDI
 * CC7 / channel volume) and BT media audio (the media element's .volume). Both
 * levels persist; the physical slider stays the master above them.
 *
 * The media level is software only — it multiplies against the tablet's OS
 * STREAM_MUSIC index for the A2DP speaker. So every media-level change (and mount)
 * asks the bridge to verify that index (`checkBridgeMediaVolume`); the bridge raises
 * it if it was lowered. `mediaOutput.silent` says the check could NOT fix it.
 */
const PIANO_KEY = 'piano.mix.pianoLevel';
const MEDIA_KEY = 'piano.mix.mediaLevel';
const CC_VOLUME = 7; // MIDI Channel Volume (GM Main Volume)

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v)));
const readLevel = (key) => {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return 1;
    const n = Number(raw);
    return Number.isFinite(n) ? clamp01(n) : 1;
  } catch { return 1; }
};

// Media/transport components also render in isolated test and preview surfaces.
// Keep their harmless defaults, while the real kiosk tree installs the sole
// state-owning provider above sound, connection, presets and every mode.
const FALLBACK = {
  pianoLevel: 1,
  mediaLevel: 1,
  setPianoLevel: () => {},
  setMediaLevel: () => {},
  reassertPianoLevel: () => false,
  mediaOutput: null,
};
const Ctx = createContext(FALLBACK);

export function PianoMixProvider({ children }) {
  const { outputConnected, sendControlChange } = usePianoMidi();
  const pianoId = usePianoKioskConfigOptional()?.pianoId || 'default';
  const logger = useMemo(() => getLogger().child({ component: 'piano-mix' }), []);
  const pianoKey = `${PIANO_KEY}.${pianoId}`;
  const readPianoLevel = useCallback(() => {
    try {
      const scoped = localStorage.getItem(pianoKey);
      if (scoped != null) return readLevel(pianoKey);
      const legacyRaw = localStorage.getItem(PIANO_KEY);
      if (legacyRaw == null) return 1;
      const legacy = readLevel(PIANO_KEY);
      localStorage.setItem(pianoKey, String(legacy)); // one-time copy; old key remains backward-compatible
      return legacy;
    } catch { return 1; }
  }, [pianoKey]);
  const [pianoLevel, setPianoLevelState] = useState(readPianoLevel);
  const [mediaLevel, setMediaLevelState] = useState(() => readLevel(MEDIA_KEY));
  const pianoRef = useRef(pianoLevel);
  pianoRef.current = pianoLevel;

  const setPianoLevel = useCallback((v) => {
    const level = clamp01(v);
    setPianoLevelState(level);
    try { localStorage.setItem(pianoKey, String(level)); } catch { /* storage unavailable */ }
    const cc = Math.round(level * 127);
    sendControlChange(CC_VOLUME, cc);
    logger.info('piano.mix.piano-level', { level, cc });
  }, [pianoKey, sendControlChange, logger]);

  const reassertPianoLevel = useCallback(() => {
    const level = pianoRef.current;
    const cc = Math.round(level * 127);
    const sent = sendControlChange(CC_VOLUME, cc);
    logger.info('piano.mix.cc7-reassert', { pianoId, level, cc, sent });
    return sent;
  }, [sendControlChange, logger, pianoId]);

  useEffect(() => {
    const level = readPianoLevel();
    pianoRef.current = level;
    setPianoLevelState(level);
  }, [readPianoLevel]);

  const [mediaOutput, setMediaOutput] = useState(null);
  const checkMediaOutput = useCallback(async (trigger) => {
    const r = await checkBridgeMediaVolume();
    if (!r.available) {
      logger.debug('piano.mix.os-volume.unavailable', { trigger, error: r.error });
      return r;
    }
    setMediaOutput(r);
    const data = { trigger, routeOk: r.routeOk, musicIndex: r.musicIndex, musicMax: r.musicMax };
    if (r.silent) logger.warn('piano.mix.os-volume.silent', data);
    else if (r.raised) logger.warn('piano.mix.os-volume.raised', data);
    else logger.debug('piano.mix.os-volume.ok', data);
    return r;
  }, [logger]);

  useEffect(() => { checkMediaOutput('mount'); }, [checkMediaOutput]);

  const setMediaLevel = useCallback((v) => {
    const level = clamp01(v);
    setMediaLevelState(level);
    try { localStorage.setItem(MEDIA_KEY, String(level)); } catch { /* storage unavailable */ }
    logger.info('piano.mix.media-level', { level });
    checkMediaOutput('media-level');
  }, [logger, checkMediaOutput]);

  // Re-assert the piano CC7 level whenever the MIDI OUT LINK (re)connects, so a
  // reconnect, keyboard power-cycle, or BLE flap restores the chosen balance —
  // including a volume change made while the link was briefly down (the send
  // no-oped, but pianoLevel state kept it, so this re-fires it). Keyed on
  // outputConnected (the port that actually flaps), not input-level `connected`.
  useEffect(() => {
    if (!outputConnected) return;
    const cc = Math.round(pianoRef.current * 127);
    sendControlChange(CC_VOLUME, cc);
    logger.info('piano.mix.cc7-assert', { level: pianoRef.current, cc });
  }, [outputConnected, sendControlChange, logger]);

  const value = useMemo(
    () => ({ pianoLevel, mediaLevel, setPianoLevel, setMediaLevel, reassertPianoLevel, mediaOutput }),
    [pianoLevel, mediaLevel, setPianoLevel, setMediaLevel, reassertPianoLevel, mediaOutput],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export default Ctx;
