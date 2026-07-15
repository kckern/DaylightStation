import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Mocks: the hook routes across nav view + two dispatch surfaces ──
let navState = { view: 'home', params: {} };
vi.mock('../shell/NavProvider.jsx', () => ({
  useNav: () => navState,
}));

const dispatchToTarget = vi.fn();
vi.mock('../cast/DispatchProvider.jsx', () => ({
  useDispatch: () => ({ dispatchToTarget }),
}));

const playNow = vi.fn();
// queue is a stable reference in production (controller.queue), so the mock
// returns the SAME object every render — otherwise useCallback would rebuild.
const stableQueue = { playNow };
vi.mock('../controller/useSessionController.js', () => ({
  useSessionController: () => ({ queue: stableQueue }),
}));

import { useContentDispatch } from './useContentDispatch.js';

beforeEach(() => {
  dispatchToTarget.mockClear();
  playNow.mockClear();
  navState = { view: 'home', params: {} };
});

describe('useContentDispatch', () => {
  it('returns a stable dispatch function across renders', () => {
    const { result, rerender } = renderHook(() => useContentDispatch());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('non-peek view routes to local queue.playNow with clearRest', () => {
    navState = { view: 'home', params: {} };
    const { result } = renderHook(() => useContentDispatch());
    act(() => {
      result.current('plex:42', { title: 'Bluey', thumbnail: 'thumb.jpg' });
    });
    expect(playNow).toHaveBeenCalledWith(
      { contentId: 'plex:42', title: 'Bluey', thumbnail: 'thumb.jpg' },
      { clearRest: true }
    );
    expect(dispatchToTarget).not.toHaveBeenCalled();
  });

  it('peek view with a deviceId routes to dispatchToTarget in fork mode', () => {
    navState = { view: 'peek', params: { deviceId: 'shield-tv' } };
    const { result } = renderHook(() => useContentDispatch());
    act(() => {
      result.current('plex:99', { title: 'Lonesome Dove' });
    });
    expect(dispatchToTarget).toHaveBeenCalledWith({
      targetIds: ['shield-tv'],
      play: 'plex:99',
      mode: 'fork',
      title: 'Lonesome Dove',
    });
    expect(playNow).not.toHaveBeenCalled();
  });

  it('peek view WITHOUT a deviceId falls back to local playNow', () => {
    navState = { view: 'peek', params: {} };
    const { result } = renderHook(() => useContentDispatch());
    act(() => {
      result.current('plex:7', { title: 'X' });
    });
    expect(playNow).toHaveBeenCalledWith(
      { contentId: 'plex:7', title: 'X', thumbnail: null },
      { clearRest: true }
    );
    expect(dispatchToTarget).not.toHaveBeenCalled();
  });

  it('defaults missing title/thumbnail to null', () => {
    navState = { view: 'home', params: {} };
    const { result } = renderHook(() => useContentDispatch());
    act(() => {
      result.current('plex:1');
    });
    expect(playNow).toHaveBeenCalledWith(
      { contentId: 'plex:1', title: null, thumbnail: null },
      { clearRest: true }
    );
  });
});
