import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { FleetContext } from '../fleet/FleetProvider.jsx';
import { CastTargetProvider } from '../cast/CastTargetProvider.jsx';

const transport = {
  play: vi.fn(), pause: vi.fn(), stop: vi.fn(), seekAbs: vi.fn(), seekRel: vi.fn(), skipNext: vi.fn(), skipPrev: vi.fn(),
};
const config = { setShuffle: vi.fn(), setRepeat: vi.fn(), setVolume: vi.fn() };
const queue = { jump: vi.fn(), reorder: vi.fn(), remove: vi.fn(), clear: vi.fn() };
const controller = { position: { get: () => state.position, subscribe: () => () => {} } };
const state = {
  entry: {},
  position: { seconds: 60, ts: 0 },
  snapshot: {
    state: 'playing',
    currentItem: { contentId: 'plex:arrival', title: 'Arrival', duration: 7200 },
    queue: { items: [{ queueItemId: 'q1', contentId: 'plex:arrival', title: 'Arrival' }], currentIndex: 0, upNextCount: 0 },
    config: { shuffle: false, repeat: 'off', volume: 70 },
  },
};
const enterPeek = vi.fn();
const exitPeek = vi.fn();
const predict = vi.fn();
const pending = vi.fn();
const pendingMatch = vi.fn();

vi.mock('../controller/useSessionController.js', () => ({
  useSessionController: () => ({
    controller,
    snapshot: state.snapshot,
    // RemoteSessionController retains these methods even while fleet marks a
    // device stale/offline. The consumer must gate them from fleet state.
    transport,
    queue,
    config,
    capabilities: { seekable: true, acked: true },
  }),
}));
vi.mock('../peek/usePeek.js', () => ({ usePeek: () => ({ enterPeek, exitPeek }) }));
vi.mock('../fleet/useDevice.js', () => ({ useDevice: () => ({ device: { id: 'tv-1', name: 'Living Room TV' }, entry: state.entry }) }));
vi.mock('../fleet/deviceDisplay.js', () => ({
  deviceName: () => 'Living Room TV', deviceIcon: () => 'TV', deviceLocation: () => 'Living room',
}));
vi.mock('../../../hooks/useStatusOverlay', () => ({
  useStatusOverlay: () => ({ statusView: new Map([['tv-1', state.snapshot]]), predict, pending, pendingMatch }),
}));
const peekPop = vi.fn();
let backDestination = 'Devices';
vi.mock('./NavProvider.jsx', () => ({ useNav: () => ({ pop: peekPop, backDestination }) }));
import { PeekPanel } from './PeekPanel.jsx';

const emptyFleetEntries = new Map();
const peekFleetStore = { subscribeAll: () => () => {}, getAll: () => emptyFleetEntries, getEntry: () => null };
function PeekTestProviders({ deviceId = 'tv-1' }) {
  return (
    <FleetContext.Provider value={{ devices: [{ id: 'tv-1', name: 'Office TV', location: 'Office' }], store: peekFleetStore }}>
      <CastTargetProvider><MantineProvider><PeekPanel deviceId={deviceId} /></MantineProvider></CastTargetProvider>
    </FleetContext.Provider>
  );
}
function renderPeekPanel() {
  return render(<PeekTestProviders />);
}

function measureSeekTrack(track, { left = 0, width = 200 } = {}) {
  track.getBoundingClientRect = () => ({
    left, width, right: left + width, top: 0, bottom: 8, height: 8, x: left, y: 0,
  });
}

function fireSeekPointer(track, type, clientX) {
  fireEvent(track, new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX }));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  transport.pause.mockResolvedValue({ ok: true });
  transport.stop.mockResolvedValue({ ok: true });
  transport.seekAbs.mockResolvedValue({ ok: true });
  state.entry = {};
  state.snapshot = {
    state: 'playing',
    currentItem: { contentId: 'plex:arrival', title: 'Arrival', duration: 7200 },
    queue: { items: [{ queueItemId: 'q1', contentId: 'plex:arrival', title: 'Arrival' }], currentIndex: 0, upNextCount: 0 },
    config: { shuffle: false, repeat: 'off', volume: 70 },
  };
});

describe('PeekPanel shared target controls', () => {
  it('keeps the persisted local aim while steering the Office screen', () => {
    localStorage.setItem('media-app.cast-target', JSON.stringify({
      mode: 'transfer', targetIds: [], activityAt: Date.now(), exemptionStartedAt: null,
    }));
    renderPeekPanel();
    expect(screen.getByTestId('aim-label')).toHaveTextContent('Aim: This device');
    expect(screen.getByTestId('aim-label')).not.toHaveTextContent('Office TV');
  });

  it('names the actual prior area on its visible Back control', () => {
    backDestination = 'Browse';
    renderPeekPanel();
    expect(screen.getByTestId('peek-back')).toHaveTextContent('← Browse');
    fireEvent.click(screen.getByTestId('peek-back'));
    expect(peekPop).toHaveBeenCalledTimes(1);
  });
  it('shows the kept queue only after Stop is acknowledged and the receiver reports ready with no item', async () => {
    const view = renderPeekPanel();
    fireEvent.click(screen.getByTestId('np-stop'));
    expect(screen.queryByTestId('peek-queue-kept')).toBeNull();

    state.snapshot = {
      ...state.snapshot,
      state: 'ready',
      currentItem: null,
      queue: { ...state.snapshot.queue, currentIndex: 0 },
    };
    view.rerender(<PeekTestProviders />);

    expect(await screen.findByTestId('peek-queue-kept')).toHaveTextContent('Queue kept: 1 item');
    expect(screen.getByTestId('peek-open-queue')).toBeVisible();
  });

  it('does not show a kept-queue receipt after Stop is rejected', async () => {
    transport.stop.mockRejectedValueOnce(new Error('ack timeout'));
    const view = renderPeekPanel();
    fireEvent.click(screen.getByTestId('np-stop'));
    await screen.findByTestId('np-command-feedback');

    state.snapshot = { ...state.snapshot, state: 'ready', currentItem: null };
    view.rerender(<PeekTestProviders />);
    await waitFor(() => expect(screen.queryByTestId('peek-queue-kept')).toBeNull());
  });

  it('does not retain a Stop receipt when its receiver becomes stale or the target switches', async () => {
    const view = renderPeekPanel();
    fireEvent.click(screen.getByTestId('np-stop'));
    state.snapshot = { ...state.snapshot, state: 'ready', currentItem: null };
    await act(async () => { await Promise.resolve(); });
    view.rerender(<PeekTestProviders />);
    await screen.findByTestId('peek-queue-kept');

    state.entry = { isStale: true };
    view.rerender(<PeekTestProviders />);
    await waitFor(() => expect(screen.queryByTestId('peek-queue-kept')).toBeNull());

    view.rerender(<PeekTestProviders deviceId="tv-2" />);
    expect(screen.queryByTestId('peek-queue-kept')).toBeNull();
  });

  it('uses the shared target-bound transport instead of duplicate remote controls', () => {
    renderPeekPanel();

    expect(screen.getByTestId('np-transport')).toBeInTheDocument();
    expect(screen.getByTestId('np-target-label')).toHaveTextContent('Living Room TV');
    expect(screen.queryByTestId('peek-play')).toBeNull();
    expect(screen.queryByTestId('peek-pause')).toBeNull();
    expect(screen.queryByTestId('peek-stop')).toBeNull();
    expect(screen.queryByTestId('peek-volume')).toBeNull();
  });

  it('keeps the remote pending adapter and reports an ambiguous rejection without false success', async () => {
    transport.pause.mockRejectedValueOnce(new Error('ack timeout'));
    renderPeekPanel();

    fireEvent.click(screen.getByTestId('np-toggle'));

    expect(predict).toHaveBeenCalledWith('tv-1', { state: 'paused' });
    expect(transport.pause).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('np-command-feedback')).toHaveTextContent('Could not confirm change');
    expect(screen.queryByText('Not sent')).toBeNull();
  });

  it('keeps remote seek at receiver position until confirmation and shows a rejected seek', async () => {
    transport.seekAbs.mockRejectedValueOnce(new Error('ack timeout'));
    renderPeekPanel();
    const seek = screen.getByTestId('np-seek');
    measureSeekTrack(seek);

    fireSeekPointer(seek, 'pointerdown', 150);
    fireSeekPointer(seek, 'pointerup', 150);

    expect(transport.seekAbs).toHaveBeenCalledWith(5400);
    expect(pendingMatch).toHaveBeenCalledWith('tv-1', 'position', expect.any(Function));
    expect(pendingMatch.mock.calls[0][2](5400)).toBe(true);
    expect(pendingMatch.mock.calls[0][2](61)).toBe(false);
    // The requested 1:30:00 must not become an optimistic remote position.
    expect(seek).toHaveAttribute('aria-valuenow', '60');
    expect(await screen.findByTestId('np-seek-command-feedback')).toHaveTextContent('Could not confirm change');
  });

  it('keeps target identity and ready-queue controls when the remote has no current item', () => {
    state.snapshot = {
      ...state.snapshot,
      state: 'ready',
      currentItem: null,
      queue: { items: [{ queueItemId: 'q1', contentId: 'plex:arrival', title: 'Arrival' }], currentIndex: -1, upNextCount: 0 },
    };
    renderPeekPanel();

    expect(screen.getByText('Living Room TV')).toBeInTheDocument();
    expect(screen.getByTestId('np-toggle')).toBeEnabled();
    expect(screen.getByTestId('np-volume')).toBeEnabled();
  });

  it.each([
    ['offline retained playback', { offline: true }, 'This device is offline'],
    ['stale retained playback', { isStale: true }, 'This device state is out of date'],
    ['missing playback state', {}, 'Playback state is unavailable for this device'],
  ])('disables actual remote methods for %s', (_case, entry, reason) => {
    state.entry = entry;
    state.snapshot = _case === 'missing playback state' ? null : {
      state: 'playing',
      currentItem: { contentId: 'plex:arrival', title: 'Arrival', duration: 7200 },
      queue: {
        items: [
          { queueItemId: 'q1', contentId: 'plex:arrival', title: 'Arrival' },
          { queueItemId: 'q2', contentId: 'plex:blade-runner', title: 'Blade Runner' },
        ],
        currentIndex: 0,
        upNextCount: 0,
      },
      config: { shuffle: false, repeat: 'off', volume: 70 },
    };
    renderPeekPanel();

    expect(screen.getByRole('heading', { name: /Living Room TV/ })).toBeInTheDocument();
    expect(screen.getByTestId('np-target-label')).toHaveTextContent('Living Room TV');
    expect(screen.getByTestId('np-toggle')).toBeDisabled();
    expect(screen.getByTestId('np-stop')).toBeDisabled();
    expect(screen.getByTestId('np-volume')).toBeDisabled();
    expect(screen.getByText(reason)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('np-toggle'));
    fireEvent.click(screen.getByTestId('np-stop'));
    fireEvent.change(screen.getByTestId('np-volume'), { target: { value: '55' } });
    expect(transport.pause).not.toHaveBeenCalled();
    expect(transport.stop).not.toHaveBeenCalled();
    expect(config.setVolume).not.toHaveBeenCalled();
    if (_case !== 'missing playback state') {
      expect(screen.getByTestId('np-seek')).toHaveAttribute('aria-disabled', 'true');
      expect(screen.getByTestId('queue-shuffle')).toBeDisabled();
      expect(screen.getByTestId('queue-repeat')).toBeDisabled();
      expect(screen.getByTestId('queue-clear')).toBeDisabled();
      expect(screen.getByTestId('queue-jump-q2')).toBeDisabled();
      expect(screen.getByTestId('queue-movedown-q1')).toBeDisabled();
      expect(screen.getByTestId('queue-moveup-q2')).toBeDisabled();
      expect(screen.getByTestId('queue-remove-q1')).toBeDisabled();
      fireEvent.keyDown(screen.getByTestId('np-seek'), { key: 'ArrowRight' });
      fireEvent.click(screen.getByTestId('queue-shuffle'));
      fireEvent.click(screen.getByTestId('queue-repeat'));
      fireEvent.click(screen.getByTestId('queue-clear'));
      fireEvent.click(screen.getByTestId('queue-jump-q2'));
      fireEvent.click(screen.getByTestId('queue-movedown-q1'));
      fireEvent.click(screen.getByTestId('queue-moveup-q2'));
      fireEvent.click(screen.getByTestId('queue-remove-q1'));
      expect(transport.seekAbs).not.toHaveBeenCalled();
      expect(config.setShuffle).not.toHaveBeenCalled();
      expect(config.setRepeat).not.toHaveBeenCalled();
      expect(queue.clear).not.toHaveBeenCalled();
      expect(queue.jump).not.toHaveBeenCalled();
      expect(queue.reorder).not.toHaveBeenCalled();
      expect(queue.remove).not.toHaveBeenCalled();
    }
  });
});
