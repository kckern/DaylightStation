import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePlaybackStateBroadcast } from './usePlaybackStateBroadcast.js';
import { TIMING } from '../constants.js';
import { validatePlaybackStateBroadcast } from '@shared-contracts/media/envelopes.mjs';

describe('usePlaybackStateBroadcast', () => {
  let send;
  beforeEach(() => { vi.useFakeTimers(); send = vi.fn(); });
  afterEach(() => { vi.useRealTimers(); });

  it('emits a playback_state message on mount reflecting current state', () => {
    renderHook(() => usePlaybackStateBroadcast({
      send,
      clientId: 'c1',
      displayName: 'D',
      snapshot: {
        sessionId: 's1', state: 'playing',
        currentItem: { contentId: 'p:1', format: 'video', title: 'T', duration: 60 },
        position: 2,
        config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
      },
    }));
    expect(send).toHaveBeenCalled();
    const msg = send.mock.calls[0][0];
    expect(msg.topic).toBe('playback_state');
    expect(msg.clientId).toBe('c1');
    expect(msg.sessionId).toBe('s1');
    expect(msg.state).toBe('playing');
    expect(msg.currentItem.contentId).toBe('p:1');
  });

  it('re-emits when snapshot.state changes', () => {
    const { rerender } = renderHook(({ snap }) => usePlaybackStateBroadcast({
      send, clientId: 'c1', displayName: 'D', snapshot: snap,
    }), { initialProps: { snap: { sessionId: 's1', state: 'loading', currentItem: null, position: 0, config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 } } } });
    send.mockClear();
    rerender({ snap: { sessionId: 's1', state: 'playing', currentItem: null, position: 0, config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 } } });
    expect(send).toHaveBeenCalled();
    expect(send.mock.calls[0][0].state).toBe('playing');
  });

  it('heartbeats every 5s while playing', () => {
    renderHook(() => usePlaybackStateBroadcast({
      send, clientId: 'c1', displayName: 'D',
      snapshot: { sessionId: 's1', state: 'playing', currentItem: null, position: 0, config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 } },
    }));
    send.mockClear();
    act(() => { vi.advanceTimersByTime(5100); });
    expect(send).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(5100); });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('emits terminal stopped on unmount', () => {
    const { unmount } = renderHook(() => usePlaybackStateBroadcast({
      send, clientId: 'c1', displayName: 'D',
      snapshot: { sessionId: 's1', state: 'playing', currentItem: null, position: 0, config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 } },
    }));
    send.mockClear();
    unmount();
    expect(send).toHaveBeenCalled();
    expect(send.mock.calls[send.mock.calls.length - 1][0].state).toBe('stopped');
  });

  it('publishes the persisted browser identity and one canonical state projection', () => {
    renderHook(() => usePlaybackStateBroadcast({
      send,
      identity: {
        clientId: 'c1', deviceId: 'browser:c1', name: 'Kitchen tablet', room: 'Kitchen',
        connectedAt: '2026-09-22T12:00:00.000Z',
      },
      snapshot: {
        sessionId: 's1', state: 'playing',
        currentItem: { contentId: 'p:1', format: 'video', title: 'T', duration: 60 },
        position: 2,
        queue: { items: [], currentIndex: -1, upNextCount: 0 },
        config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
        meta: { ownerId: 'c1', updatedAt: '2026-09-22T12:00:01.000Z', revision: 7, origin: { kind: 'routine', name: 'Morning' } },
      },
    }));

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'playback_state',
      identity: expect.objectContaining({ deviceId: 'browser:c1', name: 'Kitchen tablet', room: 'Kitchen' }),
      deviceId: 'browser:c1', ownerId: 'c1', revision: 7,
      origin: { kind: 'routine', name: 'Morning' },
      queue: { items: [], currentIndex: -1, upNextCount: 0 },
      connected: true,
      lastHeardAt: expect.any(String),
    }));
  });

  it('heartbeats while idle so an open browser is not mistaken for off', () => {
    renderHook(() => usePlaybackStateBroadcast({
      send, clientId: 'c1', displayName: 'D',
      snapshot: { sessionId: 's1', state: 'idle', currentItem: null, position: 0, queue: { items: [], currentIndex: -1, upNextCount: 0 }, config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 }, meta: { ownerId: 'c1', updatedAt: 'x' } },
    }));
    send.mockClear();
    act(() => { vi.advanceTimersByTime(30_001); });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ state: 'idle', reason: 'heartbeat' }));
  });

  const idleSnap = { sessionId: 's1', state: 'idle', currentItem: null, position: 0, queue: { items: [], currentIndex: -1, upNextCount: 0 }, config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 }, meta: { ownerId: 'c1', updatedAt: 'x' } };

  it('heartbeats an idle browser at the 30s browser cadence, not the 5s playing cadence', () => {
    renderHook(() => usePlaybackStateBroadcast({ send, clientId: 'c1', displayName: 'D', snapshot: idleSnap }));
    send.mockClear();
    act(() => { vi.advanceTimersByTime(29_999); });
    expect(send).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(2); });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ state: 'idle', reason: 'heartbeat' }));
    // Several idle heartbeats land inside the two-minute uncertainty window.
    expect(TIMING.BROWSER_HEARTBEAT_MS * 3).toBeLessThan(TIMING.BROWSER_UNCERTAIN_AFTER_MS);
  });

  it('publishes nothing until the control registration is ready, then publishes once it is', () => {
    // The relay drops (and WARNs about) a frame whose identity is not yet
    // registered on this connection — so the first frame waits for identify.
    const { rerender } = renderHook(({ ready }) => usePlaybackStateBroadcast({
      send, clientId: 'c1', displayName: 'D', snapshot: idleSnap, ready,
    }), { initialProps: { ready: false } });
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(send).not.toHaveBeenCalled();
    rerender({ ready: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ reason: 'initial', state: 'idle' }));
  });

  it('puts only the identity contract fields on the wire, not the whole identity context', () => {
    renderHook(() => usePlaybackStateBroadcast({
      send,
      identity: {
        clientId: 'c1', deviceId: 'browser:c1', name: 'Kitchen tablet', room: 'Kitchen',
        connectedAt: '2026-09-22T12:00:00.000Z',
        displayName: 'Kitchen tablet', controlClientId: 'c1', controlReady: true, rename: () => {},
      },
      snapshot: idleSnap,
    }));
    expect(send.mock.calls[0][0].identity).toEqual({
      clientId: 'c1', deviceId: 'browser:c1', name: 'Kitchen tablet', room: 'Kitchen',
      connectedAt: '2026-09-22T12:00:00.000Z',
    });
    expect(validatePlaybackStateBroadcast(send.mock.calls[0][0]).valid).toBe(true);
  });
});
