import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const transport = { play: vi.fn(), pause: vi.fn(), stop: vi.fn(), skipNext: vi.fn() };
const state = { snapshot: null, position: { seconds: 30, ts: 0 } };
vi.mock('../controller/useSessionController.js', () => ({
  useSessionController: () => ({ controller: {}, snapshot: state.snapshot, transport }),
}));
vi.mock('../controller/usePlaybackPosition.js', () => ({
  usePlaybackPosition: () => state.position,
}));
const push = vi.fn();
const nav = { push, view: 'home' };
vi.mock('./NavProvider.jsx', () => ({ useNav: () => nav }));

import { MiniPlayer } from './MiniPlayer.jsx';

function makeSnapshot({
  playerState = 'playing',
  index = 0,
  count = 3,
  repeat = 'off',
  duration = 120,
  title = 'Track One',
} = {}) {
  return {
    state: playerState,
    position: 0,
    currentItem: { contentId: 'plex:1', title, duration, thumbnail: '/thumb.jpg' },
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
  it('renders the exact "Idle" bar when nothing is queued', () => {
    state.snapshot = { ...makeSnapshot(), currentItem: null };
    render(<MiniPlayer />);
    expect(screen.getByTestId('media-mini-player')).toHaveTextContent('Idle');
    expect(screen.queryByTestId('mini-toggle')).toBeNull();
  });

  it('shows a top-edge progress bar reflecting position/duration', () => {
    render(<MiniPlayer />);
    // 30s of 120s → 25%.
    expect(screen.getByTestId('mini-progress').style.width).toBe('25.00%');
  });

  it('hides the progress bar when the item has no duration', () => {
    state.snapshot = makeSnapshot({ duration: null });
    render(<MiniPlayer />);
    expect(screen.queryByTestId('mini-progress')).toBeNull();
  });

  it('toggles play/pause from the current state', () => {
    render(<MiniPlayer />);
    fireEvent.click(screen.getByTestId('mini-toggle'));
    expect(transport.pause).toHaveBeenCalledTimes(1);

    state.snapshot = makeSnapshot({ playerState: 'paused' });
    render(<MiniPlayer />);
    fireEvent.click(screen.getAllByTestId('mini-toggle')[1]);
    expect(transport.play).toHaveBeenCalledTimes(1);
  });

  it('skips to the next item, and disables next with no neighbor', () => {
    render(<MiniPlayer />);
    const next = screen.getByTestId('mini-next');
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(transport.skipNext).toHaveBeenCalledTimes(1);

    state.snapshot = makeSnapshot({ index: 2, count: 3 });
    render(<MiniPlayer />);
    expect(screen.getAllByTestId('mini-next')[1]).toBeDisabled();
  });

  it('keeps the title tap → Now Playing affordance and queue chip', () => {
    render(<MiniPlayer />);
    expect(screen.getByTestId('mini-queue-count')).toHaveTextContent('1/3');
    fireEvent.click(screen.getByTestId('mini-player-open-nowplaying'));
    expect(push).toHaveBeenCalledWith('nowPlaying', {});
  });

  it('keeps stop working', () => {
    render(<MiniPlayer />);
    fireEvent.click(screen.getByTestId('mini-stop'));
    expect(transport.stop).toHaveBeenCalledTimes(1);
  });
});
