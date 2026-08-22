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

// Helper: render the hook and return bound dispatch/playContainerAsQueue
// functions (call-through, so `act` around the caller's own call still works).
function setup() {
  const { result, rerender } = renderHook(() => useContentDispatch());
  return {
    rerender,
    dispatch: (...args) => result.current.dispatch(...args),
    playContainerAsQueue: (...args) => result.current.playContainerAsQueue(...args),
    getCurrent: () => result.current,
  };
}

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
  it('returns stable dispatch/playContainerAsQueue functions across renders', () => {
    const { result, rerender } = renderHook(() => useContentDispatch());
    const first = result.current;
    rerender();
    expect(result.current.dispatch).toBe(first.dispatch);
    expect(result.current.playContainerAsQueue).toBe(first.playContainerAsQueue);
  });

  it('non-peek view routes to local queue.playNow with clearRest', () => {
    navState = { view: 'home', params: {} };
    const { dispatch } = setup();
    act(() => {
      dispatch('plex:42', { title: 'Bluey', thumbnail: 'thumb.jpg' });
    });
    expect(playNow).toHaveBeenCalledWith(
      { contentId: 'plex:42', title: 'Bluey', thumbnail: 'thumb.jpg' },
      { clearRest: true }
    );
    expect(dispatchToTarget).not.toHaveBeenCalled();
  });

  it('peek view with a deviceId routes to dispatchToTarget in fork mode', () => {
    navState = { view: 'peek', params: { deviceId: 'shield-tv' } };
    const { dispatch } = setup();
    act(() => {
      dispatch('plex:99', { title: 'Lonesome Dove' });
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
    const { dispatch } = setup();
    act(() => {
      dispatch('plex:7', { title: 'X' });
    });
    expect(playNow).toHaveBeenCalledWith(
      { contentId: 'plex:7', title: 'X', thumbnail: null },
      { clearRest: true }
    );
    expect(dispatchToTarget).not.toHaveBeenCalled();
  });

  it('defaults missing title/thumbnail to null', () => {
    navState = { view: 'home', params: {} };
    const { dispatch } = setup();
    act(() => {
      dispatch('plex:1');
    });
    expect(playNow).toHaveBeenCalledWith(
      { contentId: 'plex:1', title: null, thumbnail: null },
      { clearRest: true }
    );
  });

  it('a configured cast target routes a selection to that device', () => {
    castTargetState = { targetIds: ['livingroom-tv'], mode: 'transfer' };
    const { dispatch } = setup();
    act(() => {
      dispatch('plex:685088', { title: 'Episode 3' });
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
    const { dispatch } = setup();
    act(() => {
      dispatch('plex:685088', { title: 'Episode 3' });
    });
    expect(dispatchToTarget).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'fork' })
    );
  });

  it('fans out to every configured target', () => {
    castTargetState = { targetIds: ['livingroom-tv', 'office-tv'], mode: 'transfer' };
    const { dispatch } = setup();
    act(() => {
      dispatch('plex:685088', { title: 'Episode 3' });
    });
    expect(dispatchToTarget).toHaveBeenCalledWith(
      expect.objectContaining({ targetIds: ['livingroom-tv', 'office-tv'] })
    );
  });

  it('peek view wins over a configured cast target (leaf)', () => {
    navState = { view: 'peek', params: { deviceId: 'shield-tv' } };
    castTargetState = { targetIds: ['livingroom-tv'], mode: 'transfer' };
    const { dispatch } = setup();
    act(() => {
      dispatch('plex:99', { title: 'Lonesome Dove' });
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
    act(() => { route = result.current.dispatch('plex:1', { title: 'A' }); });
    expect(route).toBe('local');

    castTargetState = { targetIds: ['livingroom-tv'], mode: 'transfer' };
    rerender();
    act(() => { route = result.current.dispatch('plex:2', { title: 'B' }); });
    expect(route).toBe('cast');

    navState = { view: 'peek', params: { deviceId: 'shield-tv' } };
    rerender();
    act(() => { route = result.current.dispatch('plex:3', { title: 'C' }); });
    expect(route).toBe('peek');
  });

  // ── Task 14 (spec D6): containers ALWAYS browse — tap never blows away a
  // queue or casts silently, regardless of what's aimed. ──
  describe('container selections — dispatch() always browses', () => {
    it('opens a show on the canvas instead of queueing all its episodes', () => {
      const { dispatch } = setup();
      let route;
      act(() => {
        route = dispatch('plex:663508', { title: 'Tuttle Twins', type: 'show' });
      });
      expect(push).toHaveBeenCalledWith('browse', { path: 'plex/663508', label: 'Tuttle Twins' });
      expect(route).toBe('browse');
      expect(playNow).not.toHaveBeenCalled();
      expect(dispatchToTarget).not.toHaveBeenCalled();
    });

    it('recognizes every container marker the combobox emits', () => {
      const { dispatch } = setup();
      for (const item of [
        { title: 'A', itemType: 'container' },
        { title: 'B', isContainer: true },
        { title: 'C', type: 'album' },
        { title: 'D', type: 'playlist' },
        { title: 'E', metadata: { type: 'artist' } },
      ]) {
        push.mockClear();
        act(() => { dispatch('plex:1', item); });
        expect(push).toHaveBeenCalledTimes(1);
      }
      expect(playNow).not.toHaveBeenCalled();
    });

    it('splits only the FIRST colon so pathy ids survive', () => {
      const { dispatch } = setup();
      act(() => {
        dispatch('files:clips/summer.mp4', { title: 'Clips', itemType: 'container' });
      });
      expect(push).toHaveBeenCalledWith('browse', expect.objectContaining({ path: 'files/clips/summer.mp4' }));
    });

    it('falls back to the id when a container has no title', () => {
      const { dispatch } = setup();
      act(() => { dispatch('plex:9', { itemType: 'container' }); });
      expect(push).toHaveBeenCalledWith('browse', { path: 'plex/9', label: 'plex:9' });
    });

    it('a leaf still plays locally', () => {
      const { dispatch } = setup();
      act(() => { dispatch('plex:665667', { title: 'Episode 8', type: 'episode' }); });
      expect(push).not.toHaveBeenCalled();
      expect(playNow).toHaveBeenCalled();
    });

    // Task 14 REVERSAL of prior behavior: an aimed cast target used to win
    // over a container tap ("cast the album" survived). It no longer does —
    // that silent whole-container cast on a mere tap is the exact
    // accidental-blowaway pattern the new grammar exists to prevent. Sending
    // a container anywhere is now the ▶ verb (playContainerAsQueue), never
    // implicit in the tap.
    it('an aimed cast target no longer wins — container tap still browses', () => {
      castTargetState = { targetIds: ['speaker-red'], mode: 'transfer' };
      const { dispatch } = setup();
      let route;
      act(() => {
        route = dispatch('plex:5150', { title: 'Van Halen', type: 'album' });
      });
      expect(route).toBe('browse');
      expect(push).toHaveBeenCalledWith('browse', expect.objectContaining({ path: 'plex/5150' }));
      expect(dispatchToTarget).not.toHaveBeenCalled();
    });

    // Task 14 REVERSAL: peek used to win over opening a container. It no
    // longer does — browsing is pure navigation and never touches the
    // peeked device's playback, so there's nothing to protect it from.
    it('peek no longer wins over a container tap — it still browses', () => {
      navState = { view: 'peek', params: { deviceId: 'shield-tv' } };
      const { dispatch } = setup();
      let route;
      act(() => {
        route = dispatch('plex:663508', { title: 'Tuttle Twins', type: 'show' });
      });
      expect(route).toBe('browse');
      expect(push).toHaveBeenCalledWith('browse', { path: 'plex/663508', label: 'Tuttle Twins' });
      expect(dispatchToTarget).not.toHaveBeenCalled();
    });

    it('a bare id with no item metadata plays locally, not browse', () => {
      const { dispatch } = setup();
      act(() => { dispatch('plex:1'); });
      expect(push).not.toHaveBeenCalled();
      expect(playNow).toHaveBeenCalled();
    });
  });

  // ── Task 14: the ▶ verb — explicit "send the whole container" action,
  // now the ONLY way a container reaches a cast target or the peeked
  // device. Same destination precedence as leaves, minus the browse branch. ──
  describe('playContainerAsQueue — the ▶ verb', () => {
    it('peek view sends it to the peeked device in fork mode (remote control never stops its own device)', () => {
      navState = { view: 'peek', params: { deviceId: 'shield-tv' } };
      const { playContainerAsQueue } = setup();
      let route;
      act(() => {
        route = playContainerAsQueue('plex:663508', { id: 'plex:663508', title: 'Tuttle Twins', type: 'show' });
      });
      expect(route).toBe('peek');
      expect(dispatchToTarget).toHaveBeenCalledWith({
        targetIds: ['shield-tv'],
        play: 'plex:663508',
        mode: 'fork',
        title: 'Tuttle Twins',
      });
      expect(playNow).not.toHaveBeenCalled();
    });

    it('an aimed cast target casts the whole container there', () => {
      castTargetState = { targetIds: ['speaker-red'], mode: 'transfer' };
      const { playContainerAsQueue } = setup();
      let route;
      act(() => {
        route = playContainerAsQueue('plex:5150', { id: 'plex:5150', title: 'Van Halen', type: 'album' });
      });
      expect(route).toBe('cast');
      expect(dispatchToTarget).toHaveBeenCalledWith(
        expect.objectContaining({ targetIds: ['speaker-red'], play: 'plex:5150', mode: 'transfer' })
      );
      expect(playNow).not.toHaveBeenCalled();
    });

    it('shows the same named casting confirmation toast as a leaf cast', () => {
      castTargetState = { targetIds: ['livingroom-tv'], mode: 'transfer' };
      dispatchToTarget.mockReturnValue(['d1']);
      const { playContainerAsQueue } = setup();
      act(() => { playContainerAsQueue('plex:5150', { id: 'plex:5150', title: 'Van Halen', type: 'album' }); });
      expect(notificationsShow).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Casting Van Halen', message: 'To Living Room TV' })
      );
    });

    it('otherwise plays it locally as a queue, replacing the current one, with container markers preserved for expansion', () => {
      const { playContainerAsQueue } = setup();
      let route;
      act(() => {
        route = playContainerAsQueue('plex:5150', { id: 'plex:5150', title: 'Van Halen', type: 'album', childCount: 12 });
      });
      expect(route).toBe('local');
      expect(playNow).toHaveBeenCalledWith(
        expect.objectContaining({ contentId: 'plex:5150', title: 'Van Halen', type: 'album', childCount: 12 }),
        { clearRest: true }
      );
      expect(dispatchToTarget).not.toHaveBeenCalled();
    });

    it('falls back to a bare content input when the item carries no usable id', () => {
      const { playContainerAsQueue } = setup();
      act(() => { playContainerAsQueue('plex:5150', null); });
      expect(playNow).toHaveBeenCalledWith(
        { contentId: 'plex:5150', title: null, thumbnail: null },
        { clearRest: true }
      );
    });
  });

  it('stays stable across renders when the cast target is unchanged', () => {
    castTargetState = { targetIds: ['livingroom-tv'], mode: 'transfer' };
    const { result, rerender } = renderHook(() => useContentDispatch());
    const first = result.current;
    rerender();
    expect(result.current.dispatch).toBe(first.dispatch);
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
      const { dispatch } = setup();
      act(() => { dispatch('plex:1', { title: 'Bluey' }); });
      expect(notificationsShow).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Casting Bluey', message: 'To Living Room TV' })
      );
    });

    it('joins multiple destination names in the confirmation toast', () => {
      castTargetState = { targetIds: ['livingroom-tv', 'office-tv'], mode: 'transfer' };
      dispatchToTarget.mockReturnValue(['d1', 'd2']);
      const { dispatch } = setup();
      act(() => { dispatch('plex:1', { title: 'Bluey' }); });
      expect(notificationsShow).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'To Living Room TV, Office TV' })
      );
    });

    it('does not toast on local playback — nothing hidden to confirm', () => {
      const { dispatch } = setup();
      act(() => { dispatch('plex:1', { title: 'Bluey' }); });
      expect(notificationsShow).not.toHaveBeenCalled();
    });

    it('does not toast on peek dispatch — the destination is already the screen you are driving', () => {
      navState = { view: 'peek', params: { deviceId: 'shield-tv' } };
      const { dispatch } = setup();
      act(() => { dispatch('plex:1', { title: 'Bluey' }); });
      expect(notificationsShow).not.toHaveBeenCalled();
    });

    it('shows a failure toast naming the device once the dispatch resolves to failed', async () => {
      castTargetState = { targetIds: ['livingroom-tv'], mode: 'transfer' };
      dispatchToTarget.mockReturnValue(['d1']);
      const { dispatch, rerender } = setup();
      act(() => { dispatch('plex:1', { title: 'Bluey' }); });
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
      const { dispatch, rerender } = setup();
      act(() => { dispatch('plex:1', { title: 'Bluey' }); });
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
      const { dispatch, rerender } = setup();
      act(() => { dispatch('plex:1', { title: 'Bluey' }); });
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
      const { dispatch, rerender } = setup();
      act(() => { dispatch('plex:1', { title: 'Bluey' }); });
      await flush();
      notificationsShow.mockClear();

      dispatchesState = new Map([['d1', { status: 'running' }]]);
      rerender();
      expect(notificationsShow).not.toHaveBeenCalled();
    });

    it('does not re-toast the same failed dispatchId on a later rerender', async () => {
      castTargetState = { targetIds: ['livingroom-tv'], mode: 'transfer' };
      dispatchToTarget.mockReturnValue(['d1']);
      const { dispatch, rerender } = setup();
      act(() => { dispatch('plex:1', { title: 'Bluey' }); });
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
