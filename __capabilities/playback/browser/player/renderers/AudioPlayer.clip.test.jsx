import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioPlayer } from './AudioPlayer.jsx';
import { useCommonMediaController } from '../hooks/useCommonMediaController.js';
import { DaylightAPI } from '../../../../../frontend/src/lib/api.mjs';

vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn().mockResolvedValue({}) }));

beforeEach(() => {
  vi.useFakeTimers();
  DaylightAPI.mockClear();
  useCommonMediaController.__appliedStartByKey = Object.create(null);
  useCommonMediaController.__lastPosByKey = Object.create(null);
  useCommonMediaController.__lastSeekByKey = Object.create(null);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mountClip(image) {
  const advance = vi.fn();
  const progress = vi.fn();
  const media = { id: 'files:audio-clip', assetId: 'files:audio-clip',
    title: 'Audio clip', mediaUrl: '/clip.mp3', mediaType: 'audio', format: 'audio',
    seconds: 10, duration: 100, segment: { start: 10, end: 20 } };
  const clear = () => {};
  const player = coverImage => <AudioPlayer media={{ ...media, image: coverImage }}
    advance={advance} clear={clear} onProgress={progress} />;
  const view = render(player(image));
  const node = view.container.querySelector('audio');
  Object.defineProperties(node, {
    currentTime: { configurable: true, writable: true, value: 10 },
    duration: { configurable: true, value: 100 },
    readyState: { configurable: true, value: 4 },
    paused: { configurable: true, value: false },
    ended: { configurable: true, writable: true, value: false },
  });
  act(() => { node.dispatchEvent(new Event('durationchange')); node.dispatchEvent(new Event('loadedmetadata')); });
  return { ...view, node, advance, progress, setCoverImage: image => view.rerender(player(image)) };
}
const tick = (node, seconds) => act(() => {
  node.currentTime = seconds;
  node.dispatchEvent(new Event('timeupdate'));
});
const playLogs = () => DaylightAPI.mock.calls.filter(([path]) => path === 'api/v1/play/log').map(([, body]) => body);

describe('excluded audio clip through AudioPlayer and common controller', () => {
  it('publishes clip-relative 50 percent, logs native position 15, and completes once at clip end 20', () => {
    const { node, progress, advance } = mountClip();
    tick(node, 15);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ currentTime: 5, duration: 10,
      contentSeconds: 15, nativeSeconds: 15, percent: '50.0' }));
    expect(playLogs().at(-1)).toMatchObject({ seconds: 15, percent: '15.0' });
    expect(advance).not.toHaveBeenCalled();
    tick(node, 20);
    expect(advance).toHaveBeenCalledTimes(1);
    tick(node, 20);
    act(() => { node.ended = true; node.dispatchEvent(new Event('ended')); });
    expect(advance).toHaveBeenCalledTimes(1);
  });
  it('saves an interrupted audio clip at its native position and full-file percentage', () => {
    const { node, unmount } = mountClip();
    tick(node, 15);
    DaylightAPI.mockClear();
    unmount();
    expect(playLogs()).toEqual([expect.objectContaining({ seconds: 15, percent: '15.0' })]);
  });
});

function loadArtwork(cover, naturalSize) {
  Object.defineProperties(cover, {
    complete: { configurable: true, value: true },
    currentSrc: { configurable: true, value: cover.src },
    naturalWidth: { configurable: true, value: naturalSize },
    naturalHeight: { configurable: true, value: naturalSize },
  });
  vi.spyOn(cover, 'getBoundingClientRect').mockReturnValue({ width: 300, height: 300 });
  act(() => cover.dispatchEvent(new Event('load')));
}

describe('AudioPlayer cover artwork', () => {
  it('measures load and resize for the currently attached cover', () => {
    const observations = new Map();
    vi.stubGlobal('ResizeObserver', class {
      constructor(onResize) {
        this.onResize = onResize;
      }
      observe(cover) {
        this.cover = cover;
        observations.set(cover, this.onResize);
      }
      disconnect() {
        observations.delete(this.cover);
      }
    });

    const { container, setCoverImage } = mountClip();
    expect(container.querySelector('img.cover')).toBeNull();

    setCoverImage('/cover.jpg');
    const firstCover = container.querySelector('img.cover');
    loadArtwork(firstCover, 100);
    expect(firstCover.style.filter).toBe('blur(1.00px)');
    const firstResize = observations.get(firstCover);
    expect(firstResize).toBeTypeOf('function');

    firstCover.getBoundingClientRect.mockReturnValue({ width: 200, height: 200 });
    act(() => firstResize());
    expect(firstCover.style.filter).toBe('blur(0.50px)');

    setCoverImage(undefined);
    expect(container.querySelector('img.cover')).toBeNull();
    expect(observations.has(firstCover)).toBe(false);

    setCoverImage('/cover.jpg');
    const nextCover = container.querySelector('img.cover');
    expect(nextCover.style.filter).toBe('');
    loadArtwork(nextCover, 150);
    expect(nextCover.style.filter).toBe('blur(0.50px)');
    act(() => firstResize());
    expect(nextCover.style.filter).toBe('blur(0.50px)');
  });

  it('clears an old cover measurement while the same image element loads a new source', () => {
    const { container, setCoverImage } = mountClip('/small.jpg');
    const cover = container.querySelector('img.cover');
    loadArtwork(cover, 100);
    expect(cover.style.filter).toBe('blur(1.00px)');

    // The element can still report the prior completed request as its current image.
    setCoverImage('/larger.jpg');
    expect(container.querySelector('img.cover')).toBe(cover);
    expect(cover.style.filter).toBe('');

    loadArtwork(cover, 150);
    expect(cover.style.filter).toBe('blur(0.50px)');
  });
});
