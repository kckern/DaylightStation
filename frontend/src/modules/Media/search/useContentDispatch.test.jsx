import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Mocks: the hook routes across nav view + two dispatch surfaces ──
const push = vi.fn();
let navState = { view: 'home', params: {} };
vi.mock('../shell/NavProvider.jsx', () => ({
  useNav: () => ({ ...navState, push }),
}));

const dispatchToTarget = vi.fn();
const retryLast = vi.fn();
// Mutable holder for the live per-dispatchId state DispatchProvider tracks —
// the toast-on-failure watcher polls this the same way DispatchProgressTray
// does. Empty Map by default (nothing pending).
let dispatchesState = new Map();
vi.mock('../cast/DispatchProvider.jsx', () => ({
  useDispatch: () => ({ dispatchToTarget, dispatches: dispatchesState, retryLast }),
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

let fleetDevices = [{ id: 'livingroom-tv', name: 'Living Room TV' }, { id: 'office-tv', name: 'Office TV' }];
vi.mock('../fleet/FleetProvider.jsx', () => ({
  useFleetContext: () => ({ devices: fleetDevices }),
}));

const notificationsShow = vi.fn();
vi.mock('@mantine/notifications', () => ({
  notifications: { show: (...a) => notificationsShow(...a) },
}));

import { useContentDispatch } from './useContentDispatch.js';

beforeEach(() => {
  dispatchToTarget.mockClear();
  retryLast.mockClear();
  playNow.mockClear();
  push.mockClear();
  notificationsShow.mockClear();
  navState = { view: 'home', params: {} };
  castTargetState = { targetIds: [], mode: 'transfer' };
  dispatchesState = new Map();
  fleetDevices = [{ id: 'livingroom-tv', name: 'Living Room TV' }, { id: 'office-tv', name: 'Office TV' }];
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

  // ── Containers open the full browse view (2026-08-12 session review) ──
  describe('container selections', () => {
    it('opens a show on the canvas instead of queueing all its episodes', () => {
      const { result } = renderHook(() => useContentDispatch());
      let route;
      act(() => {
        route = result.current('plex:663508', { title: 'Tuttle Twins', type: 'show' });
      });
      expect(push).toHaveBeenCalledWith('browse', { path: 'plex/663508', label: 'Tuttle Twins' });
      expect(route).toBe('browse');
      expect(playNow).not.toHaveBeenCalled();
      expect(dispatchToTarget).not.toHaveBeenCalled();
    });

    it('recognizes every container marker the combobox emits', () => {
      const { result } = renderHook(() => useContentDispatch());
      for (const item of [
        { title: 'A', itemType: 'container' },
        { title: 'B', isContainer: true },
        { title: 'C', type: 'album' },
        { title: 'D', type: 'playlist' },
        { title: 'E', metadata: { type: 'artist' } },
      ]) {
        push.mockClear();
        act(() => { result.current('plex:1', item); });
        expect(push).toHaveBeenCalledTimes(1);
      }
      expect(playNow).not.toHaveBeenCalled();
    });

    it('splits only the FIRST colon so pathy ids survive', () => {
      const { result } = renderHook(() => useContentDispatch());
      act(() => {
        result.current('files:clips/summer.mp4', { title: 'Clips', itemType: 'container' });
      });
      expect(push).toHaveBeenCalledWith('browse', expect.objectContaining({ path: 'files/clips/summer.mp4' }));
    });

    it('falls back to the id when a container has no title', () => {
      const { result } = renderHook(() => useContentDispatch());
      act(() => { result.current('plex:9', { itemType: 'container' }); });
      expect(push).toHaveBeenCalledWith('browse', { path: 'plex/9', label: 'plex:9' });
    });

    it('a leaf still plays locally', () => {
      const { result } = renderHook(() => useContentDispatch());
      act(() => { result.current('plex:665667', { title: 'Episode 8', type: 'episode' }); });
      expect(push).not.toHaveBeenCalled();
      expect(playNow).toHaveBeenCalled();
    });

    it('an aimed cast target still wins — "cast the album" survives', () => {
      castTargetState = { targetIds: ['speaker-red'], mode: 'transfer' };
      const { result } = renderHook(() => useContentDispatch());
      let route;
      act(() => {
        route = result.current('plex:5150', { title: 'Van Halen', type: 'album' });
      });
      expect(route).toBe('cast');
      expect(dispatchToTarget).toHaveBeenCalledWith(
        expect.objectContaining({ targetIds: ['speaker-red'], play: 'plex:5150' })
      );
      expect(push).not.toHaveBeenCalled();
    });

    it('peek still wins over opening a container', () => {
      navState = { view: 'peek', params: { deviceId: 'shield-tv' } };
      const { result } = renderHook(() => useContentDispatch());
      let route;
      act(() => {
        route = result.current('plex:663508', { title: 'Tuttle Twins', type: 'show' });
      });
      expect(route).toBe('peek');
      expect(push).not.toHaveBeenCalled();
    });

    it('a bare id with no item metadata plays locally, not browse', () => {
      const { result } = renderHook(() => useContentDispatch());
      act(() => { result.current('plex:1'); });
      expect(push).not.toHaveBeenCalled();
      expect(playNow).toHaveBeenCalled();
    });
  });

  it('stays stable across renders when the cast target is unchanged', () => {
    castTargetState = { targetIds: ['livingroom-tv'], mode: 'transfer' };
    const { result, rerender } = renderHook(() => useContentDispatch());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  // ── Named toasts (spec D4) — the incident this closes: a tap on a search
  // result went to hidden dock-chip state with no acknowledgement, success
  // or failure. ──
  describe('cast toasts', () => {
    // dispatchToTarget is fire-and-forget; give its .then() microtask a
    // couple of ticks to run before asserting on pendingRef-driven state.
    const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

    it('shows a confirmation toast naming title + destination the instant a cast routes', () => {
      castTargetState = { targetIds: ['livingroom-tv'], mode: 'transfer' };
      dispatchToTarget.mockReturnValue(['d1']);
      const { result } = renderHook(() => useContentDispatch());
      act(() => { result.current('plex:1', { title: 'Bluey' }); });
      expect(notificationsShow).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Casting Bluey', message: 'To Living Room TV' })
      );
    });

    it('joins multiple destination names in the confirmation toast', () => {
      castTargetState = { targetIds: ['livingroom-tv', 'office-tv'], mode: 'transfer' };
      dispatchToTarget.mockReturnValue(['d1', 'd2']);
      const { result } = renderHook(() => useContentDispatch());
      act(() => { result.current('plex:1', { title: 'Bluey' }); });
      expect(notificationsShow).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'To Living Room TV, Office TV' })
      );
    });

    it('does not toast on local playback — nothing hidden to confirm', () => {
      const { result } = renderHook(() => useContentDispatch());
      act(() => { result.current('plex:1', { title: 'Bluey' }); });
      expect(notificationsShow).not.toHaveBeenCalled();
    });

    it('does not toast on peek dispatch — the destination is already the screen you are driving', () => {
      navState = { view: 'peek', params: { deviceId: 'shield-tv' } };
      const { result } = renderHook(() => useContentDispatch());
      act(() => { result.current('plex:1', { title: 'Bluey' }); });
      expect(notificationsShow).not.toHaveBeenCalled();
    });

    it('shows a failure toast naming the device once the dispatch resolves to failed', async () => {
      castTargetState = { targetIds: ['livingroom-tv'], mode: 'transfer' };
      dispatchToTarget.mockReturnValue(['d1']);
      const { result, rerender } = renderHook(() => useContentDispatch());
      act(() => { result.current('plex:1', { title: 'Bluey' }); });
      await flush();

      notificationsShow.mockClear();
      dispatchesState = new Map([['d1', { status: 'failed', error: 'FKB rejected credentials: Please login' }]]);
      rerender();

      expect(notificationsShow).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Couldn't cast to Living Room TV" })
      );
    });

    it('passes the backend error through verbatim, never a generic substitute', async () => {
      castTargetState = { targetIds: ['livingroom-tv'], mode: 'transfer' };
      dispatchToTarget.mockReturnValue(['d1']);
      const { result, rerender } = renderHook(() => useContentDispatch());
      act(() => { result.current('plex:1', { title: 'Bluey' }); });
      await flush();

      dispatchesState = new Map([['d1', { status: 'failed', error: 'FKB rejected credentials: Please login' }]]);
      rerender();

      const call = notificationsShow.mock.calls.find((c) => c[0].title === "Couldn't cast to Living Room TV");
      expect(call).toBeTruthy();
      const [textEl] = call[0].message.props.children;
      expect(textEl.props.children).toBe('FKB rejected credentials: Please login');
    });

    it('Retry on the failure toast re-invokes the exact same dispatch via retryLast', async () => {
      castTargetState = { targetIds: ['livingroom-tv'], mode: 'transfer' };
      dispatchToTarget.mockReturnValue(['d1']);
      const { result, rerender } = renderHook(() => useContentDispatch());
      act(() => { result.current('plex:1', { title: 'Bluey' }); });
      await flush();

      dispatchesState = new Map([['d1', { status: 'failed', error: 'boom' }]]);
      rerender();

      const call = notificationsShow.mock.calls.find((c) => c[0].title === "Couldn't cast to Living Room TV");
      const [, retryButtonEl] = call[0].message.props.children;
      retryButtonEl.props.onClick();
      expect(retryLast).toHaveBeenCalledTimes(1);
    });

    it('does not toast while the dispatch is still running', async () => {
      castTargetState = { targetIds: ['livingroom-tv'], mode: 'transfer' };
      dispatchToTarget.mockReturnValue(['d1']);
      const { result, rerender } = renderHook(() => useContentDispatch());
      act(() => { result.current('plex:1', { title: 'Bluey' }); });
      await flush();
      notificationsShow.mockClear();

      dispatchesState = new Map([['d1', { status: 'running' }]]);
      rerender();
      expect(notificationsShow).not.toHaveBeenCalled();
    });

    it('does not re-toast the same failed dispatchId on a later rerender', async () => {
      castTargetState = { targetIds: ['livingroom-tv'], mode: 'transfer' };
      dispatchToTarget.mockReturnValue(['d1']);
      const { result, rerender } = renderHook(() => useContentDispatch());
      act(() => { result.current('plex:1', { title: 'Bluey' }); });
      await flush();

      dispatchesState = new Map([['d1', { status: 'failed', error: 'boom' }]]);
      rerender();
      expect(notificationsShow).toHaveBeenCalledTimes(2); // confirmation + failure

      notificationsShow.mockClear();
      dispatchesState = new Map([['d1', { status: 'failed', error: 'boom' }]]); // fresh Map, same content
      rerender();
      expect(notificationsShow).not.toHaveBeenCalled();
    });
  });
});
