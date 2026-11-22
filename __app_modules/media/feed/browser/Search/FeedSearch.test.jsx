import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ api: vi.fn(), mutate: vi.fn(), applyPending: items => items, revision: 0 }));

vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: mocks.api }));
vi.mock("../FeedWorkspaceContext.jsx", () => ({
  useFeedWorkspace: () => ({
    mutateItems: mocks.mutate, applyPendingMutations: mocks.applyPending, itemSyncRevision: mocks.revision,
  }),
}));

import FeedSearch from "./FeedSearch.jsx";

describe('FeedSearch', () => {
  beforeEach(() => {
    mocks.api.mockReset();
    mocks.mutate.mockReset();
    mocks.revision = 0;
    mocks.api.mockImplementation(url => Promise.resolve(url.includes('cursor=')
      ? { items: [{ id: 'two', stateKey: 'two', title: 'Second result', state: { isSaved: true } }], total: 2, nextCursor: null, coverage: { retentionMonths: 12, status: 'complete' } }
      : { items: [{ id: 'one', stateKey: 'one', title: 'Saved result', state: { isSaved: true } }], total: 2, nextCursor: 'MQ', coverage: { retentionMonths: 12, status: 'complete' } }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test('refreshes indexing only in the foreground and keeps an appended page, cursor and local save', async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const item = (id) => ({ id, stateKey: id, title: id, state: {} });
    const response = (id, nextCursor) => ({
      items: [item(id)], nextCursor, total: 4,
      coverage: { status: 'running', indexed: 1, retentionMonths: 12 },
    });
    let finishPage;
    mocks.api.mockImplementation(url => url.includes('cursor=page2')
      ? new Promise(resolve => { finishPage = resolve; })
      : Promise.resolve(response('First', 'page2')));
    let finishSave;
    mocks.mutate.mockImplementation(([row], action, { onApply }) => {
      onApply([{ ...row, state: { isSaved: true } }]);
      return new Promise(resolve => { finishSave = resolve; });
    });

    await act(async () => render(<MemoryRouter initialEntries={['/feed/search?q=birds']}><FeedSearch /></MemoryRouter>));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    visibility.mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(mocks.api).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('visible');
    await act(async () => fireEvent(document, new Event('visibilitychange')));
    expect(mocks.api).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Saved' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Load more (1 of 4)' }));
    visibility.mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    visibility.mockReturnValue('visible');
    fireEvent(document, new Event('visibilitychange'));
    await act(() => vi.advanceTimersByTimeAsync(4500));
    expect(mocks.api).toHaveBeenCalledTimes(3);
    expect(mocks.api.mock.lastCall[3].signal.aborted).toBe(false);
    await act(async () => finishPage(response('Second', 'page3')));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByRole('heading', { name: 'Second' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Saved' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Search feed history' })).toHaveValue('birds');
    let finishOlderPoll;
    mocks.api.mockImplementationOnce(() => new Promise(resolve => { finishOlderPoll = resolve; }));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    await act(async () => finishSave());
    await act(async () => finishOlderPoll(response('First', 'page2')));
    expect(screen.getByRole('button', { name: 'Saved' })).toBeVisible();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(screen.queryByRole('button', { name: 'Saved' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Second' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Load more (2 of 4)' }));
    expect(mocks.api.mock.lastCall[0]).toContain('cursor=page3');
  });

  test('a submitted query supersedes an in-flight poll even if the transport delivers the old reply', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const page = (title, status) => ({
      items: [{ id: title, title }], total: 1, coverage: { status, indexed: 1, retentionMonths: 12 },
    });
    let finishPoll;
    mocks.api.mockResolvedValueOnce(page('Old match', 'running'))
      .mockImplementationOnce(() => new Promise(resolve => { finishPoll = resolve; }))
      .mockResolvedValueOnce(page('New match', 'complete'));
    await act(async () => render(<MemoryRouter initialEntries={['/feed/search?q=old']}><FeedSearch /></MemoryRouter>));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    const pollSignal = mocks.api.mock.lastCall[3].signal;
    fireEvent.change(screen.getByRole('textbox', { name: 'Search feed history' }), { target: { value: 'new' } });
    await act(async () => fireEvent.submit(screen.getByRole('search')));
    expect(pollSignal.aborted).toBe(true);
    await act(async () => finishPoll(page('Late match', 'running')));
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(screen.getByRole('heading', { name: 'New match' })).toBeVisible();
    expect(screen.queryByText('Late match')).toBeNull();
    expect(mocks.api).toHaveBeenCalledTimes(3);
    expect(mocks.api.mock.lastCall[0]).toContain('q=new');
  });

  test('a stalled indexing poll releases the slot silently and cannot publish a late reply', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const page = (title, status) => ({
      items: [{ id: title, title }], total: 1, coverage: { status, indexed: 1, retentionMonths: 12 },
    });
    const stalled = Promise.withResolvers();
    mocks.api.mockResolvedValueOnce(page('Initial match', 'running'))
      .mockReturnValueOnce(stalled.promise)
      .mockResolvedValue(page('Accepted match', 'complete'));
    await act(async () => render(<MemoryRouter><FeedSearch /></MemoryRouter>));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    const signal = mocks.api.mock.lastCall[3].signal;
    await act(() => vi.advanceTimersByTimeAsync(8000));
    expect(mocks.api).toHaveBeenCalledTimes(2);
    expect(signal.aborted).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(signal.aborted).toBe(true);
    expect(mocks.api).toHaveBeenCalledTimes(3);
    await act(async () => stalled.resolve(page('Expired match', 'running')));
    expect(screen.getByRole('heading', { name: 'Accepted match' })).toBeVisible();
    expect(screen.queryByText('Expired match')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('replay reconciliation replaces indexing and an obsolete reconciliation', async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const snapshot = (title, status = 'running') => ({
      items: [{ id: 'bird', title }], total: 1, coverage: { status, retentionMonths: 12 },
    });
    const indexing = Promise.withResolvers();
    const firstReplay = Promise.withResolvers();
    mocks.api.mockResolvedValueOnce(snapshot('Original birds'))
      .mockReturnValueOnce(indexing.promise)
      .mockReturnValueOnce(firstReplay.promise)
      .mockResolvedValueOnce(snapshot('Latest birds', 'complete'));
    const search = () => <MemoryRouter><FeedSearch /></MemoryRouter>;
    const view = await act(async () => render(search()));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    const indexingSignal = mocks.api.mock.lastCall[3].signal;
    await act(async () => { mocks.revision = 1; view.rerender(search()); });
    const replaySignal = mocks.api.mock.lastCall[3].signal;
    expect(mocks.api).toHaveBeenCalledTimes(3);
    expect(indexingSignal.aborted).toBe(true);
    visibility.mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    visibility.mockReturnValue('visible');
    fireEvent(document, new Event('visibilitychange'));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(mocks.api).toHaveBeenCalledTimes(3);
    expect(replaySignal.aborted).toBe(false);
    await act(async () => { mocks.revision = 2; view.rerender(search()); });
    expect(replaySignal.aborted).toBe(true);
    expect(mocks.api).toHaveBeenCalledTimes(4);
    await act(async () => {
      indexing.resolve(snapshot('Retired indexing'));
      firstReplay.reject(new Error('Retired reconciliation'));
    });
    expect(screen.getByRole('heading', { name: 'Latest birds' })).toBeVisible();
    expect(screen.queryByText('Retired indexing')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('replay waits for a stalled append to expire and supplies the next accepted cursor', async () => {
    vi.useFakeTimers();
    const snapshot = (title, nextCursor = null) => ({ items: [{ id: title, title, state: { isSaved: true } }], total: 2, nextCursor });
    const append = Promise.withResolvers();
    mocks.api.mockResolvedValueOnce(snapshot('Original bird', 'original-cursor'))
      .mockReturnValueOnce(append.promise)
      .mockResolvedValueOnce(snapshot('Reconciled bird', 'accepted-cursor'))
      .mockResolvedValueOnce(snapshot('More birds'));
    const search = () => <MemoryRouter initialEntries={['/feed/search?state=saved']}><FeedSearch /></MemoryRouter>;
    const view = await act(async () => render(search()));
    fireEvent.click(screen.getByRole('button', { name: 'Load more (1 of 2)' }));
    const expiredSignal = mocks.api.mock.lastCall[3].signal;
    await act(async () => { mocks.revision = 1; view.rerender(search()); });
    expect(mocks.api).toHaveBeenCalledTimes(2);
    expect(expiredSignal.aborted).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(expiredSignal.aborted).toBe(true);
    expect(mocks.api).toHaveBeenCalledTimes(3);
    expect(mocks.api.mock.lastCall[0]).not.toContain('cursor=');
    expect(screen.getByRole('heading', { name: 'Reconciled bird' })).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Load more (1 of 2)' })));
    expect(mocks.api.mock.lastCall[0]).toContain('cursor=accepted-cursor');
    await act(async () => append.resolve(snapshot('Expired bird')));
    expect(screen.getByRole('heading', { name: 'More birds' })).toBeVisible();
    expect(screen.queryByText('Expired bird')).toBeNull();
  });

  test('browses filtered history without requiring a query and paginates', async () => {
    render(<MemoryRouter initialEntries={['/feed/search?state=saved']}><FeedSearch /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Saved result' })).toBeInTheDocument();
    expect(mocks.api).toHaveBeenCalledWith(expect.stringContaining('state=saved'), {}, 'GET', expect.any(Object));
    expect(screen.getByText('2 results · 12-month history')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more (1 of 2)' }));
    expect(await screen.findByRole('heading', { name: 'Second result' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.api).toHaveBeenLastCalledWith(expect.stringContaining('cursor=MQ'), {}, 'GET', expect.any(Object)));
  });

  test('removes an item from the Saved filter on optimistic unsave and restores it on rollback', async () => {
    let rollback;
    mocks.api.mockResolvedValue({ items: [{ id: 'one', stateKey: 'one', title: 'Saved result', state: { isSaved: true } }],
      total: 1, nextCursor: null, coverage: { retentionMonths: 12, status: 'complete' } });
    mocks.mutate.mockImplementation(([item], _action, { onApply }) => {
      onApply([{ ...item, state: { ...item.state, isSaved: false } }]);
      return new Promise((_resolve, reject) => {
        rollback = () => {
          onApply([item]);
          reject(new Error('write failed'));
        };
      });
    });
    render(<MemoryRouter initialEntries={['/feed/search?state=saved']}><FeedSearch /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Saved result' });
    const saved = screen.getByRole('button', { name: 'Saved' });
    saved.focus();
    fireEvent.click(saved);

    expect(await screen.findByText('No matching items in indexed history.')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Saved result' })).toBeNull();
    expect(screen.getByText('0 results · 12-month history')).toBeVisible();
    const results = screen.getByRole('region', { name: 'Search your feed' });
    await waitFor(() => expect(results).toHaveFocus());

    await act(async () => rollback());
    expect(await screen.findByRole('heading', { name: 'Saved result' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Saved' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('1 result · 12-month history')).toBeVisible();
  });

  test('refills an offset-paginated Saved result window after an online unsave', async () => {
    const item = id => ({ id: `item-${id}`, stateKey: `item-${id}`, title: `Result ${id}`, state: { isSaved: true } });
    const firstPage = Array.from({ length: 30 }, (_, index) => item(index + 1));
    const refreshedPage = Array.from({ length: 30 }, (_, index) => item(index + 2));
    mocks.api.mockResolvedValueOnce({ items: firstPage, total: 31, nextCursor: '30', coverage: { retentionMonths: 12, status: 'complete' } })
      .mockResolvedValueOnce({ items: refreshedPage, total: 30, nextCursor: null, coverage: { retentionMonths: 12, status: 'complete' } });
    mocks.mutate.mockImplementation(async ([row], action, { onApply, onSettled }) => {
      onApply([{ ...row, state: { ...row.state, isSaved: false } }]);
      onSettled({ action, queued: false });
      return { items: [{ id: row.id, state: { isSaved: false } }] };
    });

    render(<MemoryRouter initialEntries={['/feed/search?state=saved']}><FeedSearch /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Result 1' })).toBeVisible();
    fireEvent.click(screen.getAllByRole('button', { name: 'Saved' })[0]);

    expect(await screen.findByRole('heading', { name: 'Result 31' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Result 1' })).toBeNull();
    expect(screen.getByText('30 results · 12-month history')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Load more/ })).toBeNull();
    expect(mocks.api).toHaveBeenCalledTimes(2);
    expect(mocks.api.mock.lastCall[0]).not.toContain('cursor=');
  });

  test('waits for Load more to settle before reconciling a Saved membership change', async () => {
    const item = id => ({ id: `item-${id}`, stateKey: `item-${id}`, title: `Result ${id}`, state: { isSaved: true } });
    const page = (start, count, total, nextCursor) => ({
      items: Array.from({ length: count }, (_, index) => item(start + index)), total, nextCursor,
      coverage: { retentionMonths: 12, status: 'complete' },
    });
    let finishAppend;
    let cursorReads = 0;
    let noCursorReads = 0;
    mocks.api.mockImplementation(url => {
      const cursor = new URL(url, 'http://local').searchParams.get('cursor');
      if (cursor === '30' && cursorReads++ === 0) return new Promise(resolve => { finishAppend = resolve; });
      if (cursor === '30') return Promise.resolve(page(32, 30, 60, null));
      return Promise.resolve(noCursorReads++ === 0 ? page(1, 30, 61, '30') : page(2, 30, 60, '30'));
    });
    mocks.mutate.mockImplementation(async ([row], action, { onApply, onSettled }) => {
      onApply([{ ...row, state: { ...row.state, isSaved: false } }]);
      onSettled({ action, queued: false });
      return { items: [{ id: row.id, state: { isSaved: false } }] };
    });

    render(<MemoryRouter initialEntries={['/feed/search?state=saved']}><FeedSearch /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Result 1' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Load more (30 of 61)' }));
    await waitFor(() => expect(finishAppend).toBeTypeOf('function'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Saved' })[0]);

    await act(async () => finishAppend(page(31, 30, 61, '60')));
    expect(await screen.findByRole('heading', { name: 'Result 61' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Result 1' })).toBeNull();
    expect(screen.getByText('60 results · 12-month history')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Loading…' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Load more/ })).toBeNull();
  });

  test('restores a sole Saved result through Undo after reconciliation emptied the list', async () => {
    const savedItem = { id: 'one', stateKey: 'one', title: 'Saved result', state: { isSaved: true } };
    let undo;
    mocks.api.mockResolvedValueOnce({ items: [savedItem], total: 1, nextCursor: null, coverage: { retentionMonths: 12, status: 'complete' } })
      .mockResolvedValueOnce({ items: [], total: 0, nextCursor: null, coverage: { retentionMonths: 12, status: 'complete' } })
      .mockResolvedValueOnce({ items: [savedItem], total: 1, nextCursor: null, coverage: { retentionMonths: 12, status: 'complete' } });
    mocks.mutate.mockImplementation(async ([row], action, { onApply, onSettled }) => {
      if (action === 'unsave') {
        onApply([{ ...row, state: { ...row.state, isSaved: false } }]);
        onSettled({ action, queued: false });
        undo = () => {
          onApply([savedItem]);
          onSettled({ action: 'save', queued: false });
        };
      }
      return { items: [{ id: row.id, state: { isSaved: action === 'save' } }] };
    });

    render(<MemoryRouter initialEntries={['/feed/search?state=saved']}><FeedSearch /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Saved result' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Saved' }));
    expect(await screen.findByText('No matching items in indexed history.')).toBeVisible();
    expect(screen.getByText('0 results · 12-month history')).toBeVisible();

    await act(async () => undo());

    expect(await screen.findByRole('heading', { name: 'Saved result' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Saved' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('1 result · 12-month history')).toBeVisible();
    expect(mocks.api).toHaveBeenCalledTimes(3);
  });

  test('reconciles Undo against the current query after navigation from the originating search', async () => {
    const savedItem = { id: 'one', stateKey: 'one', title: 'Birds', state: { isSaved: true } };
    let undo;
    let birdSearches = 0;
    mocks.api.mockImplementation(url => {
      const params = new URL(url, 'http://local').searchParams;
      if (params.get('q') === 'birds' && birdSearches++ > 0) return Promise.resolve({ items: [savedItem], total: 1, nextCursor: null, coverage: { retentionMonths: 12, status: 'complete' } });
      if (params.get('q') === 'birds') return Promise.resolve({ items: [], total: 0, nextCursor: null, coverage: { retentionMonths: 12, status: 'complete' } });
      return Promise.resolve({ items: [savedItem], total: 1, nextCursor: null, coverage: { retentionMonths: 12, status: 'complete' } });
    });
    mocks.mutate.mockImplementation(async ([row], action, { onApply, onSettled }) => {
      if (action === 'unsave') {
        onApply([{ ...row, state: { ...row.state, isSaved: false } }]);
        onSettled({ action, queued: false });
        undo = () => {
          onApply([savedItem]);
          onSettled({ action: 'save', queued: false });
        };
      }
      return { items: [{ id: row.id, state: { isSaved: action === 'save' } }] };
    });

    render(<MemoryRouter initialEntries={['/feed/search?state=saved']}><FeedSearch /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Birds' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Saved' }));
    expect(await screen.findByText('No matching items in indexed history.')).toBeVisible();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search feed history' }), { target: { value: 'birds' } });
    fireEvent.submit(screen.getByRole('search'));
    expect(await screen.findByText('No matching items in indexed history.')).toBeVisible();

    await act(async () => undo());

    expect(await screen.findByRole('heading', { name: 'Birds' })).toBeVisible();
    expect(screen.getByText('1 result · 12-month history')).toBeVisible();
    expect(mocks.api).toHaveBeenCalledTimes(4);
    expect(mocks.api.mock.lastCall[0]).toContain('q=birds');
  });

  test('hides the previous query and its continuation while a new query loads or retries', async () => {
    const page = (title, nextCursor) => ({
      items: [{ id: title, title }], total: 2, nextCursor,
      coverage: { status: 'complete', retentionMonths: 12 },
    });
    let rejectSearch;
    mocks.api.mockResolvedValueOnce(page('Old match', 'old-page'))
      .mockImplementationOnce(() => new Promise((resolve, reject) => { rejectSearch = reject; }))
      .mockResolvedValueOnce(page('New match', 'new-page'))
      .mockResolvedValueOnce(page('New second match', null));
    render(<MemoryRouter initialEntries={['/feed/search?q=old']}><FeedSearch /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Old match' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Load more (1 of 2)' })).toBeEnabled();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search feed history' }), { target: { value: 'new' } });
    fireEvent.submit(screen.getByRole('search'));
    expect(screen.getByText('Searching…')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Old match' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Load more/ })).toBeNull();
    expect(screen.queryByText('2 results · 12-month history')).toBeNull();

    await act(async () => rejectSearch(new Error('Unavailable')));
    expect(screen.getByRole('alert')).toHaveTextContent('Search could not be completed.');
    expect(screen.queryByRole('heading', { name: 'Old match' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Load more/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'New match' })).toBeVisible();
    expect(mocks.api.mock.lastCall[0]).toContain('q=new');
    expect(mocks.api.mock.lastCall[0]).not.toContain('cursor=');

    fireEvent.click(screen.getByRole('button', { name: 'Load more (1 of 2)' }));
    expect(await screen.findByRole('heading', { name: 'New second match' })).toBeVisible();
    expect(mocks.api.mock.lastCall[0]).toContain('q=new');
    expect(mocks.api.mock.lastCall[0]).toContain('cursor=new-page');
  });

  test('exposes read, save, and archive controls for every result', async () => {
    render(<MemoryRouter initialEntries={['/feed/search']}><FeedSearch /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Saved result' });
    expect(screen.getByRole('button', { name: 'Saved' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark read' })).toBeInTheDocument();
  });
});
