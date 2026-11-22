import { act, fireEvent, render, screen } from '@testing-library/react';
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

it('restores gallery focus when arrow-key navigation removes the focused boundary arrow', () => {
  render(
    <FeedPlayerProvider>
      <FeedCard
        item={{
          id: 'keyboard-gallery-item',
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
    </FeedPlayerProvider>,
  );

  const firstGallery = screen.getByRole('region', { name: 'Image gallery, 1 of 2' });
  const next = screen.getByRole('button', { name: 'Next image' });
  next.focus();
  fireEvent.keyDown(next, { key: 'ArrowRight' });

  const lastGallery = screen.getByRole('region', { name: 'Image gallery, 2 of 2' });
  expect(document.activeElement).toBe(lastGallery);

  const previous = screen.getByRole('button', { name: 'Previous image' });
  previous.focus();
  fireEvent.keyDown(previous, { key: 'ArrowLeft' });

  const returnedGallery = screen.getByRole('region', { name: 'Image gallery, 1 of 2' });
  expect(returnedGallery).toBe(firstGallery);
  expect(document.activeElement).toBe(returnedGallery);
});

it('does not steal focus from another gallery when a swipe removes its arrow', () => {
  const item = id => ({
    id,
    title: 'Two photographs',
    source: 'test',
    image: 'https://example.test/first.jpg',
    meta: {
      galleryImages: [
        { url: 'https://example.test/first.jpg' },
        { url: 'https://example.test/second.jpg' },
      ],
    },
  });
  render(
    <FeedPlayerProvider>
      <><FeedCard item={item('gallery-a')} /><FeedCard item={item('gallery-b')} /></>
    </FeedPlayerProvider>,
  );

  const galleryA = screen.getAllByRole('region', { name: 'Image gallery, 1 of 2' })[0];
  const galleryB = screen.getAllByRole('region', { name: 'Image gallery, 1 of 2' })[1];
  const focusedArrow = galleryA.querySelector('[aria-label="Next image"]');
  focusedArrow.focus();
  const finger = touch(1, 220, 100);
  dispatchTouch(galleryB, 'touchstart', [finger], [finger]);
  dispatchTouch(galleryB, 'touchend', [], [touch(1, 160, 100)]);

  expect(screen.getByRole('region', { name: 'Image gallery, 2 of 2' })).toBe(galleryB);
  expect(document.activeElement).toBe(focusedArrow);
});
