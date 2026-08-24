import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { useState } from 'react';
import { FeedWorkspaceProvider, useFeedWorkspace } from './FeedWorkspaceContext.jsx';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../../lib/api.mjs', () => ({ DaylightAPI: (...args) => apiMock(...args) }));
vi.mock('@mantine/notifications', () => ({ notifications: { show: vi.fn() } }));

function PreferenceProbe() {
  const { readingPreferences, setReadingPreference, getLastVisit, markVisited, workspaceReady } = useFeedWorkspace();
  return (
    <>
      <output>{JSON.stringify(readingPreferences)}</output>
      <button onClick={() => setReadingPreference('fontScale', 1.3)}>Larger</button>
      <button onClick={() => markVisited('reader', '2026-08-24T12:00:00.000Z')}>Visit</button>
      <output aria-label="last visit">{getLastVisit('reader') || 'never'}</output>
      <output aria-label="workspace ready">{String(workspaceReady)}</output>
    </>
  );
}

function MutationProbe() {
  const { mutateItems, pendingMutations } = useFeedWorkspace();
  const [item, setItem] = useState({ id: 'one', state: { isRead: false, isSaved: false, isArchived: false } });
  return (
    <>
      <output aria-label="saved">{String(item.state.isSaved)}</output>
      <output aria-label="pending">{pendingMutations}</output>
      <button onClick={() => mutateItems([item], 'save', { onApply: updated => setItem(updated[0]) })}>Save item</button>
    </>
  );
}


describe('FeedWorkspaceProvider reading preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    apiMock.mockReset().mockResolvedValue({ unread: 0, saved: 0, archived: 0, pendingSync: 0 });
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

  test('keeps optimistic state and durably queues a mutation while offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    render(<FeedWorkspaceProvider><MutationProbe /></FeedWorkspaceProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Save item' }));

    await waitFor(() => expect(screen.getByLabelText('saved')).toHaveTextContent('true'));
    expect(screen.getByLabelText('pending')).toHaveTextContent('1');
    expect(JSON.parse(localStorage.getItem('feed:pending-mutations'))).toMatchObject([{ itemIds: ['one'], action: 'save' }]);
    expect(apiMock).not.toHaveBeenCalledWith('/api/v1/feed/items/state', expect.anything(), 'PATCH');
  });

  test('replays durable offline mutations when connectivity is available', async () => {
    localStorage.setItem('feed:pending-mutations', JSON.stringify([{ id: 'queued-1', itemIds: ['one'], action: 'save', createdAt: '2026-08-24T10:00:00.000Z' }]));
    render(<FeedWorkspaceProvider><MutationProbe /></FeedWorkspaceProvider>);

    await waitFor(() => expect(JSON.parse(localStorage.getItem('feed:pending-mutations'))).toEqual([]));
    expect(apiMock).toHaveBeenCalledWith('/api/v1/feed/items/state', { itemIds: ['one'], action: 'save' }, 'PATCH');
  });
});
