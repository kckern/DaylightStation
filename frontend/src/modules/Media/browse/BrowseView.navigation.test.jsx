import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { BrowseView } from './BrowseView.jsx';
import { NavProvider, useNav } from '../shell/NavProvider.jsx';
import { CastTargetProvider } from '../cast/CastTargetProvider.jsx';
import { DaylightAPI } from '../../../lib/api.mjs';

vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));
vi.mock('../search/useContentDispatch.js', () => ({
  useContentDispatch: () => ({
    dispatchLeafVerb: vi.fn(), playContainerAsQueue: vi.fn(), addContainerToQueue: vi.fn(),
  }),
}));
vi.mock('../fleet/useFleetContext.js', () => ({ useFleetContext: () => ({ devices: [] }) }));
vi.mock('../shell/useDismissLayer.js', () => ({ useDismissLayer: () => {} }));
vi.mock('../cast/DispatchTargetPicker.jsx', () => ({ DispatchTargetPicker: () => null }));

function NavigationSurface() {
  const { view, params } = useNav();
  return <div data-testid="scroll-host">
    {view === 'browse'
      ? <BrowseView {...params} />
      : <output data-testid="detail-route">{params.contentId}</output>}
  </div>;
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({ mediaNavStack: [{
    view: 'browse',
    params: { path: 'plex/season-2', label: 'Season 2', scrollTop: 21, focusedId: 'plex:e1' },
  }] }, '', '/media?view=browse&path=plex%2Fseason-2');
  DaylightAPI.mockResolvedValue({ items: [
    { id: 'plex:e1', title: 'Episode 1', type: 'episode', itemType: 'item', index: 1 },
    { id: 'plex:e2', title: 'Episode 2', type: 'episode', itemType: 'item', index: 2 },
  ], total: 2 });
});

describe('Browse Detail browser history', () => {
  // Omitting currentPatch from either Detail entrypoint must lose the live
  // viewport on Back, even when this browse entry already has an old snapshot.
  it.each(['Details', 'More → Open detail'])('%s restores the exact path, scroll, and triggering leaf on browser Back', async (entrypoint) => {
    render(<MantineProvider><CastTargetProvider><NavProvider>
      <NavigationSurface />
    </NavProvider></CastTargetProvider></MantineProvider>);
    await screen.findByTestId('browse-detail-plex:e2');
    const host = screen.getByTestId('scroll-host');
    host.scrollTop = 137;

    if (entrypoint === 'Details') {
      fireEvent.click(screen.getByTestId('browse-detail-plex:e2'));
    } else {
      fireEvent.click(screen.getByTestId('result-more-plex:e2'));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Open detail' }));
    }
    expect(screen.getByTestId('detail-route')).toHaveTextContent('plex:e2');
    expect(new URLSearchParams(location.search).get('view')).toBe('detail');
    host.scrollTop = 0;

    act(() => window.history.back());

    await screen.findByTestId('browse-detail-plex:e2');
    expect(new URLSearchParams(location.search).get('path')).toBe('plex/season-2');
    expect(screen.getByText('Season 2')).toHaveAttribute('aria-current', 'page');
    await waitFor(() => {
      expect(host.scrollTop).toBe(137);
      expect(screen.getByTestId('result-play-now-plex:e2')).toHaveFocus();
    });
    expect(window.history.state.mediaNavStack.at(-1)).toMatchObject({
      view: 'browse', params: { path: 'plex/season-2', scrollTop: 137, focusedId: 'plex:e2' },
    });
  });
});
