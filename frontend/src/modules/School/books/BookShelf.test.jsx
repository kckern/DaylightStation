/**
 * BookShelf — the screen SchoolApp mounts for `program: 'book-log'` (design
 * §2–§3), and History, the hidden view behind `history ›`.
 *
 * The hook is mocked and driven by hand: these tests pin what each `view`
 * paints, which action each tappable calls, that the obligation line keys on
 * `obligation` (not the label) and carries the window word, and that
 * finished books live on History grouped by month.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

const h = vi.hoisted(() => ({ hook: vi.fn() }));

vi.mock('./useBookShelf.js', () => ({
  useBookShelf: (...args) => h.hook(...args),
  default: (...args) => h.hook(...args),
}));

import BookShelf, { localDayKey } from './BookShelf.jsx';

const actions = () => ({
  noteActivity: vi.fn(), done: vi.fn(), retry: vi.fn(), openHistory: vi.fn(), back: vi.fn(),
  startAdd: vi.fn(), openItem: vi.fn(), openDuplicate: vi.fn(),
});

const item = (id, overrides = {}, projection = {}) => ({
  itemId: `kid:${id}:e0`, bookId: id, progressMode: 'page', pageCount: 195, openedAt: '2026-08-20',
  events: [], title: `Book ${id}`, authors: [], coverUrl: null,
  ...overrides,
  projection: { status: 'reading', page: 84, percent: 43, minutes: 0, daysRead: 2, lastAt: '2026-08-25T10:00:00Z', ...projection },
});

const HATCHET = item('hatchet', { title: 'Hatchet', coverUrl: '/c/h.jpg' });
const FROG = item('frog', { title: 'Frog and Toad', progressMode: 'check' }, { daysRead: 12, lastAt: '2026-08-24T10:00:00Z' });
const DONE_JULY = item('july', { title: 'Finished in July' }, { status: 'finished', lastAt: '2026-07-14T21:00:00Z' });
const DONE_AUG = item('aug', { title: 'Finished in August' }, { status: 'finished', lastAt: '2026-08-02T21:00:00Z' });
const ASIDE_JULY = item('aside', { title: 'Set aside in July' }, { status: 'set-aside', lastAt: '2026-07-20T21:00:00Z' });
const UNREAD = item('unread', { title: 'Not yet opened' }, { status: 'unread', page: null, percent: 0, lastAt: '2026-08-23T10:00:00Z' });

function arm(state) {
  const a = actions();
  h.hook.mockReturnValue({
    view: 'shelf', step: null, error: null, busy: false, current: null,
    learner: { id: 'kid', name: 'Alpha' },
    shelf: { learnerId: 'kid', items: [HATCHET, FROG], obligation: null },
    add: {}, update: {},
    ...state,
    actions: a,
  });
  return a;
}

function mount(props = {}) {
  return render(<BookShelf learnerId="kid" grant="g1" idleTimeoutSeconds={90} onExit={() => {}} {...props} />);
}

beforeEach(() => { h.hook.mockReset(); });

describe('BookShelf', () => {
  it('hands the hook exactly what it was mounted with', () => {
    const onExit = () => {};
    arm({ view: 'loading', shelf: null });
    mount({ onExit });
    expect(h.hook).toHaveBeenCalledWith({ learnerId: 'kid', grant: 'g1', idleTimeoutSeconds: 90, onExit });
  });

  it('loading: a calm line, no tiles', () => {
    arm({ view: 'loading', shelf: null });
    mount();
    expect(screen.getByText(/getting your shelf/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add a book/i })).toBeNull();
  });

  it('closed: renders nothing', () => {
    arm({ view: 'closed', shelf: null });
    const { container } = mount();
    expect(container.firstChild).toBeNull();
  });

  describe('the shelf', () => {
    it('one tile per reading/unread item, then + Add a book last', () => {
      arm({ shelf: { learnerId: 'kid', items: [HATCHET, DONE_JULY, FROG, UNREAD], obligation: null } });
      mount();
      const grid = screen.getByTestId('book-shelf-grid');
      const tiles = within(grid).getAllByRole('button');
      expect(tiles.map((t) => t.textContent)).toEqual([
        expect.stringContaining('Hatchet'),
        expect.stringContaining('Frog and Toad'),
        expect.stringContaining('Not yet opened'),
        expect.stringContaining('Add a book'),
      ]);
      expect(within(grid).queryByText('Finished in July')).toBeNull();
    });

    it('keeps the hook order — no re-sort', () => {
      arm({ shelf: { learnerId: 'kid', items: [FROG, HATCHET], obligation: null } });
      mount();
      const tiles = within(screen.getByTestId('book-shelf-grid')).getAllByRole('button');
      expect(tiles[0]).toHaveTextContent('Frog and Toad');
      expect(tiles[1]).toHaveTextContent('Hatchet');
    });

    it('empty: the + tile alone, captioned for the first book', () => {
      arm({ shelf: { learnerId: 'kid', items: [], obligation: null } });
      mount();
      const tiles = within(screen.getByTestId('book-shelf-grid')).getAllByRole('button');
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toHaveTextContent('Add your first book');
    });

    it('is headed Reading, never with an h1', () => {
      arm();
      const { container } = mount();
      expect(screen.getByRole('heading', { level: 2, name: 'Reading' })).toBeInTheDocument();
      expect(container.querySelector('h1')).toBeNull();
    });

    it('wears the learner chip', () => {
      arm();
      const { container } = mount();
      const chip = container.querySelector('.school-selfservice-card__learner');
      expect(chip).not.toBeNull();
      expect(chip).toHaveTextContent('Alpha');
    });

    it('shows the learner portrait by the learner id when no avatar override is set', () => {
      arm();
      mount();
      const img = screen.getByRole('img', { name: 'Alpha' });
      expect(img).toHaveAttribute('src', expect.stringContaining('/users/kid?'));
    });

    it('Done calls actions.done', () => {
      const a = arm();
      mount();
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(a.done).toHaveBeenCalledTimes(1);
    });

    it('history › calls actions.openHistory', () => {
      const a = arm();
      mount();
      fireEvent.click(screen.getByRole('button', { name: /history/i }));
      expect(a.openHistory).toHaveBeenCalledTimes(1);
    });

    it('a tile calls actions.openItem with its itemId', () => {
      const a = arm();
      mount();
      fireEvent.click(screen.getByRole('button', { name: /Hatchet/ }));
      expect(a.openItem).toHaveBeenCalledWith('kid:hatchet:e0');
    });

    it('+ calls actions.startAdd', () => {
      const a = arm();
      mount();
      fireEvent.click(screen.getByRole('button', { name: /add a book/i }));
      expect(a.startAdd).toHaveBeenCalledTimes(1);
      expect(a.openItem).not.toHaveBeenCalled();
    });

    it('any tap inside the root notes activity', () => {
      const a = arm();
      mount();
      fireEvent.click(screen.getByRole('heading', { level: 2, name: 'Reading' }));
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(a.noteActivity).toHaveBeenCalledTimes(2);
    });

    it('the grid, not the body, is the scroll container', () => {
      arm();
      mount();
      expect(screen.getByTestId('book-shelf-grid')).toHaveClass('school-books__grid');
    });
  });

  describe('the obligation line', () => {
    const obligation = (per) => ({
      label: '14 of 20 pages', actual: 14, target: 20, metric: 'pages', per, incompatibleBooks: [],
    });

    it('per day → today', () => {
      arm({ shelf: { learnerId: 'kid', items: [HATCHET], obligation: obligation('day') } });
      mount();
      expect(screen.getByText('14 of 20 pages today')).toBeInTheDocument();
    });

    it('per week → this week', () => {
      arm({ shelf: { learnerId: 'kid', items: [HATCHET], obligation: obligation('week') } });
      mount();
      expect(screen.getByText('14 of 20 pages this week')).toBeInTheDocument();
    });

    it('per month → this month', () => {
      arm({ shelf: { learnerId: 'kid', items: [HATCHET], obligation: obligation('month') } });
      mount();
      expect(screen.getByText('14 of 20 pages this month')).toBeInTheDocument();
    });

    it('once → the label alone', () => {
      arm({ shelf: { learnerId: 'kid', items: [HATCHET], obligation: { ...obligation('once'), label: '1 of 2 books' } } });
      mount();
      expect(screen.getByText('1 of 2 books')).toBeInTheDocument();
    });

    it('no per → the label alone', () => {
      const { per, ...withoutPer } = obligation('day');
      arm({ shelf: { learnerId: 'kid', items: [HATCHET], obligation: withoutPer } });
      mount();
      expect(screen.getByText('14 of 20 pages')).toBeInTheDocument();
    });

    it('null obligation → no line, even with a label elsewhere', () => {
      arm({ shelf: { learnerId: 'kid', items: [HATCHET], obligation: null } });
      const { container } = mount();
      expect(container.querySelector('.school-books__obligation')).toBeNull();
    });

    it('tags the books whose mode cannot satisfy the metric', () => {
      arm({ shelf: { learnerId: 'kid', items: [HATCHET, FROG], obligation: { ...obligation('day'), incompatibleBooks: ['frog'] } } });
      mount();
      const frog = screen.getByRole('button', { name: /Frog and Toad/ });
      expect(frog).toHaveTextContent("doesn't count toward pages");
      expect(screen.getByRole('button', { name: /Hatchet/ })).not.toHaveTextContent("doesn't count");
    });
  });

  describe('errors', () => {
    it('a failed load names the fault and offers Try again', () => {
      const a = arm({ view: 'loading', shelf: null, error: { message: 'Could not load your shelf' } });
      mount();
      expect(screen.getByText('Could not load your shelf')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(a.retry).toHaveBeenCalledTimes(1);
    });

    it('a failed re-read keeps the tiles up and says so', () => {
      arm({ error: { message: 'Could not load your shelf' } });
      mount();
      expect(screen.getByText('Could not load your shelf')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Hatchet/ })).toBeInTheDocument();
    });
  });

  describe('overlays', () => {
    it('update: renders UpdateBook on the current item, with the tiles gone and Done still up', () => {
      arm({ view: 'update', current: HATCHET });
      mount();
      const overlay = screen.getByTestId('update-book');
      expect(within(overlay).getByText('Hatchet')).toBeInTheDocument();
      expect(within(overlay).getByText('What page are you on?')).toBeInTheDocument();
      expect(screen.queryByTestId('book-shelf-grid')).toBeNull();
      expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    });

    it('add: renders AddBook on the hook\'s step, with the tiles gone and Done still up', () => {
      arm({ view: 'add', step: 'number', add: { entry: '', hint: null, canSubmit: false, canRetry: false, resolved: null, duplicateOf: null } });
      mount();
      const overlay = screen.getByTestId('add-book');
      expect(overlay).toHaveAttribute('data-step', 'number');
      expect(within(overlay).getByText('Type the number under the barcode')).toBeInTheDocument();
      expect(screen.queryByTestId('book-shelf-grid')).toBeNull();
      expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    });
  });

  describe('today is the study day the API named (review m2)', () => {
    const BOOK = { isbn13: '9780064400558', title: 'Hatchet', authors: [] };
    const toWhen = (extra = {}) => arm({
      view: 'add', step: 'when',
      add: { entry: '9780064400558', hint: null, canSubmit: false, canRetry: false, resolved: { status: 'ok', book: BOOK }, duplicateOf: null },
      ...extra,
    });

    it('the DayPicker is seeded from the server\'s studyDay, not the browser\'s date', () => {
      // A day no browser clock in this test run will agree with: Thursday 15 January 2026.
      toWhen({ studyDay: '2026-01-15' });
      mount();
      expect(screen.getByTestId('daypicker')).toHaveTextContent('Today · Thu 15');
      // The browser's own day-of-month must not be what seeded it; anchor on the
      // summary so a run on the 15th cannot trip over the seed's own digits.
      expect(screen.getByTestId('daypicker')).toHaveTextContent(/Today · Thu 15/);
    });

    it('falls back to the panel\'s local date only when the field is absent', () => {
      toWhen({ studyDay: null });
      mount();
      const ms = Date.parse(`${localDayKey()}T00:00:00Z`);
      const day = new Date(ms).getUTCDate();
      expect(screen.getByTestId('daypicker')).toHaveTextContent(`Today · `);
      expect(screen.getByTestId('daypicker')).toHaveTextContent(` ${day}`);
    });
  });

  describe('History', () => {
    const history = (items) => arm({ view: 'history', shelf: { learnerId: 'kid', items, obligation: null } });

    it('shows finished and set-aside books grouped by month, most recent first', () => {
      history([HATCHET, DONE_JULY, DONE_AUG, ASIDE_JULY]);
      mount();
      const groups = screen.getAllByTestId('book-history-group');
      expect(groups).toHaveLength(2);
      expect(within(groups[0]).getByRole('heading', { level: 3 })).toHaveTextContent('August 2026');
      expect(within(groups[0]).getByText('Finished in August')).toBeInTheDocument();
      expect(within(groups[1]).getByRole('heading', { level: 3 })).toHaveTextContent('July 2026');
      expect(within(groups[1]).getByText('Finished in July')).toBeInTheDocument();
      expect(within(groups[1]).getByText('Set aside in July')).toBeInTheDocument();
      expect(screen.queryByText('Hatchet')).toBeNull();
    });

    it('a finished tile shows its day, not a bar', () => {
      history([DONE_JULY]);
      mount();
      expect(screen.getByText('Finished Jul 14')).toBeInTheDocument();
      expect(screen.queryByRole('progressbar')).toBeNull();
    });

    it('nothing on it is tappable except back and Done', () => {
      history([DONE_JULY, DONE_AUG]);
      mount();
      const names = screen.getAllByRole('button').map((b) => b.textContent.trim());
      expect(names).toHaveLength(2);
      expect(names).toEqual(expect.arrayContaining(['Done', expect.stringMatching(/back/i)]));
    });

    it('‹ back calls actions.back', () => {
      const a = history([DONE_JULY]);
      mount();
      fireEvent.click(screen.getByRole('button', { name: /back/i }));
      expect(a.back).toHaveBeenCalledTimes(1);
    });

    it('says so when nothing is finished yet', () => {
      history([HATCHET]);
      mount();
      expect(screen.getByText(/nothing finished yet/i)).toBeInTheDocument();
    });
  });
});
