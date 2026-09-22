// @vitest-environment jsdom
// JSDOM dispatches history traversal asynchronously like a browser. Happy DOM
// dispatches popstate inside history.go(), re-entering NavProvider's updater.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  const { view, params, goToArea, pop } = useNav();
  return <div data-testid="scroll-host">
    <button onClick={() => goToArea('browse')}>Browse area</button>
    {view === 'browse'
      ? <BrowseView {...params} />
      : view === 'detail'
        ? <><button onClick={pop}>Detail Back</button><output data-testid="detail-route">{params.contentId}</output></>
        : <output data-testid="home-route">Home</output>}
  </div>;
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', query => Object.assign(new EventTarget(), {
    matches: false, media: query, addListener() {}, removeListener() {},
  }));
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

afterEach(() => vi.unstubAllGlobals());

describe('Browse Detail browser history', () => {
  it('reselects the original Browse root after repeated Detail visits so one browser Back reaches Home', async () => {
    window.history.replaceState(null, '', '/media');
    DaylightAPI.mockImplementation(async (url) => {
      const items = url.startsWith('api/v1/list/?')
        ? [{ id: 'plex:', title: 'Plex', itemType: 'container' }]
        : url.startsWith('api/v1/list/plex?')
          ? [{ id: 'plex:movies', title: 'Movies', itemType: 'container' }]
          : [{ id: 'plex:e2', title: 'Episode 2', type: 'episode', itemType: 'item' }];
      return { items, total: items.length };
    });
    render(<MantineProvider><CastTargetProvider><NavProvider>
      <NavigationSurface />
    </NavProvider></CastTargetProvider></MantineProvider>);
    const openDetail = async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Browse area' }));
      const source = await screen.findByTestId('browse-open-plex:');
      screen.getByTestId('scroll-host').scrollTop = 137;
      fireEvent.click(source);
      fireEvent.click(await screen.findByTestId('browse-open-plex:movies'));
      fireEvent.click(await screen.findByTestId('browse-detail-plex:e2'));
      expect(screen.getByTestId('detail-route')).toHaveTextContent('plex:e2');
    };

    await openDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Detail Back' }));
    await screen.findByTestId('browse-detail-plex:e2');
    await openDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Browse area' }));
    await screen.findByTestId('browse-open-plex:');
    expect(screen.getByTestId('scroll-host').scrollTop).toBe(137);
    expect(screen.getByTestId('browse-open-plex:')).toHaveFocus();
    expect(window.history.state.mediaNavStack.at(-1).params).toEqual({
      path: '', scrollTop: 137, focusedId: 'plex:',
    });

    act(() => window.history.back());

    await screen.findByTestId('home-route');
    expect(location.search).toBe('');
    expect(window.history.state.mediaNavStack).toEqual([{ view: 'home', params: {} }]);
  });

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
