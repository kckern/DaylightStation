import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

const transport = {
  play: vi.fn(), pause: vi.fn(), stop: vi.fn(),
  seekAbs: vi.fn(), seekRel: vi.fn(), skipNext: vi.fn(), skipPrev: vi.fn(),
};
const config = { setShuffle: vi.fn(), setRepeat: vi.fn(), setVolume: vi.fn() };
const state = { snapshot: null };
vi.mock('../controller/useSessionController.js', () => ({
  useSessionController: () => ({
    controller: {},
    snapshot: state.snapshot,
    transport,
    config,
    capabilities: { seekable: true, acked: false },
    portability: { snapshotForHandoff: () => state.snapshot },
  }),
}));
vi.mock('../controller/usePlaybackPosition.js', () => ({
  usePlaybackPosition: () => ({ seconds: 30, ts: 0 }),
}));
vi.mock('../session/usePlayerHost.js', () => ({ usePlayerHost: () => {} }));
const pop = vi.fn();
vi.mock('./NavProvider.jsx', () => ({ useNav: () => ({ pop, push: vi.fn(), view: 'nowPlaying' }) }));
vi.mock('./QueuePanel.jsx', () => ({ QueuePanel: () => <div data-testid="queue-stub" /> }));
vi.mock('../cast/DispatchTargetPicker.jsx', () => ({
  DispatchTargetPicker: () => <div data-testid="picker-stub" />,
}));

import { NowPlayingView } from './NowPlayingView.jsx';

function makeSnapshot({ item, index = 1, containerTitle = 'Primary Songs' } = {}) {
  const items = [0, 1, 2].map((i) => ({
    queueItemId: `q${i}`,
    contentId: `singalong:primary/${i + 4}`,
    title: `Primary Song ${i + 4}`,
    priority: 'queue',
    ...(containerTitle ? { containerTitle } : {}),
  }));
  return {
    state: 'playing',
    position: 30,
    currentItem: item !== undefined ? item : {
      contentId: 'singalong:primary/5',
      title: 'Primary Song 5',
      duration: 180,
      thumbnail: '/api/v1/thumb/5.jpg',
      format: 'video',
    },
    queue: { items, currentIndex: index, upNextCount: 0 },
    config: { shuffle: false, repeat: 'off', volume: 100, shader: null },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.snapshot = makeSnapshot();
});

describe('NowPlayingView', () => {
  it('keeps the exact "Now Playing: <title>" heading', () => {
    render(<NowPlayingView />);
    expect(screen.getByTestId('now-playing-title')).toHaveTextContent('Now Playing: Primary Song 5');
  });

  it('renders artwork + metadata from the current item without raw ids', () => {
    render(<NowPlayingView />);
    const meta = screen.getByTestId('np-meta');
    expect(screen.getByTestId('np-meta-art')).toHaveAttribute('src', '/api/v1/thumb/5.jpg');
    expect(within(meta).getByTestId('np-meta-title')).toHaveTextContent('Primary Song 5');
    expect(within(meta).getByTestId('np-meta-context')).toHaveTextContent('Primary Songs');
    expect(within(meta).getByTestId('np-meta-sub')).toHaveTextContent('2 of 3');
    expect(within(meta).getByTestId('np-meta-sub')).toHaveTextContent('3:00');
    expect(meta.textContent).not.toMatch(/singalong:/);
  });

  it('omits metadata lines it cannot fill — never falls back to a raw id', () => {
    state.snapshot = makeSnapshot({
      item: { contentId: 'plex:999', title: null, duration: null },
      containerTitle: null,
    });
    render(<NowPlayingView />);
    const meta = screen.getByTestId('np-meta');
    expect(within(meta).queryByTestId('np-meta-title')).toBeNull();
    expect(within(meta).queryByTestId('np-meta-context')).toBeNull();
    expect(meta.textContent).not.toContain('plex:999');
  });

  it('mounts the seek row and full transport for the current item', () => {
    render(<NowPlayingView />);
    expect(screen.getByTestId('np-seek')).toBeInTheDocument();
    expect(screen.getByTestId('np-transport')).toBeInTheDocument();
    expect(screen.getByTestId('np-rew')).toBeInTheDocument();
    expect(screen.getByTestId('np-ffw')).toBeInTheDocument();
  });

  it('hides the speed control when the host has no media element (no pathway)', () => {
    render(<NowPlayingView />);
    expect(screen.queryByTestId('np-rate')).toBeNull();
  });

  it('shows the empty state when nothing is playing', () => {
    state.snapshot = makeSnapshot({ item: null, index: -1 });
    render(<NowPlayingView />);
    expect(screen.getByTestId('now-playing-title')).toHaveTextContent('Nothing playing');
    expect(screen.queryByTestId('np-meta')).toBeNull();
    expect(screen.queryByTestId('np-transport')).toBeNull();
    expect(screen.queryByTestId('handoff-section')).toBeNull();
  });

  it('keeps the back button wired to nav pop', () => {
    render(<NowPlayingView />);
    fireEvent.click(screen.getByTestId('now-playing-back'));
    expect(pop).toHaveBeenCalledTimes(1);
  });
});
