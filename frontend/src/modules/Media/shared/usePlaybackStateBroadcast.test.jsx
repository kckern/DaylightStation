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
});
