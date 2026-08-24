import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import Reader from './Reader.jsx';

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
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => apiMock(...args) }));
vi.mock('../FeedWorkspaceContext.jsx', () => ({
  useFeedWorkspace: () => workspaceMock,
}));
vi.mock('../Scroll/hooks/useVirtualFeedWindow.js', () => ({
  useVirtualFeedWindow: (_ref, rows) => ({ items: rows, paddingTop: 0, paddingBottom: 0, measureRef: () => () => {} }),
}));

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

  test('loads Saved from canonical Reader history instead of the three-day stream', async () => {
    render(<MemoryRouter initialEntries={['/feed/reader?view=saved']}><Routes><Route path="/feed/reader" element={<Reader />} /></Routes></MemoryRouter>);
    expect(await screen.findByText('Saved from last month')).toBeInTheDocument();
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(expect.stringContaining('/api/v1/feed/search?state=saved&mode=reader'), {}, 'GET', expect.anything()));
    expect(apiMock.mock.calls.some(([path]) => path.startsWith('/api/v1/feed/reader/stream'))).toBe(false);
  });
});
