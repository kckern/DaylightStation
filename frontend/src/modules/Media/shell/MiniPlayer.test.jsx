import React from 'react';
import { vi, test, expect, describe } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MiniPlayer } from './MiniPlayer.jsx';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { NavProvider } from './NavProvider.jsx';

function makeAdapter(state, item, queue) {
  const stopMock = vi.fn();
  const playMock = vi.fn();
  const pauseMock = vi.fn();
  return {
    stopMock, playMock, pauseMock,
    adapter: {
      getSnapshot: () => ({
        state,
        currentItem: item,
        position: 0,
        queue: queue ?? { items: [], currentIndex: -1, upNextCount: 0 },
        config: {},
        meta: { updatedAt: '', ownerId: 'test' },
      }),
      subscribe: () => () => {},
      transport: { play: playMock, pause: pauseMock, stop: stopMock, skipNext: () => {}, skipPrev: () => {} },
      queue: {}, config: {}, lifecycle: {}, portability: {},
    },
  };
}

function renderMiniPlayer({ state, item, queue }) {
  const harness = makeAdapter(state, item, queue);
  render(
    <LocalSessionContext.Provider value={{ adapter: harness.adapter }}>
      <NavProvider><MiniPlayer /></NavProvider>
    </LocalSessionContext.Provider>,
  );
  return harness;
}

describe('MiniPlayer', () => {
  test('idle when no current item', () => {
    renderMiniPlayer({ state: 'idle', item: null });
    expect(screen.getByTestId('media-mini-player')).toHaveTextContent(/idle/i);
    expect(screen.queryByTestId('mini-stop')).not.toBeInTheDocument();
  });

  test('shows title, pause toggle, and stop when playing', () => {
    const item = { contentId: 'plex:1', title: 'Cosmos' };
    renderMiniPlayer({ state: 'playing', item });
    expect(screen.getByTestId('mini-player-open-nowplaying')).toHaveTextContent('Cosmos');
    expect(screen.getByTestId('mini-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('mini-stop')).toBeInTheDocument();
  });

  test('Stop calls transport.stop()', () => {
    const item = { contentId: 'plex:1', title: 'Cosmos' };
    const { stopMock } = renderMiniPlayer({ state: 'playing', item });
    fireEvent.click(screen.getByTestId('mini-stop'));
    expect(stopMock).toHaveBeenCalledTimes(1);
  });

  test('shows queue position badge for a multi-item queue', () => {
    const item = { contentId: 'plex:2', title: 'Cosmos' };
    const queue = {
      items: [{ queueItemId: 'a' }, { queueItemId: 'b' }, { queueItemId: 'c' }],
      currentIndex: 1, upNextCount: 0,
    };
    renderMiniPlayer({ state: 'playing', item, queue });
    expect(screen.getByTestId('mini-queue-count')).toHaveTextContent('2/3');
  });
});
