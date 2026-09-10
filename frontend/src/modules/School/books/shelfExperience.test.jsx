import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ shelf: vi.fn(), resolve: vi.fn(), open: vi.fn(), progress: vi.fn(), mode: vi.fn() }));
vi.mock('../schoolApi.js', () => ({ schoolApi: { books: api, roster: vi.fn().mockResolvedValue({ ok: true, data: [] }) } }));
vi.mock('../schoolLog.js', () => ({ schoolLog: { bookShelf: vi.fn(), bookShelfError: vi.fn() } }));
import BookShelf from './BookShelf.jsx';
import { useBookShelf } from './useBookShelf.js';
const ISBN = '9780064400558';
const item = { itemId: 'test:book:1', bookId: ISBN, title: 'Hatchet', authors: ['Gary Paulsen'], pageCount: 195, progressMode: 'page', events: [], projection: { status: 'reading', page: 84, lastAt: '2026-09-06' } };
const finished = { ...item, projection: { ...item.projection, status: 'finished', lastAt: '2026-09-07' }, events: [{ kind: 'finished', at: '2026-09-07', recordedAt: '2026-09-07T15:32:00Z' }] };
const shelf = (items) => ({ ok: true, data: { items, studyDay: '2026-09-07', earliestFinishDay: '2025-09-08', obligation: null } });
const props = { learnerId: 'test', grant: 'grant', idleTimeoutSeconds: 0 };
beforeEach(() => {
  Object.values(api).forEach(fn => fn.mockReset());
  api.shelf.mockResolvedValue(shelf([item]));
  api.resolve.mockResolvedValue({ ok: true, data: { status: 'ok', book: { ...item, isbn13: ISBN } } });
  api.open.mockResolvedValue({ ok: true, data: { item } });
  api.progress.mockResolvedValue({ ok: true, data: { item: finished } });
});
async function lookup(result) {
  act(() => result.current.actions.typeIsbn(ISBN));
  await act(async () => result.current.actions.lookup());
}
describe('shelf experience', () => {
  it('opens ISBN only on the first empty load and respects explicit Back and rereads', async () => {
    api.shelf.mockResolvedValue(shelf([]));
    const { result } = renderHook(() => useBookShelf(props));
    await waitFor(() => expect(result.current.view).toBe('add'));
    expect(result.current.step).toBe('number');
    act(() => result.current.actions.back());
    await act(async () => result.current.actions.retry());
    expect(result.current.view).toBe('shelf');
  });
  it('keeps finished-only books visible and opens completed details with same-day Read again', async () => {
    api.shelf.mockResolvedValue(shelf([finished]));
    render(<BookShelf {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Hatchet' }));
    expect(screen.getByText('Last finished Sep 7, 2026')).toBeInTheDocument();
    expect(screen.getByText(/Recorded /)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finished today' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Read again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finished today' }));
    await screen.findByTestId('book-save-receipt');
    expect(api.open).toHaveBeenCalledTimes(1);
    expect(api.open.mock.calls[0][2]).toMatchObject({ bookId: ISBN, where: 'finished', finishedOn: '2026-09-07' });
  });
  it('combines cover and actions and preserves the ISBN for wrong-book correction', async () => {
    api.shelf.mockResolvedValue(shelf([]));
    render(<BookShelf {...props} />);
    await screen.findByTestId('numberpad');
    // Scanner keys are individual keyboard events.
    for (const key of ISBN) fireEvent.keyDown(window, { key });
    // No button to hunt for: thirteen valid digits are their own instruction,
    // and the pad acts on them after its settle.
    expect(screen.queryByRole('button', { name: 'Look it up' })).toBeNull();
    await screen.findByRole('button', { name: 'Start reading' });
    expect(screen.getByText('Hatchet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finished today' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Wrong book? Edit number' }));
    expect(screen.getByTestId('numberpad-entry').textContent.replace(/\s/g, '')).toBe(ISBN);
    expect(api.open).not.toHaveBeenCalled();
  });
  it('finishes in one tap and shows the shelf, recent finish, and inline Undo', async () => {
    api.shelf.mockResolvedValueOnce(shelf([item])).mockResolvedValue(shelf([finished]));
    render(<BookShelf {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Hatchet' }));
    expect(screen.queryByTestId('numberpad')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Finished today' }));
    const receipt = await screen.findByTestId('book-save-receipt');
    expect(screen.getByTestId('book-shelf-grid')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Book history' })).toBeInTheDocument();
    fireEvent.click(within(receipt).getByRole('button', { name: 'Undo finish' }));
    await waitFor(() => expect(api.progress).toHaveBeenCalledTimes(2));
    expect(api.progress.mock.calls[1][2]).toBe(item.itemId);
    expect(api.progress.mock.calls[1][3].kind).toBe('reopened');
  });
  it('retains success after a read failure and Retry shelf only reads', async () => {
    api.shelf.mockResolvedValueOnce(shelf([item])).mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValue(shelf([finished]));
    render(<BookShelf {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Hatchet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finished today' }));
    await screen.findByTestId('book-save-receipt');
    expect(screen.queryByRole('button', { name: 'Open Hatchet' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry shelf' }));
    await waitFor(() => expect(api.shelf).toHaveBeenCalledTimes(3));
    expect(screen.queryByRole('button', { name: 'Open Hatchet' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry shelf' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByTestId('book-save-receipt')).toHaveTextContent('Book finished!');
    expect(api.progress).toHaveBeenCalledTimes(1);
  });
  it('allocates add IDs before the first action and reuses them on failed-write retry and double taps', async () => {
    api.shelf.mockResolvedValue(shelf([]));
    api.open.mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValue({ ok: true, data: { item } });
    const { result } = renderHook(() => useBookShelf(props));
    await waitFor(() => expect(result.current.view).toBe('add'));
    await lookup(result);
    const entryId = result.current.add.entryId;
    expect(entryId).toBeTruthy();
    await act(async () => result.current.actions.choose('starting'));
    await act(async () => { await Promise.all([result.current.actions.choose('starting'), result.current.actions.choose('starting')]); });
    expect(api.open).toHaveBeenCalledTimes(2);
    expect(api.open.mock.calls[0][2]).toEqual(api.open.mock.calls[1][2]);
    expect(api.open.mock.calls[0][2].entryId).toBe(entryId);
    expect(result.current.view).toBe('shelf');
  });
  it('treats unread matches as existing books without an open write', async () => {
    api.shelf.mockResolvedValue(shelf([{ ...item, projection: { status: 'unread' } }]));
    const { result } = renderHook(() => useBookShelf(props));
    await waitFor(() => expect(result.current.view).toBe('shelf'));
    act(() => result.current.actions.startAdd());
    await lookup(result);
    expect(result.current.add.duplicateOf).toBe(item.itemId);
    act(() => result.current.actions.openDuplicate());
    expect(result.current.view).toBe('update');
    expect(api.open).not.toHaveBeenCalled();
  });
  it('discards the prior learner load when learner changes', async () => {
    let complete;
    api.shelf.mockReturnValueOnce(new Promise(resolve => { complete = resolve; })).mockResolvedValue(shelf([]));
    const { result, rerender } = renderHook(p => useBookShelf(p), { initialProps: props });
    rerender({ ...props, learnerId: 'next', grant: 'next-grant' });
    await waitFor(() => expect(result.current.view).toBe('add'));
    await act(async () => complete(shelf([item])));
    expect(result.current.shelf.items).toHaveLength(0);
    expect(result.current.learner.id).toBe('next');
  });
  it('opens completed details from all history and keeps legacy finishes date-only', async () => {
    api.shelf.mockResolvedValue(shelf([{ ...finished, events: [{ kind: 'finished', at: '2026-09-06T12:00:00Z' }] }]));
    render(<BookShelf {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Hatchet' }));
    expect(screen.getByText('Last finished Sep 6, 2026')).toBeInTheDocument();
    expect(screen.queryByText(/Recorded /)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Read again' })).toBeInTheDocument();
  });
  it('preserves typed page after a write failure and retries the same identity', async () => {
    api.progress.mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValue({ ok: true, data: { item } });
    render(<BookShelf {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Hatchet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Update page' }));
    fireEvent.keyDown(window, { key: '9' });
    fireEvent.keyDown(window, { key: '0' });
    fireEvent.click(screen.getByRole('button', { name: 'Save page' }));
    await screen.findByText("That didn't save — try again");
    expect(screen.getByTestId('numberpad-entry').textContent.replace(/\s/g, '')).toBe('90');
    fireEvent.click(screen.getByRole('button', { name: 'Save page' }));
    await screen.findByTestId('book-save-receipt');
    expect(api.progress).toHaveBeenCalledTimes(2);
    expect(api.progress.mock.calls[0][3]).toEqual(api.progress.mock.calls[1][3]);
  });
  it('orders recent finishes by effective date even when recorded later', async () => {
    api.shelf.mockResolvedValue(shelf([
      { ...finished, itemId: 'late', title: 'Backdated', events: [{ kind: 'finished', at: '2026-09-02T12:00:00Z', recordedAt: '2026-09-07T22:00:00Z' }] },
      { ...finished, itemId: 'new', title: 'Recent', events: [{ kind: 'finished', at: '2026-09-07T12:00:00Z', recordedAt: '2026-09-07T12:01:00Z' }] },
    ]));
    render(<BookShelf {...props} />);
    const history = await screen.findByTestId('book-history');
    // Newest day first; the backdated finish sits under its own day's heading.
    expect(within(history).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['Open Recent', 'Open Backdated']);
    const groups = within(history).getAllByTestId('book-history-group');
    expect(groups.map((g) => g.getAttribute('data-day'))).toEqual(['2026-09-07', '2026-09-02']);
    expect(within(groups[1]).getByRole('heading', { level: 4 })).toHaveTextContent('Wednesday 2 September');
  });

  it('blocks the first-book tile after the first save succeeds but its shelf read fails', async () => {
    api.shelf.mockResolvedValueOnce(shelf([])).mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValue(shelf([item]));
    render(<BookShelf {...props} />);
    await screen.findByTestId('numberpad');
    for (const key of ISBN) fireEvent.keyDown(window, { key });
    fireEvent.click(await screen.findByRole('button', { name: 'Start reading' }));
    await screen.findByRole('button', { name: 'Retry shelf' });
    const first = screen.getByRole('button', { name: /Add your first book/ });
    expect(first).toBeDisabled();
    fireEvent.click(first);
    expect(screen.queryByTestId('add-book')).not.toBeInTheDocument();
    expect(api.open).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry shelf' }));
    await screen.findByRole('button', { name: 'Open Hatchet' });
    expect(screen.getByRole('button', { name: /Add a book/ })).toBeEnabled();
  });
  it('keeps stale tiles blocked after failed Undo while preserving its failure, retry identity, and read retry', async () => {
    api.shelf.mockResolvedValueOnce(shelf([item])).mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValue(shelf([finished]));
    const undoFailure = { ok: false, status: 503, data: { error: { message: 'Undo could not save' } } };
    api.progress.mockResolvedValueOnce({ ok: true, data: { item: finished } }).mockResolvedValue(undoFailure);
    render(<BookShelf {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Hatchet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finished today' }));
    await screen.findByRole('button', { name: 'Retry shelf' });
    fireEvent.click(screen.getByRole('button', { name: 'Undo finish' }));
    await screen.findByText('Undo could not save');
    expect(screen.queryByRole('button', { name: 'Open Hatchet' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add a book/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Retry shelf' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo finish' }));
    await waitFor(() => expect(api.progress).toHaveBeenCalledTimes(3));
    expect(api.progress.mock.calls[1][3]).toEqual(api.progress.mock.calls[2][3]);
    expect(screen.queryByRole('button', { name: 'Open Hatchet' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry shelf' }));
    await screen.findByRole('button', { name: 'Open Hatchet' });
    expect(screen.getByRole('button', { name: /Add a book/ })).toBeEnabled();
    expect(api.progress).toHaveBeenCalledTimes(3);
  });
  it('guards hook navigation against stale shelf data independently of rendered disabled controls', async () => {
    api.shelf.mockResolvedValueOnce(shelf([item])).mockResolvedValueOnce({ ok: false, status: 503 });
    const { result } = renderHook(() => useBookShelf(props));
    await waitFor(() => expect(result.current.view).toBe('shelf'));
    act(() => result.current.actions.openItem(item.itemId));
    await act(async () => result.current.actions.finish('2026-09-07'));
    act(() => result.current.actions.startAdd());
    expect(result.current.view).toBe('shelf');
    act(() => result.current.actions.openItem(item.itemId));
    expect(result.current.view).toBe('shelf');
  });

  // ── Auto-advance: the pad has no button, so the number is the instruction ──
  //
  // ISBN10 is the ten-digit form of this fixture's book; TEN_ONLY is a
  // different valid ISBN-10 used for the case the catalog does not know.
  describe('the ISBN pad fires itself', () => {
    const ISBN10 = '0064400557';
    beforeEach(() => { api.shelf.mockResolvedValue(shelf([])); });

    it('thirteen digits advance with no button anywhere on the pad', async () => {
      render(<BookShelf {...props} />);
      await screen.findByTestId('numberpad');
      expect(screen.queryByRole('button', { name: 'Look it up' })).toBeNull();
      for (const key of ISBN) fireEvent.keyDown(window, { key });
      expect(await screen.findByRole('button', { name: 'Start reading' })).toBeTruthy();
      expect(api.resolve).toHaveBeenCalledWith(ISBN);
    });

    it('ten digits ask the catalog at once and advance on a hit', async () => {
      render(<BookShelf {...props} />);
      await screen.findByTestId('numberpad');
      for (const key of ISBN10) fireEvent.keyDown(window, { key });
      // Fired BEFORE anything moved: the round trip runs under the settle.
      await waitFor(() => expect(api.resolve).toHaveBeenCalledWith(ISBN));
      expect(screen.getByTestId('numberpad')).toBeTruthy();
      expect(await screen.findByRole('button', { name: 'Start reading' }, { timeout: 3000 })).toBeTruthy();
    });

    it('a ten the catalog does not know moves nothing and accuses nobody', async () => {
      api.resolve.mockResolvedValue({ ok: false, status: 404, data: { status: 'not-found', reason: 'no-source' } });
      render(<BookShelf {...props} />);
      await screen.findByTestId('numberpad');
      for (const key of ISBN10) fireEvent.keyDown(window, { key });
      // The child may still be typing the front of a thirteen, so a miss here
      // says nothing — but it must not strand them either.
      const use = await screen.findByRole('button', { name: 'Use this number' }, { timeout: 3000 });
      expect(screen.getByTestId('numberpad')).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByText(/one digit is off/)).toBeNull();
      fireEvent.click(use);
      expect(await screen.findByRole('button', { name: 'Start reading' })).toBeTruthy();
    });

    it('an eleventh digit cancels the ten-digit commit', async () => {
      render(<BookShelf {...props} />);
      await screen.findByTestId('numberpad');
      for (const key of ISBN10) fireEvent.keyDown(window, { key });
      await waitFor(() => expect(api.resolve).toHaveBeenCalledWith(ISBN));
      fireEvent.keyDown(window, { key: ISBN[10] });
      await new Promise((resolve) => { setTimeout(resolve, 1400); });
      // Eleven digits are still typing: no cover, no verdict, no button.
      expect(screen.getByTestId('numberpad')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Start reading' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Use this number' })).toBeNull();
    });
  });

});
