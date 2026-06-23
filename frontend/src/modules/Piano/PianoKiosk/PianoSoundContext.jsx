import { createContext, useContext, useMemo, useState, useCallback } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoMidi } from './PianoMidiContext.jsx';
import { usePianoKioskConfig } from './PianoConfig.jsx';
import { usePianoVoiceBridge } from './usePianoVoiceBridge.js';
import { resolveInstrumentSpec } from './instrumentSpec.js';
import { getDeviceProfile } from './devices/suzukiMdg400.js';

/**
 * PianoSound — the single owner of "what voice is the piano playing". Two layers:
 *
 *  1. The onboard keyboard. When config names a `device` (e.g. the Suzuki MDG-400),
 *     its full grouped voice list + reverb/chorus effects are driven over MIDI OUT
 *     (Program Change / Bank Select / CC). Otherwise the simple config `voices`
 *     timbre list is used.
 *  2. Rendered voice-bridge instruments (the APK) — selecting one mutes onboard
 *     (Local Control) so only the rendered voice sounds.
 *
 * The chrome status chip reads `activeName`; the Settings sheet edits everything.
 */
const SoundContext = createContext(null);

const FALLBACK = {
  sources: [], active: null, activeId: null, activeName: 'Onboard', select: () => {},
  gainDb: 0, reverbMix: 0, setGain: () => {}, setReverb: () => {}, hasInstruments: false, bridgeLink: null,
  device: null, deviceVoice: null, selectVoice: () => {}, effects: null, setEffect: () => {},
};

export function PianoSoundProvider({ children }) {
  const { config, pianoId } = usePianoKioskConfig();
  const { sendProgramChange, sendVoice, sendControlChange, sendLocalControl } = usePianoMidi();
  const logger = useMemo(() => getLogger().child({ component: 'piano-sound' }), []);

  const device = useMemo(() => getDeviceProfile(config.device), [config.device]);
  const voices = useMemo(() => config.voices || [], [config.voices]);
  const instruments = useMemo(() => config.instruments || [], [config.instruments]);
  const bridge = usePianoVoiceBridge({ enabled: instruments.length > 0 });

  // Flat source list. With a hardware `device`, its voices are driven by the
  // Keyboard panel (grouped, 138 voices) — so `sources` is just rendered voices;
  // otherwise the simple onboard timbres lead.
  const sources = useMemo(() => {
    const onboard = device ? [] : (voices.length
      ? voices.map((v, i) => ({ id: `onboard:${i}`, kind: 'onboard', name: v.label || `Voice ${i + 1}`, program: v.program }))
      : [{ id: 'onboard:0', kind: 'onboard', name: 'Onboard', program: null }]);
    const rendered = instruments.map((inst) => ({ id: `inst:${inst.id}`, kind: 'instrument', name: inst.name, inst }));
    return [...onboard, ...rendered];
  }, [device, voices, instruments]);

  // activeId === null means "onboard" (the device voice / first timbre is sounding).
  const [activeId, setActiveId] = useState(() => (device ? null : sources[0]?.id ?? null));
  const [gainDb, setGainDb] = useState(0);
  const [reverbMix, setReverbMix] = useState(0);
  const active = activeId ? sources.find((s) => s.id === activeId) || null : null;

  // ── Onboard hardware: the configured device's voice + effects ──
  const [deviceVoice, setDeviceVoice] = useState(() => device?.voiceGroups?.[0]?.voices?.[0] || null);
  const [effects, setEffects] = useState(() => (device ? {
    reverb: { on: true, type: device.effects.reverb.defaultType, level: 64 },
    chorus: { on: false, type: device.effects.chorus.defaultType, level: 64 },
  } : null));

  const selectVoice = useCallback((voice) => {
    if (!voice) return;
    bridge.stop();
    sendLocalControl(true);     // make sure the onboard sound is audible
    sendVoice(voice.pc, voice.bank || 0);
    setDeviceVoice(voice);
    setActiveId(null);
    logger.info('piano.device.voice', { pianoId, no: voice.no, name: voice.name, pc: voice.pc, bank: voice.bank || 0 });
  }, [bridge, sendLocalControl, sendVoice, pianoId, logger]);

  const setEffect = useCallback((name, patch) => {
    setEffects((prev) => {
      if (!prev || !device?.effects?.[name]) return prev;
      const eff = { ...prev[name], ...patch };
      const fx = device.effects[name];
      if ('type' in patch) sendControlChange(fx.typeCC, eff.type);
      if ('level' in patch || 'on' in patch) sendControlChange(fx.levelCC, eff.on ? eff.level : 0);
      logger.info('piano.device.effect', { pianoId, name, ...patch });
      return { ...prev, [name]: eff };
    });
  }, [device, sendControlChange, pianoId, logger]);

  // ── Voice selection (onboard timbres + rendered instruments) ──
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

  const activeName = active?.kind === 'instrument'
    ? active.name
    : (device ? (deviceVoice?.name || 'Keyboard') : (active?.name || 'Onboard'));

  const value = useMemo(() => ({
    sources, active, activeId, activeName, select,
    gainDb, reverbMix, setGain, setReverb,
    hasInstruments: instruments.length > 0, bridgeLink: bridge.status?.link ?? null,
    device, deviceVoice, selectVoice, effects, setEffect,
  }), [sources, active, activeId, activeName, select, gainDb, reverbMix, setGain, setReverb, instruments.length, bridge.status?.link, device, deviceVoice, selectVoice, effects, setEffect]);

  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>;
}

export function usePianoSound() {
  return useContext(SoundContext) || FALLBACK;
}

export default PianoSoundProvider;
