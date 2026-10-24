import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, renderHook } from '@testing-library/react';
import { useSkylineWeapons } from "./useSkylineWeapons.js";

describe('useSkylineWeapons', () => {
  it('queues a key press once, ignores auto-repeat, and drains', () => {
    const { result } = renderHook(() => useSkylineWeapons({ enabled: true, getGamepads: () => [] }));
    fireEvent.keyDown(window, { key: 'b' });
    fireEvent.keyDown(window, { key: 'b', repeat: true });
    fireEvent.keyDown(window, { key: ' ' });
    expect(result.current()).toEqual(['bomb', 'laser']);
    expect(result.current()).toEqual([]);
  });

  it('ignores a pad button held when polling starts, then fires on each new press', () => {
    vi.useFakeTimers();
    const onGamepad = vi.fn();
    const pad = { index: 0, id: 'pad', mapping: 'standard', buttons: [{ pressed: true }] };
    const { result } = renderHook(() => useSkylineWeapons({ enabled: true, getGamepads: () => [pad], onGamepad }));
    act(() => vi.advanceTimersByTime(50));
    expect(result.current()).toEqual([]);
    expect(onGamepad).toHaveBeenCalledOnce();
    pad.buttons = [{ pressed: false }];
    act(() => vi.advanceTimersByTime(50));
    pad.buttons = [{ pressed: false }, { pressed: true }];
    act(() => vi.advanceTimersByTime(50));
    expect(result.current()).toEqual(['bomb']);
    vi.useRealTimers();
  });

  it('does nothing while disabled', () => {
    const { result } = renderHook(() => useSkylineWeapons({ enabled: false, getGamepads: () => [] }));
    fireEvent.keyDown(window, { key: 'f' });
    expect(result.current()).toEqual([]);
  });
});
