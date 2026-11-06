import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
const h = vi.hoisted(() => ({ state: null, file: vi.fn(), move: vi.fn(), remove: vi.fn(), log: vi.fn() }));
vi.mock("./useBookPile.js", () => ({ useBookPile: () => h.state }));
vi.mock("../schoolLog.js", () => ({ schoolLog: { bookShelf: (...a) => h.log(...a), bookShelfError: vi.fn(), bookShelfDebug: vi.fn() } }));
vi.mock("../../../../../frontend/src/lib/identity/ProfileAvatar.jsx", () => ({ default: () => <span>avatar</span> }));
import BookPile from "./BookPile.jsx";

const roster = [{ id: 'child-a', name: 'Ada' }, { id: 'child-b', name: 'Ben' }];
const card = (over = {}) => ({ id: 'c1', isbn13: '9780064400558', status: 'ready', state: 'unfiled', duplicates: 0, book: { title: 'Hatchet' }, ...over });
const hook = (over = {}) => {
  const cards = over.cards ?? [card()];
  return { cards, reader: null, live: true, lastScanAt: '2026-10-30T20:00:00.000Z', unfiled: cards.filter((c) => c.state === 'unfiled'), busy: false, error: null,
    file: h.file, move: h.move, remove: h.remove, enabled: true, lastFiled: null, ...over };
};
const props = { screenId: 'portal', roster, safe: true, onOpen: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); h.state = hook(); });

describe('BookPile', () => {
  it('counts the books to file and files them all with one face tap', async () => {
    h.state = hook({ cards: [card(), card({ id: 'c2', isbn13: '9780062691026', book: { title: 'Weird School' } })] });
    render(<BookPile {...props} />);
    expect(screen.getByRole('heading', { name: 'Books to file · 2' })).toBeTruthy();
    expect(screen.getByText('Keep scanning. Tap a face to file them.')).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Ada' })));
    expect(h.file).toHaveBeenCalledWith('child-a');
  });

  it('names the sticky reader once everything is filed', () => {
    h.state = hook({ reader: 'child-a', cards: [card({ state: 'filed', learnerId: 'child-a', outcome: 'finished-new' })] });
    render(<BookPile {...props} />);
    expect(screen.getByRole('heading', { name: 'Filing to Ada' })).toBeTruthy();
    expect(screen.getByText('New scans go to Ada.')).toBeTruthy();
  });

  it('says when the child already has the book today, and marks a double scan', () => {
    h.state = hook({ cards: [
      card({ state: 'filed', learnerId: 'child-a', outcome: 'already-today' }),
      card({ id: 'c2', duplicates: 1 }),
      card({ id: 'c3', status: 'loading', book: null }),
    ] });
    render(<BookPile {...props} />);
    expect(screen.getByText('Ada already has it today')).toBeTruthy();
    expect(screen.getByText('Scanned twice')).toBeTruthy();
    expect(screen.getByText('Looking up…')).toBeTruthy();
  });

  it('Change → Remove removes that card', async () => {
    render(<BookPile {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change Hatchet' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remove' })));
    expect(h.remove).toHaveBeenCalledWith('c1');
  });

  it('Change → Give to someone else moves that card only', async () => {
    h.state = hook({ cards: [card({ state: 'filed', learnerId: 'child-a', outcome: 'finished-new' })], reader: 'child-a' });
    render(<BookPile {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change Hatchet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Give to someone else' }));
    const sheet = screen.getByRole('dialog', { name: 'Change Hatchet' });
    await act(async () => fireEvent.click(within(sheet).getByRole('button', { name: 'Ben' })));
    expect(h.move).toHaveBeenCalledWith('c1', 'child-b');
    expect(h.file).not.toHaveBeenCalled();
  });

  it('draws nothing while a shelf is open', () => {
    const { container } = render(<BookPile {...props} scopeLearnerId="child-a" />);
    expect(container.innerHTML).toBe('');
  });

  it('offers the pile from the corner while the panel is busy', () => {
    h.state = hook({ cards: [card(), card({ id: 'c2' })] });
    render(<BookPile {...props} safe={false} />);
    expect(screen.queryByRole('heading', { name: /Books to file/ })).toBeNull();
    expect(screen.getByText('2 books scanned — open when ready')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
    expect(props.onOpen).toHaveBeenCalled();
  });

  it('stays out of the way while busy once a reader is filing', () => {
    h.state = hook({ reader: 'child-a', cards: [card()] });
    const { container } = render(<BookPile {...props} safe={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('draws nothing when the session is over and nothing is left to file', () => {
    h.state = hook({ live: false, cards: [card({ state: 'filed', learnerId: 'child-a', outcome: 'finished-new' })] });
    const { container } = render(<BookPile {...props} />);
    expect(container.innerHTML).toBe('');
  });

  it('Later sets the pile aside to a corner card, and Open brings it back', async () => {
    const r = render(<BookPile {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByRole('heading', { name: /Books to file/ })).toBeNull();
    expect(screen.getByText('1 book scanned — open when ready')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
    expect(screen.getByRole('heading', { name: 'Books to file · 1' })).toBeTruthy();
    expect(props.onOpen).not.toHaveBeenCalled();
    r.unmount();
  });

  it('recedes to a corner card once the session is over, keeping the keypad free', () => {
    h.state = hook({ live: false });
    render(<BookPile {...props} />);
    expect(screen.queryByRole('heading', { name: /Books to file/ })).toBeNull();
    expect(screen.getByText('1 book scanned — open when ready')).toBeTruthy();
  });

  it('raises nothing for leftover unreadable barcodes', () => {
    h.state = hook({ live: false, cards: [card({ status: 'invalid', error: 'That book barcode is invalid.' })] });
    const { container } = render(<BookPile {...props} />);
    expect(container.innerHTML).toBe('');
  });

  // 2026-11-05: after a successful filing the screen looked exactly the same,
  // so the child tapped his face three more times.
  it('confirms a filing in so many words and takes the faces away once nothing is left to file', () => {
    h.state = hook({ reader: 'child-a', lastFiled: { learnerId: 'child-a', count: 2, alreadyToday: 0, failed: 0, at: 1 },
      cards: [card({ state: 'filed', learnerId: 'child-a', outcome: 'finished-new' }), card({ id: 'c2', state: 'filed', learnerId: 'child-a', outcome: 'finished-new' })] });
    render(<BookPile {...props} />);
    expect(screen.getByRole('status')).toHaveTextContent('Filed 2 books to Ada');
    expect(screen.queryByRole('button', { name: 'Ada' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ben' })).toBeNull();
  });

  it('keeps the faces while a book is still waiting to be filed', () => {
    h.state = hook({ reader: 'child-a', lastFiled: { learnerId: 'child-a', count: 1, alreadyToday: 0, failed: 0, at: 1 },
      cards: [card({ state: 'filed', learnerId: 'child-a', outcome: 'finished-new' }), card({ id: 'c2' })] });
    render(<BookPile {...props} />);
    expect(screen.getByRole('button', { name: 'Ada' })).toBeTruthy();
  });

  it('logs full screen vs corner once per change', () => {
    const r = render(<BookPile {...props} />);
    r.rerender(<BookPile {...props} />);
    expect(h.log.mock.calls.filter(([e]) => e === 'book-pile.shown')).toEqual([['book-pile.shown', expect.objectContaining({ mode: 'full' })]]);
    r.rerender(<BookPile {...props} safe={false} />);
    expect(h.log).toHaveBeenLastCalledWith('book-pile.shown', expect.objectContaining({ mode: 'corner' }));
  });

  it('with no confirmation to show, a new card brings the faces back', () => {
    h.state = hook({ reader: 'child-a', lastFiled: null,
      cards: [card({ state: 'filed', learnerId: 'child-a', outcome: 'finished-new' }), card({ id: 'c2' })] });
    render(<BookPile {...props} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Ada' })).toBeTruthy();
  });
});


// Book-scan experience task 3: an open shelf counts what is waiting for it.
describe('BookPile — hands an open shelf its waiting cards', () => {
  it('reports only cards scanned after the shelf opened, unfiled and openable, with intent and superseded flag', async () => {
    const onShelfCards = vi.fn();
    const before = card({ id: 'old', intentId: 'i-old' });
    h.state = hook({ cards: [before] });
    const r = render(<BookPile {...props} onShelfCards={onShelfCards} />);
    r.rerender(<BookPile {...props} scopeLearnerId="child-a" onShelfCards={onShelfCards} />);
    expect(onShelfCards).toHaveBeenLastCalledWith([]);
    h.state = hook({ cards: [
      before,
      card({ id: 'a', intentId: 'i-a', isbn13: '9780763648602', book: { title: 'Book Three' }, superseded: true }),
      card({ id: 'b', intentId: 'i-b', isbn13: '9780763691677', book: null }),
      card({ id: 'bad', intentId: 'i-bad', status: 'invalid' }),
      card({ id: 'gone', intentId: 'i-gone', state: 'claimed' }),
    ] });
    r.rerender(<BookPile {...props} scopeLearnerId="child-a" onShelfCards={onShelfCards} />);
    expect(onShelfCards).toHaveBeenLastCalledWith([
      { id: 'a', intentId: 'i-a', isbn13: '9780763648602', label: 'Book Three', superseded: true },
      { id: 'b', intentId: 'i-b', isbn13: '9780763691677', label: '9780763691677', superseded: false },
    ]);
    r.rerender(<BookPile {...props} scopeLearnerId={null} onShelfCards={onShelfCards} />);
    expect(onShelfCards).toHaveBeenLastCalledWith(null);
  });
});
