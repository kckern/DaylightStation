/**
 * ShelfTile — one cover + one caption (design §3).
 *
 * What these pin: the cover is an image named by the title and falls back to
 * the launch card's calm placeholder (never an invented cover); the caption is
 * the mode's own number, formatted but never derived; a title that cannot
 * break still cannot escape the tile; the incompatible tag; the tap; and that
 * a finished tile shows the day, not a bar.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ShelfTile from './ShelfTile.jsx';

const PLACEHOLDER = 'school-selfservice-card__poster-placeholder';

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
  describe('the text column', () => {
    it('wraps title, author, bar and caption beside the art, never inside it', () => {
      const { container } = render(<ShelfTile item={item()} onSelect={() => {}} />);
      const text = container.querySelector('.school-books-tile__text');
      expect(text.querySelector('.school-books-tile__title')).not.toBeNull();
      expect(text.querySelector('.school-books-tile__author')).not.toBeNull();
      expect(text.querySelector('.school-books-tile__bar')).not.toBeNull();
      expect(text.querySelector('.school-books-tile__caption')).not.toBeNull();
      // The cover is the text column's SIBLING: they used to share one fixed
      // four-row grid, which is what sliced every second title line.
      expect(text.querySelector('.school-books-tile__cover')).toBeNull();
      expect(container.querySelector('.school-books-tile__art .school-books-tile__cover')).not.toBeNull();
    });
  });

  describe('the cover', () => {
    it('renders the cover image named by the title', () => {
      render(<ShelfTile item={item()} onSelect={() => {}} />);
      const img = screen.getByRole('img', { name: 'Cover of Hatchet' });
      expect(img).toHaveAttribute('src', '/covers/hatchet.jpg');
    });

    it('uses the launch card placeholder when there is no cover', () => {
      const { container } = render(<ShelfTile item={item({ coverUrl: null })} onSelect={() => {}} />);
      expect(container.querySelector(`.${PLACEHOLDER}`)).not.toBeNull();
      expect(container.querySelector('img')).toBeNull();
      expect(screen.getByRole('img', { name: 'No cover available for Hatchet' })).toBeInTheDocument();
    });

    it('falls back to the placeholder when the cover fails to load', () => {
      const { container } = render(<ShelfTile item={item()} onSelect={() => {}} />);
      fireEvent.error(screen.getByRole('img', { name: 'Cover of Hatchet' }));
      expect(container.querySelector(`.${PLACEHOLDER}`)).not.toBeNull();
      expect(container.querySelector('img')).toBeNull();
      expect(screen.getByRole('img', { name: 'No cover available for Hatchet' })).toBeInTheDocument();
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
      expect(screen.getByRole('img', { name: 'No cover available for Hatchet' })).toBeInTheDocument();
    });

    it('refuses a backslash path that a browser could normalize into a cross-origin URL', () => {
      const { container } = render(<ShelfTile item={item({ coverUrl: '/\\evil.example/cover.jpg' })} onSelect={() => {}} />);
      expect(container.querySelector('img')).toBeNull();
      expect(screen.getByRole('img', { name: 'No cover available for Hatchet' })).toBeInTheDocument();
    });
  });

  describe('captions per mode', () => {
    it('page: a bar at the percent and the page number', () => {
      render(<ShelfTile item={item()} onSelect={() => {}} />);
      expect(screen.getByText('p. 84')).toBeInTheDocument();
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '46');
    });

    it('page: "Just started" while no page is logged', () => {
      render(<ShelfTile item={item({}, { page: null, percent: 0 })} onSelect={() => {}} />);
      expect(screen.getByText('Just started')).toBeInTheDocument();
      expect(screen.queryByText(/^p\. /)).toBeNull();
    });

    it('page: no bar when the record had no page count', () => {
      render(<ShelfTile item={item({ pageCount: null }, { percent: null })} onSelect={() => {}} />);
      expect(screen.getByText('p. 84')).toBeInTheDocument();
      expect(screen.queryByRole('progressbar')).toBeNull();
    });

    it('minutes: hours and minutes formatted from the integer', () => {
      render(<ShelfTile item={item({ progressMode: 'minutes' }, { minutes: 200 })} onSelect={() => {}} />);
      expect(screen.getByText('3h 20m')).toBeInTheDocument();
      expect(screen.queryByRole('progressbar')).toBeNull();
    });

    it('minutes: under an hour is minutes alone', () => {
      render(<ShelfTile item={item({ progressMode: 'minutes' }, { minutes: 45 })} onSelect={() => {}} />);
      expect(screen.getByText('45m')).toBeInTheDocument();
    });

    it('check: the days read', () => {
      render(<ShelfTile item={item({ progressMode: 'check' }, { daysRead: 12 })} onSelect={() => {}} />);
      expect(screen.getByText('read on 12 days')).toBeInTheDocument();
      expect(screen.queryByRole('progressbar')).toBeNull();
    });

    it('check: one day is singular', () => {
      render(<ShelfTile item={item({ progressMode: 'check' }, { daysRead: 1 })} onSelect={() => {}} />);
      expect(screen.getByText('read on 1 day')).toBeInTheDocument();
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

  it('clamps a title that cannot break', () => {
    const title = 'Supercalifragilisticexpialidociousness'.padEnd(40, 'x');
    expect(title).toHaveLength(40);
    expect(title).not.toMatch(/\s/);
    render(<ShelfTile item={item({ title })} onSelect={() => {}} />);
    const el = screen.getByText(title);
    expect(el).toHaveClass('school-books-tile__title');
  });

  it('reports its itemId on tap', () => {
    const onSelect = vi.fn();
    render(<ShelfTile item={item()} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Hatchet/ }));
    expect(onSelect).toHaveBeenCalledWith('kid:9780064400558:e0');
  });

  describe('on history', () => {
    // NO DATE ON A DONE CARD: the history shelf's day heading carries it, and
    // a card wearing the same date as the line above it said it twice.
    it('a finished tile shows neither a bar nor a date — the day heading owns the date', () => {
      const { container } = render(<ShelfTile item={item({}, { status: 'finished', page: 195, percent: 100, lastAt: '2026-07-14T21:00:00Z' })} />);
      expect(screen.queryByRole('progressbar')).toBeNull();
      expect(screen.queryByText(/^p\. /)).toBeNull();
      expect(screen.queryByText('Jul 14')).toBeNull();
      expect(container.querySelector('.school-books-tile__caption')).toBeNull();
      expect(container.querySelector('.school-books-tile')).toHaveClass('school-books-tile--history');
    });

    it('a set-aside tile names that outcome, without a date', () => {
      render(<ShelfTile item={item({}, { status: 'set-aside', lastAt: '2026-06-02' })} />);
      expect(screen.getByText('Set aside')).toBeInTheDocument();
      expect(screen.queryByText(/Jun 2/)).toBeNull();
    });

    it('the finished prop wins over a reading status', () => {
      const { container } = render(<ShelfTile item={item({}, { lastAt: '2026-07-14' })} finished />);
      expect(screen.queryByRole('progressbar')).toBeNull();
      expect(container.querySelector('.school-books-tile__mark')).toHaveClass('is-finished');
    });

    it('marks a finished book with the green check, not another sentence', () => {
      const { container } = render(<ShelfTile item={item({}, { status: 'finished', lastAt: '2026-07-14' })} />);
      const mark = container.querySelector('.school-books-tile__mark');
      expect(mark).toHaveClass('is-finished');
      expect(mark).toHaveAttribute('aria-label', 'Finished');
      expect(screen.queryByText(/^Finished/)).toBeNull();
    });

    it('marks a set-aside book differently, and keeps its word', () => {
      const { container } = render(<ShelfTile item={item({}, { status: 'set-aside', lastAt: '2026-06-02' })} />);
      expect(container.querySelector('.school-books-tile__mark')).toHaveClass('is-set-aside');
      expect(screen.getByText('Set aside')).toBeInTheDocument();
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
