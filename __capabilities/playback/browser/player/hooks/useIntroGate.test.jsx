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

  it('counts the hold from an early cover (SinglePlayer showed the scene first)', () => {
    vi.setSystemTime(new Date('2026-11-21T12:00:10Z'));
    const coverStartedAt = Date.parse('2026-11-21T12:00:08Z'); // 2 s of early cover
    const { el, result } = setup({ intro: READY, coverStartedAt });
    act(() => { el.start(); });
    expect(result.current).toBe('holding');
    act(() => { vi.advanceTimersByTime(HOLD - 2000 - 1); });
    expect(el.play).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(el.play).toHaveBeenCalled();
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

  it('never covers a recovery remount (startSec Infinity), even while the intro is pending', () => {
    expect(setup({ intro: READY, startSec: Infinity }).result.current).toBe('off');
    const { result } = setup({ intro: PENDING, startSec: Infinity });
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
    expect(result.current).toBe('off'); // the film is rolling: the gate lets go at once (late)
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

  it('drops the cover on unmount but never resumes the element it leaves behind', () => {
    const { el, result, unmount } = setup({ intro: READY });
    act(() => { el.start(); });
    expect(result.current).toBe('holding');
    unmount();
    expect(el.play).not.toHaveBeenCalled();
    expect(isIntroCovering()).toBe(false);
  });

  it('does not resume a held element that is no longer in the document on reset', () => {
    const el = fakeVideo();
    const { result, rerender } = setup({ intro: READY, el });
    act(() => { el.start(); });
    expect(result.current).toBe('holding');
    el.isConnected = false;
    rerender({ intro: PENDING, el, resetKey: 'b' });
    expect(el.play).not.toHaveBeenCalled();
  });

  it('keeps the cover up across a reset from one covering title to another', () => {
    const { result, rerender } = setup({ intro: READY });
    expect(result.current).toBe('covering');
    expect(isIntroCovering()).toBe(true);
    rerender({ intro: { ...READY }, resetKey: 'b' });
    expect(result.current).toBe('covering');
    expect(isIntroCovering()).toBe(true);
  });

  it('gives up covering a video that never produces a frame', async () => {
    const { INTRO_COVER_CEILING_MS } = await import('./useIntroGate.js');
    expect(INTRO_COVER_CEILING_MS).toBe(20000);
    const { result } = setup({ intro: READY });
    act(() => { vi.advanceTimersByTime(HOLD + INTRO_COVER_CEILING_MS - 1); });
    expect(result.current).toBe('covering');
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe('off');
    expect(isIntroCovering()).toBe(false);
  });

  it('does not apply the cover ceiling to a held video', async () => {
    const { INTRO_COVER_CEILING_MS } = await import('./useIntroGate.js');
    const { el, result } = setup({ intro: READY });
    act(() => { el.start(); });
    expect(result.current).toBe('holding');
    el.play = vi.fn(() => new Promise(() => {})); // resume never settles; the play timeout ends it
    act(() => { vi.advanceTimersByTime(HOLD + INTRO_COVER_CEILING_MS); });
    expect(result.current).toBe('playing');
  });

  it('goes off when the film rolls past INTRO_LATE_SEC while the intro is still pending', () => {
    const el = fakeVideo();
    const { result, rerender } = setup({ intro: PENDING, el });
    act(() => { el.start(); });
    expect(result.current).toBe('waiting'); // first frame near the top: still in time
    act(() => { el.currentTime = 1.5; el.fire('timeupdate'); });
    expect(result.current).toBe('off');
    expect(isIntroCovering()).toBe(false);
    rerender({ intro: READY, el });
    expect(result.current).toBe('off');
    expect(el.pause).not.toHaveBeenCalled();
  });

  it('goes off on a late first frame while waiting', () => {
    const el = fakeVideo({ currentTime: 2 });
    const { result } = setup({ intro: PENDING, el });
    act(() => { el.start(); });
    expect(result.current).toBe('off');
  });

  it('still covers when the answer arrives before the film has rolled INTRO_LATE_SEC', () => {
    const el = fakeVideo();
    const { result, rerender } = setup({ intro: PENDING, el });
    act(() => { el.start(); el.currentTime = 0.5; el.fire('timeupdate'); });
    expect(result.current).toBe('waiting');
    rerender({ intro: READY, el });
    expect(result.current).toBe('holding');
    expect(el.pause).toHaveBeenCalledTimes(1);
  });

  it('tags its hold pause and resume so they are not read as the viewer', () => {
    const el = fakeVideo();
    const seen = [];
    el.pause = vi.fn(() => { seen.push(['pause', el.__pauseSource]); el.paused = true; });
    el.play = vi.fn(() => { seen.push(['play', el.__playSource]); el.paused = false; return Promise.resolve(); });
    setup({ intro: READY, el });
    act(() => { el.start(); });
    act(() => { vi.advanceTimersByTime(HOLD); });
    expect(seen).toEqual([['pause', 'intro-hold'], ['play', 'intro-hold']]);
  });

  it('stops listening to the element once the gate is done', () => {
    const el = fakeVideo();
    const remove = vi.spyOn(el, 'removeEventListener');
    const { result } = setup({ intro: READY, el });
    act(() => { vi.advanceTimersByTime(HOLD); el.start(); });
    expect(result.current).toBe('playing');
    expect(remove).toHaveBeenCalledWith('playing', expect.any(Function));
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

describe('useIntroGate: resume after a long absence, and restart', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { setIntroCovering(false); vi.useRealTimers(); });
  const seek = (el, t) => { el.seeking = true; el.currentTime = t; el.fire('seeking'); el.seeking = false; el.fire('seeked'); };
  const watchTo = (el, t) => { el.currentTime = t; el.fire('timeupdate'); };

  it('covers a resume the intro allows, and holds the frame at the resume point', () => {
    const el = fakeVideo();
    const { result } = setup({ el, intro: { ...READY, resumeOk: true }, startSec: 5520 });
    expect(result.current).toBe('covering');
    el.currentTime = 5520;
    act(() => { el.start(); });
    expect(result.current).toBe('holding');
    expect(el.pause).toHaveBeenCalled();
  });

  it('stays off for a resume the intro does not allow, and on a recovery remount', () => {
    expect(setup({ intro: READY, startSec: 5520 }).result.current).toBe('off');
    expect(setup({ intro: { ...READY, resumeOk: true }, startSec: Infinity }).result.current).toBe('off');
  });

  it('replays the intro when a title it stayed off for is sent back to the top', () => {
    const el = fakeVideo();
    el.seeking = false;
    const onReplay = vi.fn();
    const { result } = setup({ el, intro: READY, startSec: 5520, onReplay });
    expect(result.current).toBe('off');
    act(() => { el.paused = false; el.readyState = 4; watchTo(el, 5600); });
    act(() => { seek(el, 0); });
    expect(onReplay).toHaveBeenCalledWith(1);
    expect(result.current).toBe('holding'); // the playing element is held at the top
    expect(el.pause).toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(HOLD); });
    expect(el.play).toHaveBeenCalled();
  });

  it('does not replay for a short scrub back, or a seek to the top from early on', () => {
    const el = fakeVideo();
    el.seeking = false;
    const onReplay = vi.fn();
    setup({ el, intro: READY, startSec: 5520, onReplay });
    act(() => { watchTo(el, 30); seek(el, 0); });
    act(() => { watchTo(el, 200); seek(el, 150); });
    expect(onReplay).not.toHaveBeenCalled();
  });

  it('does not replay after a stream that never produced a frame', () => {
    const el = fakeVideo();
    el.seeking = false;
    const onReplay = vi.fn();
    const { result } = setup({ el, intro: READY, onReplay });
    act(() => { vi.advanceTimersByTime(HOLD + 20000); });
    expect(result.current).toBe('off');
    act(() => { watchTo(el, 600); seek(el, 0); });
    expect(onReplay).not.toHaveBeenCalled();
  });
});
