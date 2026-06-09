import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const setQueryFn = vi.fn();
const retryFn = vi.fn();
let mockSearch = { results: [], pending: [], isSearching: false, error: null, setQuery: setQueryFn, retry: retryFn };
vi.mock('./useLiveSearch.js', () => ({
  useLiveSearch: vi.fn(() => mockSearch),
}));

const scopeCtx = {
  scopes: [{ label: 'All', key: 'all', params: 'take=50' }, { label: 'Video', key: 'video', params: 'source=plex' }],
  currentScopeKey: 'all',
  currentScope: { label: 'All', key: 'all', params: 'take=50' },
  scopeError: null,
  setScopeKey: vi.fn(),
};
vi.mock('./SearchProvider.jsx', () => ({
  useSearchContext: vi.fn(() => scopeCtx),
}));

vi.mock('../cast/CastButton.jsx', () => ({
  CastButton: ({ contentId }) => <button data-testid={`cast-button-${contentId}`}>Cast</button>,
}));

const controller = {
  queue: {
    playNow: vi.fn(),
    add: vi.fn(),
    playNext: vi.fn(),
    addUpNext: vi.fn(),
  },
};
vi.mock('../session/useSessionController.js', () => ({
  useSessionController: vi.fn(() => controller),
}));

const navCtx = { push: vi.fn() };
vi.mock('../shell/NavProvider.jsx', () => ({
  useNav: vi.fn(() => navCtx),
}));

import { SearchBar } from './SearchBar.jsx';

beforeEach(() => {
  setQueryFn.mockClear();
  retryFn.mockClear();
  scopeCtx.setScopeKey.mockClear();
  mockSearch = { results: [], pending: [], isSearching: false, error: null, setQuery: setQueryFn, retry: retryFn };
});

describe('SearchBar', () => {
  it('renders the input with placeholder', () => {
    render(<SearchBar />);
    expect(screen.getByTestId('media-search-input')).toBeInTheDocument();
  });

  it('typing calls useLiveSearch.setQuery', () => {
    render(<SearchBar />);
    fireEvent.change(screen.getByTestId('media-search-input'), { target: { value: 'lonesome' } });
    expect(setQueryFn).toHaveBeenCalledWith('lonesome');
  });

  it('switching scope calls setScopeKey', () => {
    render(<SearchBar />);
    fireEvent.change(screen.getByTestId('media-search-scope'), { target: { value: 'video' } });
    expect(scopeCtx.setScopeKey).toHaveBeenCalledWith('video');
  });

  it('shows results dropdown when results are present', () => {
    mockSearch = {
      results: [{ id: 'plex:1', title: 'Lonesome Ghosts' }],
      pending: [], isSearching: false, error: null, setQuery: setQueryFn, retry: retryFn,
    };
    render(<SearchBar />);
    // Typing 2+ chars triggers RESULTS state
    fireEvent.change(screen.getByTestId('media-search-input'), { target: { value: 'lo' } });
    expect(screen.getByText('Lonesome Ghosts')).toBeInTheDocument();
  });

  it('shows search-loading indicator while isSearching with 2+ chars', () => {
    mockSearch = {
      results: [], pending: ['plex'], isSearching: true, error: null, setQuery: setQueryFn, retry: retryFn,
    };
    render(<SearchBar />);
    fireEvent.change(screen.getByTestId('media-search-input'), { target: { value: 'lo' } });
    expect(screen.getByTestId('search-loading')).toBeInTheDocument();
  });

  it('renders an optgroup for a parent scope with children', () => {
    scopeCtx.scopes = [
      { label: 'All', key: 'all', params: 'take=50' },
      { label: 'Video', key: 'video', params: 'source=plex', children: [
        { label: 'Movies', key: 'video-movies', params: 'source=plex&type=movie' },
        { label: 'Shows', key: 'video-shows', params: 'source=plex&type=show' },
      ] },
    ];
    const { container } = render(<SearchBar />);
    const optgroup = container.querySelector('optgroup[label="Video"]');
    expect(optgroup).not.toBeNull();
    expect(optgroup.querySelectorAll('option').length).toBeGreaterThanOrEqual(2);
    scopeCtx.scopes = [{ label: 'All', key: 'all', params: 'take=50' }, { label: 'Video', key: 'video', params: 'source=plex' }];
  });

  it('renders a scope-error indicator when scopeError is set', () => {
    scopeCtx.scopeError = new Error('config down');
    render(<SearchBar />);
    expect(screen.getByTestId('scope-error')).toBeInTheDocument();
    scopeCtx.scopeError = null;
  });
});
