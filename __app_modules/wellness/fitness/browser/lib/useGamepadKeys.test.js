import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
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
});

describe('padShape', () => {
  it('summarises id, mapping and sizes', () => {
    expect(padShape({ id: 'R1', mapping: '', buttons: [1, 2, 3], axes: [0, 0] }))
      .toEqual({ id: 'R1', mapping: '', buttons: 3, axes: 2 });
  });
});

describe('useGamepadKeys — activation', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('a button already held when the hook turns on fires only after a release and a new press', () => {
    let frames = [];
    vi.stubGlobal('requestAnimationFrame', (fn) => { frames.push(fn); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    let pads = [pad([1])]; // B held over the hand-off from another screen
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => pads });
    const tick = () => { const f = frames; frames = []; f.forEach((fn) => fn()); };
    const onKey = vi.fn();
    renderHook(() => useGamepadKeys(true, onKey));
    tick(); tick();
    expect(onKey).not.toHaveBeenCalled();
    pads = [pad([])]; tick();
    pads = [pad([1])]; tick();
    expect(onKey).toHaveBeenCalledWith('Escape');
    expect(onKey).toHaveBeenCalledTimes(1);
  });
});
