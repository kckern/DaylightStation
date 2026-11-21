import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  claimRemote, createRemoteButtonRuntime, holdRemoteButtons, resetRemoteButtonHolds, savedActionId,
} from './remoteButtonRuntime.js';
import { createRemoteInputSource } from './remoteInputSource.js';
import { performRemoteAction } from './RemoteButtonsHost.jsx';

// Made-up fixtures: two handlebar remotes of one model.
const RIGHT = 'AA:BB:CC:00:00:01';
const LEFT = 'AA:BB:CC:00:00:02';

function setup(remotes = { [RIGHT]: { buttons: { MediaPlayPause: 'up', MediaTrackNext: 'none', AudioVolumeUp: 'volume-up' } } }, controllers = {}) {
  let t = 0;
  const timers = [];
  const performed = [];
  const replayed = [];
  const listeners = new Set();
  const source = createRemoteInputSource({
    subscribeRemoteKeys: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    getController: (a) => controllers[a] || null,
  });
  const rt = createRemoteButtonRuntime({
    getRemotes: () => remotes,
    controlOf: source.controlOf,
    perform: (a, ctx) => performed.push([a.id, ctx.address, ctx.repeat]),
    replay: (p) => replayed.push(p.key),
    now: () => t,
    setTimer: (fn, ms) => { const h = { fn, at: t + ms }; timers.push(h); return h; },
    clearTimer: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
  });
  const advance = (ms) => { t += ms; for (const h of [...timers]) if (h.at <= t) { timers.splice(timers.indexOf(h), 1); h.fn(); } };
  source.subscribe((ev) => rt.input(ev));
  // A `bt.remote.key` message on the bus, through the source.
  const feed = (msg) => listeners.forEach((fn) => fn(msg));
  return { rt, feed, performed, replayed, advance };
}

afterEach(() => resetRemoteButtonHolds());

describe('remoteButtonRuntime', () => {
  it('a press from the remote with a saved action performs it; another remote of the same model does not', () => {
    const { rt, feed, performed } = setup();
    feed({ address: LEFT, key: 'MediaPlayPause', state: 'down' });
    feed({ address: RIGHT.toLowerCase(), key: 'MediaPlayPause', state: 'down' });
    feed({ address: RIGHT, key: 'MediaPlayPause', state: 'up' });
    expect(performed).toEqual([['up', RIGHT, false]]);
  });

  it('"Nothing" swallows the press and does nothing; a repeat acts only for volume', () => {
    const { rt, feed, performed } = setup();
    feed({ address: RIGHT, key: 'MediaTrackNext', state: 'down' });
    feed({ address: RIGHT, key: 'MediaPlayPause', state: 'repeat' });
    feed({ address: RIGHT, key: 'AudioVolumeUp', state: 'repeat' });
    expect(performed).toEqual([['volume-up', RIGHT, true]]);
  });

  it('claimed (its Bluetooth page is open) or held (an Invaders round): nothing acts, and its browser keys pass', () => {
    const { rt, feed, performed } = setup();
    const release = claimRemote(RIGHT);
    feed({ address: RIGHT, key: 'MediaPlayPause', state: 'down' });
    expect(rt.browserKeydown({ key: 'MediaPlayPause' })).toBe('pass');
    release();
    const unhold = holdRemoteButtons('skyline-invaders');
    feed({ address: RIGHT, key: 'MediaPlayPause', state: 'down' });
    unhold();
    expect(performed).toEqual([]);
    feed({ address: RIGHT, key: 'MediaPlayPause', state: 'down' });
    expect(performed).toEqual([['up', RIGHT, false]]);
  });

  it("browser copy after the tagged press: dropped when the acting remote set that key, passed for another remote's", () => {
    const { rt, feed } = setup();
    feed({ address: RIGHT, key: 'MediaPlayPause', state: 'down' });
    expect(rt.browserKeydown({ key: 'MediaPlayPause' })).toBe('swallow');
    expect(rt.browserKeyup({ key: 'MediaPlayPause' })).toBe('swallow');
    feed({ address: LEFT, key: 'MediaPlayPause', state: 'down' });
    expect(rt.browserKeydown({ key: 'MediaPlayPause' })).toBe('pass');
  });

  it('browser copy first: held back; its twin from the acting remote drops it, from another remote replays it, none replays after the window', () => {
    const { rt, feed, replayed, advance } = setup();
    expect(rt.browserKeydown({ key: 'MediaPlayPause' })).toBe('swallow');
    feed({ address: RIGHT, key: 'MediaPlayPause', state: 'down' });
    expect(replayed).toEqual([]);
    expect(rt.browserKeydown({ key: 'MediaPlayPause' })).toBe('swallow');
    feed({ address: LEFT, key: 'MediaPlayPause', state: 'down' });
    expect(replayed).toEqual(['MediaPlayPause']);
    expect(rt.browserKeydown({ key: 'MediaPlayPause' })).toBe('swallow');
    advance(450);
    expect(replayed).toEqual(['MediaPlayPause', 'MediaPlayPause']);
  });

  it('keys no acting remote has set pass at once', () => {
    const { rt, feed } = setup();
    expect(rt.browserKeydown({ key: 'ArrowDown' })).toBe('pass');
    expect(rt.browserKeydown({ key: 'MediaTrackPrevious' })).toBe('pass');
  });
});

describe('useRemoteButtonsHold', () => {
  it('holds the runtime while active and releases on change or unmount', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { useRemoteButtonsHold } = await import('./remoteButtonsContext.js');
    const { remoteButtonHolds } = await import('./remoteButtonRuntime.js');
    const { rerender, unmount } = renderHook(({ on }) => useRemoteButtonsHold(on, 'a-game'), { initialProps: { on: true } });
    expect(remoteButtonHolds()).toEqual(['a-game']);
    rerender({ on: false });
    expect(remoteButtonHolds()).toEqual([]);
    rerender({ on: true });
    unmount();
    expect(remoteButtonHolds()).toEqual([]);
  });
});

describe('by position', () => {
  // Fixtures: the same model mounted two ways; the rider's Up is a different key on each.
  const BUTTONS = { call: 'MediaPlayPause', forward: 'MediaTrackNext', reverse: 'MediaTrackPrevious', plus: 'AudioVolumeUp', minus: 'AudioVolumeDown' };
  const controllers = {
    [RIGHT]: { address: RIGHT, buttons: BUTTONS, positions: { up: 'reverse', down: 'forward', left: 'plus', right: 'minus', center: 'call' } },
    [LEFT]: { address: LEFT, buttons: BUTTONS, positions: { up: 'forward', down: 'reverse', left: 'minus', right: 'plus', center: 'call' } },
  };
  it('(address, key) → button → position → action: both remotes map the rider\'s Up alike', () => {
    const same = { positions: { up: 'volume-up', down: 'volume-down' } };
    const { rt, feed, performed } = setup({ [RIGHT]: same, [LEFT]: same }, controllers);
    feed({ address: RIGHT, key: 'MediaTrackPrevious', state: 'down' });
    feed({ address: LEFT, key: 'MediaTrackNext', state: 'down' });
    feed({ address: LEFT, key: 'MediaTrackPrevious', state: 'down' });
    expect(performed).toEqual([['volume-up', RIGHT, false], ['volume-up', LEFT, false], ['volume-down', LEFT, false]]);
  });
  it('the source emits abstract input; without positions: the key itself is the control', () => {
    const source = createRemoteInputSource({ subscribeRemoteKeys: () => () => {}, getController: (a) => controllers[a] || null });
    expect(source.controlOf(RIGHT, 'MediaTrackNext')).toEqual({ kind: 'position', control: 'down' });
    expect(source.controlOf('AA:BB:CC:00:00:09', 'ButtonA')).toEqual({ kind: 'key', control: 'ButtonA' });
    expect(savedActionId({ buttons: { ButtonA: 'select' } }, { kind: 'key', control: 'ButtonA' })).toBe('select');
    expect(savedActionId({ buttons: { MediaTrackNext: 'next' } }, { kind: 'position', control: 'down' })).toBeNull();
    expect(savedActionId(null, { kind: 'key', control: 'x' })).toBeNull();
  });
});

describe('performRemoteAction', () => {
  it('navigate goes to a modal that captured it on the ActionBus, else as its key', () => {
    const bus = { hasCapture: (a) => a === 'navigate', emit: vi.fn(() => true) };
    expect(performRemoteAction({ id: 'up' }, { bus })).toBe('action-bus');
    expect(bus.emit).toHaveBeenCalledWith('navigate', { direction: 'up' });
    const keys = [];
    const on = (e) => keys.push([e.type, e.key]);
    window.addEventListener('keydown', on);
    window.addEventListener('keyup', on);
    try {
      expect(performRemoteAction({ id: 'back' }, { bus: { hasCapture: () => false } })).toBe('key');
      expect(keys).toEqual([['keydown', 'Escape'], ['keyup', 'Escape']]);
    } finally { window.removeEventListener('keydown', on); window.removeEventListener('keyup', on); }
  });
  it('playback goes to the player; with no player open it does nothing', () => {
    const playback = { playPause: vi.fn(), volumeDown: vi.fn() };
    expect(performRemoteAction({ id: 'play-pause' }, { playback })).toBe('player');
    expect(performRemoteAction({ id: 'volume-down' }, { playback })).toBe('player');
    expect(playback.playPause).toHaveBeenCalledTimes(1);
    expect(performRemoteAction({ id: 'next' }, { playback: null })).toBe('no-player');
  });
});
