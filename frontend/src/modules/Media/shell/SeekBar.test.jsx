import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';

const transport = { seekAbs: vi.fn() };
const state = {
  controller: {},
  transport,
  snapshot: null,
  capabilities: { seekable: true, live: false, reason: null, acked: false },
  position: { seconds: 60, ts: 0 },
};
vi.mock('../controller/useSessionController.js', () => ({
  useSessionController: () => ({
    controller: state.controller,
    snapshot: state.snapshot,
    transport: state.transport,
    capabilities: state.capabilities,
  }),
}));
vi.mock('../controller/usePlaybackPosition.js', () => ({
  usePlaybackPosition: () => state.position,
}));

import { SeekBar } from './SeekBar.jsx';
import { formatTime } from './formatTime.js';

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
  state.capabilities = { seekable: true, live: false, reason: null, acked: false };
  state.position = { seconds: 60, ts: 0 };
  state.controller = {};
  state.transport = transport;
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

  it('commits against the press geometry when its elapsed label reflows before pointer release', () => {
    render(<SeekBar target="local" />);
    const track = screen.getByTestId('np-seek');
    // A short elapsed label initially leaves a 200px track at x=0. Updating
    // the preview to a long time label can move its left edge to x=10 and
    // shrink it to 180px before the browser emits pointerup. The press at
    // x=120 is 60% of the original track, so it must commit 144s, not 147s.
    const rects = [
      { left: 0, width: 200, right: 200, top: 0, bottom: 8, height: 8, x: 0, y: 0 },
      { left: 10, width: 180, right: 190, top: 0, bottom: 8, height: 8, x: 10, y: 0 },
    ];
    track.getBoundingClientRect = () => rects.shift() ?? rects.at(-1);

    firePointer(track, 'pointerdown', 120);
    firePointer(track, 'pointerup', 120);

    expect(transport.seekAbs).toHaveBeenCalledWith(144);
  });

  it('cancels an active pointer gesture without committing its preview', () => {
    render(<SeekBar target="local" />);
    const track = screen.getByTestId('np-seek');
    measureTrack(track);

    firePointer(track, 'pointerdown', 100);
    firePointer(track, 'pointercancel', 100);
    firePointer(track, 'pointerup', 100);

    expect(transport.seekAbs).not.toHaveBeenCalled();
    expect(screen.getByTestId('np-seek-elapsed')).toHaveTextContent('1:00');
  });

  it('does not start a pointer seek from a zero-width track or non-finite coordinate', () => {
    render(<SeekBar target="local" />);
    const track = screen.getByTestId('np-seek');
    measureTrack(track, { width: 0 });
    firePointer(track, 'pointerdown', 100);
    firePointer(track, 'pointerup', 100);

    measureTrack(track);
    const nonFiniteDown = new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperty(nonFiniteDown, 'clientX', { value: Number.NaN });
    fireEvent(track, nonFiniteDown);
    firePointer(track, 'pointerup', 100);

    expect(transport.seekAbs).not.toHaveBeenCalled();
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

  it('cancels a remote drag when availability becomes false before pointer release', () => {
    const target = { deviceId: 'tv-1' };
    const { rerender } = render(<SeekBar target={target} availability={{ available: true }} />);
    const track = screen.getByTestId('np-seek');
    measureTrack(track);

    firePointer(track, 'pointerdown', 100);
    rerender(<SeekBar target={target} availability={{ available: false, reason: 'This device is offline' }} />);
    firePointer(track, 'pointerup', 100);
    fireEvent.keyDown(track, { key: 'ArrowRight' });

    expect(track).toHaveAttribute('aria-disabled', 'true');
    expect(transport.seekAbs).not.toHaveBeenCalled();
    expect(screen.getByTestId('np-seek-elapsed')).toHaveTextContent('1:00');
  });

  it.each(['target', 'content', 'queue visit', 'controller', 'target ABA'])('cancels a drag across a changed %s', change => {
    state.snapshot.queue = { items: [{ queueItemId: 'visit-a', contentId: 'plex:100' }], currentIndex: 0 };
    const { rerender } = render(<SeekBar target={{ deviceId: 'screen-a' }} />);
    const track = screen.getByTestId('np-seek');
    measureTrack(track);
    firePointer(track, 'pointerdown', 100);
    expect(screen.getByTestId('np-seek-elapsed')).toHaveTextContent('2:00');
    let deviceId = 'screen-a';
    if (change.startsWith('target')) deviceId = 'screen-b';
    if (change === 'content') state.snapshot = { ...state.snapshot, currentItem: { ...state.snapshot.currentItem, contentId: 'plex:200' } };
    if (change === 'queue visit') state.snapshot = { ...state.snapshot, queue: { items: [{ queueItemId: 'visit-b', contentId: 'plex:100' }], currentIndex: 0 } };
    if (change === 'controller') state.controller = {};
    const replacementSeek = vi.fn();
    state.transport = { seekAbs: replacementSeek };
    rerender(<SeekBar target={{ deviceId }} />);
    if (change === 'target ABA') rerender(<SeekBar target={{ deviceId: 'screen-a' }} />);
    firePointer(track, 'pointerup', 100);
    expect(transport.seekAbs).not.toHaveBeenCalled();
    expect(replacementSeek).not.toHaveBeenCalled();
    expect(screen.getByTestId('np-seek-elapsed')).toHaveTextContent('1:00');
  });

  it('preserves a drag through same-item metadata and progress updates', () => {
    const { rerender } = render(<SeekBar target={{ deviceId: 'screen-a' }} />);
    const track = screen.getByTestId('np-seek');
    measureTrack(track);
    firePointer(track, 'pointerdown', 100);
    state.snapshot = { ...state.snapshot, currentItem: { ...state.snapshot.currentItem, title: 'Enriched title' } };
    state.position = { seconds: 61, ts: 1 };
    rerender(<SeekBar target={{ deviceId: 'screen-a' }} />);
    firePointer(track, 'pointerup', 100);
    expect(transport.seekAbs).toHaveBeenCalledExactlyOnceWith(120);
  });

  it('does not apply a held gesture to a replacement native node before React rerenders', () => {
    let node = document.createElement('video');
    state.controller = { getMediaElement: () => node };
    render(<SeekBar target="local" />);
    const track = screen.getByTestId('np-seek');
    measureTrack(track);
    firePointer(track, 'pointerdown', 100);
    node = document.createElement('video');
    firePointer(track, 'pointerup', 100);
    expect(transport.seekAbs).not.toHaveBeenCalled();
  });

  it('cancels rather than remapping a press when the timeline duration changes', () => {
    const { rerender } = render(<SeekBar target="local" />);
    const track = screen.getByTestId('np-seek');
    measureTrack(track);
    firePointer(track, 'pointerdown', 100);
    state.snapshot = makeSnapshot({ duration: 600 });
    rerender(<SeekBar target="local" />);
    firePointer(track, 'pointerup', 100);
    expect(transport.seekAbs).not.toHaveBeenCalled();
  });

  it('does not show a rejected seek from an old playback context', async () => {
    let reject;
    state.transport = { seekAbs: vi.fn(() => new Promise((_, fail) => { reject = fail; })) };
    const { rerender } = render(<SeekBar target={{ deviceId: 'screen-a' }} />);
    const track = screen.getByTestId('np-seek');
    measureTrack(track);
    firePointer(track, 'pointerdown', 100);
    firePointer(track, 'pointerup', 100);

    state.snapshot = { ...state.snapshot, currentItem: { ...state.snapshot.currentItem, contentId: 'plex:replacement' } };
    rerender(<SeekBar target={{ deviceId: 'screen-a' }} />);
    await act(async () => {
      reject(new Error('old ack timeout'));
      await Promise.resolve();
    });
    expect(screen.queryByTestId('np-seek-command-feedback')).toBeNull();
  });

  it('clears an already-visible seek failure when playback context changes', async () => {
    state.transport = { seekAbs: vi.fn(() => Promise.reject(new Error('ack timeout'))) };
    const { rerender } = render(<SeekBar target={{ deviceId: 'screen-a' }} />);
    const track = screen.getByTestId('np-seek');
    measureTrack(track);
    firePointer(track, 'pointerdown', 100);
    firePointer(track, 'pointerup', 100);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('np-seek-command-feedback')).toHaveTextContent('Could not confirm change');

    state.snapshot = { ...state.snapshot, currentItem: { ...state.snapshot.currentItem, contentId: 'plex:replacement' } };
    rerender(<SeekBar target={{ deviceId: 'screen-a' }} />);
    expect(screen.queryByTestId('np-seek-command-feedback')).toBeNull();
  });

  it('shows a LIVE badge instead of a scrubber for live content', () => {
    state.snapshot = makeSnapshot({ isLive: true });
    state.capabilities = {
      seekable: false, live: true, reason: 'Live playback has no seekable position', acked: false,
    };
    render(<SeekBar target="local" />);
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    expect(screen.queryByTestId('np-seek')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Live playback has no seekable position');
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

  it('renders an unknown-duration slider as disabled, not as LIVE', () => {
    state.snapshot = makeSnapshot({ duration: null, isLive: false });
    state.capabilities = {
      seekable: false, live: false, reason: 'Playback duration is unavailable', acked: false,
    };
    render(<SeekBar target="local" />);
    expect(screen.getByTestId('np-seek')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByText('LIVE')).toBeNull();
  });

  it('normalizes a non-finite duration to an unknown disabled range', () => {
    state.snapshot = makeSnapshot({ duration: Number.POSITIVE_INFINITY, isLive: false });
    state.capabilities = {
      seekable: false, live: false, reason: 'Playback duration is unavailable', acked: false,
    };
    render(<SeekBar target="local" />);
    expect(screen.getByTestId('np-seek')).toHaveAttribute('aria-valuemax', '0');
    expect(screen.getByTestId('np-seek')).toHaveAttribute('aria-disabled', 'true');
  });
});
