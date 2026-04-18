import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
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
