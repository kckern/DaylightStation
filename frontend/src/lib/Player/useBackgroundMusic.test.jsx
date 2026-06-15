import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { DaylightAPI } from '../api.mjs';
import { useBackgroundMusic } from './useBackgroundMusic.js';

vi.mock('../api.mjs', () => ({ DaylightAPI: vi.fn() }));

// Minimal fake <audio>: records src/volume, captures listeners, fire() dispatches.
function makeFakeEl() {
  const handlers = {};
  return {
    volume: 1,
    src: '',
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    addEventListener: (ev, fn) => { (handlers[ev] ||= []).push(fn); },
    removeEventListener: (ev, fn) => { handlers[ev] = (handlers[ev] || []).filter((h) => h !== fn); },
    removeAttribute: vi.fn(),
    fire: (ev) => (handlers[ev] || []).slice().forEach((h) => h()),
  };
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
