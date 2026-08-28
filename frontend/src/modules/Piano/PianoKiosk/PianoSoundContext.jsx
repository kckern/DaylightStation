import { createContext, useMemo, useState, useCallback, useEffect, useRef } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoMidi } from './PianoMidiContext.jsx';
import { planEffectSysex } from './effectSysex.js';
import { usePianoKioskConfig } from './PianoConfig.jsx';
import { getDeviceProfile } from './devices/suzukiMdg400.js';

/**
 * PianoSound — the single owner of "what voice is the piano playing". The
 * onboard keyboard (the Suzuki MDG-400) is the single sound engine: when
 * config names a `device`, its full grouped voice list + reverb/chorus
 * effects are driven over MIDI OUT (Program Change / Bank Select / CC).
 *
 * The chrome status chip reads `activeName`; `usePianoSoundBundle` composes
 * voice + effects into the SoundPreset used by the player surface.
 */
export const SoundContext = createContext(null);

export function PianoSoundProvider({ children }) {
  const { config, pianoId } = usePianoKioskConfig();
  const { sendVoice, sendControlChange, sendLocalControl, outputConnected, sendSysex } = usePianoMidi();
  const logger = useMemo(() => getLogger().child({ component: 'piano-sound' }), []);

  const device = useMemo(() => getDeviceProfile(config.device), [config.device]);

  // Effect transport policy, from piano config (`effects:` block). Defaults match
  // the documented rig: GM2 is preferred over GS because it needs 2 messages
  // instead of 3 and the JamCorder's BLE→DIN hop drops SysEx often enough that
  // the shorter sequence measurably survives better. `resend` exists because the
  // instrument has no read-back — nothing can confirm a message landed.
  const effectsCfg = useMemo(() => ({
    dialect: config?.effects?.dialect === 'gs' ? 'gs' : 'gm2',
    route: config?.effects?.route || 'pianobridge',
    transport: config?.effects?.transport === 'cc' ? 'cc' : 'sysex',
    resend: Number(config?.effects?.resend) > 0 ? Number(config.effects.resend) : 3,
  }), [config?.effects?.dialect, config?.effects?.route, config?.effects?.transport, config?.effects?.resend]);

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

  /**
   * Push one effect to the hardware, preferring SysEx.
   *
   * The MDG-400 **ignores Control Change for effect type** — `piano/config.yml`:
   * "sysex works; cc is ignored by this unit". Until 2026-08-22 this code sent
   * only CC, so the UI worked, the bytes went out, and the piano discarded them.
   * That is the whole reason reverb/chorus never did anything.
   *
   * SysEx cannot come from the browser (the WebView is denied Web MIDI SysEx), so
   * it goes over the piano-bridge APK. When that route is unavailable — no bridge
   * (a laptop), or an older APK without `midi.raw` — fall back to the old CC path
   * rather than sending nothing: harmless on this unit, and correct on any device
   * that does honour CC.
   *
   * Returns 'sysex' or 'cc' so the log records which route actually carried it.
   */
  const applyEffectToHardware = useCallback((name, eff, fx) => {
    if (effectsCfg.transport === 'cc') {
      sendControlChange(fx.typeCC, eff.type);
      sendControlChange(fx.levelCC, eff.on ? eff.level : 0);
      return 'cc';
    }
    const bridgeRoute = effectsCfg.route === 'pianobridge';
    const ops = bridgeRoute && sendSysex
      ? planEffectSysex(name, eff, { dialect: effectsCfg.dialect, levelCC: fx.levelCC })
      : [];
    let sentAny = false;
    for (const op of ops) {
      if (op.kind === 'sysex') {
        // Re-send for redundancy: fire-and-forget over a hop that occasionally
        // drops SysEx, against an instrument with no read-back.
        if (sendSysex(op.bytes, effectsCfg.resend)) sentAny = true;
      } else if (op.kind === 'cc') {
        sendControlChange(op.cc, op.value);
      }
    }
    if (sentAny) return 'sysex';
    logger.warn('piano.device.effect-fallback', { pianoId, name, route: effectsCfg.route, transport: effectsCfg.transport });
    sendControlChange(fx.typeCC, eff.type);
    sendControlChange(fx.levelCC, eff.on ? eff.level : 0);
    return 'cc';
  }, [sendSysex, sendControlChange, effectsCfg, logger, pianoId]);

  const setEffect = useCallback((name, patch) => {
    setEffects((prev) => {
      if (!prev || !device?.effects?.[name]) return prev;
      const eff = { ...prev[name], ...patch };
      const fx = device.effects[name];
      const via = applyEffectToHardware(name, eff, fx);
      logger.info('piano.device.effect', { pianoId, name, via, ...patch });
      return { ...prev, [name]: eff };
    });
  }, [device, applyEffectToHardware, pianoId, logger]);

  // Re-assert the current voice + effects onto the hardware. Used by the
  // central connection repair after it reacquires MIDI.
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
          applyEffectToHardware(name, eff, fx);
        }
      });
    }
    logger.info('piano.sound.resync', { pianoId, deviceVoice: deviceVoice?.no ?? null });
  }, [device, deviceVoice, effects, sendLocalControl, sendVoice, applyEffectToHardware, pianoId, logger]);

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
    activeName, resync, device, deviceVoice, selectVoice, effects, setEffect,
  }), [activeName, resync, device, deviceVoice, selectVoice, effects, setEffect]);

  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>;
}

export default PianoSoundProvider;
