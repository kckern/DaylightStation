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
  startAdd: vi.fn(), openItem: vi.fn(), openDuplicate: vi.fn(), undoFinish: vi.fn(),
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
    // `openAdd` rides along: the panel door opens the shelf straight at the pad.
    expect(h.hook).toHaveBeenCalledWith({ learnerId: 'kid', grant: 'g1', idleTimeoutSeconds: 90, onExit, openAdd: false });
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

  /**
   * THE LEARNER CHIP IS A GUARD, not decoration — this file's own header says
   * so: "a shelf left open on a shared wall panel is one child's books with
   * another child's hands on them, and the name at the top is how the second
   * child notices."
   *
   * Pinned in a test as of 2026-09-06, when the reading log was opened to every
   * learner and the code that reaches it stopped being capped. Attribution, not
   * frequency, is the control on this surface, and the chip is the whole of it —
   * so a refactor that quietly drops the name or the face has removed a control
   * rather than tidied a header.
   */
  describe('the learner chip', () => {
    it('names the learner and draws their portrait', () => {
      arm({});
      mount();
      expect(screen.getByText('Alpha')).toBeInTheDocument();
      expect(screen.getByRole('img', { name: /Alpha/i })).toBeInTheDocument();
    });

    it('is still there while a book is open — the overlays are where pages get typed', () => {
      arm({
        view: 'update',
        current: HATCHET,
      });
      mount();
      expect(screen.getByText('Alpha')).toBeInTheDocument();
    });

    it('falls back to the id rather than drawing an anonymous shelf', () => {
      arm({ learner: { id: 'kid' } });
      mount();
      expect(screen.getByText('kid')).toBeInTheDocument();
    });
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

    it('the history holds set-aside books beside finished ones, on their days', () => {
      arm({ shelf: { learnerId: 'kid', items: [DONE_JULY, ASIDE_JULY, HATCHET], obligation: null } });
      mount();
      const done = screen.getByTestId('book-history');
      expect(done.querySelectorAll('.school-books-tile__mark.is-set-aside')).toHaveLength(1);
      expect(done.querySelectorAll('.school-books-tile__mark.is-finished')).toHaveLength(1);
      // Two different days, two shelves — and no "See all history" anywhere.
      expect(screen.getAllByTestId('book-history-group')).toHaveLength(2);
      expect(screen.queryByRole('button', { name: /history/i })).toBeNull();
    });

    // THE TAXONOMY FIX: the obligation is pips INSIDE the Today heading, not a
    // sentence in a chip above the shelf.
    it('the obligation is drawn as pips in the Today heading, with the sentence as its name', () => {
      arm({ shelf: { learnerId: 'kid', items: [HATCHET], obligation: { label: '1 of 2 books', per: 'day', actual: 1, target: 2, met: false, metric: 'books' } } });
      mount();
      const heading = screen.getByRole('heading', { level: 3, name: 'Today' });
      const pips = screen.getByTestId('shelf-obligation');
      expect(heading.parentElement).toContainElement(pips);
      expect(pips).toHaveAttribute('aria-label', '1 of 2 books today');
      expect(pips.querySelectorAll('.reading-pip')).toHaveLength(2);
      expect(pips.querySelectorAll('.reading-pip--done')).toHaveLength(1);
      expect(screen.queryByText('1 of 2 books today')).toBeNull();
    });

    it('the shelf row is a row and nothing else — one layout system per element', () => {
      arm();
      mount();
      const row = screen.getByTestId('book-shelf-grid');
      expect(row).toHaveClass('school-books__row');
      expect(row).not.toHaveClass('school-books__grid');
    });

    it('the add card takes a book\'s footprint in the row, not a control beside it', () => {
      arm();
      const { container } = mount();
      const row = screen.getByTestId('book-shelf-grid');
      const add = within(row).getByRole('button', { name: /Add a book/ });
      // The same card, the same 2:3 art slot: it stands ON the shelf.
      expect(add).toHaveClass('school-books-tile');
      expect(add.querySelector('.school-books-tile__art .school-books-tile__cover')).not.toBeNull();
      expect(add).toHaveTextContent('Tap to type the number');
      // And nothing outside the row offers it any more.
      expect(container.querySelectorAll('button')).toHaveLength(
        container.querySelectorAll('.school-books-tile, .school-screen-header__done, .school-books__history-link').length,
      );
    });

    it('offers the add card even when the only books are finished ones', () => {
      arm({ shelf: { learnerId: 'kid', items: [DONE_JULY], obligation: null } });
      mount();
      const row = screen.getByTestId('book-shelf-grid');
      expect(within(row).getByRole('button', { name: /Add a book/ })).toBeInTheDocument();
      expect(within(row).queryByText('Ready for your next book')).toBeNull();
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
      expect(within(overlay).getByRole('button', { name: 'Update page' })).toBeInTheDocument();
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

    it('receipt: makes a finished write explicit and wires history, back, and undo', () => {
      const a = arm({
        view: 'receipt',
        receipt: {
          kind: 'finished', book: HATCHET, finishedOn: '2026-08-25',
          itemId: HATCHET.itemId, undoEntryId: 'undo-1',
        },
      });
      mount();
      expect(screen.getByTestId('book-save-receipt')).toHaveTextContent('Book finished!');
      expect(screen.getByTestId('book-save-receipt')).toHaveTextContent('Hatchet');

      expect(screen.getByTestId('book-shelf-grid')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Undo finish' }));
      expect(a.undoFinish).toHaveBeenCalledTimes(1);
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

  describe('Book history — one shelf per day, on the shelf screen itself', () => {
    const history = (items, studyDay = '2026-08-02') => arm({ studyDay, shelf: { learnerId: 'kid', items, obligation: null } });

    it('groups finished and set-aside books by DAY, newest first, the day as the heading', () => {
      history([HATCHET, DONE_JULY, DONE_AUG, ASIDE_JULY]);
      mount();
      const groups = screen.getAllByTestId('book-history-group');
      expect(groups).toHaveLength(3);
      expect(within(groups[0]).getByRole('heading', { level: 4 })).toHaveTextContent('Today');
      expect(within(groups[0]).getByText('Finished in August')).toBeInTheDocument();
      // The bookend: the weekday on top, the date under.
      expect(within(groups[1]).getByRole('heading', { level: 4 })).toHaveAccessibleName('Monday 20 July');
      expect(within(groups[1]).getByRole('heading', { level: 4 })).toHaveTextContent(/Monday.*20 Jul/);
      expect(within(groups[1]).getByText('Set aside in July')).toBeInTheDocument();
      expect(within(groups[2]).getByRole('heading', { level: 4 })).toHaveTextContent(/Tuesday.*14 Jul/);
      expect(within(groups[2]).getByText('Finished in July')).toBeInTheDocument();
      // A book still being read is on the Today row, not in the history.
      expect(within(screen.getByTestId('book-history')).queryByText('Hatchet')).toBeNull();
    });

    it('a finished card carries no date and no bar — the day heading has the date', () => {
      history([DONE_JULY]);
      mount();
      expect(screen.queryByText('Jul 14')).toBeNull();
      expect(screen.queryByRole('progressbar')).toBeNull();
      expect(screen.getByTestId('book-history').querySelector('.school-books-tile--history')).not.toBeNull();
    });

    it('history cards open details; the header keeps its one exit', () => {
      const a = history([DONE_JULY, DONE_AUG]);
      mount();
      fireEvent.click(screen.getByRole('button', { name: 'Open Finished in July' }));
      expect(a.openItem).toHaveBeenCalledWith(DONE_JULY.itemId);
      expect(screen.queryByRole('button', { name: /back/i })).toBeNull();
      expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    });

    it('draws no history at all when nothing is finished yet', () => {
      history([HATCHET]);
      mount();
      expect(screen.queryByTestId('book-history')).toBeNull();
    });

    it('the same book finished twice in a day is one card wearing ×2', () => {
      const twice = [
        item('h1', { title: 'Hands Are Not for Hitting', bookId: 'b:hands' }, { status: 'finished', lastAt: '2026-08-02T09:00:00Z' }),
        item('h2', { title: 'Hands Are Not for Hitting', bookId: 'b:hands' }, { status: 'finished', lastAt: '2026-08-02T15:00:00Z' }),
        item('c1', { title: 'Cowboy Small', bookId: 'b:cowboy' }, { status: 'finished', lastAt: '2026-08-02T16:00:00Z' }),
      ];
      history(twice);
      mount();
      const today = screen.getAllByTestId('book-history-group')[0];
      expect(within(today).getAllByRole('button')).toHaveLength(2);
      expect(within(today).getByLabelText('2 times')).toHaveTextContent('×2');
      expect(within(today).getByRole('button', { name: 'Open Cowboy Small' }).querySelector('.school-books-tile__times')).toBeNull();
    });

    it('reveals a week of days at a time, the rest behind a sentinel', () => {
      const days = Array.from({ length: 10 }, (_, i) => item(`d${i}`, { title: `Book ${i}` }, { status: 'finished', lastAt: `2026-07-${String(20 - i).padStart(2, '0')}T12:00:00Z` }));
      history(days);
      mount();
      expect(screen.getAllByTestId('book-history-group')).toHaveLength(7);
      expect(screen.getByTestId('book-history-more')).toBeInTheDocument();
    });
  });
});
