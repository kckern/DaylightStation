import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const selectVoice = vi.fn(), setEffect = vi.fn();
vi.mock('./usePianoSound.js', () => ({
  usePianoSound: () => ({
    selectVoice, setEffect,
    deviceVoice: { pc: 4, bank: 0, name: 'EP' },
    effects: { reverb: { type: 2, level: 40, on: true }, chorus: { type: 1, level: 10, on: true } },
    device: {
      voiceGroups: [
        { group: 'Piano', voices: [{ no: 17, name: 'Upright', pc: 16, bank: 0 }] },
      ],
    },
  }),
}));
import { usePianoSoundBundle } from './usePianoSoundBundle.js';

describe('usePianoSoundBundle', () => {
  it('applyBundle dispatches voice, reverb and chorus while ignoring legacy volume', () => {
    const { result } = renderHook(() => usePianoSoundBundle());
    result.current.applyBundle({
      voice: { pc: 16, bank: 0 }, reverb: { type: 3, level: 72, on: true },
      chorus: { type: 0, level: 0, on: false }, volume: 100,
    });
    expect(selectVoice).toHaveBeenCalledWith({ no: 17, name: 'Upright', pc: 16, bank: 0 });
    expect(setEffect).toHaveBeenNthCalledWith(1, 'reverb', { type: 3, level: 72, on: true });
    expect(setEffect).toHaveBeenNthCalledWith(2, 'chorus', { type: 0, level: 0, on: false });
  });
  it('currentBundle reflects only the live SoundPreset', () => {
    const { result } = renderHook(() => usePianoSoundBundle());
    expect(result.current.currentBundle).toEqual({
      voice: { pc: 4, bank: 0, name: 'EP' },
      reverb: { type: 2, level: 40, on: true },
      chorus: { type: 1, level: 10, on: true },
    });
  });
});
