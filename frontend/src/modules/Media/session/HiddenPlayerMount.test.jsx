import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { LocalSessionContext } from './LocalSessionContext.js';

// Stub Player to capture props
const playerPropsLog = [];
vi.mock('../../Player/Player.jsx', () => ({
  default: (props) => {
    playerPropsLog.push(props);
    return <div data-testid="player-stub">Player: {props.play?.contentId ?? 'none'}</div>;
  },
}));

import { HiddenPlayerMount } from './HiddenPlayerMount.jsx';

function mockAdapter(snapshot) {
  const subs = new Set();
  return {
    onPlayerEnded: vi.fn(),
    onPlayerError: vi.fn(),
    onPlayerStateChange: vi.fn(),
    onPlayerProgress: vi.fn(),
    getSnapshot: () => snapshot,
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
  };
}

describe('HiddenPlayerMount', () => {
  it('renders <Player> with play={currentItem} when snapshot has one', () => {
    playerPropsLog.length = 0;
    const adapter = mockAdapter({
      currentItem: { contentId: 'plex:1', format: 'video', title: 'T' },
      state: 'loading',
    });
    const { getByTestId } = render(
      <LocalSessionContext.Provider value={{ adapter }}>
        <HiddenPlayerMount />
      </LocalSessionContext.Provider>
    );
    expect(getByTestId('player-stub').textContent).toContain('plex:1');
    expect(playerPropsLog[0].play.contentId).toBe('plex:1');
  });

  it('does not render Player when currentItem is null', () => {
    const adapter = mockAdapter({ currentItem: null, state: 'idle' });
    const { queryByTestId } = render(
      <LocalSessionContext.Provider value={{ adapter }}>
        <HiddenPlayerMount />
      </LocalSessionContext.Provider>
    );
    expect(queryByTestId('player-stub')).toBeNull();
  });

  it('wires Player.clear to adapter.onPlayerEnded', () => {
    playerPropsLog.length = 0;
    const adapter = mockAdapter({
      currentItem: { contentId: 'plex:1', format: 'video' },
      state: 'playing',
    });
    render(
      <LocalSessionContext.Provider value={{ adapter }}>
        <HiddenPlayerMount />
      </LocalSessionContext.Provider>
    );
    playerPropsLog[0].clear();
    expect(adapter.onPlayerEnded).toHaveBeenCalled();
  });

  it('wires Player.onProgress: first non-paused tick transitions to playing, position throttled to >=5s', () => {
    playerPropsLog.length = 0;
    const adapter = mockAdapter({
      currentItem: { contentId: 'plex:1', format: 'video' },
      state: 'loading',
    });
    render(
      <LocalSessionContext.Provider value={{ adapter }}>
        <HiddenPlayerMount />
      </LocalSessionContext.Provider>
    );
    const onProgress = playerPropsLog[0].onProgress;
    expect(typeof onProgress).toBe('function');

    // Player emits a payload object — first non-paused tick triggers playing
    onProgress({ currentTime: 0.5, paused: false });
    expect(adapter.onPlayerStateChange).toHaveBeenCalledWith('playing');
    expect(adapter.onPlayerProgress).not.toHaveBeenCalled(); // 0.5 < 5s threshold

    // Subsequent tick <5s delta → no position update
    onProgress({ currentTime: 3.0, paused: false });
    expect(adapter.onPlayerProgress).not.toHaveBeenCalled();

    // Tick at ≥5s delta from 0 → persists
    onProgress({ currentTime: 6.0, paused: false });
    expect(adapter.onPlayerProgress).toHaveBeenCalledWith(6.0);

    // Ticks within 5s of last persisted value → no new persist
    onProgress({ currentTime: 8.0, paused: false });
    expect(adapter.onPlayerProgress).toHaveBeenCalledTimes(1);

    // ≥5s from last persisted (6.0) → persists again
    onProgress({ currentTime: 11.5, paused: false });
    expect(adapter.onPlayerProgress).toHaveBeenCalledTimes(2);
    expect(adapter.onPlayerProgress).toHaveBeenLastCalledWith(11.5);

    // Non-finite / missing values are ignored
    onProgress({ currentTime: NaN, paused: false });
    onProgress({});
    onProgress(undefined);
    expect(adapter.onPlayerProgress).toHaveBeenCalledTimes(2);

    // Accepts bare-number payloads too (backward compatible)
    onProgress(20);
    expect(adapter.onPlayerProgress).toHaveBeenCalledTimes(3);
    expect(adapter.onPlayerProgress).toHaveBeenLastCalledWith(20);
  });

  it('does not transition to playing if the first tick is paused', () => {
    playerPropsLog.length = 0;
    const adapter = mockAdapter({
      currentItem: { contentId: 'plex:1', format: 'video' },
      state: 'loading',
    });
    render(
      <LocalSessionContext.Provider value={{ adapter }}>
        <HiddenPlayerMount />
      </LocalSessionContext.Provider>
    );
    const onProgress = playerPropsLog[0].onProgress;
    onProgress({ currentTime: 0.2, paused: true });
    expect(adapter.onPlayerStateChange).not.toHaveBeenCalled();
    onProgress({ currentTime: 0.4, paused: false });
    expect(adapter.onPlayerStateChange).toHaveBeenCalledWith('playing');
  });
});

describe('HiddenPlayerMount — stall detection', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('calls adapter.onPlayerStalled after STALL_THRESHOLD_MS of continuous stalled=true', () => {
    playerPropsLog.length = 0;
    const adapter = mockAdapter({
      currentItem: { contentId: 'plex:1', format: 'video' },
      state: 'playing',
    });
    adapter.onPlayerStalled = vi.fn();
    render(
      <LocalSessionContext.Provider value={{ adapter }}>
        <HiddenPlayerMount />
      </LocalSessionContext.Provider>
    );
    const onProgress = playerPropsLog[0].onProgress;

    act(() => { onProgress({ currentTime: 10, paused: false, stalled: true }); });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(adapter.onPlayerStalled).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(5500); }); // cumulative 10.5s
    expect(adapter.onPlayerStalled).toHaveBeenCalledTimes(1);
    expect(adapter.onPlayerStalled.mock.calls[0][0]).toMatchObject({ stalledMs: expect.any(Number) });
  });

  it('clears the pending stall timer when stalled becomes false', () => {
    playerPropsLog.length = 0;
    const adapter = mockAdapter({
      currentItem: { contentId: 'plex:1', format: 'video' },
      state: 'playing',
    });
    adapter.onPlayerStalled = vi.fn();
    render(
      <LocalSessionContext.Provider value={{ adapter }}>
        <HiddenPlayerMount />
      </LocalSessionContext.Provider>
    );
    const onProgress = playerPropsLog[0].onProgress;

    act(() => { onProgress({ currentTime: 10, paused: false, stalled: true }); });
    act(() => { vi.advanceTimersByTime(5000); });
    act(() => { onProgress({ currentTime: 12, paused: false, stalled: false }); });
    act(() => { vi.advanceTimersByTime(10000); });

    expect(adapter.onPlayerStalled).not.toHaveBeenCalled();
  });

  it('cancels the pending stall timer on unmount', () => {
    playerPropsLog.length = 0;
    const adapter = mockAdapter({
      currentItem: { contentId: 'plex:1', format: 'video' },
      state: 'playing',
    });
    adapter.onPlayerStalled = vi.fn();
    const { unmount } = render(
      <LocalSessionContext.Provider value={{ adapter }}>
        <HiddenPlayerMount />
      </LocalSessionContext.Provider>
    );
    const onProgress = playerPropsLog[0].onProgress;

    act(() => { onProgress({ currentTime: 10, paused: false, stalled: true }); });
    act(() => { vi.advanceTimersByTime(5000); });
    unmount();
    act(() => { vi.advanceTimersByTime(10000); });

    expect(adapter.onPlayerStalled).not.toHaveBeenCalled();
  });

  it('cancels the pending stall timer when the current item changes', () => {
    playerPropsLog.length = 0;
    const subs = new Set();
    let currentSnapshot = {
      currentItem: { contentId: 'plex:1', format: 'video' },
      state: 'playing',
    };
    const adapter = {
      onPlayerEnded: vi.fn(),
      onPlayerError: vi.fn(),
      onPlayerStateChange: vi.fn(),
      onPlayerProgress: vi.fn(),
      onPlayerStalled: vi.fn(),
      getSnapshot: () => currentSnapshot,
      subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    };
    render(
      <LocalSessionContext.Provider value={{ adapter }}>
        <HiddenPlayerMount />
      </LocalSessionContext.Provider>
    );
    const onProgress = playerPropsLog[0].onProgress;

    act(() => { onProgress({ currentTime: 10, paused: false, stalled: true }); });
    act(() => { vi.advanceTimersByTime(5000); });

    // Simulate item change — update snapshot + notify subscribers
    act(() => {
      currentSnapshot = {
        currentItem: { contentId: 'plex:2', format: 'video' },
        state: 'loading',
      };
      for (const sub of subs) sub(currentSnapshot);
    });

    act(() => { vi.advanceTimersByTime(10000); });

    expect(adapter.onPlayerStalled).not.toHaveBeenCalled();
  });
});

import { PlayerHostContext } from './LocalSessionProvider.jsx';

describe('HiddenPlayerMount — portal host', () => {
  it('renders into the provided host element when context supplies one', () => {
    playerPropsLog.length = 0;
    const adapter = mockAdapter({
      currentItem: { contentId: 'plex:1', format: 'video' },
      state: 'loading',
    });
    const host = document.createElement('div');
    host.setAttribute('data-testid', 'custom-host');
    document.body.appendChild(host);

    render(
      <LocalSessionContext.Provider value={{ adapter }}>
        <PlayerHostContext.Provider value={host}>
          <HiddenPlayerMount />
        </PlayerHostContext.Provider>
      </LocalSessionContext.Provider>
    );
    expect(host.querySelector('[data-testid="player-stub"]')).not.toBeNull();
    document.body.removeChild(host);
  });

  it('renders inline when host is null', () => {
    playerPropsLog.length = 0;
    const adapter = mockAdapter({
      currentItem: { contentId: 'plex:1', format: 'video' },
      state: 'loading',
    });
    const { container } = render(
      <LocalSessionContext.Provider value={{ adapter }}>
        <PlayerHostContext.Provider value={null}>
          <HiddenPlayerMount />
        </PlayerHostContext.Provider>
      </LocalSessionContext.Provider>
    );
    expect(container.querySelector('[data-testid="player-stub"]')).not.toBeNull();
  });
});
