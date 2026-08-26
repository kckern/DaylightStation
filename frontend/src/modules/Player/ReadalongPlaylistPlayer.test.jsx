// Behavior tests for the read-along playlist shell (jsdom).
//
// HONESTY NOTE: jsdom cannot see layout. Nothing here proves the stage has
// height or that verse text is visible — that geometry is covered by the
// Playwright fixture (tests/_infrastructure/harnesses/readalong-layout/) and
// by looking at the real tablet. These tests cover the shell's behavior:
// chapter chips, transport, progress plumbing, auto-resume, completion writes.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ReadalongPlaylistPlayer from './ReadalongPlaylistPlayer.jsx';

const h = vi.hoisted(() => ({
  seek: vi.fn(),
  toggle: vi.fn(),
  lastProps: null,
}));

vi.mock('./Player.jsx', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  const MockPlayer = forwardRef((props, ref) => {
    h.lastProps = props;
    useImperativeHandle(ref, () => ({
      seek: h.seek,
      toggle: h.toggle,
      play: vi.fn(),
      pause: vi.fn(),
      getCurrentTime: () => 42,
      getDuration: () => 149,
      getMediaElement: () => null,
    }));
    return <div data-testid="mock-player" data-content-id={props.play?.contentId} />;
  });
  return { default: MockPlayer };
});

vi.mock('../../lib/logging/Logger.js', () => {
  const noop = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  noop.child = () => noop;
  return { getLogger: () => noop, default: () => noop };
});

const PARTS = [
  { id: 'p1', title: 'Psalms 49', contentId: 'readalong:scripture/ps-49' },
  { id: 'p2', title: 'Psalms 50', contentId: 'readalong:scripture/ps-50' },
  { id: 'p3', title: 'Psalms 51', contentId: 'readalong:scripture/ps-51' },
  { id: 'p4', title: 'Psalms 61', contentId: 'readalong:scripture/ps-61' },
];

const emitProgress = (payload) => act(() => { h.lastProps.onProgress(payload); });

beforeEach(() => {
  h.seek.mockClear();
  h.toggle.mockClear();
  h.lastProps = null;
});

describe('ReadalongPlaylistPlayer', () => {
  it('renders one chip per chapter — the merged picker/progress rail — with the current chip inert', async () => {
    render(<ReadalongPlaylistPlayer title="Psalms" parts={PARTS} />);
    await screen.findByTestId('mock-player');
    const chips = PARTS.map((p) => screen.getByRole('button', { name: `Play ${p.title}` }));
    expect(chips).toHaveLength(4);
    expect(chips[0]).toBeDisabled();
    expect(chips[1]).toBeEnabled();
    // The old triple representation is gone: no separate segment bars row.
    expect(document.querySelector('.readalong-playlist__segments')).toBeNull();
    expect(document.querySelector('.readalong-playlist__picker')).toBeNull();
    // Transport: Previous disabled on the first chapter.
    expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Next/ })).toBeEnabled();
  });

  it('reflects playback progress in the current chip fill and the play/pause control', async () => {
    render(<ReadalongPlaylistPlayer title="Psalms" parts={PARTS} />);
    await screen.findByTestId('mock-player');
    emitProgress({ currentTime: 30, duration: 120, paused: false });
    const fill = document.querySelector('.readalong-playlist__chapter.is-current .readalong-playlist__chapter-fill i');
    expect(fill.style.width).toBe('25%');
    expect(screen.getByRole('button', { name: /Pause/ })).toBeInTheDocument();
    emitProgress({ currentTime: 31, duration: 120, paused: true });
    expect(screen.getByRole('button', { name: /^Play$/ })).toBeInTheDocument();
  });

  it('auto-resumes a part with a meaningful saved position, exactly once', async () => {
    render(
      <ReadalongPlaylistPlayer
        title="Psalms" parts={PARTS}
        progress={{ parts: { p1: { lastPositionSeconds: 60 } } }}
      />
    );
    await screen.findByTestId('mock-player');
    emitProgress({ currentTime: 0, duration: 149, paused: false });
    expect(h.seek).toHaveBeenCalledWith(60);
    emitProgress({ currentTime: 0.5, duration: 149, paused: false });
    expect(h.seek).toHaveBeenCalledTimes(1);
  });

  it('does not auto-resume a position at the very start or end', async () => {
    render(
      <ReadalongPlaylistPlayer
        title="Psalms" parts={PARTS}
        progress={{ parts: { p1: { lastPositionSeconds: 145 } } }}
      />
    );
    await screen.findByTestId('mock-player');
    emitProgress({ currentTime: 0, duration: 149, paused: false });
    expect(h.seek).not.toHaveBeenCalled();
  });

  it('chapter tap switches the mounted part and writes progress for the departed one', async () => {
    const onProgress = vi.fn();
    render(<ReadalongPlaylistPlayer title="Psalms" parts={PARTS} onProgress={onProgress} />);
    await screen.findByTestId('mock-player');
    emitProgress({ currentTime: 30, duration: 120, paused: false });
    fireEvent.click(screen.getByRole('button', { name: 'Play Psalms 50' }));
    const player = await screen.findByTestId('mock-player');
    expect(player.dataset.contentId).toBe('readalong:scripture/ps-50');
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ partId: 'p1', positionSeconds: 30, completed: false })
    );
  });

  it('a finished final part writes completed:true and stays put', async () => {
    const onProgress = vi.fn();
    render(<ReadalongPlaylistPlayer title="Psalms" parts={PARTS.slice(0, 1)} onProgress={onProgress} />);
    await screen.findByTestId('mock-player');
    emitProgress({ currentTime: 120, duration: 120, paused: true });
    act(() => { h.lastProps.clear(); });
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ partId: 'p1', completed: true })
    );
    expect(screen.getByRole('button', { name: /Play again/ })).toBeInTheDocument();
  });

  it('transport buttons drive the player controller', async () => {
    render(<ReadalongPlaylistPlayer title="Psalms" parts={PARTS} />);
    await screen.findByTestId('mock-player');
    fireEvent.click(screen.getByRole('button', { name: /^Play$/ }));
    expect(h.toggle).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Back 15s/ }));
    expect(h.seek).toHaveBeenCalledWith(27); // 42 - 15
    fireEvent.click(screen.getByRole('button', { name: /Ahead 15s/ }));
    expect(h.seek).toHaveBeenCalledWith(57); // 42 + 15
  });

  it('renders the empty state with a way back when there are no parts', () => {
    const onExit = vi.fn();
    render(<ReadalongPlaylistPlayer title="Psalms" parts={[]} onExit={onExit} />);
    expect(screen.getByText('No audio is available for this reading.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(onExit).toHaveBeenCalled();
  });
});
