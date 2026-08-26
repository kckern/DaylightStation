// ContentScroller onProgress bridge (jsdom).
//
// HONESTY NOTE: jsdom cannot see layout — nothing here proves the scroller
// renders at a useful height. This covers only the media-event → onProgress
// plumbing that shell components (ReadalongPlaylistPlayer) depend on.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, act } from '@testing-library/react';
import ContentScroller from './ContentScroller.jsx';

vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn(() => Promise.resolve({})) }));

beforeAll(() => {
  // jsdom media elements implement neither play nor pause.
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true, writable: true, value: vi.fn(() => Promise.resolve()),
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true, writable: true, value: vi.fn(),
  });
});

const renderScroller = (onProgress) => render(
  <ContentScroller
    type="scriptures"
    title="Psalms 49"
    mainMediaUrl="/media/ps49.mp3"
    contentData={{ type: 'verses', data: [{ verse: 1, text: 'Hear this' }] }}
    parseContent={() => <div className="scripture-text"><p>Hear this</p></div>}
    onProgress={onProgress}
  />
);

describe('ContentScroller onProgress bridge', () => {
  it('emits currentTime/duration/paused/percent on media timeupdate', () => {
    const onProgress = vi.fn();
    const { container } = renderScroller(onProgress);
    const audio = container.querySelector('audio');
    expect(audio).toBeTruthy();
    Object.defineProperty(audio, 'duration', { configurable: true, value: 100 });
    audio.currentTime = 25;
    act(() => { audio.dispatchEvent(new Event('timeupdate')); });
    expect(onProgress).toHaveBeenCalledWith({
      currentTime: 25, duration: 100, paused: true, percent: 25,
    });
  });

  it('emits on play and pause so shells can mirror the paused state', () => {
    const onProgress = vi.fn();
    const { container } = renderScroller(onProgress);
    const audio = container.querySelector('audio');
    Object.defineProperty(audio, 'duration', { configurable: true, value: 100 });
    Object.defineProperty(audio, 'paused', { configurable: true, value: false });
    act(() => { audio.dispatchEvent(new Event('play')); });
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ paused: false }));
    Object.defineProperty(audio, 'paused', { configurable: true, value: true });
    act(() => { audio.dispatchEvent(new Event('pause')); });
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ paused: true }));
  });

  it('reports a zero duration as 0, never NaN', () => {
    const onProgress = vi.fn();
    const { container } = renderScroller(onProgress);
    const audio = container.querySelector('audio');
    act(() => { audio.dispatchEvent(new Event('timeupdate')); });
    const payload = onProgress.mock.calls.at(-1)[0];
    expect(payload.duration).toBe(0);
    expect(payload.percent).toBe(0);
    expect(Number.isNaN(payload.currentTime)).toBe(false);
  });

  it('stays silent when no onProgress is provided (every other surface)', () => {
    const { container } = renderScroller(undefined);
    const audio = container.querySelector('audio');
    expect(() => act(() => { audio.dispatchEvent(new Event('timeupdate')); })).not.toThrow();
  });
});
