import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

let mockBehavior = 'default';
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async (path) => {
    if (path !== 'api/v1/media/config') return {};
    if (mockBehavior === 'reject') throw new Error('config down');
    if (mockBehavior === 'children') {
      return {
        searchScopes: [
          { label: 'All', key: 'all', params: 'take=50' },
          { label: 'Video', key: 'video', params: 'source=plex', children: [
            { label: 'Movies', key: 'video-movies', params: 'source=plex&type=movie' },
            { label: 'Shows', key: 'video-shows', params: 'source=plex&type=show' },
          ] },
        ],
      };
    }
    return {
      searchScopes: [
        { label: 'All', key: 'all', params: 'take=50' },
        { label: 'Video', key: 'video', params: 'source=plex&mediaType=video' },
      ],
    };
  }),
}));

import { SearchProvider, useSearchContext, SCOPE_KEY_LAST } from './SearchProvider.jsx';

function Probe() {
  const { scopes, currentScopeKey, currentScope, scopeError, setScopeKey } = useSearchContext();
  return (
    <div>
      <span data-testid="scopes">{scopes.map((s) => s.key).join(',')}</span>
      <span data-testid="current">{currentScopeKey}</span>
      <span data-testid="current-params">{currentScope?.params ?? ''}</span>
      <span data-testid="scope-error">{scopeError ? scopeError.message : ''}</span>
      <button onClick={() => setScopeKey('video')} data-testid="pick-video">video</button>
    </div>
  );
}

describe('SearchProvider', () => {
  beforeEach(() => { mockBehavior = 'default'; localStorage.clear(); });

  it('loads scopes from /api/v1/media/config on mount', async () => {
    render(<SearchProvider><Probe /></SearchProvider>);
    await waitFor(() => expect(screen.getByTestId('scopes')).toHaveTextContent('all,video'));
  });

  it('defaults currentScopeKey to the first scope', async () => {
    render(<SearchProvider><Probe /></SearchProvider>);
    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('all'));
  });

  it('persists current scope to localStorage and restores on next mount', async () => {
    const { unmount } = render(<SearchProvider><Probe /></SearchProvider>);
    await waitFor(() => screen.getByTestId('pick-video'));
    act(() => { screen.getByTestId('pick-video').click(); });
    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('video'));
    expect(localStorage.getItem(SCOPE_KEY_LAST)).toBe('video');
    unmount();

    render(<SearchProvider><Probe /></SearchProvider>);
    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('video'));
  });

  it('resolves currentScope for a child key (searches children, not just top level)', async () => {
    mockBehavior = 'children';
    localStorage.setItem(SCOPE_KEY_LAST, 'video-movies');
    render(<SearchProvider><Probe /></SearchProvider>);
    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('video-movies'));
    expect(screen.getByTestId('current-params')).toHaveTextContent('type=movie');
  });

  it('exposes scopeError when the config fetch rejects', async () => {
    mockBehavior = 'reject';
    render(<SearchProvider><Probe /></SearchProvider>);
    await waitFor(() => expect(screen.getByTestId('scope-error')).toHaveTextContent('config down'));
  });
});
