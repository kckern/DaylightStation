import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLongPress } from './useLongPress.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function down(h, x = 0, y = 0) { h.onPointerDown({ clientX: x, clientY: y }); }

describe('useLongPress', () => {
  it('fires onLongPress after holdMs and suppresses the tap', () => {
    const onLong = vi.fn(); const onTap = vi.fn();
    const { result } = renderHook(() => useLongPress(onLong, { holdMs: 500, onTap }));
    down(result.current); vi.advanceTimersByTime(500);
    result.current.onPointerUp({});
    expect(onLong).toHaveBeenCalledTimes(1);
    expect(onTap).not.toHaveBeenCalled();
  });
  it('fires onTap on a quick release (before holdMs)', () => {
    const onLong = vi.fn(); const onTap = vi.fn();
    const { result } = renderHook(() => useLongPress(onLong, { holdMs: 500, onTap }));
    down(result.current); vi.advanceTimersByTime(200); result.current.onPointerUp({});
    expect(onLong).not.toHaveBeenCalled();
    expect(onTap).toHaveBeenCalledTimes(1);
  });
  it('cancels the long-press when the pointer drifts past moveCancelPx', () => {
    const onLong = vi.fn();
    const { result } = renderHook(() => useLongPress(onLong, { holdMs: 500, moveCancelPx: 8 }));
    down(result.current, 0, 0);
    result.current.onPointerMove({ clientX: 20, clientY: 0 });
    vi.advanceTimersByTime(500);
    expect(onLong).not.toHaveBeenCalled();
  });
  it('opens the tap action from a quick keyboard press', () => {
    const onLong = vi.fn(); const onTap = vi.fn();
    const { result } = renderHook(() => useLongPress(onLong, { holdMs: 500, onTap }));
    result.current.onKeyDown({ key: 'Enter', repeat: false, preventDefault: vi.fn() });
    vi.advanceTimersByTime(200);
    result.current.onKeyUp({ key: 'Enter', preventDefault: vi.fn() });
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onLong).not.toHaveBeenCalled();
  });
  it('opens maintenance from a held keyboard press and suppresses the later click', () => {
    const onLong = vi.fn(); const onTap = vi.fn();
    const { result } = renderHook(() => useLongPress(onLong, { holdMs: 500, onTap }));
    result.current.onKeyDown({ key: ' ', repeat: false, preventDefault: vi.fn() });
    vi.advanceTimersByTime(500);
    result.current.onKeyUp({ key: ' ', preventDefault: vi.fn() });
    result.current.onClick({ detail: 0, preventDefault: vi.fn() });
    expect(onLong).toHaveBeenCalledTimes(1);
    expect(onTap).not.toHaveBeenCalled();
  });
});
