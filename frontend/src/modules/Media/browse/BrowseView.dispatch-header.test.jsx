// frontend/src/modules/Media/browse/BrowseView.dispatch-header.test.jsx
// Task 15 (spec D6 addendum): a container tap ALWAYS browses (Task 14) — the
// header this suite covers is what pays that cost back. It exercises
// BrowseView's own wiring (header visibility gated on containerItem being an
// actual container, the three verbs calling the right useContentDispatch
// function with the right args, header placement) — not useContentDispatch's
// destination-routing table, which useContentDispatch.test.jsx already
// covers exhaustively. useContentDispatch is mocked at the hook boundary
// here for that reason (mirrors SearchMode.test.jsx / MediaContentSearch's
// own test conventions).
//
// DestinationLine mounts for real (per Task 12/13's interface contract —
// "no layout-specific props, everything from context"); only its own leaf
// deps (fleet devices, the dismiss-layer registrar, the device picker sheet
// body) are stubbed, same as SearchMode.test.jsx.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

// ── useListBrowse: control items/loading directly, no network ──
let browseState = { items: [], total: 0, loading: false, error: null };
const loadMore = vi.fn();
vi.mock('./useListBrowse.js', () => ({
  useListBrowse: () => ({ ...browseState, loadMore }),
}));

// ── useSessionController: BrowseView's own leaf-row Play Now/Add (unrelated
// to the container header, but BrowseView still calls the hook) ──
const queuePlayNow = vi.fn();
const queueAdd = vi.fn();
vi.mock('../controller/useSessionController.js', () => ({
  useSessionController: () => ({ queue: { playNow: queuePlayNow, add: queueAdd } }),
}));

// ── useNav: breadcrumb + drill navigation ──
const navPush = vi.fn();
const navPop = vi.fn();
const navReplace = vi.fn();
vi.mock('../shell/NavProvider.jsx', () => ({
  useNav: () => ({ push: navPush, pop: navPop, replace: navReplace, depth: 2 }),
}));

// ── useContentDispatch: the header's ▶/🔀/+ verbs — this suite asserts
// BrowseView calls these correctly, not what they do internally. ──
const playContainerAsQueueMock = vi.fn();
const addContainerToQueueMock = vi.fn();
vi.mock('../search/useContentDispatch.js', () => ({
  useContentDispatch: () => ({
    playContainerAsQueue: playContainerAsQueueMock,
    addContainerToQueue: addContainerToQueueMock,
  }),
}));

// ── component-local logger ──
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: vi.fn() }) }),
}));

// ── DestinationLine's own leaf deps ──
let fleetDevices = [];
vi.mock('../fleet/useFleetContext.js', () => ({
  useFleetContext: () => ({ devices: fleetDevices }),
}));
vi.mock('../shell/useDismissLayer.js', () => ({
  useDismissLayer: () => {},
}));
vi.mock('../cast/DispatchTargetPicker.jsx', () => ({
  DispatchTargetPicker: () => <div data-testid="picker-stub" />,
}));

import { BrowseView } from './BrowseView.jsx';
import { CastTargetProvider } from '../cast/CastTargetProvider.jsx';

function renderBrowse(props = {}) {
  return render(
    <MantineProvider>
      <CastTargetProvider>
        <BrowseView path="plex/663508" label="Tuttle Twins" {...props} />
      </CastTargetProvider>
    </MantineProvider>
  );
}

beforeEach(() => {
  browseState = { items: [], total: 0, loading: false, error: null };
  loadMore.mockClear();
  queuePlayNow.mockClear();
  queueAdd.mockClear();
  navPush.mockClear();
  navPop.mockClear();
  navReplace.mockClear();
  playContainerAsQueueMock.mockClear();
  addContainerToQueueMock.mockClear();
  fleetDevices = [];
  localStorage.clear();
});

describe('BrowseView — container dispatch header (Task 15)', () => {
  const containerItem = { id: 'plex:663508', title: 'Tuttle Twins', type: 'show' };

  it('does not render the header for a root/category browse level (no containerItem)', () => {
    renderBrowse({ containerItem: null });
    expect(screen.queryByTestId('browse-dispatch-header')).not.toBeInTheDocument();
  });

  it('does not render the header when the item passed along is not actually a container', () => {
    renderBrowse({ containerItem: { id: 'plex:665667', title: 'Episode 8', type: 'episode' } });
    expect(screen.queryByTestId('browse-dispatch-header')).not.toBeInTheDocument();
  });

  it('renders ▶ Play · 🔀 Shuffle · + Queue and the destination for a container browse view', () => {
    renderBrowse({ containerItem });
    expect(screen.getByTestId('browse-dispatch-header')).toBeInTheDocument();
    expect(screen.getByTestId('browse-dispatch-play')).toHaveTextContent('Play');
    expect(screen.getByTestId('browse-dispatch-shuffle')).toHaveTextContent('Shuffle');
    expect(screen.getByTestId('browse-dispatch-queue')).toHaveTextContent('Queue');
    expect(screen.getByTestId('destination-line')).toBeInTheDocument();
    expect(screen.getByTestId('destination-line-name')).toHaveTextContent('This browser');
  });

  it('renders the header directly under the breadcrumb, above the row list', () => {
    renderBrowse({ containerItem });
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav.nextElementSibling).toHaveAttribute('data-testid', 'browse-dispatch-header');
  });

  it('Play invokes container-as-queue dispatch with the container id and item', () => {
    renderBrowse({ containerItem });
    fireEvent.click(screen.getByTestId('browse-dispatch-play'));
    expect(playContainerAsQueueMock).toHaveBeenCalledWith('plex:663508', containerItem);
    expect(addContainerToQueueMock).not.toHaveBeenCalled();
  });

  it('Shuffle invokes container-as-queue dispatch with shuffle:true', () => {
    renderBrowse({ containerItem });
    fireEvent.click(screen.getByTestId('browse-dispatch-shuffle'));
    expect(playContainerAsQueueMock).toHaveBeenCalledWith('plex:663508', containerItem, { shuffle: true });
  });

  it('Queue invokes the append (+) dispatch, never the replacing Play dispatch', () => {
    renderBrowse({ containerItem });
    fireEvent.click(screen.getByTestId('browse-dispatch-queue'));
    expect(addContainerToQueueMock).toHaveBeenCalledWith('plex:663508', containerItem);
    expect(playContainerAsQueueMock).not.toHaveBeenCalled();
  });

  it('every verb targets the WHOLE container id, not a row within it', () => {
    renderBrowse({ containerItem });
    fireEvent.click(screen.getByTestId('browse-dispatch-play'));
    fireEvent.click(screen.getByTestId('browse-dispatch-shuffle'));
    fireEvent.click(screen.getByTestId('browse-dispatch-queue'));
    for (const call of playContainerAsQueueMock.mock.calls) expect(call[0]).toBe('plex:663508');
    for (const call of addContainerToQueueMock.mock.calls) expect(call[0]).toBe('plex:663508');
  });
});

describe('BrowseView — nested drill carries containerItem forward', () => {
  it('opening a nested container row pushes browse with that row as containerItem', () => {
    browseState = {
      items: [{ id: 'plex:9999', title: 'Season 1', itemType: 'container', type: 'season' }],
      total: 1,
      loading: false,
      error: null,
    };
    renderBrowse({ containerItem: { id: 'plex:663508', title: 'Tuttle Twins', type: 'show' } });
    fireEvent.click(screen.getByTestId('browse-open-plex:9999'));
    expect(navPush).toHaveBeenCalledWith('browse', expect.objectContaining({
      path: 'plex/9999',
      label: 'Season 1',
      containerItem: expect.objectContaining({ id: 'plex:9999', title: 'Season 1', itemType: 'container' }),
    }));
  });
});
