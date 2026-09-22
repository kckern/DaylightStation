import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { FleetContext } from '../fleet/FleetProvider.jsx';
import { CastTargetProvider } from '../cast/CastTargetProvider.jsx';

const transport = {
  play: vi.fn(), pause: vi.fn(), stop: vi.fn(),
  seekAbs: vi.fn(), seekRel: vi.fn(), skipNext: vi.fn(), skipPrev: vi.fn(),
};
const config = { setShuffle: vi.fn(), setRepeat: vi.fn(), setVolume: vi.fn() };
const state = { snapshot: null, mediaElement: null, controller: null };
const hostClaimSpy = vi.fn();
vi.mock('../controller/useSessionController.js', () => ({
  useSessionController: () => ({
    controller: state.controller ?? { getMediaElement: () => state.mediaElement },
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
vi.mock('../session/usePlayerHost.js', () => ({ usePlayerHost: (...args) => hostClaimSpy(...args) }));
const pop = vi.fn();
let backDestination = 'Browse';
vi.mock('./NavProvider.jsx', () => ({ useNav: () => ({ pop, push: vi.fn(), view: 'nowPlaying', backDestination }) }));
vi.mock('./QueuePanel.jsx', () => ({ QueuePanel: () => <div data-testid="queue-stub" /> }));
vi.mock('../cast/DispatchTargetPicker.jsx', () => ({
  DispatchTargetPicker: () => <div data-testid="picker-stub" />,
}));

import { NowPlayingView } from './NowPlayingView.jsx';

const emptyFleetEntries = new Map();
const fleetStore = {
  subscribeAll: () => () => {},
  getAll: () => emptyFleetEntries,
  getEntry: () => null,
};

function renderNowPlaying({ devices = [] } = {}) {
  return render(
    <FleetContext.Provider value={{ devices, store: fleetStore }}>
      <CastTargetProvider><NowPlayingView /></CastTargetProvider>
    </FleetContext.Provider>,
  );
}

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
  localStorage.clear();
  state.snapshot = makeSnapshot();
  state.mediaElement = null;
  state.controller = null;
});

describe('NowPlayingView', () => {
  it('shows the persisted remote aim while the local Now Playing surface is open', () => {
    localStorage.setItem('media-app.cast-target', JSON.stringify({
      mode: 'transfer', targetIds: ['office-tv'], activityAt: Date.now(), exemptionStartedAt: null,
    }));
    renderNowPlaying({ devices: [{ id: 'office-tv', name: 'Office TV', location: 'Office' }] });
    expect(screen.getByTestId('aim-label')).toHaveTextContent('Aim: Office TV · Office');
  });

  it.each(['format', 'mediaType'])('keeps HLS video expansion available for %s descriptors', field => {
    state.snapshot = makeSnapshot({ item: { contentId: 'plex:55854', title: 'Arrival', [field]: 'hls_video' } });
    renderNowPlaying();
    expect(screen.getByRole('button', { name: 'Expand video', exact: true })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Expand video', exact: true }));
    expect(hostClaimSpy).toHaveBeenLastCalledWith(expect.any(Object), 2, true, { forceShader: 'focused' });
  });

  it('keeps video expansion available for a paused contentId-only item when the actual native node is VIDEO', () => {
    state.snapshot = makeSnapshot({
      item: { contentId: 'plex:arrival', title: 'Arrival' },
    });
    state.snapshot.state = 'paused';
    state.mediaElement = document.createElement('video');

    renderNowPlaying();

    expect(screen.getByRole('button', { name: 'Expand video', exact: true })).toBeVisible();
    expect(screen.getByTestId('np-rate')).toBeDisabled();
  });

  it('shows artwork and title when expanded audio is opened', () => {
    state.snapshot = makeSnapshot({
      item: {
        contentId: 'plex:audio-1',
        title: 'Audio Arrival',
        format: 'audio',
        thumbnail: '/api/v1/thumb/audio-1.jpg',
      },
    });

    renderNowPlaying();

    fireEvent.click(screen.getByRole('button', { name: 'Expand audio', exact: true }));

    expect(screen.getByRole('button', { name: 'Shrink audio', exact: true })).toBeVisible();
    expect(screen.getByTestId('np-meta-art')).toHaveAttribute('src', '/api/v1/thumb/audio-1.jpg');
    expect(screen.getByTestId('np-meta-title')).toHaveTextContent('Audio Arrival');
  });

  it('keeps the exact "Now Playing: <title>" heading', () => {
    renderNowPlaying();
    expect(screen.getByTestId('now-playing-title')).toHaveTextContent('Now Playing: Primary Song 5');
  });

  it('renders artwork + metadata from the current item without raw ids', () => {
    renderNowPlaying();
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
    renderNowPlaying();
    const meta = screen.getByTestId('np-meta');
    expect(within(meta).queryByTestId('np-meta-title')).toBeNull();
    expect(within(meta).queryByTestId('np-meta-context')).toBeNull();
    expect(meta.textContent).not.toContain('plex:999');
  });

  it('mounts the seek row and full transport for the current item', () => {
    renderNowPlaying();
    expect(screen.getByTestId('np-seek')).toBeInTheDocument();
    expect(screen.getByTestId('np-transport')).toBeInTheDocument();
    expect(screen.getByTestId('np-rew')).toBeInTheDocument();
    expect(screen.getByTestId('np-ffw')).toBeInTheDocument();
  });

  it('keeps speed visible but unavailable without a controller rate capability', () => {
    renderNowPlaying();
    expect(screen.getByTestId('np-rate')).toBeDisabled();
    expect(screen.getByText('Playback speed is not available for this screen')).toBeInTheDocument();
  });

  it('shows the empty state when nothing is playing', () => {
    state.snapshot = makeSnapshot({ item: null, index: -1 });
    renderNowPlaying();
    expect(screen.getByTestId('now-playing-title')).toHaveTextContent('Nothing playing');
    expect(screen.queryByTestId('np-meta')).toBeNull();
    expect(screen.queryByTestId('np-transport')).toBeNull();
    expect(screen.queryByTestId('handoff-section')).toBeNull();
  });

  it('keeps the back button wired to nav pop', () => {
    renderNowPlaying();
    fireEvent.click(screen.getByTestId('now-playing-back'));
    expect(pop).toHaveBeenCalledTimes(1);
  });

  it('names the actual prior area on its visible Back control', () => {
    backDestination = 'Devices';
    renderNowPlaying();
    expect(screen.getByTestId('now-playing-back')).toHaveTextContent('← Devices');
  });

  it('expands with the exact accessible control, requests focused rendering, and keeps Stop reachable', () => {
    renderNowPlaying();
    expect(screen.getByRole('button', { name: 'Expand video', exact: true })).toBeVisible();
    expect(hostClaimSpy).toHaveBeenLastCalledWith(expect.any(Object), 2, true, { forceShader: null });

    fireEvent.click(screen.getByRole('button', { name: 'Expand video', exact: true }));

    expect(screen.getByRole('button', { name: 'Shrink video', exact: true })).toBeVisible();
    expect(screen.getByTestId('now-playing-view')).toHaveClass('now-playing-view--expanded');
    expect(hostClaimSpy).toHaveBeenLastCalledWith(expect.any(Object), 2, true, { forceShader: 'focused' });
    expect(screen.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  });

  it('does not use the controller media accessor as a speed control pathway', () => {
    state.mediaElement = { playbackRate: 1 };
    renderNowPlaying();
    expect(screen.getByTestId('np-rate')).toBeDisabled();
  });
});
