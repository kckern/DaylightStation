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

// Mutable holder — the factory closes over it but only reads at render time.
// Default is "no preferred target", which is what the pre-existing local-playback
// tests below assume.
let castTargetState = { targetIds: [], mode: 'transfer' };
vi.mock('../cast/useCastTarget.js', () => ({
  useCastTarget: () => castTargetState,
}));

import { useContentDispatch } from './useContentDispatch.js';

beforeEach(() => {
  dispatchToTarget.mockClear();
  playNow.mockClear();
  navState = { view: 'home', params: {} };
  castTargetState = { targetIds: [], mode: 'transfer' };
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

  it('a configured cast target routes a selection to that device', () => {
    castTargetState = { targetIds: ['livingroom-tv'], mode: 'transfer' };
    const { result } = renderHook(() => useContentDispatch());
    act(() => {
      result.current('plex:685088', { title: 'Episode 3' });
    });
    expect(dispatchToTarget).toHaveBeenCalledWith({
      targetIds: ['livingroom-tv'],
      play: 'plex:685088',
      mode: 'transfer',
      title: 'Episode 3',
    });
    expect(playNow).not.toHaveBeenCalled();
  });

  it('passes the chip mode through verbatim (fork)', () => {
    castTargetState = { targetIds: ['livingroom-tv'], mode: 'fork' };
    const { result } = renderHook(() => useContentDispatch());
    act(() => {
      result.current('plex:685088', { title: 'Episode 3' });
    });
    expect(dispatchToTarget).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'fork' })
    );
  });

  it('fans out to every configured target', () => {
    castTargetState = { targetIds: ['livingroom-tv', 'office-tv'], mode: 'transfer' };
    const { result } = renderHook(() => useContentDispatch());
    act(() => {
      result.current('plex:685088', { title: 'Episode 3' });
    });
    expect(dispatchToTarget).toHaveBeenCalledWith(
      expect.objectContaining({ targetIds: ['livingroom-tv', 'office-tv'] })
    );
  });

  it('peek view wins over a configured cast target', () => {
    navState = { view: 'peek', params: { deviceId: 'shield-tv' } };
    castTargetState = { targetIds: ['livingroom-tv'], mode: 'transfer' };
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
  });

  it('returns the branch it took', () => {
    const { result, rerender } = renderHook(() => useContentDispatch());
    let route;
    act(() => { route = result.current('plex:1', { title: 'A' }); });
    expect(route).toBe('local');

    castTargetState = { targetIds: ['livingroom-tv'], mode: 'transfer' };
    rerender();
    act(() => { route = result.current('plex:2', { title: 'B' }); });
    expect(route).toBe('cast');

    navState = { view: 'peek', params: { deviceId: 'shield-tv' } };
    rerender();
    act(() => { route = result.current('plex:3', { title: 'C' }); });
    expect(route).toBe('peek');
  });

  it('stays stable across renders when the cast target is unchanged', () => {
    castTargetState = { targetIds: ['livingroom-tv'], mode: 'transfer' };
    const { result, rerender } = renderHook(() => useContentDispatch());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
