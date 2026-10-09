// usePianoSound.js — the hook half of PianoSoundContext.jsx, split out so
// Fast Refresh can hot-reload the provider component on its own.
import { useContext } from 'react';
import { SoundContext } from './PianoSoundContext.jsx';

export function usePianoSound() {
  const value = useContext(SoundContext);
  if (!value) throw new Error('usePianoSound must be used within PianoSoundProvider');
  return value;
}
