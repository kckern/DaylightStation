import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ImageFrame } from './ImageFrame.jsx';

vi.mock('../../../../../frontend/src/lib/logging/Logger.js', () => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), child: () => logger };
  return { default: () => logger };
});

const slide = (url) => ({ id: 'photo:1', mediaUrl: url, slideshow: { duration: 1, effect: 'none' } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('ignores pending image load and error callbacks after the slideshow stops', () => {
  const advance = vi.fn();
  const { container, unmount } = render(<ImageFrame media={slide('/old.png')} advance={advance} />);
  const image = container.querySelector('img[src="/old.png"]');
  const load = image.onload;
  const error = image.onerror;
  unmount();

  load.call(image);
  error.call(image);
  vi.advanceTimersByTime(1000);
  expect(advance).not.toHaveBeenCalled();
  expect(requestAnimationFrame).not.toHaveBeenCalled();
});

it('lets only the replacement image start the slide when its URL changes under the same id', () => {
  const advance = vi.fn();
  const { container, rerender } = render(<ImageFrame media={slide('/old.png')} advance={advance} />);
  const oldImage = container.querySelector('img[src="/old.png"]');
  const oldLoad = oldImage.onload;
  const oldError = oldImage.onerror;
  rerender(<ImageFrame media={slide('/new.png')} advance={advance} />);
  oldLoad.call(oldImage);
  oldError.call(oldImage);
  expect(requestAnimationFrame).not.toHaveBeenCalled();
  expect(advance).not.toHaveBeenCalled();

  const nextImage = container.querySelector('img[src="/new.png"]');
  act(() => nextImage.dispatchEvent(new Event('load')));
  expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(1000));
  expect(advance).toHaveBeenCalledTimes(1);
});

it('releases metadata timers and the pending original upgrade after a thumbnail has loaded', () => {
  const upgrades = [];
  vi.stubGlobal('Image', class {
    constructor() { upgrades.push(this); }
  });
  const media = {
    mediaUrl: '/original.png', thumbnail: '/thumb.png',
    slideshow: { duration: 5, showMetadata: true, effect: 'none' },
  };
  const { container, unmount } = render(<ImageFrame media={media} advance={vi.fn()} />);
  const thumbnail = container.querySelector('img[src="/thumb.png"]');
  act(() => thumbnail.dispatchEvent(new Event('load')));
  expect(upgrades).toHaveLength(1);
  const lateUpgrade = upgrades[0].onload;
  expect(lateUpgrade).toEqual(expect.any(Function));
  unmount();

  expect(vi.getTimerCount()).toBe(0);
  expect(upgrades[0].onload).toBeNull();
  lateUpgrade();
  expect(thumbnail.getAttribute('src')).toBe('/thumb.png');
});
