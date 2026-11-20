import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const logInfo = vi.fn();
vi.mock('@/lib/logging/Logger.js', () => ({
  __esModule: true,
  default: () => ({ child: () => ({ info: (...a) => logInfo(...a), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }),
}));
import { gamepadKeyEdges, padShape, useGamepadKeys } from './useGamepadKeys.js';

const pad = (pressed) => ({ buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i) })) });

describe('gamepadKeyEdges', () => {
  it('maps D-pad, A and B to menu keys on the press edge only', () => {
    let state = gamepadKeyEdges(new Set(), [pad([12])]);
    expect(state.edges).toEqual(['ArrowUp']);
    state = gamepadKeyEdges(state.pressed, [pad([12])]);
    expect(state.edges).toEqual([]); // held: no repeat
    state = gamepadKeyEdges(state.pressed, [pad([0, 1])]);
    expect(state.edges.sort()).toEqual(['Enter', 'Escape']);
  });
  it('ignores missing pads', () => {
    expect(gamepadKeyEdges(new Set(), [null, undefined]).edges).toEqual([]);
  });
});

const stick = (x, y, mapping = '') => ({ mapping, buttons: [], axes: [x, y] });

describe('gamepadKeyEdges — left stick', () => {
  it('turns stick deflection past half into arrows, once per push', () => {
    let s = gamepadKeyEdges(new Set(), [stick(-0.9, 0)]);
    expect(s.edges).toEqual(['ArrowLeft']);
    s = gamepadKeyEdges(s.pressed, [stick(-0.9, 0)]);
    expect(s.edges).toEqual([]);
    s = gamepadKeyEdges(s.pressed, [stick(0, 0)]);
    s = gamepadKeyEdges(s.pressed, [stick(0, 0.8)]);
    expect(s.edges).toEqual(['ArrowDown']);
  });
  it('ignores a resting or barely moved stick', () => {
    expect(gamepadKeyEdges(new Set(), [stick(0.3, -0.2)]).edges).toEqual([]);
  });
  it('a stick and the D-pad on one pad give one arrow, released only when both let go', () => {
    const both = (dpad, x) => ({ buttons: pad(dpad ? [14] : []).buttons, axes: [x, 0] });
    let s = gamepadKeyEdges(new Set(), [both(true, -0.9)]);
    expect(s.edges).toEqual(['ArrowLeft']);
    s = gamepadKeyEdges(s.pressed, [both(false, -0.9)]); // D-pad released, stick still over
    expect(s.edges).toEqual([]);
    expect(s.pressed.has('ArrowLeft')).toBe(true);
    s = gamepadKeyEdges(s.pressed, [both(true, 0)]); // stick back, D-pad pressed again: still held
    expect(s.edges).toEqual([]);
    s = gamepadKeyEdges(s.pressed, [both(false, 0)]);
    expect(s.pressed.size).toBe(0);
    expect(gamepadKeyEdges(s.pressed, [both(true, 0)]).edges).toEqual(['ArrowLeft']);
  });
});

describe('padShape', () => {
  it('summarises id, mapping, sizes, resting axes and held buttons', () => {
    const buttons = [{ pressed: false }, { pressed: true }, { pressed: false }];
    const axes = [0.004, -1, 0.123456, 0.5, 0.9];
    expect(padShape({ id: 'R1', mapping: '', buttons, axes }))
      .toEqual({ id: 'R1', mapping: '', buttons: 3, axes: 5, axisValues: [0, -1, 0.12, 0.5], pressedButtons: [1] });
  });
  it('copes with a pad missing buttons or axes', () => {
    expect(padShape({ id: 'X' })).toEqual({ id: 'X', mapping: '', buttons: 0, axes: 0, axisValues: [], pressedButtons: [] });
  });
});

describe('useGamepadKeys — activation', () => {
  let frames;
  let pads;
  const original = Object.getOwnPropertyDescriptor(navigator, 'getGamepads');
  const tick = () => { const f = frames; frames = []; f.forEach((fn) => fn()); };
  beforeEach(() => {
    frames = [];
    pads = [];
    logInfo.mockClear();
    vi.stubGlobal('requestAnimationFrame', (fn) => { frames.push(fn); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', () => {}); // leave queued frames: the loop must stop by itself
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => pads });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (original) Object.defineProperty(navigator, 'getGamepads', original);
    else delete navigator.getGamepads;
  });

  it('a button already held when the hook turns on fires only after a release and a new press', () => {
    pads = [pad([1])]; // B held over the hand-off from another screen
    const onKey = vi.fn();
    renderHook(() => useGamepadKeys(true, onKey));
    tick(); tick();
    expect(onKey).not.toHaveBeenCalled();
    pads = [pad([])]; tick();
    pads = [pad([1])]; tick();
    expect(onKey).toHaveBeenCalledWith('Escape');
    expect(onKey).toHaveBeenCalledTimes(1);
  });

  it('a pad that first appears after arming fires on its first press', () => {
    const onKey = vi.fn();
    renderHook(() => useGamepadKeys(true, onKey));
    tick();
    pads = [{ ...pad([0]), id: 'late-pad', index: 0 }]; tick();
    expect(onKey).toHaveBeenCalledWith('Enter');
  });

  it('stops polling after unmount even when a frame was already queued', () => {
    const onKey = vi.fn();
    const { unmount } = renderHook(() => useGamepadKeys(true, onKey));
    tick();
    unmount();
    pads = [pad([0])];
    tick();
    expect(frames).toHaveLength(0);
    expect(onKey).not.toHaveBeenCalled();
  });

  it('logs a pad shape once per page load, not once per activation', () => {
    pads = [{ ...pad([]), id: 'once-pad', index: 3, axes: [] }];
    const { rerender } = renderHook(({ on }) => useGamepadKeys(on, vi.fn()), { initialProps: { on: true } });
    tick();
    rerender({ on: false });
    rerender({ on: true });
    tick();
    const shapes = logInfo.mock.calls.filter(([event, data]) => event === 'gamepad-shape' && data.id === 'once-pad');
    expect(shapes).toHaveLength(1);
  });
});
