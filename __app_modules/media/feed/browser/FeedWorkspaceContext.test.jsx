import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { useState } from 'react';
import { notifications } from '@mantine/notifications';
import { FeedWorkspaceProvider, useFeedWorkspace } from "./FeedWorkspaceContext.jsx";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock("../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: (...args) => apiMock(...args) }));
vi.mock('@mantine/notifications', () => ({ notifications: { show: vi.fn() } }));

function PreferenceProbe() {
  const { readingPreferences, setReadingPreference, getLastVisit, markVisited, workspaceReady, refreshWorkspace } = useFeedWorkspace();
  return (
    <>
      <output>{JSON.stringify(readingPreferences)}</output>
      <button onClick={() => setReadingPreference('fontScale', 1.3)}>Larger</button>
      <button onClick={() => setReadingPreference('theme', 'sepia')}>Sepia</button>
      <button onClick={() => setReadingPreference('density', 'compact')}>Compact</button>
      <button onClick={() => setReadingPreference('density', 'comfortable')}>Comfortable</button>
      <button onClick={() => refreshWorkspace()}>Refresh preferences</button>
      <button onClick={() => markVisited('reader', '2026-08-24T12:00:00.000Z')}>Visit</button>
      <button onClick={() => markVisited('reader', '2026-08-25T12:00:00.000Z', { itemId: 'two', scrollOffset: 200 })}>Visit again</button>
      <output aria-label="last visit">{getLastVisit('reader') || 'never'}</output>
      <output aria-label="workspace ready">{String(workspaceReady)}</output>
    </>
  );
}

function SourceProbe() {
  const { sourcePreferences, setSourcePreference, refreshWorkspace } = useFeedWorkspace();
  return <>
    <output aria-label="source level">{sourcePreferences.daily || 'normal'}</output>
    {['more', 'less'].map(level => <button key={level} onClick={() => setSourcePreference('daily', level).catch(() => {})}>{level}</button>)}
    <button onClick={() => refreshWorkspace()}>Refresh workspace</button>
  </>;
}

function MutationProbe() {
  const { mutateItems, pendingMutations } = useFeedWorkspace();
  const [error, setError] = useState('');
  const [item, setItem] = useState({ id: 'one', state: { isRead: false, isSaved: false, isArchived: false } });
  return (
    <>
      <output aria-label="saved">{String(item.state.isSaved)}</output>
      <output aria-label="read">{String(item.state.isRead)}</output>
      <output aria-label="failure">{error}</output>
      <output aria-label="pending">{pendingMutations}</output>
      <button onClick={() => mutateItems([item], 'save', { onApply: updated => setItem(updated[0]) }).catch(err => setError(err.message))}>Save item</button>
      <button onClick={() => mutateItems([item], 'read', { onApply: updated => setItem(updated[0]) }).catch(err => setError(err.message))}>Mark item read</button>
    </>
  );
}

function SummaryProbe() {
  const { summary, refreshSummary, retrySync } = useFeedWorkspace();
  return <>
    <output aria-label="unread Reader items">{summary.readerUnread}</output>
    <button onClick={refreshSummary}>Refresh counts</button>
    <button onClick={retrySync}>Retry source sync</button>
  </>;
}

function tokenFor(username) {
  return `header.${btoa(JSON.stringify({ sub: username })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.signature`;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const preferenceSaves = () => apiMock.mock.calls
  .filter(([path, , method]) => path === '/api/v1/feed/workspace/preferences' && method === 'PATCH')
  .map(([, body]) => body);
const storedAppearance = () => JSON.parse(localStorage.getItem('feed:reading-preferences'));


describe('FeedWorkspaceProvider reading preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    apiMock.mockReset().mockResolvedValue({ unread: 0, saved: 0, archived: 0, pendingSync: 0 });
  });

  test('a retired counts read cannot replace the current badge even if its transport ignores abort', async () => {
    const summaries = [];
    apiMock.mockImplementation((path, _data, _method, options) => {
      if (!path.endsWith('/items/state/summary')) return Promise.resolve({ preferencesStored: true });
      const request = deferred();
      summaries.push({ ...request, signal: options.signal });
      return request.promise;
    });
    const view = render(<FeedWorkspaceProvider><SummaryProbe /></FeedWorkspaceProvider>);
    fireEvent.click(screen.getByText('Refresh counts'));
    expect(summaries[0].signal.aborted).toBe(true);
    await act(async () => summaries[1].resolve({ readerUnread: 7 }));
    await act(async () => summaries[0].resolve({ readerUnread: 8 }));
    expect(screen.getByLabelText('unread Reader items')).toHaveTextContent('7');
    fireEvent.click(screen.getByText('Refresh counts'));
    view.unmount();
    expect(summaries[2].signal.aborted).toBe(true);
    await act(async () => summaries[2].resolve({ readerUnread: 9 }));
  });

  test('does not hold an acknowledged offline replay or source retry behind a badge refresh', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    localStorage.setItem('feed:pending-mutations:household', JSON.stringify([
      { id: 'saved', itemIds: ['one'], action: 'save' },
    ]));
    const slowRead = deferred();
    let summaryReads = 0;
    apiMock.mockImplementation(path => {
      if (path.endsWith('/items/state/summary') && ++summaryReads === 2) return slowRead.promise;
      return Promise.resolve({ readerUnread: 1, pendingSync: 0, preferencesStored: true });
    });
    render(<FeedWorkspaceProvider><SummaryProbe /></FeedWorkspaceProvider>);
    await screen.findByText('1');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    fireEvent.click(screen.getByText('Retry source sync'));
    try {
      await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/v1/feed/items/state/retry', {}, 'POST'), { timeout: 750 });
      expect(apiMock.mock.calls.filter(([path]) => path === '/api/v1/feed/items/state')).toHaveLength(1);
    } finally {
      await act(async () => slowRead.resolve({ readerUnread: 9, pendingSync: 0 }));
    }
    expect(screen.getByLabelText('unread Reader items')).toHaveTextContent('1');
  });

  test('finishes a submitted source retry after exit without refreshing or notifying the replacement workspace', async () => {
    const retry = deferred();
    apiMock.mockImplementation(path => path.endsWith('/state/retry') ? retry.promise
      : Promise.resolve({ preferencesStored: true, readerUnread: 2 }));
    const view = render(<FeedWorkspaceProvider><SummaryProbe /></FeedWorkspaceProvider>);
    fireEvent.click(screen.getByText('Retry source sync'));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/v1/feed/items/state/retry', {}, 'POST'));
    view.unmount();
    render(<FeedWorkspaceProvider><SummaryProbe /></FeedWorkspaceProvider>);
    await screen.findByText('2');
    notifications.show.mockClear();
    await act(async () => retry.resolve({ readerUnread: 0, pendingSync: 0 }));
    expect(screen.getByLabelText('unread Reader items')).toHaveTextContent('2');
    expect(apiMock.mock.calls.filter(([path]) => path.endsWith('/items/state/summary'))).toHaveLength(2);
    expect(notifications.show).not.toHaveBeenCalled();
  });

  test('loads persisted preferences and saves updates', async () => {
    localStorage.setItem('feed:reading-preferences', JSON.stringify({ theme: 'sepia', measure: 56 }));
    render(<FeedWorkspaceProvider><PreferenceProbe /></FeedWorkspaceProvider>);

    expect(screen.getByText(/"theme":"sepia"/)).toHaveTextContent('"measure":56');
    fireEvent.click(screen.getByRole('button', { name: 'Larger' }));

    await waitFor(() => expect(JSON.parse(localStorage.getItem('feed:reading-preferences'))).toMatchObject({ theme: 'sepia', measure: 56, fontScale: 1.3 }));

    fireEvent.click(screen.getByRole('button', { name: 'Visit' }));
    expect(localStorage.getItem('feed:last-visit:reader')).toBe('2026-08-24T12:00:00.000Z');
  });

  test('continues syncing preferences and checkpoints when browser writes exceed quota', async () => {
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage full', 'QuotaExceededError');
    });
    try {
      render(<FeedWorkspaceProvider><PreferenceProbe /></FeedWorkspaceProvider>);
      await waitFor(() => expect(screen.getByLabelText('workspace ready')).toHaveTextContent('true'));
      fireEvent.click(screen.getByRole('button', { name: 'Larger' }));
      await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/v1/feed/workspace/preferences', { fontScale: 1.3 }, 'PATCH'));
      fireEvent.click(screen.getByRole('button', { name: 'Visit' }));
      expect(screen.getByLabelText('last visit')).toHaveTextContent('2026-08-24T12:00:00.000Z');
      await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/v1/feed/workspace/checkpoints/reader', expect.any(Object), 'PUT'));
    } finally {
      write.mockRestore();
    }
  });

  test('keeps the newest visit visible across a stale workspace read and checkpoint acknowledgement', async () => {
    const read = deferred();
    const first = deferred();
    const second = deferred();
    const writes = [];
    apiMock.mockImplementation((path, body) => {
      if (path.endsWith('/workspace')) return read.promise;
      if (path.endsWith('/checkpoints/reader')) {
        writes.push(body);
        return writes.length === 1 ? first.promise : second.promise;
      }
      return Promise.resolve({});
    });
    render(<FeedWorkspaceProvider><PreferenceProbe /></FeedWorkspaceProvider>);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/v1/feed/workspace'));
    fireEvent.click(screen.getByText('Visit'));
    fireEvent.click(screen.getByText('Visit again'));
    const visit = screen.getByLabelText('last visit');
    const newest = '2026-08-25T12:00:00.000Z';
    try {
      await act(async () => read.resolve({ preferencesStored: true, checkpoints: { reader: { visitedAt: 'older' } } }));
      expect(visit).toHaveTextContent(newest);
      expect(writes).toHaveLength(1);
      await act(async () => first.resolve({ checkpoint: { visitedAt: 'old acknowledgement' } }));
      expect(writes).toHaveLength(2);
      expect(visit).toHaveTextContent(newest);
      expect(localStorage.getItem('feed:last-visit:reader')).toBe(newest);
      expect(writes[1]).toMatchObject({ visitedAt: newest, itemId: 'two', scrollOffset: 200 });
      await act(async () => second.resolve({ checkpoint: { visitedAt: 'latest acknowledgement' } }));
      expect(visit).toHaveTextContent('latest acknowledgement');
      expect(localStorage.getItem('feed:last-visit:reader')).toBe('latest acknowledgement');
    } finally {
      await act(async () => { first.resolve({}); second.resolve({}); });
    }
  });

  for (const order of ['read before visit', 'visit before read']) {
    test(order + ' keeps an acknowledged visit when a stale workspace read settles last', async () => {
      const read = deferred();
      const save = deferred();
      let reads = 0;
      apiMock.mockImplementation(path => {
        if (path.endsWith('/workspace') && ++reads === 2) return read.promise;
        if (path.endsWith('/checkpoints/reader')) return save.promise;
        return Promise.resolve({ preferencesStored: true });
      });
      render(<FeedWorkspaceProvider><PreferenceProbe /></FeedWorkspaceProvider>);
      await screen.findByText('true');
      if (order === 'visit before read') fireEvent.click(screen.getByText('Visit'));
      fireEvent.click(screen.getByText('Refresh preferences'));
      try {
        await waitFor(() => expect(reads).toBe(2));
        if (order === 'read before visit') fireEvent.click(screen.getByText('Visit'));
        await act(async () => save.resolve({ checkpoint: { visitedAt: 'confirmed visit' } }));
        expect(screen.getByLabelText('last visit')).toHaveTextContent('confirmed visit');
        await act(async () => read.resolve({ preferencesStored: true, checkpoints: { reader: { visitedAt: 'older' } } }));
        expect(screen.getByLabelText('last visit')).toHaveTextContent('confirmed visit');
      } finally {
        await act(async () => { read.resolve({ preferencesStored: true }); save.resolve({}); });
      }
    });
  }

  test('a replacement workspace loads and saves preferences while an accepted Reader write is held', async () => {
    const save = deferred();
    apiMock.mockImplementation(path => path.endsWith('/checkpoints/reader') ? save.promise
      : Promise.resolve({ preferencesStored: true, checkpoints: { reader: { visitedAt: 'older' } } }));
    const old = render(<FeedWorkspaceProvider><PreferenceProbe /></FeedWorkspaceProvider>);
    await screen.findByText('true');
    fireEvent.click(screen.getByText('Visit'));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/v1/feed/workspace/checkpoints/reader', expect.any(Object), 'PUT'));
    old.unmount();
    render(<FeedWorkspaceProvider><PreferenceProbe /></FeedWorkspaceProvider>);
    try {
      await screen.findByText('true');
      expect(screen.getByLabelText('last visit')).toHaveTextContent('2026-08-24T12:00:00.000Z');
      fireEvent.click(screen.getByText('Sepia'));
      await waitFor(() => expect(preferenceSaves()).toEqual([{ theme: 'sepia' }]));
      await act(async () => save.resolve({ checkpoint: { visitedAt: 'retired reply' } }));
      expect(localStorage.getItem('feed:last-visit:reader')).toBe('2026-08-24T12:00:00.000Z');
      expect(screen.getByLabelText('last visit')).toHaveTextContent('2026-08-24T12:00:00.000Z');
    } finally {
      await act(async () => save.resolve({}));
    }
  });

  test('a switched account can save its own Reader visit before the former account replies', async () => {
    const save = deferred();
    const writes = [];
    localStorage.setItem('ds_token', tokenFor('amy'));
    apiMock.mockImplementation((path, position) => {
      if (path.endsWith('/checkpoints/reader')) {
        writes.push(position);
        return writes.length === 1 ? save.promise : Promise.resolve({ checkpoint: { visitedAt: 'Bob confirmed' } });
      }
      return Promise.resolve({ preferencesStored: true });
    });
    const previous = render(<FeedWorkspaceProvider><PreferenceProbe /></FeedWorkspaceProvider>);
    await screen.findByText('true');
    fireEvent.click(screen.getByText('Visit'));
    await waitFor(() => expect(writes).toHaveLength(1));
    localStorage.setItem('ds_token', tokenFor('bob'));
    fireEvent.click(screen.getByText('Visit again'));
    expect(localStorage.getItem('feed:last-visit:reader')).toBe('2026-08-24T12:00:00.000Z');
    previous.unmount();
    render(<FeedWorkspaceProvider><PreferenceProbe /></FeedWorkspaceProvider>);
    await screen.findByText('true');
    try {
      fireEvent.click(screen.getByText('Visit again'));
      await screen.findByText('Bob confirmed');
      await act(async () => save.resolve({ checkpoint: { visitedAt: 'Amy confirmed' } }));
      expect(screen.getByLabelText('last visit')).toHaveTextContent('Bob confirmed');
      expect(localStorage.getItem('feed:last-visit:reader')).toBe('Bob confirmed');
    } finally {
      await act(async () => save.resolve({}));
    }
  });

  test('hydrates account preferences and checkpoints before declaring the workspace ready', async () => {
    apiMock.mockImplementation(path => {
      if (path === '/api/v1/feed/workspace') return Promise.resolve({
        preferencesStored: true,
        preferences: { theme: 'light', density: 'compact', fontScale: 1.15, lineHeight: 1.85, measure: 56, sessionBudget: 30 },
        checkpoints: { reader: { visitedAt: '2026-08-23T10:00:00.000Z', itemId: 'one', scrollOffset: 90 } },
      });
      return Promise.resolve({ unread: 0, saved: 0, archived: 0, pendingSync: 0 });
    });

    render(<FeedWorkspaceProvider><PreferenceProbe /></FeedWorkspaceProvider>);

    await waitFor(() => expect(screen.getByLabelText('workspace ready')).toHaveTextContent('true'));
    expect(screen.getByText(/"theme":"light"/)).toHaveTextContent('"density":"compact"');
    expect(screen.getByLabelText('last visit')).toHaveTextContent('2026-08-23T10:00:00.000Z');
  });

  test('keeps an early edit when the startup workspace response has an older value', async () => {
    const initial = deferred();
    apiMock.mockImplementation((path, patch) => {
      if (path.endsWith('/workspace')) return initial.promise;
      if (path.endsWith('/preferences')) return Promise.resolve({ preferences: { theme: patch.theme, density: 'compact' } });
      return Promise.resolve({});
    });
    render(<FeedWorkspaceProvider><PreferenceProbe /></FeedWorkspaceProvider>);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/v1/feed/workspace'));
    fireEvent.click(screen.getByRole('button', { name: 'Sepia' }));
    expect(storedAppearance().theme).toBe('sepia');
    expect(preferenceSaves()).toEqual([]);

    await act(async () => { initial.resolve({ preferencesStored: true, preferences: { theme: 'dark', density: 'compact' } }); });
    await waitFor(() => expect(preferenceSaves()).toEqual([{ theme: 'sepia' }]));
    expect(screen.getByText(/"theme":"sepia"/)).toHaveTextContent('"density":"compact"');
    expect(storedAppearance()).toMatchObject({ theme: 'sepia', density: 'compact' });
    expect(localStorage.getItem('feed:density')).toBe('compact');
  });

  test('migrates the initial legacy values before sending a preference edited during startup', async () => {
    localStorage.setItem('feed:reading-preferences', JSON.stringify({ measure: 56 }));
    localStorage.setItem('feed:density', 'compact');
    const initial = deferred();
    const migration = deferred();
    apiMock.mockImplementation((path, patch) => {
      if (path.endsWith('/workspace')) return initial.promise;
      if (path.endsWith('/preferences')) return Object.hasOwn(patch, 'measure') ? migration.promise : Promise.resolve({});
      return Promise.resolve({});
    });
    render(<FeedWorkspaceProvider><PreferenceProbe /></FeedWorkspaceProvider>);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/v1/feed/workspace'));
    fireEvent.click(screen.getByRole('button', { name: 'Comfortable' }));
    expect(preferenceSaves()).toEqual([]);
    await act(async () => { initial.resolve({ preferencesStored: false }); });
    expect(screen.getByLabelText('workspace ready')).toHaveTextContent('true');
    expect(preferenceSaves()).toEqual([expect.objectContaining({ measure: 56, density: 'compact' })]);

    await act(async () => { migration.resolve({ preferences: { measure: 56, density: 'compact' } }); });
    expect(preferenceSaves()).toEqual([expect.objectContaining({ measure: 56 }), { density: 'comfortable' }]);
    expect(storedAppearance()).toMatchObject({ measure: 56, density: 'comfortable' });
    expect(localStorage.getItem('feed:density')).toBe('comfortable');
  });

  test('serializes accepted edits and only applies the submitted field of a current response', async () => {
    const first = deferred();
    const second = deferred();
    const third = deferred();
    const saves = [first, second, third];
    apiMock.mockImplementation(path => {
      if (path.endsWith('/workspace')) return Promise.resolve({ preferencesStored: true });
      if (path.endsWith('/preferences')) return saves.shift().promise;
      return Promise.resolve({});
    });
    render(<FeedWorkspaceProvider><PreferenceProbe /></FeedWorkspaceProvider>);
    await waitFor(() => expect(screen.getByLabelText('workspace ready')).toHaveTextContent('true'));

    fireEvent.click(screen.getByRole('button', { name: 'Compact' }));
    await waitFor(() => expect(preferenceSaves()).toEqual([{ density: 'compact' }]));
    fireEvent.click(screen.getByRole('button', { name: 'Comfortable' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sepia' }));
    expect(screen.getByText(/"theme":"sepia"/)).toHaveTextContent('"density":"comfortable"');
    expect(preferenceSaves()).toEqual([{ density: 'compact' }]);

    await act(async () => { first.resolve({ preferences: { density: 'compact', theme: 'dark' } }); });
    expect(storedAppearance()).toMatchObject({ density: 'comfortable', theme: 'sepia' });
    expect(preferenceSaves()).toEqual([{ density: 'compact' }, { density: 'comfortable' }]);
    await act(async () => { second.reject(new Error('Write was refused')); });
    expect(preferenceSaves()).toEqual([{ density: 'compact' }, { density: 'comfortable' }, { theme: 'sepia' }]);
    await act(async () => { third.resolve({ preferences: { density: 'compact', theme: 'sepia' } }); });
    expect(storedAppearance()).toMatchObject({ density: 'comfortable', theme: 'sepia' });
    expect(localStorage.getItem('feed:density')).toBe('comfortable');
  });

  test('accepts imported changes while keeping an edit made during that refresh', async () => {
    const imported = deferred();
    let reads = 0;
    apiMock.mockImplementation(path => {
      if (path.endsWith('/workspace')) {
        return ++reads === 1 ? Promise.resolve({ preferencesStored: true }) : imported.promise;
      }
      return Promise.resolve({});
    });
    render(<FeedWorkspaceProvider><PreferenceProbe /></FeedWorkspaceProvider>);
    await waitFor(() => expect(screen.getByLabelText('workspace ready')).toHaveTextContent('true'));
    fireEvent.click(screen.getByRole('button', { name: 'Compact' }));
    await waitFor(() => expect(preferenceSaves()).toEqual([{ density: 'compact' }]));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh preferences' }));
    await waitFor(() => expect(reads).toBe(2));
    fireEvent.click(screen.getByRole('button', { name: 'Sepia' }));
    await act(async () => { imported.resolve({ preferencesStored: true, preferences: { density: 'comfortable', theme: 'light' } }); });
    expect(storedAppearance()).toMatchObject({ density: 'comfortable', theme: 'sepia' });
    expect(localStorage.getItem('feed:density')).toBe('comfortable');
    expect(preferenceSaves()).toEqual([{ density: 'compact' }, { theme: 'sepia' }]);
  });

  test('finishes accepted saves in order across replacement workspaces without publishing an old response', async () => {
    const old = deferred();
    const refresh = deferred();
    let workspaceReads = 0;
    apiMock.mockImplementation((path, patch) => {
      if (path.endsWith('/workspace')) return ++workspaceReads === 1 ? Promise.resolve({ preferencesStored: true }) : refresh.promise;
      if (path.endsWith('/preferences')) return patch.density === 'compact' ? old.promise : Promise.resolve({ preferences: patch });
      return Promise.resolve({});
    });
    const first = render(<FeedWorkspaceProvider><PreferenceProbe /></FeedWorkspaceProvider>);
    await waitFor(() => expect(screen.getByLabelText('workspace ready')).toHaveTextContent('true'));
    fireEvent.click(screen.getByRole('button', { name: 'Compact' }));
    await waitFor(() => expect(preferenceSaves()).toEqual([{ density: 'compact' }]));
    first.unmount();

    render(<FeedWorkspaceProvider><PreferenceProbe /></FeedWorkspaceProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Comfortable' }));
    expect(workspaceReads).toBe(1);
    await act(async () => { old.resolve({ preferences: { density: 'compact', theme: 'light' } }); });
    expect(workspaceReads).toBe(2);
    expect(storedAppearance()).toMatchObject({ density: 'comfortable', theme: 'dark' });
    await act(async () => { refresh.resolve({ preferencesStored: true, preferences: { density: 'compact', theme: 'sepia' } }); });
    expect(preferenceSaves()).toEqual([{ density: 'compact' }, { density: 'comfortable' }]);
    expect(storedAppearance()).toMatchObject({ density: 'comfortable', theme: 'sepia' });
  });

  test('a refused source edit rolls back to the last confirmed change for that source', async () => {
    const writes = [];
    apiMock.mockImplementation(path => {
      if (!path.endsWith('/sources/daily')) return Promise.resolve({ preferencesStored: true });
      const request = deferred();
      writes.push(request);
      return request.promise;
    });
    render(<FeedWorkspaceProvider><SourceProbe /></FeedWorkspaceProvider>);
    fireEvent.click(screen.getByText('more'));
    fireEvent.click(screen.getByText('less'));
    const source = screen.getByLabelText('source level');
    expect(source).toHaveTextContent('less');
    await waitFor(() => expect(writes).toHaveLength(1));
    await act(async () => writes[0].resolve({ sourcePreferences: { daily: 'more' } }));
    expect(writes).toHaveLength(2);
    expect(source).toHaveTextContent('less');
    await act(async () => writes[1].reject(new Error('Save refused')));
    expect(source).toHaveTextContent('more');
  });

  test('does not show another account’s pending source preference or its reply after refreshing the workspace', async () => {
    const save = deferred();
    localStorage.setItem('ds_token', tokenFor('amy'));
    let reads = 0;
    apiMock.mockImplementation(path => {
      if (path.endsWith('/sources/daily')) return save.promise;
      if (path.endsWith('/workspace')) return Promise.resolve({ preferencesStored: true, sourcePreferences: { daily: ++reads === 1 ? 'less' : 'mute' } });
      return Promise.resolve({});
    });
    render(<FeedWorkspaceProvider><SourceProbe /></FeedWorkspaceProvider>);
    const source = screen.getByLabelText('source level');
    await waitFor(() => expect(source).toHaveTextContent('less'));
    fireEvent.click(screen.getByRole('button', { name: 'more' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/v1/feed/workspace/sources/daily', { level: 'more' }, 'PUT'));
    localStorage.setItem('ds_token', tokenFor('bob'));
    fireEvent.click(screen.getByText('Refresh workspace'));
    await waitFor(() => expect(source).toHaveTextContent('mute'));
    notifications.show.mockClear();
    await act(async () => save.resolve({ sourcePreferences: { daily: 'more' } }));
    expect(source).toHaveTextContent('mute');
    expect(notifications.show).not.toHaveBeenCalled();
  });

  test('keeps optimistic state and durably queues a mutation while offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    render(<FeedWorkspaceProvider><MutationProbe /></FeedWorkspaceProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Save item' }));

    await waitFor(() => expect(screen.getByLabelText('saved')).toHaveTextContent('true'));
    expect(screen.getByLabelText('pending')).toHaveTextContent('1');
    expect(JSON.parse(localStorage.getItem('feed:pending-mutations:household'))).toMatchObject([{ itemIds: ['one'], action: 'save' }]);
    expect(apiMock).not.toHaveBeenCalledWith('/api/v1/feed/items/state', expect.anything(), 'PATCH');
  });

  test('rejects a full offline write and restores the previous item and queue', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const key = 'feed:pending-mutations:household';
    const existing = JSON.stringify([{ id: 'older', itemIds: ['other'], action: 'read' }]);
    localStorage.setItem(key, existing);
    const set = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    notifications.show.mockClear();
    try {
      render(<FeedWorkspaceProvider><MutationProbe /></FeedWorkspaceProvider>);
      fireEvent.click(screen.getByRole('button', { name: 'Save item' }));
      await waitFor(() => expect(screen.getByLabelText('failure')).not.toBeEmptyDOMElement());
      expect(screen.getByLabelText('saved')).toHaveTextContent('false');
      expect(screen.getByLabelText('pending')).toHaveTextContent('1');
      expect(localStorage.getItem(key)).toBe(existing);
      expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ title: 'Change not saved' }));
      expect(notifications.show).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Saved offline' }));
    } finally {
      set.mockRestore();
    }
  });

  test('opens the workspace with blocked storage and refuses an unscoped offline queue', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    vi.stubGlobal('localStorage', undefined);
    try {
      render(<FeedWorkspaceProvider><MutationProbe /></FeedWorkspaceProvider>);
      fireEvent.click(screen.getByRole('button', { name: 'Save item' }));
      await waitFor(() => expect(screen.getByLabelText('failure')).not.toBeEmptyDOMElement());
      expect(screen.getByLabelText('saved')).toHaveTextContent('false');
      expect(screen.getByLabelText('pending')).toHaveTextContent('0');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('replays durable offline mutations when connectivity is available', async () => {
    localStorage.setItem('feed:pending-mutations:household', JSON.stringify([{ id: 'queued-1', itemIds: ['one'], action: 'save', createdAt: '2026-08-24T10:00:00.000Z' }]));
    render(<FeedWorkspaceProvider><MutationProbe /></FeedWorkspaceProvider>);

    await waitFor(() => expect(JSON.parse(localStorage.getItem('feed:pending-mutations:household'))).toEqual([]));
    expect(apiMock).toHaveBeenCalledWith('/api/v1/feed/items/state', { itemIds: ['one'], action: 'save' }, 'PATCH');
  });

  test('a failed earlier action cannot roll back a later acknowledged action', async () => {
    const save = deferred();
    const read = deferred();
    apiMock.mockImplementation((path, body) => {
      if (path === '/api/v1/feed/items/state' && body.action === 'save') return save.promise;
      if (path === '/api/v1/feed/items/state' && body.action === 'read') return read.promise;
      return Promise.resolve({ unread: 0, saved: 0, archived: 0, pendingSync: 0, preferencesStored: true });
    });
    render(<FeedWorkspaceProvider><MutationProbe /></FeedWorkspaceProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Save item' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark item read' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/v1/feed/items/state', { itemIds: ['one'], action: 'read' }, 'PATCH'));

    await act(async () => read.resolve({ items: [{ id: 'one', state: { isRead: true, isSaved: false, isArchived: false } }] }));
    await act(async () => save.reject(new Error('save refused')));

    expect(screen.getByLabelText('read')).toHaveTextContent('true');
    expect(screen.getByLabelText('saved')).toHaveTextContent('false');
  });

  test('a delayed earlier success merges its action without replacing a newer acknowledgement', async () => {
    const save = deferred();
    const read = deferred();
    apiMock.mockImplementation((path, body) => {
      if (path === '/api/v1/feed/items/state' && body.action === 'save') return save.promise;
      if (path === '/api/v1/feed/items/state' && body.action === 'read') return read.promise;
      return Promise.resolve({ unread: 0, saved: 0, archived: 0, pendingSync: 0, preferencesStored: true });
    });
    render(<FeedWorkspaceProvider><MutationProbe /></FeedWorkspaceProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Save item' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark item read' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/v1/feed/items/state', { itemIds: ['one'], action: 'read' }, 'PATCH'));

    await act(async () => read.resolve({ items: [{ id: 'one', state: { isRead: true, isSaved: false, isArchived: false } }] }));
    await act(async () => save.resolve({ items: [{ id: 'one', state: { isRead: false, isSaved: true, isArchived: false } }] }));

    expect(screen.getByLabelText('read')).toHaveTextContent('true');
    expect(screen.getByLabelText('saved')).toHaveTextContent('true');
  });

  test('retries a failed queue removal without replaying an acknowledged action twice', async () => {
    const key = 'feed:pending-mutations:household';
    const existing = JSON.stringify([{ id: 'acked', itemIds: ['one'], action: 'save' }]);
    localStorage.setItem(key, existing);
    const set = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    try {
      render(<FeedWorkspaceProvider><MutationProbe /></FeedWorkspaceProvider>);
      await waitFor(() => expect(set).toHaveBeenCalledWith(key, '[]'));
      expect(localStorage.getItem(key)).toBe(existing);
    } finally {
      set.mockRestore();
    }
    fireEvent(window, new Event('online'));
    await waitFor(() => expect(screen.getByLabelText('pending')).toHaveTextContent('0'));
    expect(apiMock.mock.calls.filter(([path]) => path === '/api/v1/feed/items/state')).toHaveLength(1);
  });

  test('preserves the oldest pending change when the queue reaches its size limit', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const key = 'feed:pending-mutations:household';
    const existing = JSON.stringify(Array.from({ length: 500 }, (_, index) => ({ id: String(index), itemIds: ['other'], action: 'read' })));
    localStorage.setItem(key, existing);
    render(<FeedWorkspaceProvider><MutationProbe /></FeedWorkspaceProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Save item' }));
    await waitFor(() => expect(screen.getByLabelText('failure')).not.toBeEmptyDOMElement());
    expect(screen.getByLabelText('saved')).toHaveTextContent('false');
    expect(localStorage.getItem(key)).toBe(existing);
  });

  test('finishes local cleanup after an account switch without sending the same change twice', async () => {
    const key = 'feed:pending-mutations:alice';
    const first = { id: 'first', itemIds: ['first'], action: 'save' };
    const second = { id: 'second', itemIds: ['second'], action: 'read' };
    localStorage.setItem('ds_token', tokenFor('alice'));
    localStorage.setItem(key, JSON.stringify([first]));
    let release;
    apiMock.mockImplementation((path, data) => {
      if (path.endsWith('/items/state') && data.itemIds[0] === 'first') return new Promise(resolve => { release = resolve; });
      return Promise.resolve({});
    });
    render(<FeedWorkspaceProvider><MutationProbe /></FeedWorkspaceProvider>);
    await waitFor(() => expect(release).toBeTypeOf('function'));
    localStorage.setItem(key, JSON.stringify([first, second]));
    localStorage.setItem('ds_token', tokenFor('bob'));
    await act(async () => { release({}); });
    expect(JSON.parse(localStorage.getItem(key))).toEqual([first, second]);
    expect(localStorage.getItem('feed:pending-mutations:bob')).toBeNull();
    localStorage.setItem('ds_token', tokenFor('alice'));
    fireEvent(window, new Event('online'));
    await waitFor(() => expect(JSON.parse(localStorage.getItem(key))).toEqual([]));
    expect(apiMock.mock.calls.filter(([path]) => path.endsWith('/items/state')).map(([, data]) => data.itemIds[0])).toEqual(['first', 'second']);
  });

  test('never loads or replays another account’s pending mutations', async () => {
    localStorage.setItem('ds_token', tokenFor('alice'));
    localStorage.setItem('feed:pending-mutations:bob', JSON.stringify([{ id: 'bob-change', itemIds: ['private'], action: 'archive', createdAt: '2026-08-24T10:00:00.000Z' }]));
    render(<FeedWorkspaceProvider><MutationProbe /></FeedWorkspaceProvider>);

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/v1/feed/workspace'));
    expect(screen.getByLabelText('pending')).toHaveTextContent('0');
    expect(JSON.parse(localStorage.getItem('feed:pending-mutations:bob'))).toHaveLength(1);
    expect(apiMock).not.toHaveBeenCalledWith('/api/v1/feed/items/state', expect.anything(), 'PATCH');
  });

  test('a retired Undo cannot submit an item mutation for the next member', async () => {
    localStorage.setItem('ds_token', tokenFor('amy'));
    notifications.show.mockClear();
    const amy = render(<FeedWorkspaceProvider><MutationProbe /></FeedWorkspaceProvider>);
    fireEvent.click(screen.getByText('Save item'));
    await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ title: 'Saved' })));
    const toast = notifications.show.mock.calls.at(-1)[0];
    localStorage.setItem('ds_token', tokenFor('bob'));
    amy.unmount();
    render(<FeedWorkspaceProvider><MutationProbe />{toast.message}</FeedWorkspaceProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await act(async () => {});
    expect(apiMock.mock.calls.filter(([path]) => path.endsWith('/items/state'))).toHaveLength(1);
  });

  for (const result of ['success', 'refusal', 'network failure', 'same account network failure']) {
    test('a retired mutation handles ' + result + ' without publishing into the replacement', async () => {
      const request = deferred();
      localStorage.setItem('ds_token', tokenFor('amy'));
      apiMock.mockImplementation(path => path.endsWith('/items/state') ? request.promise : Promise.resolve({ preferencesStored: true }));
      const amy = render(<FeedWorkspaceProvider><MutationProbe /></FeedWorkspaceProvider>);
      fireEvent.click(screen.getByText('Save item'));
      await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/v1/feed/items/state', expect.any(Object), 'PATCH'));
      amy.unmount();
      if (result !== 'same account network failure') localStorage.setItem('ds_token', tokenFor('bob'));
      render(<FeedWorkspaceProvider><MutationProbe /></FeedWorkspaceProvider>);
      notifications.show.mockClear();
      await act(async () => {
        if (result === 'success') request.resolve({ items: [] });
        else request.reject(result === 'refusal' ? new Error('Refused') : new TypeError('Failed to fetch'));
      });
      expect(notifications.show).not.toHaveBeenCalled();
      expect(localStorage.getItem('feed:pending-mutations:bob')).toBeNull();
      if (result === 'same account network failure') {
        expect(JSON.parse(localStorage.getItem('feed:pending-mutations:amy'))).toMatchObject([{ itemIds: ['one'], action: 'save' }]);
      } else expect(localStorage.getItem('feed:pending-mutations:amy')).toBeNull();
    });
  }

  test('only the replacement workspace can enqueue for the newly active account', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    localStorage.setItem('ds_token', tokenFor('alice'));
    localStorage.setItem('feed:pending-mutations:alice', JSON.stringify([{ id: 'alice-change', itemIds: ['alice-item'], action: 'save', createdAt: '2026-08-24T10:00:00.000Z' }]));
    const previous = render(<FeedWorkspaceProvider><MutationProbe /></FeedWorkspaceProvider>);

    expect(screen.getByLabelText('pending')).toHaveTextContent('1');
    localStorage.setItem('ds_token', tokenFor('bob'));
    fireEvent.click(screen.getByRole('button', { name: 'Save item' }));

    expect(localStorage.getItem('feed:pending-mutations:bob')).toBeNull();
    previous.unmount();
    render(<FeedWorkspaceProvider><MutationProbe /></FeedWorkspaceProvider>);
    fireEvent.click(screen.getByText('Save item'));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('feed:pending-mutations:bob'))).toMatchObject([{ itemIds: ['one'], action: 'save' }]));
    expect(JSON.parse(localStorage.getItem('feed:pending-mutations:alice'))).toHaveLength(1);
  });
});
