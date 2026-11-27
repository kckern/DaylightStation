// RELY.5a — a local skip reaches the one outcome system exactly once.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
vi.mock("../logging/mediaLog.js", () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});
import { LocalSessionContext } from "../session/LocalSessionContext.js";
import { DispatchContext } from "../cast/DispatchProvider.jsx";
import { createLocalSessionController } from "../session/LocalSessionController.js";
import { LocalPlaybackOutcomes } from "./LocalPlaybackOutcomes.jsx";

const entry = (id, title) => ({ queueItemId: `q-${id}`, contentId: `plex:${id}`, format: 'audio', title, duration: 600, priority: 'queue', addedAt: '' });

describe('LocalPlaybackOutcomes', () => {
  it('records a skipped item with what plays instead', () => {
    const controller = createLocalSessionController({ clientId: 'c1', persistedSnapshot: {
      sessionId: 's', state: 'paused', currentItem: { contentId: 'plex:1', format: 'audio', title: 'Arrival', duration: 600 }, position: 0,
      queue: { items: [entry(1, 'Arrival'), entry(2, 'Nova')], currentIndex: 0, upNextCount: 0 },
      config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
      meta: { ownerId: 'c1', updatedAt: '2026-10-01T00:00:00.000Z' },
    } });
    controller.setPlayerHandle({ play: vi.fn(), pause: vi.fn(), seek: vi.fn() });
    const recordLocal = vi.fn();
    render(
      <LocalSessionContext.Provider value={{ controller }}>
        <DispatchContext.Provider value={{ recordLocal }}><LocalPlaybackOutcomes /></DispatchContext.Provider>
      </LocalSessionContext.Provider>,
    );
    act(() => { controller.transport.play(); controller.onPlayerStalled({ stalledMs: 10000 }); });
    expect(recordLocal).toHaveBeenCalledTimes(1);
    expect(recordLocal).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'playback', phase: 'skipped', reason: 'stalled',
      item: expect.objectContaining({ title: 'Arrival' }), replacement: expect.objectContaining({ title: 'Nova' }),
    }));
  });

  it('RELY.5a: a waiting notice is withdrawn when the file comes back', () => {
    vi.useFakeTimers();
    const controller = createLocalSessionController({ clientId: 'c1', persistedSnapshot: {
      sessionId: 's', state: 'paused', currentItem: { contentId: 'plex:1', format: 'audio', title: 'Arrival', duration: 600 }, position: 0,
      queue: { items: [entry(1, 'Arrival'), entry(2, 'Nova')], currentIndex: 0, upNextCount: 0 },
      config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
      meta: { ownerId: 'c1', updatedAt: '2026-10-01T00:00:00.000Z' },
    } });
    controller.setPlayerHandle({ play: vi.fn(), pause: vi.fn(), seek: vi.fn() });
    const recordLocal = vi.fn(() => 'wait-row');
    const removeDispatch = vi.fn();
    render(
      <LocalSessionContext.Provider value={{ controller }}>
        <DispatchContext.Provider value={{ recordLocal, removeDispatch }}><LocalPlaybackOutcomes /></DispatchContext.Provider>
      </LocalSessionContext.Provider>,
    );
    act(() => { controller.transport.play(); controller.onPlayerSourceWait({ waiting: true, contentId: 'plex:1' }); vi.advanceTimersByTime(3_100); });
    expect(recordLocal).toHaveBeenCalledWith(expect.objectContaining({ phase: 'waiting', item: expect.objectContaining({ title: 'Arrival' }) }));
    act(() => { controller.onPlayerSourceWait({ waiting: false, decision: 'resume', contentId: 'plex:1' }); });
    expect(removeDispatch).toHaveBeenCalledWith('wait-row');
    vi.useRealTimers();
  });

  it('one notice per failure, naming what is actually playing now (owner report 2026-11-27)', () => {
    // A failed book skipped to its own retry, which failed and skipped to Sonic:
    // the first notice ("Now playing Is God a Mathematician?") is no longer true.
    let listener = null;
    let current = null;
    const controller = { problems: { get: () => current, subscribe: (fn) => { listener = fn; return () => {}; } } };
    let n = 0;
    const recordLocal = vi.fn(() => `row-${++n}`);
    const removeDispatch = vi.fn();
    render(
      <LocalSessionContext.Provider value={{ controller }}>
        <DispatchContext.Provider value={{ recordLocal, removeDispatch }}><LocalPlaybackOutcomes /></DispatchContext.Provider>
      </LocalSessionContext.Provider>,
    );
    const book = { contentId: 'plex:505134', title: 'Is God a Mathematician?' };
    const sonic = { contentId: 'plex:775444', title: 'Sonic the Hedgehog' };
    act(() => { current = { kind: 'skipped', reason: 'error', item: book, replacement: book }; listener(current); });
    act(() => { current = { kind: 'skipped', reason: 'error', item: book, replacement: sonic }; listener(current); });
    expect(removeDispatch).toHaveBeenCalledWith('row-1');
    expect(recordLocal).toHaveBeenLastCalledWith(expect.objectContaining({ replacement: sonic }));
    // A different item failing later keeps its own notice and leaves this one.
    removeDispatch.mockClear();
    act(() => { current = { kind: 'skipped', reason: 'error', item: { contentId: 'plex:9', title: 'Other' }, replacement: null }; listener(current); });
    expect(removeDispatch).not.toHaveBeenCalledWith('row-2');
  });

  it('a notice whose replacement then fails is withdrawn: it no longer names what is playing', () => {
    let listener = null;
    const controller = { problems: { get: () => null, subscribe: (fn) => { listener = fn; return () => {}; } } };
    let n = 0;
    const recordLocal = vi.fn(() => `row-${++n}`);
    const removeDispatch = vi.fn();
    render(
      <LocalSessionContext.Provider value={{ controller }}>
        <DispatchContext.Provider value={{ recordLocal, removeDispatch }}><LocalPlaybackOutcomes /></DispatchContext.Provider>
      </LocalSessionContext.Provider>,
    );
    act(() => { listener({ kind: 'skipped', reason: 'error', item: { contentId: 'plex:1', title: 'A' }, replacement: { contentId: 'plex:2', title: 'B' } }); });
    act(() => { listener({ kind: 'skipped', reason: 'error', item: { contentId: 'plex:2', title: 'B' }, replacement: { contentId: 'plex:3', title: 'C' } }); });
    expect(removeDispatch).toHaveBeenCalledWith('row-1');
  });
});
