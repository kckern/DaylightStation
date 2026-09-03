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
  describe('the cover', () => {
    it('renders the cover image named by the title', () => {
      render(<ShelfTile item={item()} onSelect={() => {}} />);
      const img = screen.getByRole('img', { name: 'Hatchet' });
      expect(img).toHaveAttribute('src', '/covers/hatchet.jpg');
    });

    it('uses the launch card placeholder when there is no cover', () => {
      const { container } = render(<ShelfTile item={item({ coverUrl: null })} onSelect={() => {}} />);
      expect(container.querySelector(`.${PLACEHOLDER}`)).not.toBeNull();
      expect(container.querySelector('img')).toBeNull();
    });

    it('falls back to the placeholder when the cover fails to load', () => {
      const { container } = render(<ShelfTile item={item()} onSelect={() => {}} />);
      fireEvent.error(screen.getByRole('img', { name: 'Hatchet' }));
      expect(container.querySelector(`.${PLACEHOLDER}`)).not.toBeNull();
      expect(container.querySelector('img')).toBeNull();
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
    it('a finished tile shows the day instead of a bar', () => {
      render(<ShelfTile item={item({}, { status: 'finished', page: 195, percent: 100, lastAt: '2026-07-14T21:00:00Z' })} />);
      expect(screen.queryByRole('progressbar')).toBeNull();
      expect(screen.queryByText(/^p\. /)).toBeNull();
      expect(screen.getByText('Finished Jul 14')).toBeInTheDocument();
    });

    it('a set-aside tile names that outcome', () => {
      render(<ShelfTile item={item({}, { status: 'set-aside', lastAt: '2026-06-02' })} />);
      expect(screen.getByText('Set aside Jun 2')).toBeInTheDocument();
    });

    it('the finished prop wins over a reading status', () => {
      render(<ShelfTile item={item({}, { lastAt: '2026-07-14' })} finished />);
      expect(screen.queryByRole('progressbar')).toBeNull();
      expect(screen.getByText('Finished Jul 14')).toBeInTheDocument();
    });

    it('is not a button when nothing can be tapped', () => {
      render(<ShelfTile item={item({}, { status: 'finished', lastAt: '2026-07-14' })} />);
      expect(screen.queryByRole('button')).toBeNull();
    });
  });
});
