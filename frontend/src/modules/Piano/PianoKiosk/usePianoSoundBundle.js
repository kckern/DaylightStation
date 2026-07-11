import { useMemo, useCallback } from 'react';
import { planBundleOps } from './applyBundle.js';
import { usePianoSound } from './PianoSoundContext.jsx';
import { usePianoMix } from './PianoMixContext.jsx';

// Binds the pure planner (planBundleOps) to the live MIDI senders that
// already exist on PianoSoundContext / PianoMixContext, so any consumer that
// wants to re-assert a full sound Bundle (voice + reverb + chorus + volume)
// has exactly one call site to do it through.
export function usePianoSoundBundle() {
  const { selectVoice, setEffect, deviceVoice, effects } = usePianoSound();
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
          selectVoice({ pc: op.pc, bank: op.bank });
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
  }, [selectVoice, setEffect, setPianoLevel]);

  return { currentBundle, applyBundle };
}

export default usePianoSoundBundle;
