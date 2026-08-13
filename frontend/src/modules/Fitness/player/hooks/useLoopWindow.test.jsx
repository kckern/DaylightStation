import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useLoopWindow, { computeLoopWindow } from './useLoopWindow.js';

vi.mock('@/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) })
}));

describe('computeLoopWindow', () => {
  it('loops backward, ending at the pause point', () => {
    expect(computeLoopWindow('back', 10, 252, 1110)).toEqual({ start: 242, end: 252 });
  });

  it('loops forward, starting at the pause point', () => {
    expect(computeLoopWindow('forward', 30, 252, 1110)).toEqual({ start: 252, end: 282 });
  });

  it('clamps the backward start at 0', () => {
    expect(computeLoopWindow('back', 30, 10, 1110)).toEqual({ start: 0, end: 10 });
  });

  it('clamps the forward end at duration', () => {
    expect(computeLoopWindow('forward', 30, 1100, 1110)).toEqual({ start: 1100, end: 1110 });
  });

  it('returns null for a degenerate window', () => {
    expect(computeLoopWindow('back', 10, 0, 1110)).toBeNull();
    expect(computeLoopWindow('forward', 10, 1110, 1110)).toBeNull();
  });

  it('returns null for a nonsense duration', () => {
    expect(computeLoopWindow('back', 10, 252, null)).toBeNull();
  });
});

const makeEl = (t = 0) => ({
  currentTime: t,
  paused: false,
  _handlers: {},
  addEventListener(ev, fn) { this._handlers[ev] = fn; },
  removeEventListener(ev) { delete this._handlers[ev]; },
  fireTimeUpdate() { this._handlers.timeupdate?.(); },
});

describe('useLoopWindow', () => {
  it('seeks back to start when playback passes the loop end', () => {
    const el = makeEl(0);
    const onSeek = vi.fn();
    const { result } = renderHook(() =>
      useLoopWindow({ getMediaElement: () => el, onSeek }));

    act(() => { result.current.armLoop('forward', 10, 100, 1000); });
    el.currentTime = 111;
    act(() => { el.fireTimeUpdate(); });

    expect(onSeek).toHaveBeenCalledWith(100);
  });

  it('marks its own boundary seek so the loop does not self-release', () => {
    const el = makeEl(0);
    const { result } = renderHook(() =>
      useLoopWindow({ getMediaElement: () => el, onSeek: () => {} }));

    act(() => { result.current.armLoop('forward', 10, 100, 1000); });
    el.currentTime = 111;
    act(() => { el.fireTimeUpdate(); });

    expect(result.current.isBoundarySeek()).toBe(true);
    expect(result.current.loop).not.toBeNull();
  });

  it('releaseLoop clears the window', () => {
    const el = makeEl(0);
    const { result } = renderHook(() =>
      useLoopWindow({ getMediaElement: () => el, onSeek: () => {} }));
    act(() => { result.current.armLoop('back', 10, 100, 1000); });
    expect(result.current.loop).not.toBeNull();
    act(() => { result.current.releaseLoop(); });
    expect(result.current.loop).toBeNull();
  });
});
