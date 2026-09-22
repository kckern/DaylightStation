import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

let browseState;
const loadMore = vi.fn();
vi.mock('./useListBrowse.js', () => ({
  useListBrowse: () => ({ ...browseState, loadMore }),
}));

const push = vi.fn();
const replace = vi.fn();
const pop = vi.fn();
vi.mock('../shell/NavProvider.jsx', () => ({
  useNav: () => ({ push, replace, pop, depth: 3, backDestination: 'Browse' }),
}));
vi.mock('../search/useContentDispatch.js', () => ({
  useContentDispatch: () => ({
    dispatchLeafVerb: vi.fn(), playContainerAsQueue: vi.fn(), addContainerToQueue: vi.fn(),
  }),
}));
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: vi.fn() }) }),
}));
vi.mock('../fleet/useFleetContext.js', () => ({ useFleetContext: () => ({ devices: [] }) }));
vi.mock('../shell/useDismissLayer.js', () => ({ useDismissLayer: () => {} }));
vi.mock('../cast/DispatchTargetPicker.jsx', () => ({ DispatchTargetPicker: () => null }));

import { BrowseView } from './BrowseView.jsx';
import { CastTargetProvider } from '../cast/CastTargetProvider.jsx';

function renderBrowse(props = {}) {
  return render(
    <MantineProvider>
      <CastTargetProvider>
        <div data-testid="scroll-host" style={{ overflowY: 'auto', height: 200 }}>
          <BrowseView
            path="plex/season-2"
            label="Season 2"
            breadcrumbs={[
              { path: 'plex/tv', label: 'TV' },
              { path: 'plex/bluey', label: 'Bluey' },
            ]}
            {...props}
          />
        </div>
      </CastTargetProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  browseState = {
    items: [
      { id: 'plex:e10', title: 'Episode 10', type: 'episode', itemType: 'item', index: 10 },
      { id: 'plex:e2', title: 'Episode 2', type: 'episode', itemType: 'item', index: 2, thumbnail: '/two.jpg' },
      { id: 'plex:e1', title: 'Episode 1', type: 'episode', itemType: 'item', index: 1 },
    ],
    total: 6,
    loading: false,
    loadingMore: false,
    error: null,
  };
  loadMore.mockReset();
  push.mockReset();
  replace.mockReset();
  pop.mockReset();
  localStorage.clear();
});

describe('BrowseView lifecycle', () => {
  it('renders every breadcrumb parent and can jump to either one', () => {
    renderBrowse();

    expect(screen.getByRole('button', { name: 'TV' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Bluey' })).toBeVisible();
    expect(screen.getByText('Season 2')).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'TV' }));
    expect(replace).toHaveBeenCalledWith('browse', expect.objectContaining({ path: 'plex/tv', label: 'TV' }));
  });

  it('shows parts in natural order with a picture or placeholder, title, and kind', () => {
    renderBrowse();

    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('Episode 1'), expect.stringContaining('Episode 2'), expect.stringContaining('Episode 10'),
    ]));
    expect(screen.getAllByText('Episode').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole('img', { name: 'Episode 2 artwork' })).toHaveAttribute('src', '/two.jpg');
    expect(screen.getAllByTestId('result-artwork-placeholder').length).toBeGreaterThanOrEqual(2);
    const titles = screen.getAllByText(/Episode (1|2|10)$/).map((node) => node.textContent);
    expect(titles).toEqual(['Episode 1', 'Episode 2', 'Episode 10']);
  });

  it('loads the next page when the end sentinel intersects without a Load more button', () => {
    let callback;
    const observe = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb) { callback = cb; }
      observe = observe;
      disconnect() {}
    });

    renderBrowse();
    expect(screen.queryByRole('button', { name: /Load more/ })).toBeNull();
    expect(observe).toHaveBeenCalledWith(screen.getByTestId('browse-page-sentinel'));
    act(() => callback([{ isIntersecting: true }]));
    expect(loadMore).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('does not reset the current scroll when an automatic page appends rows', () => {
    const { rerender } = renderBrowse();
    const host = screen.getByTestId('scroll-host');
    Object.defineProperty(host, 'scrollTop', { configurable: true, writable: true, value: 88 });
    browseState.items = [
      ...browseState.items,
      { id: 'plex:e11', title: 'Episode 11', type: 'episode', itemType: 'item', index: 11 },
    ];

    rerender(
      <MantineProvider>
        <CastTargetProvider>
          <div data-testid="scroll-host" style={{ overflowY: 'auto', height: 200 }}>
            <BrowseView path="plex/season-2" label="Season 2" breadcrumbs={[
              { path: 'plex/tv', label: 'TV' },
              { path: 'plex/bluey', label: 'Bluey' },
            ]} />
          </div>
        </CastTargetProvider>
      </MantineProvider>,
    );

    expect(screen.getByTestId('scroll-host').scrollTop).toBe(88);
  });

  it('stores path, scrollTop, and focusedId before drilling and restores them on return', () => {
    browseState.items = [{ id: 'plex:s3', title: 'Season 3', type: 'season', itemType: 'container' }];
    const { unmount } = renderBrowse();
    const host = screen.getByTestId('scroll-host');
    Object.defineProperty(host, 'scrollTop', { configurable: true, writable: true, value: 137 });
    const row = screen.getByTestId('browse-open-plex:s3');
    row.focus();
    fireEvent.click(row);

    expect(push).toHaveBeenCalledWith(
      'browse',
      expect.objectContaining({ path: 'plex/s3', label: 'Season 3' }),
      expect.objectContaining({ currentPatch: { path: 'plex/season-2', scrollTop: 137, focusedId: 'plex:s3' } }),
    );

    unmount();
    browseState.items = [
      { id: 'plex:e2', title: 'Episode 2', type: 'episode', itemType: 'item', index: 2, thumbnail: '/two.jpg' },
    ];
    renderBrowse({ scrollTop: 137, focusedId: 'plex:e2' });
    expect(screen.getByTestId('scroll-host').scrollTop).toBe(137);
    expect(screen.getByTestId('browse-detail-plex:e2')).toHaveFocus();
  });
});
