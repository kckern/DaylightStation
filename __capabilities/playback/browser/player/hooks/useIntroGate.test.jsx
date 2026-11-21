import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIntroGate } from './useIntroGate.js';
import { isIntroCovering, setIntroCovering } from '../../player-support/introCover.js';

vi.mock('../../../../../frontend/src/lib/logging/Logger.js', () => {
  const stub = {
    debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
    child: () => stub,
  };
  return { getLogger: () => stub, default: () => stub };
});

/** A video element that is still loading (paused, no frame). */
function fakeVideo({ currentTime = 0 } = {}) {
  const el = new EventTarget();
  el.currentTime = currentTime;
  el.paused = true;
  el.readyState = 0;
  el.pause = vi.fn(() => { el.paused = true; });
  el.play = vi.fn(() => { el.paused = false; return Promise.resolve(); });
  el.fire = (type) => el.dispatchEvent(new Event(type));
  /** The player starts playback: first frame. */
  el.start = () => { el.paused = false; el.readyState = 4; el.fire('playing'); };
  return el;
}

const HOLD = 7500;
const READY = { status: 'ready', minHoldMs: HOLD, render: () => null };
const PENDING = { status: 'pending', minHoldMs: HOLD, render: () => null };

function setup(props = {}) {
  const el = props.el || fakeVideo();
  const box = { el };
  const hook = renderHook((p) => useIntroGate({
    getMediaEl: () => box.el, resetKey: 'a', ...p,
  }), { initialProps: props });
  return { el, box, ...hook };
}

describe('useIntroGate', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { setIntroCovering(false); vi.useRealTimers(); });

  it('is off with no intro or status none; waiting while pending', () => {
    expect(setup({ intro: null }).result.current).toBe('off');
    expect(setup({ intro: { status: 'none', minHoldMs: HOLD } }).result.current).toBe('off');
    const { result } = setup({ intro: PENDING });
    expect(result.current).toBe('waiting');
    // Pending holds the spinner back briefly (INTRO_WAIT_COVER_MS), then lets it show.
    expect(isIntroCovering()).toBe(true);
    act(() => { vi.advanceTimersByTime(1500); });
    expect(isIntroCovering()).toBe(false);
  });

  it('covers immediately when the intro is ready', () => {
    const { result } = setup({ intro: READY });
    expect(result.current).toBe('covering');
    expect(isIntroCovering()).toBe(true);
  });

  it('holds an early first frame paused until the minimum hold, then plays', () => {
    const { el, result } = setup({ intro: READY });
    act(() => { vi.advanceTimersByTime(1000); el.start(); });
    expect(el.pause).toHaveBeenCalledTimes(1);
    expect(result.current).toBe('holding');
    expect(isIntroCovering()).toBe(true);
    act(() => { vi.advanceTimersByTime(HOLD - 1000); });
    expect(el.play).toHaveBeenCalledTimes(1);
    expect(result.current).toBe('holding');
    act(() => { el.fire('playing'); });
    expect(result.current).toBe('playing');
    expect(isIntroCovering()).toBe(false);
  });

  it('keeps covering a slow video past the hold, then plays without pausing', () => {
    const { el, result } = setup({ intro: READY });
    act(() => { vi.advanceTimersByTime(HOLD + 3000); });
    expect(result.current).toBe('covering');
    act(() => { el.start(); });
    expect(result.current).toBe('playing');
    expect(el.pause).not.toHaveBeenCalled();
    expect(isIntroCovering()).toBe(false);
  });

  it('falls back to playing when a resumed video never reports playing', () => {
    const { el, result } = setup({ intro: READY });
    act(() => { vi.advanceTimersByTime(500); el.start(); });
    expect(result.current).toBe('holding');
    act(() => { vi.advanceTimersByTime(HOLD - 500); });
    expect(result.current).toBe('holding');
    act(() => { vi.advanceTimersByTime(2499); });
    expect(result.current).toBe('holding');
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe('playing');
    expect(isIntroCovering()).toBe(false);
  });

  it('never covers a requested resume', () => {
    const { result } = setup({ intro: READY, startSec: 600 });
    expect(result.current).toBe('off');
    expect(isIntroCovering()).toBe(false);
  });

  it('steps aside when the first frame is far into the title', () => {
    const el = fakeVideo({ currentTime: 900 });
    const { result } = setup({ intro: READY, el });
    act(() => { el.start(); });
    expect(result.current).toBe('off');
    expect(el.pause).not.toHaveBeenCalled();
    expect(isIntroCovering()).toBe(false);
  });

  it('is off when the intro becomes ready after the film is rolling', () => {
    const el = fakeVideo();
    const { result, rerender } = setup({ intro: PENDING, el });
    act(() => { el.currentTime = 3; el.start(); });
    expect(result.current).toBe('waiting');
    rerender({ intro: READY, el });
    expect(result.current).toBe('off');
    expect(isIntroCovering()).toBe(false);
    expect(el.pause).not.toHaveBeenCalled();
  });

  it('binds to an element that is already playing near the top as a first frame', () => {
    const el = fakeVideo({ currentTime: 0.2 });
    el.paused = false; el.readyState = 4;
    const { result } = setup({ intro: READY, el });
    expect(result.current).toBe('holding');
    expect(el.pause).toHaveBeenCalledTimes(1);
  });

  it('starts over on a resetKey change', () => {
    const el = fakeVideo();
    const { result, rerender } = setup({ intro: READY, el });
    act(() => { el.start(); });
    expect(result.current).toBe('holding');
    el.play.mockClear();
    rerender({ intro: PENDING, el, resetKey: 'b' });
    expect(el.play).toHaveBeenCalledTimes(1);
    expect(result.current).toBe('waiting');
    expect(isIntroCovering()).toBe(true); // the new title's pending intro holds the spinner back briefly
  });

  it('resumes a held element and drops the cover on unmount', () => {
    const { el, result, unmount } = setup({ intro: READY });
    act(() => { el.start(); });
    expect(result.current).toBe('holding');
    unmount();
    expect(el.play).toHaveBeenCalledTimes(1);
    expect(isIntroCovering()).toBe(false);
  });

  it('follows a replaced element', () => {
    const first = fakeVideo();
    const { box, result, rerender } = setup({ intro: READY, el: first });
    const second = fakeVideo();
    box.el = second;
    rerender({ intro: READY });
    act(() => { first.start(); });
    expect(result.current).toBe('covering');
    expect(first.pause).not.toHaveBeenCalled();
    act(() => { second.start(); });
    expect(result.current).toBe('holding');
    expect(second.pause).toHaveBeenCalledTimes(1);
  });

  it('does not re-cover once playing', () => {
    const { el, result, rerender } = setup({ intro: READY });
    act(() => { vi.advanceTimersByTime(HOLD); el.start(); });
    expect(result.current).toBe('playing');
    rerender({ intro: PENDING });
    expect(result.current).toBe('playing');
    rerender({ intro: { ...READY } });
    expect(result.current).toBe('playing');
    expect(isIntroCovering()).toBe(false);
  });

  it('logs a refused resume without throwing', async () => {
    const el = fakeVideo();
    el.play = vi.fn(() => Promise.reject(new Error('NotAllowedError')));
    const { result } = setup({ intro: READY, el });
    act(() => { el.start(); });
    await act(async () => { vi.advanceTimersByTime(HOLD); });
    expect(el.play).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(2500); });
    expect(result.current).toBe('playing');
  });

  it('holds the spinner back while a pending intro decides, for at most INTRO_WAIT_COVER_MS', async () => {
    const { INTRO_WAIT_COVER_MS } = await import('./useIntroGate.js');
    const el = fakeVideoForWait();
    const { result } = renderHook((p) => useIntroGate({ getMediaEl: () => el, resetKey: 'k', ...p }), {
      initialProps: { intro: { status: 'pending', minHoldMs: 7500, render: () => null } },
    });
    expect(result.current).toBe('waiting');
    expect(isIntroCovering()).toBe(true);
    act(() => { vi.advanceTimersByTime(INTRO_WAIT_COVER_MS); });
    expect(isIntroCovering()).toBe(false);
  });

  it('releases the spinner at once when the pending intro turns out to be none', () => {
    const el = fakeVideoForWait();
    const { rerender } = renderHook((p) => useIntroGate({ getMediaEl: () => el, resetKey: 'k', ...p }), {
      initialProps: { intro: { status: 'pending', minHoldMs: 7500, render: () => null } },
    });
    expect(isIntroCovering()).toBe(true);
    rerender({ intro: { status: 'none', minHoldMs: 0, render: () => null } });
    expect(isIntroCovering()).toBe(false);
  });
});

function fakeVideoForWait() {
  const el = new EventTarget();
  Object.assign(el, { currentTime: 0, paused: true, readyState: 0, pause: vi.fn(), play: vi.fn(() => Promise.resolve()) });
  return el;
}
