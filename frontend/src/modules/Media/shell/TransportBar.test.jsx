import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const transport = {
  play: vi.fn(),
  pause: vi.fn(),
  stop: vi.fn(),
  seekAbs: vi.fn(),
  seekRel: vi.fn(),
  skipNext: vi.fn(),
  skipPrev: vi.fn(),
};
const config = { setShuffle: vi.fn(), setRepeat: vi.fn(), setVolume: vi.fn() };
const state = { snapshot: null };
vi.mock('../controller/useSessionController.js', () => ({
  useSessionController: () => ({ snapshot: state.snapshot, transport, config }),
}));

import { TransportBar } from './TransportBar.jsx';

function makeSnapshot({
  playerState = 'playing',
  index = 1,
  count = 3,
  repeat = 'off',
  shuffle = false,
  volume = 80,
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
    config: { shuffle, repeat, volume, shader: null },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.snapshot = makeSnapshot();
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

  it('renders no speed control without a media element (no rate pathway)', () => {
    render(<TransportBar target="local" />);
    expect(screen.queryByTestId('np-rate')).toBeNull();
  });

  it('cycles playback speed on the media element: 1 → 1.25 → 1.5 → 2 → 0.75 → 1', () => {
    const el = { playbackRate: 1 };
    render(<TransportBar target="local" mediaEl={el} />);
    const rate = screen.getByTestId('np-rate');
    expect(rate).toHaveTextContent('1×');

    const expected = [1.25, 1.5, 2, 0.75, 1];
    for (const r of expected) {
      fireEvent.click(rate);
      expect(el.playbackRate).toBe(r);
    }
    expect(rate).toHaveTextContent('1×');
  });

  it('re-asserts the chosen speed when the media element changes (new item)', () => {
    const first = { playbackRate: 1 };
    const { rerender } = render(<TransportBar target="local" mediaEl={first} />);
    fireEvent.click(screen.getByTestId('np-rate')); // → 1.25
    expect(first.playbackRate).toBe(1.25);

    const second = { playbackRate: 1 }; // fresh element defaults to 1×
    rerender(<TransportBar target="local" mediaEl={second} />);
    expect(second.playbackRate).toBe(1.25);
    expect(screen.getByTestId('np-rate')).toHaveTextContent('1.25×');
  });

  it('renders nothing without a current item', () => {
    state.snapshot = { ...makeSnapshot(), currentItem: null };
    const { container } = render(<TransportBar target="local" />);
    expect(container.firstChild).toBeNull();
  });

  it('labels every control for assistive tech', () => {
    render(<TransportBar target="local" />);
    for (const label of ['Previous', 'Next', 'Pause', 'Back 10 seconds', 'Forward 10 seconds', 'Shuffle', 'Stop', 'Volume']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });
});
