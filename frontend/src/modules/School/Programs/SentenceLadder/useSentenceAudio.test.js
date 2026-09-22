import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('./languageLog.js', () => ({
  languageLog: { audio: vi.fn(), audioError: vi.fn(), rung: vi.fn() },
}));

import { useSentenceAudio } from './useSentenceAudio.js';

// jsdom's <audio> never fires `ended` on its own; the test ends each clip by
// hand so the timing under test is the hook's, not the media element's.
let elements;
beforeEach(() => {
  vi.useFakeTimers();
  elements = [];
  window.HTMLMediaElement.prototype.play = vi.fn(function play() {
    elements.push(this);
    return Promise.resolve();
  });
  window.HTMLMediaElement.prototype.pause = vi.fn();
  window.HTMLMediaElement.prototype.load = vi.fn();
});
afterEach(() => vi.useRealTimers());

const endCurrentClip = () => act(() => { elements.at(-1).onended?.(); });
const playCount = () => window.HTMLMediaElement.prototype.play.mock.calls.length;

describe('useSentenceAudio loop', () => {
  it('waits LOOP_GAP_MS before repeating a single-clip prompt', () => {
    const { result } = renderHook(() => useSentenceAudio());
    act(() => result.current.playSequence([{ url: '/a.mp3' }], { loop: true }));
    expect(playCount()).toBe(1);

    endCurrentClip();
    // Back-to-back would already be at 2 here. It must wait.
    expect(playCount()).toBe(1);
    act(() => vi.advanceTimersByTime(result.current.LOOP_GAP_MS - 1));
    expect(playCount()).toBe(1);
    act(() => vi.advanceTimersByTime(1));
    expect(playCount()).toBe(2);
  });

  it('keeps clips inside one pass gapless and pauses only at the wrap', () => {
    const { result } = renderHook(() => useSentenceAudio());
    act(() => result.current.playSequence([{ url: '/src.mp3' }, { url: '/tgt.mp3' }], { loop: true }));
    endCurrentClip();
    expect(playCount()).toBe(2);
    endCurrentClip();
    expect(playCount()).toBe(2);
    act(() => vi.advanceTimersByTime(result.current.LOOP_GAP_MS));
    expect(playCount()).toBe(3);
    expect(elements.at(-1).src).toContain('/src.mp3');
  });

  it('stop() during the wrap pause cancels the restart', () => {
    const { result } = renderHook(() => useSentenceAudio());
    act(() => result.current.playSequence([{ url: '/a.mp3' }], { loop: true }));
    endCurrentClip();
    act(() => result.current.stop());
    act(() => vi.advanceTimersByTime(result.current.LOOP_GAP_MS * 2));
    expect(playCount()).toBe(1);
  });

  it('does not pause a non-looping sequence at its end', () => {
    const onSequenceEnd = vi.fn();
    const { result } = renderHook(() => useSentenceAudio({ onSequenceEnd }));
    act(() => result.current.playSequence([{ url: '/a.mp3' }]));
    endCurrentClip();
    expect(onSequenceEnd).toHaveBeenCalledTimes(1);
    expect(playCount()).toBe(1);
  });
});

describe('spans and position (recording in pieces)', () => {
  let original;
  beforeEach(() => {
    original = Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, 'currentTime');
    Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', {
      configurable: true, get() { return this._t ?? 0; }, set(v) { this._t = v; },
    });
  });
  afterEach(() => {
    if (original) Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', original);
    else delete window.HTMLMediaElement.prototype.currentTime;
  });

  it('starts a clip at startMs', () => {
    const { result } = renderHook(() => useSentenceAudio());
    act(() => result.current.playSequence([{ url: '/kr.mp3', startMs: 1100 }]));
    expect(elements.at(-1).currentTime).toBeCloseTo(1.1);
  });

  it('ends a clip at endMs and moves on to the next step', async () => {
    const onSequenceEnd = vi.fn();
    const { result } = renderHook(() => useSentenceAudio({ onSequenceEnd }));
    act(() => result.current.playSequence([{ url: '/kr.mp3', startMs: 1000, endMs: 1600 }, { url: '/cue.mp3' }]));
    await act(async () => {});           // let play() resolve
    act(() => vi.advanceTimersByTime(599));
    expect(playCount()).toBe(1);
    act(() => vi.advanceTimersByTime(1));
    expect(playCount()).toBe(2);
    expect(elements.at(-1).src).toContain('/cue.mp3');
  });

  it('a clip that ends on its own does not also fire its span timer', async () => {
    const { result } = renderHook(() => useSentenceAudio());
    act(() => result.current.playSequence([{ url: '/kr.mp3', endMs: 600 }, { url: '/cue.mp3' }, { url: '/b.mp3' }]));
    await act(async () => {});
    endCurrentClip();                    // natural end → cue
    act(() => vi.advanceTimersByTime(1000));
    expect(playCount()).toBe(2);         // the stale timer did not skip the cue
  });

  it('an `ended` after the span timer stopped the clip does not skip the next step', async () => {
    // A span ending at the file's end: the browser can still fire `ended`
    // after the timer paused the element and moved on.
    const { result } = renderHook(() => useSentenceAudio());
    act(() => result.current.playSequence([
      { url: '/kr.mp3', endMs: 600 }, { url: '/cue.mp3', gapMs: 1000 }, { url: '/b.mp3' },
    ]));
    await act(async () => {});
    const staleEnded = elements.at(-1).onended;
    act(() => vi.advanceTimersByTime(600));   // span ends; cue waits on its gap
    act(() => { elements.at(-1).onended?.(); staleEnded?.(); });
    expect(playCount()).toBe(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(playCount()).toBe(2);
    expect(elements.at(-1).src).toContain('/cue.mp3');
  });

  it('arms no span timer when play() is rejected', async () => {
    window.HTMLMediaElement.prototype.play = vi.fn(function play() {
      elements.push(this);
      return Promise.reject(new Error('NotAllowedError'));
    });
    const { result } = renderHook(() => useSentenceAudio());
    act(() => result.current.playSequence([{ url: '/kr.mp3', endMs: 600 }, { url: '/cue.mp3' }]));
    await act(async () => {});
    expect(result.current.blocked).toBe(true);
    expect(result.current.playing).toBe(false);
    act(() => vi.advanceTimersByTime(1000));
    expect(playCount()).toBe(1);
    expect(result.current.position()).toBeNull();
  });

  it('stop() cancels a pending span end', async () => {
    const { result } = renderHook(() => useSentenceAudio());
    act(() => result.current.playSequence([{ url: '/kr.mp3', endMs: 600 }, { url: '/cue.mp3' }]));
    await act(async () => {});
    act(() => result.current.stop());
    act(() => vi.advanceTimersByTime(1000));
    expect(playCount()).toBe(1);
  });

  it('reports the playing clip and how far into it playback is', () => {
    const { result } = renderHook(() => useSentenceAudio());
    expect(result.current.position()).toBeNull();
    act(() => result.current.playSequence([{ url: '/kr.mp3', language: 'KR' }]));
    elements.at(-1).currentTime = 1.35;
    expect(result.current.position()).toEqual({ language: 'KR', role: undefined, ms: 1350 });
    act(() => result.current.stop());
    expect(result.current.position()).toBeNull();
  });

  it('reports no position once a sequence has ended', () => {
    const { result } = renderHook(() => useSentenceAudio());
    act(() => result.current.playSequence([{ url: '/kr.mp3', language: 'KR' }]));
    endCurrentClip();
    expect(result.current.position()).toBeNull();
  });
});
