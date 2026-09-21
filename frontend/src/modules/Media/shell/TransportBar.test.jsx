import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';

const transport = {
  play: vi.fn(),
  pause: vi.fn(),
  stop: vi.fn(),
  seekAbs: vi.fn(),
  seekRel: vi.fn(),
  skipNext: vi.fn(),
  skipPrev: vi.fn(),
};
const config = { setShuffle: vi.fn(), setRepeat: vi.fn(), setVolume: vi.fn(), setPlaybackRate: vi.fn() };
const state = { snapshot: null, capabilities: { seekable: true, acked: false } };
vi.mock('../controller/useSessionController.js', () => ({
  useSessionController: () => ({
    snapshot: state.snapshot,
    transport,
    config,
    capabilities: state.capabilities,
  }),
}));

import { TransportBar } from './TransportBar.jsx';

function makeSnapshot({
  playerState = 'playing',
  index = 1,
  count = 3,
  repeat = 'off',
  shuffle = false,
  volume = 80,
  playbackRate = 1,
  item,
} = {}) {
  return {
    state: playerState,
    position: 0,
    currentItem: item ?? { contentId: 'plex:100', title: 'Track', duration: 240 },
    queue: {
      items: Array.from({ length: count }, (_, i) => ({
        queueItemId: `q${i}`, contentId: `plex:${i}`, title: `T${i}`, priority: 'queue',
      })),
      currentIndex: index,
      upNextCount: 0,
    },
    config: { shuffle, repeat, volume, playbackRate, shader: null },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  config.setPlaybackRate = vi.fn();
  state.snapshot = makeSnapshot();
  state.capabilities = { seekable: true, acked: false };
});

describe('TransportBar', () => {
  it('pauses while playing and plays while paused', () => {
    render(<TransportBar target="local" />);
    fireEvent.click(screen.getByTestId('np-toggle'));
    expect(transport.pause).toHaveBeenCalledTimes(1);

    state.snapshot = makeSnapshot({ playerState: 'paused' });
    render(<TransportBar target="local" />);
    fireEvent.click(screen.getAllByTestId('np-toggle')[1]);
    expect(transport.play).toHaveBeenCalledTimes(1);
  });

  it('rewinds and fast-forwards 10 seconds via seekRel', () => {
    render(<TransportBar target="local" />);
    fireEvent.click(screen.getByTestId('np-rew'));
    expect(transport.seekRel).toHaveBeenCalledWith(-10);
    fireEvent.click(screen.getByTestId('np-ffw'));
    expect(transport.seekRel).toHaveBeenCalledWith(10);
  });

  it('skips with prev/next and stops with stop', () => {
    render(<TransportBar target="local" />);
    fireEvent.click(screen.getByTestId('np-prev'));
    expect(transport.skipPrev).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('np-next'));
    expect(transport.skipNext).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('np-stop'));
    expect(transport.stop).toHaveBeenCalledTimes(1);
  });

  it('disables prev at the head of the queue', () => {
    state.snapshot = makeSnapshot({ index: 0 });
    render(<TransportBar target="local" />);
    expect(screen.getByTestId('np-prev')).toBeDisabled();
    expect(screen.getByTestId('np-next')).toBeEnabled();
  });

  it('disables next at the tail of the queue (repeat off)', () => {
    state.snapshot = makeSnapshot({ index: 2, count: 3 });
    render(<TransportBar target="local" />);
    expect(screen.getByTestId('np-next')).toBeDisabled();
    expect(screen.getByTestId('np-prev')).toBeEnabled();
    fireEvent.click(screen.getByTestId('np-next'));
    expect(transport.skipNext).not.toHaveBeenCalled();
  });

  it('keeps next enabled at the tail when repeat=all wraps the queue', () => {
    state.snapshot = makeSnapshot({ index: 2, count: 3, repeat: 'all' });
    render(<TransportBar target="local" />);
    expect(screen.getByTestId('np-next')).toBeEnabled();
  });

  it('hides rew/ffw for live content (no seek contract)', () => {
    state.snapshot = makeSnapshot({
      item: { contentId: 'tv:5', title: 'Live Feed', isLive: true },
    });
    render(<TransportBar target="local" />);
    expect(screen.queryByTestId('np-rew')).toBeNull();
    expect(screen.queryByTestId('np-ffw')).toBeNull();
    expect(screen.getByTestId('np-toggle')).toBeInTheDocument();
  });

  it('disables rew/ffw and suppresses commands when duration is not seekable', () => {
    state.snapshot = makeSnapshot({
      item: { contentId: 'plex:100', title: 'Unknown length', duration: null, isLive: false },
    });
    state.capabilities = { seekable: false, acked: false };
    render(<TransportBar target="local" />);

    expect(screen.getByTestId('np-rew')).toBeDisabled();
    expect(screen.getByTestId('np-ffw')).toBeDisabled();
    fireEvent.click(screen.getByTestId('np-rew'));
    fireEvent.click(screen.getByTestId('np-ffw'));
    expect(transport.seekRel).not.toHaveBeenCalled();
  });

  it('toggles shuffle and cycles repeat through the session config', () => {
    render(<TransportBar target="local" />);
    fireEvent.click(screen.getByTestId('np-shuffle'));
    expect(config.setShuffle).toHaveBeenCalledWith(true);
    expect(screen.getByTestId('np-shuffle')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByTestId('np-repeat'));
    expect(config.setRepeat).toHaveBeenCalledWith('all');
  });

  it('sets volume through config.setVolume', () => {
    render(<TransportBar target="local" />);
    fireEvent.change(screen.getByTestId('np-volume'), { target: { value: '55' } });
    expect(config.setVolume).toHaveBeenCalledWith(55);
  });

  it('shows the volume level and changes the selected target by large steps', () => {
    render(<TransportBar target="local" />);

    expect(screen.getByTestId('np-volume-level')).toHaveTextContent('80%');
    fireEvent.click(screen.getByRole('button', { name: 'Decrease volume' }));
    expect(config.setVolume).toHaveBeenCalledWith(70);
    fireEvent.click(screen.getByRole('button', { name: 'Increase volume' }));
    expect(config.setVolume).toHaveBeenCalledWith(90);
  });

  it('changes rate through selected controller config, never a media element', () => {
    render(<TransportBar target="local" />);
    fireEvent.click(screen.getByTestId('np-rate'));
    expect(config.setPlaybackRate).toHaveBeenCalledWith(1.25);
  });

  it('keeps speed visible but disabled with a plain reason when target has no rate method', () => {
    config.setPlaybackRate = undefined;
    render(<TransportBar target={{ deviceId: 'tv-1' }} />);

    expect(screen.getByTestId('np-rate')).toBeDisabled();
    expect(screen.getByText('Playback speed is not available for this screen')).toBeInTheDocument();
  });

  it('reports ambiguous remote command rejection without claiming it was not sent', async () => {
    const onCommand = vi.fn(() => Promise.reject(new Error('ack timeout')));
    render(<TransportBar target={{ deviceId: 'tv-1' }} onCommand={onCommand} />);

    fireEvent.click(screen.getByTestId('np-toggle'));
    expect(onCommand).toHaveBeenCalledWith('pause', expect.any(Function));
    expect(await screen.findByTestId('np-command-feedback')).toHaveTextContent('Could not confirm change');
    expect(screen.queryByText('Not sent')).toBeNull();
  });

  it('labels an explicit DEVICE_OFFLINE rejection as not sent, without treating an ack timeout as delivery failure', async () => {
    const onCommand = vi.fn(() => Promise.reject(new Error('HTTP 409: Conflict - {"code":"DEVICE_OFFLINE"}')));
    render(<TransportBar target={{ deviceId: 'tv-1' }} onCommand={onCommand} />);

    fireEvent.click(screen.getByTestId('np-toggle'));
    expect(await screen.findByTestId('np-command-feedback')).toHaveTextContent('Not sent');
  });

  it('keeps a target-labelled Play and volume surface for a ready retained queue', () => {
    state.snapshot = {
      ...makeSnapshot({ playerState: 'ready', index: -1, count: 1 }),
      currentItem: null,
    };
    render(<TransportBar target={{ deviceId: 'tv-1' }} targetLabel="Living Room TV" />);

    expect(screen.getByTestId('np-target-label')).toHaveTextContent('Living Room TV');
    expect(screen.getByTestId('np-toggle')).toBeEnabled();
    expect(screen.getByTestId('np-volume')).toBeEnabled();
  });

  it('does not show an old rejected target command after the target changes', async () => {
    let rejectOld;
    const onCommand = vi.fn(() => new Promise((_, reject) => { rejectOld = reject; }));
    const { rerender } = render(<TransportBar target={{ deviceId: 'tv-1' }} onCommand={onCommand} />);
    fireEvent.click(screen.getByTestId('np-toggle'));
    rerender(<TransportBar target={{ deviceId: 'tv-2' }} onCommand={onCommand} />);
    await act(async () => { rejectOld(new Error('late ack timeout')); });
    expect(screen.queryByTestId('np-command-feedback')).toBeNull();
  });

  it('does not let an older rejection overwrite a newer command result', async () => {
    let rejectOld;
    const onCommand = vi.fn()
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; }))
      .mockResolvedValueOnce({ ok: true });
    render(<TransportBar target={{ deviceId: 'tv-1' }} onCommand={onCommand} />);
    fireEvent.click(screen.getByTestId('np-toggle'));
    fireEvent.click(screen.getByTestId('np-toggle'));
    await act(async () => { rejectOld(new Error('late ack timeout')); });
    expect(screen.queryByTestId('np-command-feedback')).toBeNull();
  });

  it('reports a synchronous current-target command failure', () => {
    render(<TransportBar target={{ deviceId: 'tv-1' }} onCommand={() => { throw new Error('offline'); }} />);
    fireEvent.click(screen.getByTestId('np-toggle'));
    expect(screen.getByTestId('np-command-feedback')).toHaveTextContent('Could not confirm change');
  });

  it('keeps identity but disables unsupported controls for an offline target', () => {
    state.snapshot = null;
    const original = { ...config };
    Object.keys(config).forEach((key) => { config[key] = undefined; });
    transport.play = undefined;
    try {
      render(<TransportBar target={{ deviceId: 'tv-1' }} targetLabel="Living Room TV" />);
      expect(screen.getByTestId('np-target-label')).toHaveTextContent('Living Room TV');
      expect(screen.getByTestId('np-toggle')).toBeDisabled();
      expect(screen.getByTestId('np-volume')).toBeDisabled();
      expect(screen.getByText('Playback controls are unavailable for this screen')).toBeInTheDocument();
    } finally {
      Object.assign(config, original);
      transport.play = vi.fn();
    }
  });

  it('labels every control for assistive tech', () => {
    render(<TransportBar target="local" />);
    for (const label of ['Previous', 'Next', 'Pause', 'Back 10 seconds', 'Forward 10 seconds', 'Shuffle', 'Stop', 'Volume']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it('explains unavailable seek rather than issuing a command', () => {
    state.snapshot = makeSnapshot({
      item: { contentId: 'plex:100', title: 'Unknown length', duration: null, isLive: false },
    });
    state.capabilities = { seekable: false, acked: false };
    render(<TransportBar target="local" />);

    expect(screen.getByText('Seeking is not available for this playback')).toBeInTheDocument();
  });
});
