import { createContext, useContext, useMemo, useState, useCallback } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoMidi } from './PianoMidiContext.jsx';
import { usePianoKioskConfig } from './PianoConfig.jsx';
import { usePianoVoiceBridge } from './usePianoVoiceBridge.js';
import { resolveInstrumentSpec } from './instrumentSpec.js';

/**
 * PianoSound — the single owner of "what voice is the piano playing". Consolidates
 * the onboard timbres (Program Change) and the rendered voice-bridge instruments
 * into one flat source list, with the live side-effects (Local Control mute,
 * preset load, gain/reverb). The chrome status chip reads the active name; the
 * Settings sheet edits the selection. One voice bridge for the whole shell (no
 * per-component WS fan-out).
 */
const SoundContext = createContext(null);

const FALLBACK = {
  sources: [], active: null, activeId: null, activeName: 'Onboard',
  select: () => {}, gainDb: 0, reverbMix: 0, setGain: () => {}, setReverb: () => {},
  hasInstruments: false, bridgeLink: null,
};

export function PianoSoundProvider({ children }) {
  const { config, pianoId } = usePianoKioskConfig();
  const { sendProgramChange, sendLocalControl } = usePianoMidi();
  const logger = useMemo(() => getLogger().child({ component: 'piano-sound' }), []);

  const voices = useMemo(() => config.voices || [], [config.voices]);
  const instruments = useMemo(() => config.instruments || [], [config.instruments]);
  const bridge = usePianoVoiceBridge({ enabled: instruments.length > 0 });

  // Flat list: onboard timbres first (each = a Program Change), then rendered voices.
  const sources = useMemo(() => {
    const onboard = voices.length
      ? voices.map((v, i) => ({ id: `onboard:${i}`, kind: 'onboard', name: v.label || `Voice ${i + 1}`, program: v.program }))
      : [{ id: 'onboard:0', kind: 'onboard', name: 'Onboard', program: null }];
    const rendered = instruments.map((inst) => ({ id: `inst:${inst.id}`, kind: 'instrument', name: inst.name, inst }));
    return [...onboard, ...rendered];
  }, [voices, instruments]);

  const [activeId, setActiveId] = useState(() => sources[0]?.id ?? null);
  const [gainDb, setGainDb] = useState(0);
  const [reverbMix, setReverbMix] = useState(0);
  const active = sources.find((s) => s.id === activeId) || sources[0] || null;

  const select = useCallback((id) => {
    const src = sources.find((s) => s.id === id);
    if (!src) return;
    if (src.kind === 'onboard') {
      const stopped = bridge.stop();
      const restored = sendLocalControl(true);
      if (src.program != null) sendProgramChange(src.program);
      logger.info('piano.sound.onboard', { pianoId, id: src.id, program: src.program, stopped, restored });
    } else {
      const loaded = bridge.loadPreset(resolveInstrumentSpec(src.inst));
      const muted = sendLocalControl(false);
      setGainDb(src.inst.gain_db ?? 0);
      setReverbMix(src.inst.reverb?.mix ?? 0);
      logger.info('piano.sound.instrument', { pianoId, id: src.inst.id, engine: src.inst.engine, loaded, muted, link: bridge.status?.link });
    }
    setActiveId(src.id);
  }, [sources, bridge, sendLocalControl, sendProgramChange, pianoId, logger]);

  const setGain = useCallback((v) => { setGainDb(v); bridge.setParam('gain_db', v); }, [bridge]);
  const setReverb = useCallback((v) => { setReverbMix(v); bridge.setParam('reverb.mix', v); }, [bridge]);

  const value = useMemo(() => ({
    sources, active, activeId, activeName: active?.name || 'Onboard',
    select, gainDb, reverbMix, setGain, setReverb,
    hasInstruments: instruments.length > 0, bridgeLink: bridge.status?.link ?? null,
  }), [sources, active, activeId, select, gainDb, reverbMix, setGain, setReverb, instruments.length, bridge.status?.link]);

  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>;
}

export function usePianoSound() {
  return useContext(SoundContext) || FALLBACK;
}

export default PianoSoundProvider;
