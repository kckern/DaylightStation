import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const transport = { play: vi.fn(), pause: vi.fn(), stop: vi.fn(), skipNext: vi.fn() };
const state = { snapshot: null, position: { seconds: 30, ts: 0 } };
const push = vi.fn();
const nav = { push, view: 'home' };
vi.mock('./NavProvider.jsx', () => ({ useNav: () => nav }));

import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { createLocalSessionController } from '../session/LocalSessionController.js';
import { MiniPlayer } from './MiniPlayer.jsx';

function stateController() {
  return {
    getSnapshot: () => state.snapshot,
    subscribe: () => () => {},
    position: {
      get: () => state.position,
      subscribe: () => () => {},
    },
    transport,
  };
}

function renderMiniPlayer(controller = stateController()) {
  return render(
    <LocalSessionContext.Provider value={{ controller }}>
      <MiniPlayer />
    </LocalSessionContext.Provider>
  );
}

function makeSnapshot({
  playerState = 'playing',
  index = 0,
  count = 3,
  repeat = 'off',
  duration = 120,
  title = 'Track One',
  format = undefined,
} = {}) {
  return {
    state: playerState,
    position: 0,
    currentItem: { contentId: 'plex:1', title, duration, thumbnail: '/thumb.jpg', format },
    queue: {
      items: Array.from({ length: count }, (_, i) => ({
        queueItemId: `q${i}`, contentId: `plex:${i}`, title: `T${i}`, priority: 'queue',
      })),
      currentIndex: index,
      upNextCount: 0,
    },
    config: { shuffle: false, repeat, volume: 100, shader: null },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  nav.view = 'home';
  state.snapshot = makeSnapshot();
  state.position = { seconds: 30, ts: 0 };
});

describe('MiniPlayer', () => {
  // Task 16 (spec D7): the mini player used to render a permanent ~60px
  // "Idle" strip even with no local session — dead chrome eating screen
  // space on a 360px phone. It now renders nothing until there's an actual
  // session to show a handle for.
  it('STEER.7a renders nothing after clear/reset leaves no item or queue', () => {
    state.snapshot = {
      ...makeSnapshot({ count: 0 }),
      state: 'idle',
      currentItem: null,
      queue: { items: [], currentIndex: -1, upNextCount: 0 },
    };
    const { container } = renderMiniPlayer();
    expect(screen.queryByTestId('media-mini-player')).not.toBeInTheDocument();
    expect(screen.queryByText('Idle')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when there is no snapshot at all', () => {
    state.snapshot = null;
    const { container } = renderMiniPlayer();
    expect(screen.queryByTestId('media-mini-player')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('STEER.7a keeps a stopped queue reachable and Play restarts its retained head', () => {
    const controller = createLocalSessionController({
      clientId: 'mini-player-test',
      randomUuid: () => 'mini-player-session',
      nowFn: () => new Date('2026-09-14T00:00:00.000Z'),
    });
    const playerHandle = { play: vi.fn(), pause: vi.fn(), seek: vi.fn() };
    controller.setPlayerHandle(playerHandle);
    controller.queue.add({ contentId: 'plex:0', title: 'First retained item', format: 'video' });
    controller.queue.add({ contentId: 'plex:1', title: 'Second retained item', format: 'video' });
    controller.transport.stop();
    playerHandle.play.mockClear();

    renderMiniPlayer(controller);

    expect(screen.getByTestId('media-mini-player')).toBeInTheDocument();
    expect(screen.getByText('2 items ready')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mini-player-open-nowplaying'));
    expect(push).toHaveBeenCalledWith('nowPlaying', {});

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(playerHandle.play).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toEqual(expect.objectContaining({
      state: 'loading',
      currentItem: expect.objectContaining({ contentId: 'plex:0', title: 'First retained item' }),
      queue: expect.objectContaining({ currentIndex: 0 }),
    }));
    expect(screen.getByText('First retained item')).toBeInTheDocument();
    expect(screen.queryByText('2 items ready')).not.toBeInTheDocument();
  });

  it('shows a top-edge progress bar reflecting position/duration', () => {
    renderMiniPlayer();
    // 30s of 120s → 25%.
    expect(screen.getByTestId('mini-progress').style.width).toBe('25.00%');
  });

  it('hides the progress bar when the item has no duration', () => {
    state.snapshot = makeSnapshot({ duration: null });
    renderMiniPlayer();
    expect(screen.queryByTestId('mini-progress')).toBeNull();
  });

  it('toggles play/pause from the current state', () => {
    renderMiniPlayer();
    fireEvent.click(screen.getByTestId('mini-toggle'));
    expect(transport.pause).toHaveBeenCalledTimes(1);

    state.snapshot = makeSnapshot({ playerState: 'paused' });
    renderMiniPlayer();
    fireEvent.click(screen.getAllByTestId('mini-toggle')[1]);
    expect(transport.play).toHaveBeenCalledTimes(1);
  });

  it('skips to the next item, and disables next with no neighbor', () => {
    renderMiniPlayer();
    const next = screen.getByTestId('mini-next');
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(transport.skipNext).toHaveBeenCalledTimes(1);

    state.snapshot = makeSnapshot({ index: 2, count: 3 });
    renderMiniPlayer();
    expect(screen.getAllByTestId('mini-next')[1]).toBeDisabled();
  });

  it('keeps the title tap → Now Playing affordance and queue chip', () => {
    renderMiniPlayer();
    expect(screen.getByTestId('mini-queue-count')).toHaveTextContent('1/3');
    fireEvent.click(screen.getByTestId('mini-player-open-nowplaying'));
    expect(push).toHaveBeenCalledWith('nowPlaying', {});
  });

  it('keeps stop working', () => {
    renderMiniPlayer();
    fireEvent.click(screen.getByTestId('mini-stop'));
    expect(transport.stop).toHaveBeenCalledTimes(1);
  });

  it('docks the live video (not the thumbnail) for video while browsing', () => {
    state.snapshot = makeSnapshot({ format: 'video' });
    nav.view = 'home';
    renderMiniPlayer();
    expect(screen.getByTestId('mini-player-video-dock')).toBeInTheDocument();
    expect(document.querySelector('.mini-player-thumb')).toBeNull();
  });

  it('docks a resolved DASH video while browsing', () => {
    state.snapshot = makeSnapshot({ format: 'dash_video' });
    nav.view = 'home';
    renderMiniPlayer();
    expect(screen.getByTestId('mini-player-video-dock')).toBeInTheDocument();
  });

  it('clicking the docked video promotes to Now Playing', () => {
    state.snapshot = makeSnapshot({ format: 'video' });
    nav.view = 'home';
    renderMiniPlayer();
    fireEvent.click(screen.getByTestId('mini-player-video-dock'));
    expect(push).toHaveBeenCalledWith('nowPlaying', {});
  });

  it('shows the thumbnail (no video dock) for audio, and for video while on Now Playing', () => {
    // audio → thumbnail
    state.snapshot = makeSnapshot(); // no format
    nav.view = 'home';
    const { unmount } = renderMiniPlayer();
    expect(screen.queryByTestId('mini-player-video-dock')).toBeNull();
    expect(document.querySelector('.mini-player-thumb')).not.toBeNull();
    unmount();

    // video but on Now Playing → thumbnail (video is in the big pane)
    state.snapshot = makeSnapshot({ format: 'video' });
    nav.view = 'nowPlaying';
    renderMiniPlayer();
    expect(screen.queryByTestId('mini-player-video-dock')).toBeNull();
    expect(document.querySelector('.mini-player-thumb')).not.toBeNull();
  });
});
