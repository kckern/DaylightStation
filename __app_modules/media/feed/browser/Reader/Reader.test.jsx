import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import FeedPlayerSheet from '../players/FeedPlayerSheet.jsx';
import { FeedPlayerProvider } from '../players/FeedPlayerContext.jsx';
import Reader from "./Reader.jsx";
import { listOfflineEditions } from '../offline/feedOfflineStore.js';

const { apiMock, workspaceMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  workspaceMock: {
    getSnapshot: () => null,
    setSnapshot: vi.fn(),
    getLastVisit: () => null,
    markVisited: vi.fn(),
    mutateItems: vi.fn().mockResolvedValue({ items: [] }),
    applyPendingMutations: items => items,
    checkpoints: {},
  },
}));
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: (...args) => apiMock(...args) }));
vi.mock("../FeedWorkspaceContext.jsx", () => ({
  useFeedWorkspace: () => workspaceMock,
}));
vi.mock("../Scroll/hooks/useVirtualFeedWindow.js", () => ({
  useVirtualFeedWindow: (_ref, rows) => ({ items: rows, paddingTop: 0, paddingBottom: 0, measureRef: () => () => {} }),
}));

vi.mock('../offline/feedOfflineStore.js', async importOriginal => ({
  ...await importOriginal(),
  listOfflineEditions: vi.fn(),
}));

function mountReader(query = '') {
  return render(<MemoryRouter initialEntries={[`/feed/reader${query}`]}><Routes><Route path="/feed/reader" element={<Reader />} /></Routes></MemoryRouter>);
}

function article(id) {
  return { id, stateKey: id, title: id, published: '2026-07-01T12:00:00Z', state: { isSaved: true } };
}

function observeSentinel() {
  let callback;
  vi.stubGlobal('IntersectionObserver', class {
    constructor(onIntersect) { this.onIntersect = onIntersect; }
    observe() { callback = this.onIntersect; }
    disconnect() { callback = null; }
  });
  return async ({ ifObserved = false } = {}) => {
    if (!ifObserved) await waitFor(() => expect(callback).toBeTypeOf('function'));
    act(() => { callback?.([{ isIntersecting: true }]); });
  };
}

afterEach(() => {
  delete workspaceMock.itemSyncRevision;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Reader history views', () => {
  beforeEach(() => {
    apiMock.mockReset().mockImplementation(path => {
      if (path === '/api/v1/feed/reader/feeds') return Promise.resolve([]);
      if (path.startsWith('/api/v1/feed/search?')) return Promise.resolve({
        items: [{ id: 'old-saved', stateKey: 'old-saved', title: 'Saved from last month', summary: 'Durable history result', url: 'https://example.test/saved', publishedAt: '2026-07-01T12:00:00Z', sourceInfo: { label: 'World', type: 'freshrss' }, origins: ['reader'], state: { isRead: true, isSaved: true, isArchived: false } }],
        nextCursor: null,
      });
      if (path.startsWith('/api/v1/feed/reader/stream')) return Promise.reject(new Error('state views must not use the recent stream'));
      return Promise.resolve({ annotations: [] });
    });
  });

  test('subscription failure leaves the inbox available and Retry reloads subscriptions', async () => {
    let attempts = 0;
    apiMock.mockImplementation(path => {
      if (path === '/api/v1/feed/reader/feeds') {
        attempts += 1;
        return attempts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve([
          { id: 'world', title: 'World', categories: [{ id: 'news', label: 'News' }] },
        ]);
      }
      if (path.startsWith('/api/v1/feed/reader/stream')) return Promise.resolve({ items: [], nextCursor: null });
      return Promise.resolve({ items: [], nextCursor: null });
    });

    mountReader();
    expect(await screen.findByRole('status')).toHaveTextContent('Subscriptions are unavailable. The inbox can still be used.');
    expect(screen.getByLabelText('Subscriptions')).toBeInTheDocument();
    expect(attempts).toBe(1);

    await screen.getByRole('button', { name: 'Retry' }).click();
    await waitFor(() => expect(attempts).toBe(2));
    expect(screen.queryByText('Subscriptions are unavailable. The inbox can still be used.')).toBeNull();
  });

  test('loads Saved from canonical Reader history instead of the three-day stream', async () => {
    mountReader('?view=saved');
    expect(await screen.findByText('Saved from last month')).toBeInTheDocument();
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(expect.stringContaining('/api/v1/feed/search?state=saved&mode=reader'), {}, 'GET', expect.anything()));
    expect(apiMock.mock.calls.some(([path]) => path.startsWith('/api/v1/feed/reader/stream'))).toBe(false);
  });

  test('retries every previously loaded page after item synchronization', async () => {
    const intersect = observeSentinel();
    let secondPageReads = 0;
    apiMock.mockImplementation(async path => {
      if (path.includes('/feeds')) return [];
      if (!path.includes('cursor=next')) return { items: [article('first')], nextCursor: 'next' };
      secondPageReads++;
      if (secondPageReads === 2) throw new Error('offline');
      return { items: [article(secondPageReads === 1 ? 'previous' : 'updated')] };
    });
    const view = () => <MemoryRouter initialEntries={['/feed/reader?view=saved']}><Reader /></MemoryRouter>;
    const { rerender } = render(view());
    await screen.findByText('first');
    await intersect();
    await screen.findByText('previous');

    workspaceMock.itemSyncRevision = 1;
    rerender(view());
    await screen.findByText('Articles could not be refreshed.');
    expect(screen.getByText('previous')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('updated')).toBeInTheDocument();
    expect(screen.getByText('first')).toBeInTheDocument();
  });

  test('a late item-sync read retains newer writes while reconciling other rows', async () => {
    const held = Promise.withResolvers();
    const initial = ['edited', 'other'].map(id => ({ ...article(id), state: { isRead: true, isSaved: true } }));
    let reads = 0;
    apiMock.mockImplementation(async path => {
      if (path.includes('/feeds')) return [];
      if (path.includes('/stream?')) return ++reads === 1 ? { items: initial, exhausted: true } : held.promise;
      return { annotations: [] };
    });
    workspaceMock.mutateItems.mockImplementationOnce(async ([item], action, { onApply }) => {
      expect(action).toBe('unsave');
      onApply([{ ...item, state: { isRead: true, isSaved: false } }]);
    });
    const view = () => <MemoryRouter initialEntries={['/feed/reader']}><Reader /></MemoryRouter>;
    const { rerender } = render(view());
    fireEvent.click((await screen.findByText('edited')).closest('button'));
    workspaceMock.itemSyncRevision = 1;
    rerender(view());
    await waitFor(() => expect(reads).toBe(2));
    fireEvent.click(screen.getByRole('button', { name: 'Saved', exact: true }));
    await screen.findByRole('button', { name: 'Save', exact: true });
    await act(async () => held.resolve({
      items: [initial[0], { ...initial[1], title: 'refreshed other' }], exhausted: true,
    }));
    expect(screen.getByText('refreshed other')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save', exact: true })).toBeInTheDocument();
  });

  test.each(['resolve', 'reject'])('ignores superseded history append on %s while the new stream appends', async outcome => {
    const intersect = observeSentinel();
    const historyAppend = Promise.withResolvers();
    const streamAppend = Promise.withResolvers();
    apiMock.mockImplementation(path => {
      if (path.includes('/feeds')) return Promise.resolve([]);
      if (path.includes('cursor=old')) return historyAppend.promise;
      if (path.includes('/search?')) return Promise.resolve({ items: [article('saved article')], nextCursor: 'old' });
      if (path.includes('continuation=fresh')) return streamAppend.promise;
      return Promise.resolve({ items: [article('recent article')], continuation: 'fresh' });
    });
    mountReader('?view=saved');
    await screen.findByText('saved article');
    await intersect();
    expect(screen.getByText('Loading more...')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'all', exact: true }));
    await screen.findByText('recent article');
    await intersect();
    expect(screen.getByText('Loading more...')).toBeInTheDocument();
    await act(async () => {
      if (outcome === 'resolve') historyAppend.resolve({ items: [article('obsolete article')], nextCursor: null });
      else historyAppend.reject(new Error('superseded'));
    });
    expect(screen.queryByText('obsolete article')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Loading more...')).toBeInTheDocument();
    await act(async () => streamAppend.resolve({ items: [article('fresh page')], exhausted: true }));
    expect(screen.getByText('fresh page')).toBeInTheDocument();
    expect(screen.getByText('End of Available Articles')).toBeInTheDocument();
  });

  test('pauses pagination on append failure until Retry requests the same cursor', async () => {
    const intersect = observeSentinel();
    const retry = Promise.withResolvers();
    const pageRequests = [];
    apiMock.mockImplementation(path => {
      if (path.includes('/feeds')) return Promise.resolve([]);
      if (path.includes('continuation=next')) {
        pageRequests.push(path);
        return pageRequests.length === 1 ? Promise.reject(new Error('page unavailable')) : retry.promise;
      }
      return Promise.resolve({ items: [article('first page')], continuation: 'next' });
    });
    mountReader();
    await screen.findByText('first page');
    await intersect();
    await screen.findByRole('alert');
    await intersect({ ifObserved: true });
    expect(pageRequests).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByText('first page')).toBeInTheDocument();
    expect(pageRequests).toEqual([pageRequests[0], pageRequests[0]]);
    await act(async () => retry.resolve({ items: [article('second page')], exhausted: true }));
    expect(screen.getByText('first page')).toBeInTheDocument();
    expect(screen.getByText('second page')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('a failed filter change never displays or paginates the previous route', async () => {
    observeSentinel();
    apiMock.mockImplementation(path => {
      if (path.includes('/feeds')) return Promise.resolve([]);
      if (path.includes('/search?')) return Promise.resolve({ items: [article('saved article')], nextCursor: 'history-cursor' });
      return Promise.reject(new Error('recent stream unavailable'));
    });
    const { container } = mountReader('?view=saved');
    await screen.findByText('saved article');
    fireEvent.click(screen.getByRole('button', { name: 'all', exact: true }));
    await screen.findByRole('alert');
    expect(screen.queryByText('saved article')).toBeNull();
    expect(container.querySelector('.reader-sentinel')).toBeNull();
  });

  test('the expanded player owns focus until Reader list navigation resumes', async () => {
    mountReader('?view=saved');
    const row = (await screen.findByText('Saved from last month')).closest('button');
    row.scrollIntoView = vi.fn();
    const player = render(<FeedPlayerProvider>
      <FeedPlayerSheet open item={{ title: 'Playing' }} onClose={() => {}} />
    </FeedPlayerProvider>);
    const close = screen.getByRole('button', { name: 'Close player' });
    close.focus();
    fireEvent.keyDown(close, { key: 'j' });
    fireEvent.keyDown(close, { key: 'k' });
    expect(close).toHaveFocus();
    expect(row.scrollIntoView).not.toHaveBeenCalled();

    player.unmount();
    fireEvent.keyDown(document, { key: 'j', repeat: true });
    expect(row).toHaveFocus();
    expect(row.scrollIntoView).toHaveBeenCalledOnce();
  });

  test('centers the focused article using the current motion preference', async () => {
    let reducedMotion = true;
    const matchMedia = window.matchMedia.bind(window);
    vi.spyOn(window, 'matchMedia').mockImplementation(query => (
      query === '(prefers-reduced-motion: reduce)'
        ? { get matches() { return reducedMotion; } }
        : matchMedia(query)
    ));
    apiMock.mockImplementation(async path => {
      if (path === '/api/v1/feed/reader/feeds') return [];
      if (path.startsWith('/api/v1/feed/search?')) {
        return { items: [article('First article'), article('Second article')], nextCursor: null };
      }
      return {};
    });

    mountReader('?view=saved');
    const first = (await screen.findByText('First article')).closest('button');
    const second = screen.getByText('Second article').closest('button');
    first.scrollIntoView = vi.fn();
    second.scrollIntoView = vi.fn();

    fireEvent.keyDown(document, { key: 'j' });
    expect(first).toHaveFocus();
    expect(first.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'center', behavior: 'instant' });

    reducedMotion = false;
    fireEvent.keyDown(first, { key: 'j' });
    expect(second).toHaveFocus();
    expect(second.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'center', behavior: 'smooth' });
  });

  test('keeps article shortcuts inactive while subscriptions has modal focus', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} });
    mountReader('?view=saved');
    const title = await screen.findByText('Saved from last month');
    const header = title.closest('button');
    header.scrollIntoView = vi.fn();
    fireEvent.click(screen.getByRole('button', { name: 'Open subscriptions' }));
    const dialog = screen.getByRole('dialog', { name: 'Subscriptions' });
    fireEvent.keyDown(dialog, { key: 'j' });
    fireEvent.keyDown(dialog, { key: 'k' });
    expect(header.scrollIntoView).not.toHaveBeenCalled();
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.keyDown(document, { key: 'j' });
    expect(header).toHaveFocus();
    expect(header.scrollIntoView).toHaveBeenCalledOnce();
  });

  test('preserves an open request while the compact media query update is arriving', async () => {
    let compact = false;
    let onChange;
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      get matches() { return compact; },
      addEventListener(_, listener) { onChange = listener; },
      removeEventListener() {},
    });
    mountReader('?view=saved');
    await screen.findByText('Saved from last month');

    compact = true;
    const opener = screen.getByRole('button', { name: 'Open subscriptions' });
    fireEvent.click(opener);
    act(() => onChange({ matches: true }));

    expect(screen.getByRole('dialog', { name: 'Subscriptions' })).toHaveFocus();
    expect(opener).toHaveAttribute('aria-expanded', 'true');
  });

  test('drops an offline retry that resolves after leaving and reopening Offline', async () => {
    const retry = Promise.withResolvers();
    listOfflineEditions.mockRejectedValueOnce(new Error('storage unavailable'))
      .mockReturnValueOnce(retry.promise)
      .mockResolvedValueOnce([{ item: article('current download') }]);
    mountReader('?view=offline');
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'saved', exact: true }));
    await screen.findByText('Saved from last month');
    fireEvent.click(screen.getByRole('button', { name: 'offline', exact: true }));
    await screen.findByText('current download');
    await act(async () => retry.resolve([{ item: article('obsolete download') }]));
    expect(screen.queryByText('obsolete download')).toBeNull();
    expect(screen.getByText('current download')).toBeInTheDocument();
  });
});
