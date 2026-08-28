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

import { SearchProvider } from './SearchProvider.jsx';
import { useSearchContext } from './useSearchContext.js';

// Legacy persistence key from the pre-session-only scope behavior. No longer
// exported by SearchProvider (nothing reads/writes it anymore) — a literal
// here proves a value left over from an old session is inert.
const LEGACY_SCOPE_KEY_LAST = 'media-scope-last';

function Probe() {
  const { scopes, currentScopeKey, currentScope, scopeError, setScopeKey, resetScope } = useSearchContext();
  return (
    <div>
      <span data-testid="scopes">{scopes.map((s) => s.key).join(',')}</span>
      <span data-testid="current">{currentScopeKey}</span>
      <span data-testid="current-params">{currentScope?.params ?? ''}</span>
      <span data-testid="scope-error">{scopeError ? scopeError.message : ''}</span>
      <button onClick={() => setScopeKey('video')} data-testid="pick-video">video</button>
      <button onClick={() => setScopeKey('video-movies')} data-testid="pick-video-movies">video-movies</button>
      <button onClick={() => resetScope()} data-testid="reset-scope">reset</button>
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

  it('ignores a stored legacy scope key and defaults to the first scope', async () => {
    localStorage.setItem(LEGACY_SCOPE_KEY_LAST, 'video');
    render(<SearchProvider><Probe /></SearchProvider>);
    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('all'));
  });

  it('does not persist setScopeKey across provider remounts', async () => {
    const { unmount } = render(<SearchProvider><Probe /></SearchProvider>);
    await waitFor(() => screen.getByTestId('pick-video'));
    act(() => { screen.getByTestId('pick-video').click(); });
    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('video'));
    expect(localStorage.getItem(LEGACY_SCOPE_KEY_LAST)).toBeNull();
    unmount();

    render(<SearchProvider><Probe /></SearchProvider>);
    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('all'));
  });

  it('resetScope returns to the first configured scope', async () => {
    render(<SearchProvider><Probe /></SearchProvider>);
    await waitFor(() => screen.getByTestId('pick-video'));
    act(() => { screen.getByTestId('pick-video').click(); });
    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('video'));
    act(() => { screen.getByTestId('reset-scope').click(); });
    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('all'));
  });

  it('resolves currentScope for a child key (searches children, not just top level)', async () => {
    mockBehavior = 'children';
    render(<SearchProvider><Probe /></SearchProvider>);
    await waitFor(() => screen.getByTestId('pick-video-movies'));
    act(() => { screen.getByTestId('pick-video-movies').click(); });
    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('video-movies'));
    expect(screen.getByTestId('current-params')).toHaveTextContent('type=movie');
  });

  it('exposes scopeError when the config fetch rejects', async () => {
    mockBehavior = 'reject';
    render(<SearchProvider><Probe /></SearchProvider>);
    await waitFor(() => expect(screen.getByTestId('scope-error')).toHaveTextContent('config down'));
  });
});
