import { act, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import FeedCard from './FeedCard.jsx';
import { FeedPlayerProvider } from '../../players/FeedPlayerContext.jsx';

function touch(identifier, x, y) {
  return { identifier, clientX: x, clientY: y };
}

function dispatchTouch(target, type, touches, changedTouches) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: touches });
  Object.defineProperty(event, 'changedTouches', { value: changedTouches });
  act(() => target.dispatchEvent(event));
}

it('advances only for a matching single-touch horizontal swipe', () => {
  const parentTouchStart = vi.fn();
  render(
    <div onTouchStart={parentTouchStart}>
      <FeedPlayerProvider>
        <FeedCard
          item={{
            id: 'gallery-item',
            title: 'Two photographs',
            source: 'test',
            image: 'https://example.test/first.jpg',
            meta: {
              galleryImages: [
                { url: 'https://example.test/first.jpg' },
                { url: 'https://example.test/second.jpg' },
              ],
            },
          }}
        />
      </FeedPlayerProvider>
    </div>,
  );

  const gallery = screen.getByRole('region', { name: 'Image gallery, 1 of 2' });
  const firstFinger = touch(1, 220, 100);
  dispatchTouch(gallery, 'touchstart', [firstFinger], [firstFinger]);
  dispatchTouch(gallery, 'touchend', [], [touch(1, 165, 300)]);

  expect(screen.getByRole('region', { name: 'Image gallery, 1 of 2' })).toBeInTheDocument();
  expect(parentTouchStart).not.toHaveBeenCalled();

  dispatchTouch(gallery, 'touchstart', [firstFinger], [firstFinger]);
  dispatchTouch(gallery, 'touchend', [], [touch(2, 165, 105)]);
  expect(screen.getByRole('region', { name: 'Image gallery, 1 of 2' })).toBeInTheDocument();

  dispatchTouch(gallery, 'touchstart', [firstFinger], [firstFinger]);
  dispatchTouch(gallery, 'touchcancel', [], [touch(1, 165, 105)]);
  dispatchTouch(gallery, 'touchend', [], [touch(1, 165, 105)]);
  expect(screen.getByRole('region', { name: 'Image gallery, 1 of 2' })).toBeInTheDocument();

  dispatchTouch(gallery, 'touchstart', [firstFinger], [firstFinger]);
  const secondFinger = touch(2, 130, 100);
  dispatchTouch(gallery, 'touchstart', [firstFinger, secondFinger], [secondFinger]);
  dispatchTouch(gallery, 'touchend', [firstFinger], [secondFinger]);
  expect(screen.getByRole('region', { name: 'Image gallery, 1 of 2' })).toBeInTheDocument();

  dispatchTouch(gallery, 'touchstart', [firstFinger], [firstFinger]);
  dispatchTouch(gallery, 'touchend', [], [touch(1, 165, 105)]);

  expect(screen.getByRole('region', { name: 'Image gallery, 2 of 2' })).toBeInTheDocument();
  expect(parentTouchStart).not.toHaveBeenCalled();
});
