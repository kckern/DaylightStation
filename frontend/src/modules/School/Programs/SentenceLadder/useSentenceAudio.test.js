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
