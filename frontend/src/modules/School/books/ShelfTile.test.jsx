/**
 * ShelfTile — THE COVER IS THE CARD.
 *
 * What these pin: the tile is its art and nothing else, so the title survives
 * only where it cannot cost layout (the accessible name and the tooltip); a
 * book with no art gets a DRAWN cover rather than a blank placeholder, because
 * on a shelf of covers a blank is the one book a child cannot find; progress
 * rides on the art; a finished book is marked, not captioned; and the tap.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ShelfTile from './ShelfTile.jsx';

const DRAWN = 'school-books-cover--drawn';

const item = (overrides = {}, projection = {}) => ({
  itemId: 'kid:9780064400558:e0',
  bookId: '9780064400558',
  progressMode: 'page',
  pageCount: 195,
  openedAt: '2026-08-20',
  events: [],
  title: 'Hatchet',
  authors: ['Gary Paulsen'],
  coverUrl: '/covers/hatchet.jpg',
  ...overrides,
  projection: {
    status: 'reading', page: 84, percent: 46, minutes: 0, daysRead: 2, lastAt: '2026-08-25T10:00:00Z',
    ...projection,
  },
});

describe('ShelfTile', () => {
  describe('the cover is the card', () => {
    it('draws the art and no text column at all', () => {
      const { container } = render(<ShelfTile item={item()} onSelect={() => {}} />);
      // The title used to sit under the art in up to three wrapped lines. On a
      // shelf of picture books that was a grid mostly made of words.
      expect(container.querySelector('.school-books-tile__text')).toBeNull();
      expect(container.querySelector('.school-books-tile__title')).toBeNull();
      expect(container.querySelector('.school-books-tile__caption')).toBeNull();
      expect(container.querySelector('.school-books-tile__art .school-books-tile__cover')).not.toBeNull();
    });

    it('keeps the title as the accessible name and the tooltip, so nothing is lost', () => {
      // Removing the words from the layout must not remove them from the page:
      // a screen reader and a hovering mouse both still get the title.
      render(<ShelfTile item={item()} onSelect={() => {}} />);
      const tile = screen.getByRole('button', { name: 'Open Hatchet' });
      expect(tile).toHaveAttribute('title', 'Hatchet');
    });

    it('names a still tile too, when there is nothing to tap', () => {
      const { container } = render(<ShelfTile item={item({}, { status: 'finished' })} />);
      expect(container.querySelector('.school-books-tile')).toHaveAttribute('title', 'Hatchet');
    });

    it('a title that cannot break costs the tile no layout, because it is not in it', () => {
      const title = 'Supercalifragilisticexpialidociousness'.padEnd(40, 'x');
      expect(title).not.toMatch(/\s/);
      render(<ShelfTile item={item({ title })} onSelect={() => {}} />);
      expect(screen.getByRole('button', { name: `Open ${title}` })).toHaveAttribute('title', title);
    });
  });

  describe('the cover', () => {
    it('renders the cover image named by the title', () => {
      render(<ShelfTile item={item()} onSelect={() => {}} />);
      const img = screen.getByRole('img', { name: 'Cover of Hatchet' });
      expect(img).toHaveAttribute('src', '/covers/hatchet.jpg');
    });

    it('DRAWS a cover from the title when there is no art', () => {
      // The calm placeholder was adequate while every card carried its title
      // underneath. Now that the cover IS the card, a placeholder is a card
      // with no identity — so the title becomes the cover instead.
      const { container } = render(<ShelfTile item={item({ coverUrl: null })} onSelect={() => {}} />);
      expect(container.querySelector('img')).toBeNull();
      const drawn = container.querySelector(`.${DRAWN}`);
      expect(drawn).not.toBeNull();
      expect(drawn).toHaveAttribute('aria-label', 'Hatchet (no cover art)');
      expect(drawn).toHaveTextContent('Hatchet');
    });

    it('gives the same book the same colour every time, so the colour identifies it', () => {
      // The hue is derived from the title, not randomised: that is the whole
      // point — two coverless books beside each other must be told apart, and
      // the same book must not change colour between renders.
      const one = render(<ShelfTile item={item({ coverUrl: null })} onSelect={() => {}} />);
      const two = render(<ShelfTile item={item({ coverUrl: null })} onSelect={() => {}} />);
      const hue = (r) => r.container.querySelector(`.${DRAWN}`).style.getPropertyValue('--drawn-hue');
      expect(hue(one)).toBe(hue(two));
      expect(hue(one)).not.toBe('');

      const other = render(<ShelfTile item={item({ title: 'Frog and Toad', coverUrl: null })} onSelect={() => {}} />);
      expect(hue(other)).not.toBe(hue(one));
    });

    it('falls back to the drawn cover when the art fails to load', () => {
      const { container } = render(<ShelfTile item={item()} onSelect={() => {}} />);
      fireEvent.error(screen.getByRole('img', { name: 'Cover of Hatchet' }));
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector(`.${DRAWN}`)).not.toBeNull();
    });

    it('retries when a shelf refresh supplies a different cover URL', () => {
      const { rerender } = render(<ShelfTile item={item()} onSelect={() => {}} />);
      fireEvent.error(screen.getByRole('img', { name: 'Cover of Hatchet' }));
      rerender(<ShelfTile item={item({ coverUrl: '/covers/hatchet-2.jpg' })} onSelect={() => {}} />);
      expect(screen.getByRole('img', { name: 'Cover of Hatchet' })).toHaveAttribute('src', '/covers/hatchet-2.jpg');
    });

    it('refuses an active or opaque cover URL from provider data', () => {
      const { container } = render(<ShelfTile item={item({ coverUrl: 'javascript:alert(1)' })} onSelect={() => {}} />);
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector(`.${DRAWN}`)).not.toBeNull();
    });

    it('refuses a backslash path that a browser could normalize into a cross-origin URL', () => {
      const { container } = render(<ShelfTile item={item({ coverUrl: '/\\evil.example/cover.jpg' })} onSelect={() => {}} />);
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector(`.${DRAWN}`)).not.toBeNull();
    });
  });

  describe('progress rides on the art', () => {
    it('page mode: a bar across the foot of the cover, at the percent', () => {
      const { container } = render(<ShelfTile item={item()} onSelect={() => {}} />);
      const bar = screen.getByRole('progressbar');
      expect(bar).toHaveAttribute('aria-valuenow', '46');
      expect(bar).toHaveAttribute('aria-label', '46% read');
      // ON the art, not beneath it — there is no beneath any more.
      expect(container.querySelector('.school-books-tile__art .school-books-tile__bar')).not.toBeNull();
    });

    it('no bar when the record had no page count to measure against', () => {
      render(<ShelfTile item={item({ pageCount: null }, { percent: null })} onSelect={() => {}} />);
      expect(screen.queryByRole('progressbar')).toBeNull();
    });

    it('no bar for the modes that have no end to be partway to', () => {
      // Minutes and check-ins count up; neither has a total, so neither has a
      // percentage, and a bar would be inventing one.
      for (const progressMode of ['minutes', 'check']) {
        const { unmount } = render(<ShelfTile item={item({ progressMode })} onSelect={() => {}} />);
        expect(screen.queryByRole('progressbar')).toBeNull();
        unmount();
      }
    });

    it('no numbers anywhere on the card — those live in the panel a tap opens', () => {
      render(<ShelfTile item={item()} onSelect={() => {}} />);
      expect(screen.queryByText(/^p\. /)).toBeNull();
      expect(screen.queryByText('Just started')).toBeNull();
    });
  });

  it('says when the book does not count toward the metric', () => {
    render(<ShelfTile item={item({ progressMode: 'check' })} incompatibleMetric="pages" onSelect={() => {}} />);
    expect(screen.getByText("doesn't count toward pages")).toBeInTheDocument();
  });

  it('spells the check-in metric the way the obligation line does', () => {
    render(<ShelfTile item={item({ progressMode: 'page' })} incompatibleMetric="checkins" onSelect={() => {}} />);
    expect(screen.getByText("doesn't count toward check-ins")).toBeInTheDocument();
  });

  it('carries no tag when the book counts', () => {
    render(<ShelfTile item={item()} onSelect={() => {}} />);
    expect(screen.queryByText(/doesn't count/)).toBeNull();
  });

  it('reports its itemId on tap', () => {
    const onSelect = vi.fn();
    render(<ShelfTile item={item()} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Hatchet/ }));
    expect(onSelect).toHaveBeenCalledWith('kid:9780064400558:e0');
  });

  describe('on history', () => {
    // NO DATE AND NO WORDS ON A DONE CARD: the day's spine beside it carries
    // the date, and the mark on the art carries the outcome.
    it('a finished tile shows neither a bar nor a date', () => {
      const { container } = render(<ShelfTile item={item({}, { status: 'finished', page: 195, percent: 100, lastAt: '2026-07-14T21:00:00Z' })} />);
      expect(screen.queryByRole('progressbar')).toBeNull();
      expect(screen.queryByText('Jul 14')).toBeNull();
      expect(container.querySelector('.school-books-tile')).toHaveClass('school-books-tile--history');
    });

    it('marks a finished book with the green check, not a sentence', () => {
      const { container } = render(<ShelfTile item={item({}, { status: 'finished', lastAt: '2026-07-14' })} />);
      const mark = container.querySelector('.school-books-tile__mark');
      expect(mark).toHaveClass('is-finished');
      expect(mark).toHaveAttribute('aria-label', 'Finished');
      expect(screen.queryByText(/^Finished/)).toBeNull();
    });

    it('marks a set-aside book differently, and says so only to a reader', () => {
      // The bookmark is a shape a child still has to learn, so the word stays
      // — as the mark's accessible name, which costs the cover no room.
      const { container } = render(<ShelfTile item={item({}, { status: 'set-aside', lastAt: '2026-06-02' })} />);
      const mark = container.querySelector('.school-books-tile__mark');
      expect(mark).toHaveClass('is-set-aside');
      expect(mark).toHaveAttribute('aria-label', 'Set aside');
      expect(screen.queryByText(/Jun 2/)).toBeNull();
    });

    it('the finished prop wins over a reading status', () => {
      const { container } = render(<ShelfTile item={item({}, { lastAt: '2026-07-14' })} finished />);
      expect(screen.queryByRole('progressbar')).toBeNull();
      expect(container.querySelector('.school-books-tile__mark')).toHaveClass('is-finished');
    });

    it('wears a count instead of repeating the same book down the day', () => {
      render(<ShelfTile item={item({}, { status: 'finished' })} history times={3} />);
      expect(screen.getByLabelText('3 times')).toHaveTextContent('×3');
    });

    it('a book still being read carries no outcome mark at all', () => {
      const { container } = render(<ShelfTile item={item()} onSelect={() => {}} />);
      expect(container.querySelector('.school-books-tile__mark')).toBeNull();
    });

    it('is not a button when nothing can be tapped', () => {
      render(<ShelfTile item={item({}, { status: 'finished', lastAt: '2026-07-14' })} />);
      expect(screen.queryByRole('button')).toBeNull();
    });
  });
});
