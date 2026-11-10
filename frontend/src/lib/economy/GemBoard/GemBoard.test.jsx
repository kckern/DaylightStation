import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';
import GemBoardOverlay, { GemBoardGrid, boardRowIds, boardShape, readBoardShape } from './GemBoard.jsx';

const part = (ruleId, label, cadence, extra = {}) => ({ ruleId, label, cadence, state: 'none', week: 0, lifetime: 0, progress: null, left: null, reach: null, days: [], items: [], score: null, note: null, ...extra });
const BOARD = {
  mode: 'live',
  week: '2026-11-02',
  today: '2026-11-04',
  windows: { school: { from: '2026-11-02', to: '2026-11-08' } },
  learners: [{ learnerId: 'a', name: 'Ann' }, { learnerId: 'b', name: 'Ben' }],
  groups: [{ id: 'move', label: 'Move' }, { id: 'school', label: 'School' }],
  categories: [
    { id: 'green-week', label: 'Green week', cadence: 'weekly', group: 'school', color: '#2e9e5b', parts: [{ ruleId: 'green-week', label: 'Green week', cadence: 'weekly' }] },
    { id: 'exercise', label: 'Moved 5 days', cadence: 'weekly', group: 'move', color: '#8e5bd0', parts: [{ ruleId: 'moved-days', label: 'Moved 5 days', cadence: 'weekly' }] },
    { id: 'ring-contests', label: 'Ring contests', cadence: 'contest', group: 'move', color: '#8e5bd0', parts: [{ ruleId: 'ring-contest', label: 'Most rings this week', cadence: 'contest' }] },
    { id: 'reading', label: 'Reading', cadence: 'weekly', group: 'school', color: '#2e9e5b', parts: [{ ruleId: 'reader-week', label: 'Story time 4 days', cadence: 'weekly' }, { ruleId: 'book-finished', label: 'Book finished', cadence: 'milestone' }] },
  ],
  cells: {
    'green-week': { a: { state: 'unknown', week: 0, streak: null, parts: [] }, b: { state: 'none', week: 0, streak: null, parts: [] } },
    exercise: {
      a: { state: 'earned', week: 2, streak: null, parts: [part('moved-days', 'Moved 5 days', 'weekly', { state: 'earned', week: 2 })] },
      b: { state: 'pending', week: 0, streak: { have: 3, need: 5, left: 3, reach: 'on-track', ruleId: 'moved-days' }, parts: [part('moved-days', 'Moved 5 days', 'weekly', { state: 'pending', progress: { have: 3, need: 5 }, left: 3, reach: 'on-track', days: [{ day: '2026-11-02', state: 'done' }, { day: '2026-11-03', state: 'done' }, { day: '2026-11-04', state: 'done' }] })] },
    },
    'ring-contests': { a: { state: 'leading', week: 0, streak: null, parts: [part('ring-contest', 'Most rings this week', 'contest', { state: 'leading', score: { mine: 320, best: 320 } })] }, b: { state: 'none', week: 0, streak: null, parts: [] } },
    reading: {
      a: { state: 'earned', week: 1, streak: { have: 1, need: 4, left: 4, reach: 'on-track', ruleId: 'reader-week' }, parts: [
        part('reader-week', 'Story time 4 days', 'weekly', { state: 'pending', progress: { have: 1, need: 4 }, left: 4, reach: 'on-track', days: [{ day: '2026-11-03', state: 'done' }] }),
        part('book-finished', 'Book finished', 'milestone', { state: 'earned', week: 1, lifetime: 4, items: [{ day: '2026-11-03', label: 'Frog and Toad' }] }),
      ] },
      b: { state: 'none', week: 0, streak: null, parts: [] },
    },
  },
  totals: { a: { week: 3, earned: 1, lifetime: 9 }, b: { week: 0, earned: 0, lifetime: 4 } },
};

afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); });

describe('GemBoardGrid', () => {
  it('one table: a line per child in roster order, gem columns under their section in section order, no numerals at a glance', () => {
    const { container } = render(<GemBoardGrid board={BOARD} focusLearnerId="b" />);
    expect(container.querySelectorAll('.gem-board__grid')).toHaveLength(1);
    expect([...container.querySelectorAll('.gem-board__name')].map((n) => n.textContent)).toEqual(['Ann', 'Ben']);
    expect([...container.querySelectorAll('.gem-board__group-label')].map((n) => n.textContent)).toEqual(['Move', 'School']);
    expect([...container.querySelectorAll('.gem-board__cat')].map((n) => n.textContent)).toEqual(['Moved 5 days', 'Ring contests', 'Green week', 'Reading']);
    const looks = [...container.querySelectorAll('.gem-board__cell')].map((c) => c.dataset.look);
    expect(looks).toEqual(['lit', 'holding', 'unknown', 'lit', 'streak', 'none', 'none', 'none']);
    // The row label carries no gem; an empty cell is blank; fractions are gone.
    expect(container.querySelector('.gem-board__cat .gem-icon')).toBeNull();
    expect(container.querySelector('.gem-board__cell[data-look="none"]').textContent).toBe('');
    expect(container.textContent).not.toMatch(/\d\/\d/);
    expect(screen.getByLabelText('Ben, Moved 5 days: 3 of 5 days, on track')).toBeTruthy();
    expect(screen.getByLabelText('Ann, Reading: earned, and 1 of 4 days, on track')).toBeTruthy();
    expect(screen.getByLabelText('Ann: 1 this week').textContent).toBe('1') // a lead is never counted: earned only;
    expect(container.textContent).not.toContain('in all'); // the week on the board, no running totals
    expect(container.querySelectorAll('.gem-board__head.is-focus')).toHaveLength(1);
  });

  it('a cell with something to show is a button that opens its detail; an empty one is not', () => {
    const onOpen = vi.fn();
    const { container } = render(<GemBoardGrid board={BOARD} onOpen={onOpen} />);
    fireEvent.click(screen.getByLabelText('Ben, Moved 5 days: 3 of 5 days, on track'));
    expect(onOpen).toHaveBeenCalledWith('exercise', 'b');
    expect(container.querySelector('.gem-board__cell[data-look="none"] button')).toBeNull();
  });

  it('a cell opens when its detail would have something to say, however blank it looks; nothing to say, no button', () => {
    const cells = {
      ...BOARD.cells,
      // Not leading, but scored: blank at a glance, a score behind it.
      'ring-contests': { ...BOARD.cells['ring-contests'], b: { state: 'none', week: 0, streak: null, parts: [part('ring-contest', 'Most rings this week', 'contest', { score: { mine: 120, best: 320 } })] } },
      // A day-count that fell short, and a row whose only rule is off.
      exercise: { ...BOARD.cells.exercise, a: { state: 'none', week: 0, streak: null, parts: [part('moved-days', 'Moved 5 days', 'weekly', { days: [{ day: '2026-11-02', state: 'done' }] })] } },
      'green-week': { a: { state: 'disabled', week: 0, streak: null, parts: [part('green-week', 'Green week', 'weekly', { state: 'disabled', lifetime: 2 })] }, b: { state: 'none', week: 0, streak: null, parts: [part('green-week', 'Green week', 'weekly')] } },
      // Books finished in other weeks, none this week.
      reading: { ...BOARD.cells.reading, b: { state: 'none', week: 0, streak: null, parts: [part('reader-week', 'Story time 4 days', 'weekly'), part('book-finished', 'Book finished', 'milestone', { lifetime: 3 })] } },
    };
    const onOpen = vi.fn();
    const { container } = render(<GemBoardGrid board={{ ...BOARD, cells }} onOpen={onOpen} />);
    const button = (label) => screen.getByLabelText(label).closest('button');
    for (const label of ['Ben, Ring contests: not this week', 'Ann, Moved 5 days: not this week']) {
      expect(button(label)).toBeTruthy();
      expect(button(label).querySelector('.gem-glyph')).toBeTruthy(); // the same box as any other cell
    }
    fireEvent.click(button('Ben, Ring contests: not this week'));
    expect(onOpen).toHaveBeenCalledWith('ring-contests', 'b');
    expect(button('Ben, Reading: not this week')).toBeNull(); // books from other weeks are not this week's news
    expect(button('Ann, Green week: off')).toBeNull();
    expect(button('Ben, Green week: not this week')).toBeNull();
    expect(container.querySelectorAll('.gem-board__cell[data-look="none"] button')).toHaveLength(2);
  });

  it('marks the cursor cell, lists row ids in display order, and says so when there is nothing to show', () => {
    const { container } = render(<GemBoardGrid board={BOARD} focusLearnerId="a" cursorRowId="reading" />);
    const cursors = container.querySelectorAll('.gem-board__cell.is-cursor');
    expect(cursors).toHaveLength(1);
    expect(cursors[0].querySelector('[aria-label]').getAttribute('aria-label')).toBe('Ann, Reading: earned, and 1 of 4 days, on track');
    expect(boardRowIds(BOARD)).toEqual(['exercise', 'ring-contests', 'green-week', 'reading']);
    expect(boardRowIds(null)).toEqual([]);
    cleanup();
    render(<GemBoardGrid board={{ ...BOARD, groups: [] }} />);
    expect(screen.getByText('No gems to show yet.')).toBeTruthy();
  });
});

describe('GemBoardGrid — areas', () => {
  // The server may send the sections in any order; the board always reads Move, School, Games.
  const AREAS = {
    ...BOARD,
    groups: [{ id: 'move', label: 'Move' }, { id: 'games', label: 'Games' }, { id: 'school', label: 'School' }],
    categories: [
      { id: 'exercise', label: 'Moved 5 days', cadence: 'weekly', group: 'move', area: 'move', color: '#8e5bd0', parts: [] },
      { id: 'racing', label: 'Racing', cadence: 'contest', group: 'games', area: 'games', color: '#ff7a2f', parts: [] },
      { id: 'reading', label: 'Reading', cadence: 'weekly', group: 'school', area: 'school', color: '#2e9e5b', parts: [] },
    ],
    cells: {
      exercise: { a: { state: 'earned', week: 3, streak: null, parts: [] }, b: { state: 'pending', week: 0, streak: { have: 1, need: 5, left: 4, reach: 'tight', ruleId: 'moved-days' }, parts: [] } },
      racing: { a: { state: 'leading', week: 0, streak: null, parts: [] }, b: { state: 'none', week: 0, streak: null, parts: [] } },
      reading: { a: { state: 'earned', week: 1, streak: null, parts: [] }, b: { state: 'pending', week: 0, streak: { have: 0, need: 4, left: 4, reach: 'tight', ruleId: 'reader-week' }, parts: [] } },
    },
  };

  it('rows sit under Move, School, Games headers in that order, each header with its icon', () => {
    const { container } = render(<GemBoardGrid board={AREAS} />);
    const heads = [...container.querySelectorAll('.gem-board__group-label')];
    expect(heads.map((n) => n.textContent)).toEqual(['Move', 'School', 'Games']);
    expect(heads.map((n) => n.querySelector('.area-icon')?.dataset.area)).toEqual(['move', 'school', 'games']);
    expect([...container.querySelectorAll('.gem-board__cat')].map((n) => n.textContent)).toEqual(['Moved 5 days', 'Reading', 'Racing']);
    expect(boardRowIds(AREAS)).toEqual(['exercise', 'reading', 'racing']);
  });

  it('honest cells: a full gem with ×3 and its icon, a ringed tight gem with no tag, a blank 0-day cell, "leading" in words', () => {
    const { container } = render(<GemBoardGrid board={AREAS} />);
    const cell = (row, who) => container.querySelector(`.gem-board__col[data-row="${row}"][data-learner="${who}"] .gem-board__cell`);
    expect(cell('exercise', 'a').querySelector('.area-icon[data-area="move"]')).toBeTruthy();
    expect(cell('exercise', 'a').textContent).toBe('×3');
    expect(cell('exercise', 'b').textContent).toBe('');
    expect(cell('exercise', 'b').querySelectorAll('.gem-glyph__seg.is-done')).toHaveLength(1);
    expect(cell('reading', 'b').querySelector('svg')).toBeNull();
    expect(cell('racing', 'a').textContent).toBe('leading');
    expect(cell('racing', 'a').querySelector('.gem-icon')).toBeNull();
  });
});

describe('GemBoardOverlay', () => {
  const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

  it('loads this week, steps to last week by its Monday minus 7, and closes on Escape', async () => {
    const load = vi.fn(async (week) => ({ ...BOARD, week: week ? '2026-10-26' : '2026-11-02' }));
    const onClose = vi.fn();
    render(<GemBoardOverlay open surface="fitness" load={load} onClose={onClose} />);
    await flush();
    expect(load).toHaveBeenLastCalledWith(null);
    expect(document.querySelectorAll('.gem-board__grid')).toHaveLength(1);
    expect([...document.querySelectorAll('.gem-board__group-label')].map((n) => n.textContent)).toEqual(['Move', 'School']);
    fireEvent.click(screen.getByText('Last week'));
    await flush();
    expect(load).toHaveBeenLastCalledWith('2026-10-26');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledWith('back');
  });

  it('takes a surface’s gamepad keys through keyRef: ↑/↓ moves the highlighted child', async () => {
    const keyRef = { current: null };
    const { container } = render(<GemBoardOverlay open surface="fitness" focusLearnerId="a" keyRef={keyRef} load={async () => BOARD} onClose={() => {}} />);
    await flush();
    const focused = () => container.ownerDocument.querySelector('.gem-board__head.is-focus .gem-board__name')?.textContent;
    expect(focused()).toBe('Ann');
    act(() => { keyRef.current('ArrowDown'); });
    expect(focused()).toBe('Ben');
    act(() => { keyRef.current('ArrowDown'); });
    expect(focused()).toBe('Ann');
  });

  it('closes itself after idleMs without input', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<GemBoardOverlay open surface="school" idleMs={1000} load={async () => BOARD} onClose={onClose} />);
    act(() => { vi.advanceTimersByTime(1001); });
    expect(onClose).toHaveBeenCalledWith('timeout');
  });

  it('says so when the economy is off or the read fails', async () => {
    const { unmount } = render(<GemBoardOverlay open surface="school" load={async () => ({ mode: 'off' })} onClose={() => {}} />);
    await flush();
    expect(screen.getByText('Gems are switched off.')).toBeTruthy();
    unmount();
    render(<GemBoardOverlay open surface="school" load={async () => { throw new Error('503'); }} onClose={() => {}} />);
    await flush();
    expect(screen.getByText('Can’t load the gems right now.')).toBeTruthy();
  });

  it('a tapped cell opens its detail; Escape closes the detail first, then the board', async () => {
    const onClose = vi.fn();
    render(<GemBoardOverlay open onClose={onClose} surface="school" load={() => Promise.resolve(BOARD)} idleMs={0} />);
    fireEvent.click(await screen.findByLabelText('Ben, Moved 5 days: 3 of 5 days, on track'));
    expect(screen.getByRole('dialog', { name: 'Ben, Moved 5 days' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Ben, Moved 5 days' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledWith('back');
  });

  it('right then Enter opens the focused child’s cell; Enter with no cursor still switches week', async () => {
    const load = vi.fn(() => Promise.resolve(BOARD));
    render(<GemBoardOverlay open onClose={() => {}} surface="fitness" focusLearnerId="b" load={load} idleMs={0} />);
    await screen.findByLabelText('Ben, Moved 5 days: 3 of 5 days, on track');
    fireEvent.keyDown(document, { key: 'Enter' });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    fireEvent.keyDown(document, { key: 'Enter' }); // back to this week
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    fireEvent.keyDown(document, { key: 'ArrowRight' }); // first gem: Moved 5 days
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(screen.getByRole('dialog', { name: 'Ben, Moved 5 days' })).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('with the detail open Enter closes it and arrows do nothing; the cursor leaves at either end, so Enter reaches the week switch again', async () => {
    const load = vi.fn(() => Promise.resolve(BOARD));
    render(<GemBoardOverlay open onClose={() => {}} surface="fitness" focusLearnerId="a" load={load} idleMs={0} />);
    await screen.findByLabelText('Ben, Moved 5 days: 3 of 5 days, on track');
    const cursor = () => document.querySelector('.gem-board__cell.is-cursor [aria-label]')?.getAttribute('aria-label');
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(cursor()).toBe('Ann, Reading: earned, and 1 of 4 days, on track');
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(screen.getByRole('dialog', { name: 'Ann, Reading' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(cursor()).toBe('Ann, Reading: earned, and 1 of 4 days, on track');
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(screen.queryByRole('dialog', { name: 'Ann, Reading' })).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'ArrowRight' }); // past the last gem: no cursor
    expect(cursor()).toBeUndefined();
    fireEvent.keyDown(document, { key: 'ArrowRight' }); // from none, right lands on the first gem
    expect(cursor()).toBe('Ann, Moved 5 days: earned, 2 gems');
    fireEvent.keyDown(document, { key: 'ArrowLeft' }); // before the first gem: no cursor
    expect(cursor()).toBeUndefined();
    fireEvent.keyDown(document, { key: 'Enter' }); // no cursor: the week switch
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it('a reopened board never paints the last session’s board or detail', async () => {
    let release;
    const load = vi.fn(() => Promise.resolve(BOARD));
    const props = { onClose: () => {}, surface: 'school', focusLearnerId: 'b', idleMs: 0 };
    const { rerender } = render(<GemBoardOverlay open load={load} {...props} />);
    fireEvent.click(await screen.findByLabelText('Ben, Moved 5 days: 3 of 5 days, on track'));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    fireEvent.click(screen.getByLabelText('Ben, Moved 5 days: 3 of 5 days, on track'));
    rerender(<GemBoardOverlay open={false} load={load} {...props} />);
    const slow = vi.fn(() => new Promise((resolve) => { release = () => resolve(BOARD); }));
    rerender(<GemBoardOverlay open load={slow} {...props} />);
    // Only the outline is up: no gem of the last session's board.
    expect(document.querySelector('.gem-board__grid.is-pending')).toBeTruthy();
    expect(document.querySelector('.gem-glyph')).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Ben, Moved 5 days' })).toBeNull();
    await act(async () => { release(); });
    expect(document.querySelector('.gem-board__grid.is-pending')).toBeNull();
    expect(document.querySelector('.gem-board__grid')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Ben, Moved 5 days' })).toBeNull();
    expect(document.querySelectorAll('.gem-board__cell.is-cursor')).toHaveLength(0);
  });

  it('Last week waits for this week’s first read: the button is off and Enter does nothing until it lands', async () => {
    let release;
    const load = vi.fn(() => new Promise((resolve) => { release = () => resolve(BOARD); }));
    render(<GemBoardOverlay open onClose={() => {}} surface="fitness" load={load} idleMs={0} />);
    const last = screen.getByText('Last week');
    expect(last.disabled).toBe(true);
    fireEvent.keyDown(document, { key: 'Enter' });
    fireEvent.click(last);
    await act(async () => { await Promise.resolve(); });
    expect(load).toHaveBeenCalledTimes(1);
    expect(last.classList.contains('is-on')).toBe(false);
    await act(async () => { release(); });
    expect(last.disabled).toBe(false);
    fireEvent.keyDown(document, { key: 'Enter' });
    await waitFor(() => expect(load).toHaveBeenLastCalledWith('2026-10-26'));
  });

  it('the detail takes focus and gives it back to its cell; the grid behind it is inert meanwhile', async () => {
    render(<GemBoardOverlay open onClose={() => {}} surface="school" load={() => Promise.resolve(BOARD)} idleMs={0} />);
    const cell = await screen.findByLabelText('Ben, Moved 5 days: 3 of 5 days, on track');
    const body = document.querySelector('.gem-board__body');
    expect(body.hasAttribute('inert')).toBe(false);
    fireEvent.click(cell);
    const dialog = screen.getByRole('dialog', { name: 'Ben, Moved 5 days' });
    expect(document.activeElement).toBe(dialog.querySelector('.gem-detail__close'));
    expect(body.hasAttribute('inert')).toBe(true);
    expect(dialog.closest('[inert]')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(body.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(cell);
    // Opened from the pad: focus still comes back to the cell under the cursor.
    fireEvent.keyDown(document, { key: 'ArrowDown' }); // Ann
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(screen.getByRole('dialog', { name: 'Ann, Moved 5 days' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(document.activeElement).toBe(screen.getByLabelText('Ann, Moved 5 days: earned, 2 gems'));
  });

  it('switching week closes the detail and clears the cursor; a cell with nothing to open leaves Enter switching week', async () => {
    const load = vi.fn(() => Promise.resolve(BOARD));
    render(<GemBoardOverlay open onClose={() => {}} surface="school" focusLearnerId="b" load={load} idleMs={0} />);
    fireEvent.click(await screen.findByLabelText('Ben, Moved 5 days: 3 of 5 days, on track'));
    fireEvent.click(screen.getByText('Last week'));
    expect(screen.queryByRole('dialog', { name: 'Ben, Moved 5 days' })).toBeNull();
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    fireEvent.keyDown(document, { key: 'ArrowLeft' }); // Reading: Ben has nothing there
    expect(document.querySelectorAll('.gem-board__cell.is-cursor')).toHaveLength(1);
    fireEvent.keyDown(document, { key: 'Enter' });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    expect(document.querySelectorAll('.gem-board__cell.is-cursor')).toHaveLength(0);
    expect(screen.queryByRole('dialog', { name: 'Ben, Reading' })).toBeNull();
  });

  it('first opening on a screen says Loading; the board read leaves its outline behind', async () => {
    let release;
    const slow = vi.fn(() => new Promise((resolve) => { release = () => resolve(BOARD); }));
    render(<GemBoardOverlay open load={slow} onClose={() => {}} surface="fitness" idleMs={0} />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(readBoardShape()).toBeNull();
    await act(async () => { release(); });
    expect(readBoardShape()).toEqual(boardShape(BOARD));
    expect(JSON.stringify(readBoardShape())).not.toMatch(/cells|totals|state/);
  });

  it('a later opening draws the kept outline at full size while the read is out: same lines and columns, no gems, no totals', async () => {
    localStorage.setItem('daylight.gemBoard.shape.v1', JSON.stringify(boardShape(BOARD)));
    let release;
    const slow = vi.fn(() => new Promise((resolve) => { release = () => resolve(BOARD); }));
    render(<GemBoardOverlay open load={slow} onClose={() => {}} surface="fitness" idleMs={0} />);
    expect(screen.queryByText('Loading…')).toBeNull();
    const grid = document.querySelector('.gem-board__grid');
    expect(grid.getAttribute('aria-busy')).toBe('true');
    const outline = { columns: grid.style.gridTemplateColumns, names: [...grid.querySelectorAll('.gem-board__name')].map((el) => el.textContent), cats: [...grid.querySelectorAll('.gem-board__cat')].map((el) => el.textContent) };
    expect(grid.querySelectorAll('.gem-board__cell')).toHaveLength(8); // blank cells, nothing drawn in them
    expect(grid.querySelector('.gem-board__cell').textContent).toBe('');
    expect(grid.querySelector('.gem-board__cell *')).toBeNull();
    expect(grid.querySelector('.gem-glyph')).toBeNull();
    expect(grid.querySelector('button')).toBeNull();
    expect([...grid.querySelectorAll('.gem-board__total')].map((el) => el.textContent)).toEqual(['', '']);
    await act(async () => { release(); });
    const loaded = document.querySelector('.gem-board__grid');
    expect(loaded.hasAttribute('aria-busy')).toBe(false);
    expect({ columns: loaded.style.gridTemplateColumns, names: [...loaded.querySelectorAll('.gem-board__name')].map((el) => el.textContent), cats: [...loaded.querySelectorAll('.gem-board__cat')].map((el) => el.textContent) }).toEqual(outline);
  });

  it('a kept outline that cannot be read, or a board that is off, is no outline', async () => {
    localStorage.setItem('daylight.gemBoard.shape.v1', '{not json');
    expect(readBoardShape()).toBeNull();
    localStorage.setItem('daylight.gemBoard.shape.v1', JSON.stringify({ learners: [], groups: [], categories: [] }));
    expect(readBoardShape()).toBeNull();
    expect(boardShape({ mode: 'off', learners: [], categories: [] })).toBeNull();
    const load = vi.fn(() => Promise.resolve({ mode: 'off', week: null, learners: [], categories: [], cells: {}, totals: {} }));
    render(<GemBoardOverlay open load={load} onClose={() => {}} surface="fitness" idleMs={0} />);
    await screen.findByText('Gems are switched off.');
    expect(readBoardShape()).toBeNull();
  });

  it('arrow keys move through rows in the grouped order, not the server’s', async () => {
    const board = {
      ...BOARD,
      groups: [{ id: 'move', label: 'Move' }, { id: 'games', label: 'Games' }, { id: 'school', label: 'School' }],
      categories: [
        { id: 'exercise', label: 'Moved 5 days', group: 'move', area: 'move', color: '#8e5bd0', parts: [] },
        { id: 'racing', label: 'Racing', group: 'games', area: 'games', color: '#ff7a2f', parts: [] },
        { id: 'reading', label: 'Reading', group: 'school', area: 'school', color: '#2e9e5b', parts: [] },
      ],
      cells: {
        exercise: { a: { state: 'none', week: 0, streak: null, parts: [] } },
        racing: { a: { state: 'none', week: 0, streak: null, parts: [] } },
        reading: { a: { state: 'none', week: 0, streak: null, parts: [] } },
      },
    };
    render(<GemBoardOverlay open surface="fitness" focusLearnerId="a" load={async () => board} onClose={() => {}} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const cursorRow = () => document.querySelector('.gem-board__cell.is-cursor')?.closest('.gem-board__col')?.dataset.row;
    const seen = [];
    for (let i = 0; i < 3; i++) { fireEvent.keyDown(document, { key: 'ArrowRight' }); seen.push(cursorRow()); }
    expect(seen).toEqual(['exercise', 'reading', 'racing']);
  });
});
