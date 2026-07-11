import { createContext, useContext, useMemo, useState, useCallback, useEffect, useRef } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoMidi } from './PianoMidiContext.jsx';
import { usePianoKioskConfig } from './PianoConfig.jsx';
import { getDeviceProfile } from './devices/suzukiMdg400.js';

/**
 * PianoSound — the single owner of "what voice is the piano playing". The
 * onboard keyboard (the Suzuki MDG-400) is the single sound engine: when
 * config names a `device`, its full grouped voice list + reverb/chorus
 * effects are driven over MIDI OUT (Program Change / Bank Select / CC).
 *
 * The chrome status chip reads `activeName`; `usePianoSoundBundle` composes
 * voice + effects + volume into the full Bundle that the Player Sound Panel
 * and Operator Drawer both drive via `selectVoice`/`setEffect`.
 *
 * The rendered-voice bridge (a native APK, out-of-process engine) has been
 * retired. `sources`/`active`/`activeId`/`select`/`gainDb`/`reverbMix`/
 * `setGain`/`setReverb`/`hasInstruments`/`bridgeLink` remain as inert stubs —
 * deferred (design §11), not currently rendered anywhere.
 */
const SoundContext = createContext(null);

const FALLBACK = {
  sources: [], active: null, activeId: null, activeName: 'Onboard', select: () => {},
  gainDb: 0, reverbMix: 0, setGain: () => {}, setReverb: () => {}, resync: () => {}, hasInstruments: false, bridgeLink: null,
  device: null, deviceVoice: null, selectVoice: () => {}, effects: null, setEffect: () => {},
};

export function PianoSoundProvider({ children }) {
  const { config, pianoId } = usePianoKioskConfig();
  const { sendVoice, sendControlChange, sendLocalControl, outputConnected } = usePianoMidi();
  const logger = useMemo(() => getLogger().child({ component: 'piano-sound' }), []);

  const device = useMemo(() => getDeviceProfile(config.device), [config.device]);

  // ── Onboard hardware: the configured device's voice + effects ──
  const [deviceVoice, setDeviceVoice] = useState(() => device?.voiceGroups?.[0]?.voices?.[0] || null);
  const [effects, setEffects] = useState(() => (device ? {
    reverb: { on: true, type: device.effects.reverb.defaultType, level: 64 },
    chorus: { on: false, type: device.effects.chorus.defaultType, level: 64 },
  } : null));

  const selectVoice = useCallback((voice) => {
    if (!voice) return;
    sendLocalControl(true);     // make sure the onboard sound is audible
    sendVoice(voice.pc, voice.bank || 0);
    setDeviceVoice(voice);
    logger.info('piano.device.voice', { pianoId, no: voice.no, name: voice.name, pc: voice.pc, bank: voice.bank || 0 });
  }, [sendLocalControl, sendVoice, pianoId, logger]);

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

  // Re-assert the current voice + effects onto the hardware. Used by the
  // Settings "Restart audio & MIDI" control (paired with a MIDI reconnect) to
  // recover the audio subsystem without a full page reload.
  const resync = useCallback(() => {
    if (device && deviceVoice) {
      sendLocalControl(true);
      sendVoice(deviceVoice.pc, deviceVoice.bank || 0);
    }
    if (device && effects) {
      ['reverb', 'chorus'].forEach((name) => {
        const fx = device.effects?.[name];
        const eff = effects[name];
        if (fx && eff) {
          sendControlChange(fx.typeCC, eff.type);
          sendControlChange(fx.levelCC, eff.on ? eff.level : 0);
        }
      });
    }
    logger.info('piano.sound.resync', { pianoId, deviceVoice: deviceVoice?.no ?? null });
  }, [device, deviceVoice, effects, sendLocalControl, sendVoice, sendControlChange, pianoId, logger]);

  // Auto-recover on a MIDI OUT link rising edge (false→true): a BLE flap makes
  // the hardware forget our voice/effects, and any instrument/tone change made
  // while the link was down never sent (the send no-oped, but deviceVoice/effects
  // state kept it). Re-assert on reconnect so the piano matches the screen with
  // no user action — the "rock solid" link the operator drawer promises. The
  // statechange debounce in useWebMidiBLE makes this a single clean edge, not a
  // storm. (Volume/CC7 is re-asserted in parallel by PianoMixContext.)
  const prevOutRef = useRef(false);
  useEffect(() => {
    if (outputConnected && !prevOutRef.current && device) resync();
    prevOutRef.current = outputConnected;
  }, [outputConnected, device, resync]);

  const activeName = device ? (deviceVoice?.name || 'Keyboard') : 'Onboard';

  const value = useMemo(() => ({
    sources: [], active: null, activeId: null, activeName, select: () => {},
    gainDb: 0, reverbMix: 0, setGain: () => {}, setReverb: () => {}, resync,
    hasInstruments: false, bridgeLink: null,
    device, deviceVoice, selectVoice, effects, setEffect,
  }), [activeName, resync, device, deviceVoice, selectVoice, effects, setEffect]);

  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>;
}

export function usePianoSound() {
  return useContext(SoundContext) || FALLBACK;
}

export default PianoSoundProvider;
