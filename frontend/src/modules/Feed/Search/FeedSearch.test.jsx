import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ api: vi.fn(), mutate: vi.fn(), applyPending: items => items }));

vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: mocks.api }));
vi.mock('../FeedWorkspaceContext.jsx', () => ({ useFeedWorkspace: () => ({ mutateItems: mocks.mutate, applyPendingMutations: mocks.applyPending }) }));

import FeedSearch from './FeedSearch.jsx';

describe('FeedSearch', () => {
  beforeEach(() => {
    mocks.api.mockReset();
    mocks.mutate.mockReset();
    mocks.api.mockImplementation(url => Promise.resolve(url.includes('cursor=')
      ? { items: [{ id: 'two', stateKey: 'two', title: 'Second result', state: {} }], total: 2, nextCursor: null, coverage: { retentionMonths: 12, status: 'complete' } }
      : { items: [{ id: 'one', stateKey: 'one', title: 'Saved result', state: { isSaved: true } }], total: 2, nextCursor: 'MQ', coverage: { retentionMonths: 12, status: 'complete' } }));
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

  test('exposes read, save, and archive controls for every result', async () => {
    render(<MemoryRouter initialEntries={['/feed/search']}><FeedSearch /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Saved result' });
    expect(screen.getByRole('button', { name: 'Saved' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark read' })).toBeInTheDocument();
  });
});
