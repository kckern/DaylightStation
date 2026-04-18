import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async (path) => {
    if (path === 'api/v1/media/config') {
      return {
        searchScopes: [
          { label: 'All', key: 'all', params: 'take=50' },
          { label: 'Video', key: 'video', params: 'source=plex&mediaType=video' },
        ],
      };
    }
    return {};
  }),
}));

import { SearchProvider, useSearchContext, SCOPE_KEY_LAST } from './SearchProvider.jsx';

function Probe() {
  const { scopes, currentScopeKey, setScopeKey } = useSearchContext();
  return (
    <div>
      <span data-testid="scopes">{scopes.map((s) => s.key).join(',')}</span>
      <span data-testid="current">{currentScopeKey}</span>
      <button onClick={() => setScopeKey('video')} data-testid="pick-video">video</button>
    </div>
  );
}

describe('SearchProvider', () => {
  beforeEach(() => { localStorage.clear(); });

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
});
