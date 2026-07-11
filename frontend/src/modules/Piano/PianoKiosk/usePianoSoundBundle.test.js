import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const selectVoice = vi.fn(), setEffect = vi.fn(), setPianoLevel = vi.fn();
vi.mock('./PianoSoundContext.jsx', () => ({
  usePianoSound: () => ({
    selectVoice, setEffect,
    deviceVoice: { pc: 4, bank: 0, name: 'EP' },
    effects: { reverb: { type: 2, level: 40, on: true }, chorus: { type: 1, level: 10, on: true } },
  }),
}));
// Real export is `pianoLevel`, not `level` (see PianoMixContext.jsx).
vi.mock('./PianoMixContext.jsx', () => ({
  usePianoMix: () => ({ setPianoLevel, pianoLevel: 88 }),
}));
import { usePianoSoundBundle } from './usePianoSoundBundle.js';

describe('usePianoSoundBundle', () => {
  it('applyBundle dispatches voice, reverb, chorus, volume to the live senders in order', () => {
    const { result } = renderHook(() => usePianoSoundBundle());
    result.current.applyBundle({
      voice: { pc: 16, bank: 0 }, reverb: { type: 3, level: 72, on: true },
      chorus: { type: 0, level: 0, on: false }, volume: 100,
    });
    expect(selectVoice).toHaveBeenCalledWith({ pc: 16, bank: 0 });
    expect(setEffect).toHaveBeenNthCalledWith(1, 'reverb', { type: 3, level: 72, on: true });
    expect(setEffect).toHaveBeenNthCalledWith(2, 'chorus', { type: 0, level: 0, on: false });
    expect(setPianoLevel).toHaveBeenCalledWith(100);
  });
  it('currentBundle reflects the live device voice + effects + mix level', () => {
    const { result } = renderHook(() => usePianoSoundBundle());
    expect(result.current.currentBundle).toEqual({
      voice: { pc: 4, bank: 0, name: 'EP' },
      reverb: { type: 2, level: 40, on: true },
      chorus: { type: 1, level: 10, on: true },
      volume: 88,
    });
  });
});
