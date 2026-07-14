import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// ResultRow drags in the session controller + cast stack; SearchResults'
// own behavior (rows + progressive still-searching indicator) is what's
// under test here.
vi.mock('./ResultRow.jsx', () => ({
  ResultRow: ({ row }) => <li data-testid={`row-${row.id}`}>{row.title}</li>,
}));

import { SearchResults } from './SearchResults.jsx';

describe('SearchResults progressive done-ness', () => {
  it('renders results immediately with an inline still-searching row while sources are pending', () => {
    render(
      <SearchResults
        results={[{ id: 'plex:1', title: 'Bluey (2018)' }]}
        pending={['abs', 'immich']}
      />,
    );
    expect(screen.getByTestId('row-plex:1')).toBeInTheDocument();
    const pendingRow = screen.getByTestId('media-search-pending');
    expect(pendingRow).toHaveTextContent('Still searching — Audiobooks, Photos…');
  });

  it('never shows raw source ids in the pending row', () => {
    render(<SearchResults results={[]} pending={['abs', 'plex', 'local-content']} />);
    const pendingRow = screen.getByTestId('media-search-pending');
    expect(pendingRow.textContent).not.toMatch(/\babs\b|\bplex\b|local-content/);
  });

  it('drops the source detail when too many sources are still pending', () => {
    render(
      <SearchResults
        results={[]}
        pending={['abs', 'plex', 'immich', 'files', 'youtube']}
      />,
    );
    expect(screen.getByTestId('media-search-pending')).toHaveTextContent(/^Still searching…$/);
  });

  it('shows no pending row once every source has completed', () => {
    render(<SearchResults results={[{ id: 'plex:1', title: 'X' }]} pending={[]} />);
    expect(screen.queryByTestId('media-search-pending')).toBeNull();
  });
});
