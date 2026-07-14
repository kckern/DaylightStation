import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const transport = { seekAbs: vi.fn() };
const state = {
  snapshot: null,
  capabilities: { seekable: true, acked: false },
  position: { seconds: 60, ts: 0 },
};
vi.mock('../controller/useSessionController.js', () => ({
  useSessionController: () => ({
    controller: {},
    snapshot: state.snapshot,
    transport,
    capabilities: state.capabilities,
  }),
}));
vi.mock('../controller/usePlaybackPosition.js', () => ({
  usePlaybackPosition: () => state.position,
}));

import { SeekBar, formatTime } from './SeekBar.jsx';

function makeSnapshot({ duration = 240, isLive = false, position = 0 } = {}) {
  return {
    state: 'playing',
    position,
    currentItem: { contentId: 'plex:100', title: 'Track', duration, isLive },
    queue: { items: [], currentIndex: -1, upNextCount: 0 },
    config: { shuffle: false, repeat: 'off', volume: 100, shader: null },
  };
}

/** happy-dom lays out nothing, so give the track a measurable box. */
function measureTrack(track, { left = 0, width = 200 } = {}) {
  track.getBoundingClientRect = () => ({
    left, width, right: left + width, top: 0, bottom: 8, height: 8, x: left, y: 0,
  });
}

/** happy-dom's PointerEvent constructor drops MouseEvent init fields
 *  (clientX arrives NaN), so dispatch a pointer-typed MouseEvent instead —
 *  React's native listener only cares about the event type. */
function firePointer(el, type, clientX) {
  fireEvent(el, new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX }));
}

beforeEach(() => {
  vi.clearAllMocks();
  state.snapshot = makeSnapshot();
  state.capabilities = { seekable: true, acked: false };
  state.position = { seconds: 60, ts: 0 };
});

describe('formatTime', () => {
  it('renders m:ss and h:mm:ss', () => {
    expect(formatTime(45)).toBe('0:45');
    expect(formatTime(60)).toBe('1:00');
    expect(formatTime(3723)).toBe('1:02:03');
  });
});

describe('SeekBar', () => {
  it('shows elapsed and remaining time from the hot position tier', () => {
    render(<SeekBar target="local" />);
    expect(screen.getByTestId('np-seek-elapsed')).toHaveTextContent('1:00');
    expect(screen.getByTestId('np-seek-remaining')).toHaveTextContent('-3:00');
  });

  it('is a keyboard-operable slider with correct aria values', () => {
    render(<SeekBar target="local" />);
    const track = screen.getByTestId('np-seek');
    expect(track).toHaveAttribute('role', 'slider');
    expect(track).toHaveAttribute('tabindex', '0');
    expect(track).toHaveAttribute('aria-valuemin', '0');
    expect(track).toHaveAttribute('aria-valuemax', '240');
    expect(track).toHaveAttribute('aria-valuenow', '60');
  });

  it('maps a click position on the track to seekAbs seconds', () => {
    render(<SeekBar target="local" />);
    const track = screen.getByTestId('np-seek');
    measureTrack(track, { left: 0, width: 200 });
    // 150px into a 200px track over a 240s item → 180s.
    firePointer(track, 'pointerdown', 150);
    firePointer(track, 'pointerup', 150);
    expect(transport.seekAbs).toHaveBeenCalledTimes(1);
    expect(transport.seekAbs).toHaveBeenCalledWith(180);
  });

  it('scrubs without seeking until release, then commits the release position', () => {
    render(<SeekBar target="local" />);
    const track = screen.getByTestId('np-seek');
    measureTrack(track, { left: 0, width: 200 });
    firePointer(track, 'pointerdown', 50);
    firePointer(track, 'pointermove', 100);
    expect(transport.seekAbs).not.toHaveBeenCalled();
    // Scrub preview reflects the drag, not the live position.
    expect(screen.getByTestId('np-seek-elapsed')).toHaveTextContent('2:00');
    firePointer(track, 'pointerup', 100);
    expect(transport.seekAbs).toHaveBeenCalledWith(120);
  });

  it('seeks with the keyboard: arrows nudge, Home/End jump', () => {
    render(<SeekBar target="local" />);
    const track = screen.getByTestId('np-seek');
    fireEvent.keyDown(track, { key: 'ArrowRight' });
    expect(transport.seekAbs).toHaveBeenCalledWith(65);
    fireEvent.keyDown(track, { key: 'ArrowLeft' });
    expect(transport.seekAbs).toHaveBeenCalledWith(55);
    fireEvent.keyDown(track, { key: 'Home' });
    expect(transport.seekAbs).toHaveBeenCalledWith(0);
    fireEvent.keyDown(track, { key: 'End' });
    expect(transport.seekAbs).toHaveBeenCalledWith(240);
  });

  it('shows a LIVE badge instead of a scrubber for live content', () => {
    state.snapshot = makeSnapshot({ isLive: true });
    state.capabilities = { seekable: false, acked: false };
    render(<SeekBar target="local" />);
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    expect(screen.queryByTestId('np-seek')).toBeNull();
  });

  it('renders nothing without a current item', () => {
    state.snapshot = { ...makeSnapshot(), currentItem: null };
    const { container } = render(<SeekBar target="local" />);
    expect(container.firstChild).toBeNull();
  });

  it('disables seeking when the item has no duration', () => {
    state.snapshot = makeSnapshot({ duration: null });
    render(<SeekBar target="local" />);
    const track = screen.getByTestId('np-seek');
    expect(track).toHaveAttribute('aria-disabled', 'true');
    measureTrack(track);
    firePointer(track, 'pointerdown', 100);
    firePointer(track, 'pointerup', 100);
    fireEvent.keyDown(track, { key: 'ArrowRight' });
    expect(transport.seekAbs).not.toHaveBeenCalled();
    expect(screen.getByTestId('np-seek-remaining')).toHaveTextContent('–:––');
  });
});
