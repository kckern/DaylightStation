import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { DaylightAPI } from '../api.mjs';
import { ScreenVolumeContext } from '../volume/ScreenVolumeContext.js';
import { useBackgroundMusic } from './useBackgroundMusic.js';

vi.mock('../api.mjs', () => ({ DaylightAPI: vi.fn() }));

// Minimal fake <audio>: records src/volume, tracks paused/currentTime/duration,
// captures listeners, fire() dispatches.
function makeFakeEl() {
  const handlers = {};
  const el = {
    volume: 1,
    src: '',
    paused: true,
    currentTime: 0,
    duration: 100,
    addEventListener: (ev, fn) => { (handlers[ev] ||= []).push(fn); },
    removeEventListener: (ev, fn) => { handlers[ev] = (handlers[ev] || []).filter((h) => h !== fn); },
    removeAttribute: vi.fn(),
    fire: (ev) => (handlers[ev] || []).slice().forEach((h) => h()),
  };
  el.play = vi.fn(() => { el.paused = false; return Promise.resolve(); });
  el.pause = vi.fn(() => { el.paused = true; });
  return el;
}

describe('useBackgroundMusic', () => {
  beforeEach(() => { DaylightAPI.mockReset(); });

  it('loads the queue, sets volume, and exposes the first track', async () => {
    DaylightAPI.mockResolvedValue({ items: [
      { mediaUrl: 'a.mp3', title: 'A', artist: 'X' },
      { mediaUrl: 'b.mp3', title: 'B', grandparentTitle: 'Y' },
    ] });
    const el = makeFakeEl();
    const ref = { current: el };
    const { result } = renderHook(() => useBackgroundMusic(ref, { queue: 'q', volume: 0.3 }));
    await waitFor(() => expect(result.current.track?.title).toBe('A'));
    expect(el.volume).toBe(0.3);
    expect(el.src).toBe('a.mp3');
    expect(el.play).toHaveBeenCalled();
  });

  it('scales the preset volume by the screen master, live', async () => {
    DaylightAPI.mockResolvedValue({ items: [{ mediaUrl: 'a.mp3', title: 'A', artist: 'X' }] });
    const el = makeFakeEl();
    const ref = { current: el };
    let master = 0.5;   // wrapper reads this on every (re)render
    const wrapper = ({ children }) => (
      React.createElement(ScreenVolumeContext.Provider, { value: { effectiveMaster: master } }, children)
    );
    const { rerender } = renderHook(
      () => useBackgroundMusic(ref, { queue: 'q', volume: 0.3 }),
      { wrapper },
    );
    await waitFor(() => expect(el.src).toBe('a.mp3'));
    expect(el.volume).toBeCloseTo(0.15, 5);   // 0.3 preset × 0.5 master
    // turning the master down adjusts volume live without reloading the queue.
    master = 0.2;
    act(() => rerender());
    expect(el.volume).toBeCloseTo(0.06, 5);   // 0.3 × 0.2
    expect(DaylightAPI).toHaveBeenCalledTimes(1);
  });

  it('toggle pauses a playing track and resumes a paused one', async () => {
    DaylightAPI.mockResolvedValue({ items: [{ mediaUrl: 'a.mp3', title: 'A', artist: 'X' }] });
    const el = makeFakeEl();
    const { result } = renderHook(() => useBackgroundMusic({ current: el }, { queue: 'q' }));
    await waitFor(() => expect(el.paused).toBe(false));   // autoplayed
    el.play.mockClear();
    act(() => result.current.toggle());
    expect(el.pause).toHaveBeenCalledTimes(1);
    expect(el.paused).toBe(true);
    act(() => result.current.toggle());
    expect(el.play).toHaveBeenCalledTimes(1);
    expect(el.paused).toBe(false);
  });

  it('seek scrubs within the current track and clamps to its bounds', async () => {
    DaylightAPI.mockResolvedValue({ items: [{ mediaUrl: 'a.mp3', title: 'A', artist: 'X' }] });
    const el = makeFakeEl();
    el.duration = 100;
    const { result } = renderHook(() => useBackgroundMusic({ current: el }, { queue: 'q' }));
    await waitFor(() => expect(el.src).toBe('a.mp3'));
    el.currentTime = 10;
    act(() => result.current.seek(15));
    expect(el.currentTime).toBe(25);
    act(() => result.current.seek(-1000));   // clamp at 0
    expect(el.currentTime).toBe(0);
    act(() => result.current.seek(1000));    // clamp at duration
    expect(el.currentTime).toBe(100);
  });

  it('advances on ended and wraps to the start', async () => {
    DaylightAPI.mockResolvedValue({ items: [
      { mediaUrl: 'a.mp3', title: 'A', artist: 'X' },
      { mediaUrl: 'b.mp3', title: 'B', artist: 'Y' },
    ] });
    const el = makeFakeEl();
    const { result } = renderHook(() => useBackgroundMusic({ current: el }, { queue: 'q' }));
    await waitFor(() => expect(result.current.track?.title).toBe('A'));
    act(() => el.fire('ended'));
    expect(result.current.track?.title).toBe('B');
    act(() => el.fire('ended'));
    expect(result.current.track?.title).toBe('A');   // wrapped
  });

  it('skips to the next track on an error event', async () => {
    DaylightAPI.mockResolvedValue({ items: [
      { mediaUrl: 'a.mp3', title: 'A', artist: 'X' },
      { mediaUrl: 'b.mp3', title: 'B', artist: 'Y' },
    ] });
    const el = makeFakeEl();
    const { result } = renderHook(() => useBackgroundMusic({ current: el }, { queue: 'q' }));
    await waitFor(() => expect(result.current.track?.title).toBe('A'));
    act(() => el.fire('error'));
    expect(result.current.track?.title).toBe('B');
  });

  it('track is null when the queue is empty', async () => {
    DaylightAPI.mockResolvedValue({ items: [] });
    const el = makeFakeEl();
    const { result } = renderHook(() => useBackgroundMusic({ current: el }, { queue: 'q' }));
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalled());
    expect(result.current.track).toBeNull();
  });

  it('track is null and nothing fetched when music config is absent', async () => {
    const el = makeFakeEl();
    const { result } = renderHook(() => useBackgroundMusic({ current: el }, null));
    expect(result.current.track).toBeNull();
    expect(DaylightAPI).not.toHaveBeenCalled();
  });

  it('track is null when the queue fetch rejects', async () => {
    DaylightAPI.mockRejectedValue(new Error('boom'));
    const el = makeFakeEl();
    const { result } = renderHook(() => useBackgroundMusic({ current: el }, { queue: 'q' }));
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalled());
    expect(result.current.track).toBeNull();
  });
});
