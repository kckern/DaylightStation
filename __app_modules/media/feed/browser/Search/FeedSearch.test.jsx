import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ api: vi.fn(), mutate: vi.fn(), applyPending: items => items }));

vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: mocks.api }));
vi.mock("../FeedWorkspaceContext.jsx", () => ({ useFeedWorkspace: () => ({ mutateItems: mocks.mutate, applyPendingMutations: mocks.applyPending }) }));

import FeedSearch from "./FeedSearch.jsx";

describe('FeedSearch', () => {
  beforeEach(() => {
    mocks.api.mockReset();
    mocks.mutate.mockReset();
    mocks.api.mockImplementation(url => Promise.resolve(url.includes('cursor=')
      ? { items: [{ id: 'two', stateKey: 'two', title: 'Second result', state: {} }], total: 2, nextCursor: null, coverage: { retentionMonths: 12, status: 'complete' } }
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

  test('browses filtered history without requiring a query and paginates', async () => {
    render(<MemoryRouter initialEntries={['/feed/search?state=saved']}><FeedSearch /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Saved result' })).toBeInTheDocument();
    expect(mocks.api).toHaveBeenCalledWith(expect.stringContaining('state=saved'), {}, 'GET', expect.any(Object));
    expect(screen.getByText('2 results · 12-month history')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more (1 of 2)' }));
    expect(await screen.findByRole('heading', { name: 'Second result' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.api).toHaveBeenLastCalledWith(expect.stringContaining('cursor=MQ'), {}, 'GET', expect.any(Object)));
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
