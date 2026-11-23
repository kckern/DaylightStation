import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SoundContext } from '../../PianoSoundContext.jsx';
import { useRhythmVoice } from './useRhythmVoice.js';

vi.mock('../../../../../../../frontend/src/lib/logging/Logger.js', () => { const log = { info: vi.fn(), warn: vi.fn(), child: () => log }; return { default: () => log }; });

const sound = (over = {}) => ({ auditionAddress: vi.fn(() => true), resync: vi.fn(), voicePatches: {},
  device: { voiceGroups: [{ voices: [{ no: 1, name: 'Piano', pc: 0 }, { no: 116, name: 'Woodblock', pc: 115 }] }] }, ...over });
const wrap = (value) => ({ children }) => <SoundContext.Provider value={value}>{children}</SoundContext.Provider>;

describe('useRhythmVoice', () => {
  it('auditions the percussive voice while active and restores the real voice on leaving', () => {
    const value = sound();
    const { unmount } = renderHook(() => useRhythmVoice(true), { wrapper: wrap(value) });
    expect(value.auditionAddress).toHaveBeenCalledWith(expect.objectContaining({ pc: 115 }));
    expect(value.resync).not.toHaveBeenCalled();
    unmount();
    expect(value.resync).toHaveBeenCalledTimes(1);
  });
  it('restores when the rung ends without unmounting', () => {
    const value = sound();
    const { rerender } = renderHook(({ on }) => useRhythmVoice(on), { wrapper: wrap(value), initialProps: { on: true } });
    rerender({ on: false });
    expect(value.resync).toHaveBeenCalledTimes(1);
  });
  it('does nothing when inactive, with no such voice, or with no sound provider', () => {
    const idle = sound();
    renderHook(() => useRhythmVoice(false), { wrapper: wrap(idle) });
    expect(idle.auditionAddress).not.toHaveBeenCalled();
    const none = sound({ device: { voiceGroups: [{ voices: [{ no: 1, name: 'Piano', pc: 0 }] }] } });
    const { unmount } = renderHook(() => useRhythmVoice(true), { wrapper: wrap(none) });
    unmount();
    expect(none.auditionAddress).not.toHaveBeenCalled();
    expect(none.resync).not.toHaveBeenCalled();
    expect(() => renderHook(() => useRhythmVoice(true))).not.toThrow();
  });
});
