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
});
