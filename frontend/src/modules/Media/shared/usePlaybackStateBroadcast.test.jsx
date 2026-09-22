import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePlaybackStateBroadcast } from './usePlaybackStateBroadcast.js';

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
});
