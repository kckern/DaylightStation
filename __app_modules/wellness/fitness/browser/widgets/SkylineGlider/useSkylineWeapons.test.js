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

  it('leaves browser shortcuts and typing alone', () => {
    const { result } = renderHook(() => useSkylineWeapons({ enabled: true, getGamepads: () => [] }));
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    fireEvent.keyDown(window, { key: 'b', altKey: true });
    const input = document.createElement('input');
    const area = document.createElement('textarea');
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    document.body.append(input, area, editable);
    fireEvent.keyDown(input, { key: 'f' });
    fireEvent.keyDown(area, { key: ' ' });
    fireEvent.keyDown(editable, { key: 'b' });
    expect(result.current()).toEqual([]);
    input.remove(); area.remove(); editable.remove();
  });

  it('fires Space on a focused button without letting it press the button', () => {
    const { result } = renderHook(() => useSkylineWeapons({ enabled: true, getGamepads: () => [] }));
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    expect(document.activeElement).toBe(button);
    const down = fireEvent.keyDown(button, { key: ' ' });
    expect(down).toBe(false);
    expect(document.activeElement).not.toBe(button);
    expect(fireEvent.keyUp(button, { key: ' ' })).toBe(false);
    expect(result.current()).toEqual(['laser']);
    button.remove();
  });
});
