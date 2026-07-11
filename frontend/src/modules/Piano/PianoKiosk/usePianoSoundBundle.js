import { useMemo, useCallback } from 'react';
import { planBundleOps } from './applyBundle.js';
import { usePianoSound } from './PianoSoundContext.jsx';
import { usePianoMix } from './PianoMixContext.jsx';

// Resolves a bare {pc,bank} into the full catalog entry (with name/no) so
// selectVoice always stores a complete voice object — otherwise deviceVoice.name
// is lost and the chrome chip label falls back to the generic "Keyboard".
function resolveVoice(device, pc, bank) {
  const groups = device?.voiceGroups || [];
  for (const g of groups) {
    for (const v of (g.voices || [])) {
      if (v.pc === pc && (v.bank || 0) === (bank || 0)) return v;
    }
  }
  return { pc, bank };
}

// Binds the pure planner (planBundleOps) to the live MIDI senders that
// already exist on PianoSoundContext / PianoMixContext, so any consumer that
// wants to re-assert a full sound Bundle (voice + reverb + chorus + volume)
// has exactly one call site to do it through.
export function usePianoSoundBundle() {
  const { selectVoice, setEffect, deviceVoice, effects, device } = usePianoSound();
  const { setPianoLevel, pianoLevel } = usePianoMix();

  const currentBundle = useMemo(() => ({
    voice: deviceVoice,
    reverb: effects?.reverb ?? null,
    chorus: effects?.chorus ?? null,
    volume: pianoLevel,
  }), [deviceVoice, effects, pianoLevel]);

  const applyBundle = useCallback((bundle) => {
    const ops = planBundleOps(bundle);
    ops.forEach((op) => {
      switch (op.kind) {
        case 'voice':
          selectVoice(resolveVoice(device, op.pc, op.bank));
          break;
        case 'reverb':
          setEffect('reverb', { type: op.type, level: op.level, on: op.on });
          break;
        case 'chorus':
          setEffect('chorus', { type: op.type, level: op.level, on: op.on });
          break;
        case 'volume':
          setPianoLevel(op.value);
          break;
        default:
          break;
      }
    });
  }, [selectVoice, setEffect, setPianoLevel, device]);

  return { currentBundle, applyBundle };
}

export default usePianoSoundBundle;
