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
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

// ── useListBrowse: control items/loading directly, no network ──
let navBack = 'Devices';
const listPaths = [];
let browseState = { items: [], total: 0, loading: false, error: null };
const loadMore = vi.fn();
let pageInfo = null;
vi.mock("./useContentInfo.js", () => ({ useContentInfo: () => ({ info: pageInfo, loading: false, error: null, reload: () => {} }) }));
vi.mock("./useListBrowse.js", () => ({
  useListBrowse: (path) => { listPaths.push(path); return { ...browseState, loadMore }; },
}));

// ── useSessionController: BrowseView's own leaf-row Play Now/Add (unrelated
// to the container header, but BrowseView still calls the hook) ──
const queuePlayNow = vi.fn();
const queueAdd = vi.fn();
vi.mock("../controller/useSessionController.js", () => ({
  useSessionController: () => ({ queue: { playNow: queuePlayNow, add: queueAdd } }),
}));

// ── useNav: breadcrumb + drill navigation ──
const navPush = vi.fn();
const navPop = vi.fn();
const navReplace = vi.fn();
vi.mock("../shell/NavProvider.jsx", () => ({
  useNav: () => ({ push: navPush, pop: navPop, replace: navReplace, depth: 2, backDestination: navBack }),
}));

// ── useContentDispatch: the header's ▶/🔀/+ verbs — this suite asserts
// BrowseView calls these correctly, not what they do internally. ──
const playContainerAsQueueMock = vi.fn();
const addContainerToQueueMock = vi.fn();
const dispatchLeafVerbMock = vi.fn();
vi.mock("../search/useContentDispatch.js", () => ({
  useContentDispatch: () => ({
    playContainerAsQueue: playContainerAsQueueMock,
    addContainerToQueue: addContainerToQueueMock,
    dispatchLeafVerb: dispatchLeafVerbMock,
  }),
}));

// ── component-local logger ──
vi.mock("../household/useHouseholdResultActions.js", () => ({
  useHouseholdResultActions: () => ({ extraActions: () => [], runHousehold: () => false }),
}));
vi.mock("../../../../../frontend/src/lib/logging/Logger.js", () => {
  const getLogger = () => ({ child: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn() }) });
  return { default: getLogger, getLogger };
});

// ── DestinationLine's own leaf deps ──
let fleetDevices = [];
vi.mock("../fleet/useFleetContext.js", () => ({
  useFleetContext: () => ({ devices: fleetDevices }),
}));
vi.mock("@/lib/ui/dismiss/useDismissLayer.js", () => ({
  useDismissLayer: () => {},
}));
vi.mock("../cast/DispatchTargetPicker.jsx", () => ({
  DispatchTargetPicker: () => <div data-testid="picker-stub" />,
}));

import { BrowseView } from "./BrowseView.jsx";
import { CastTargetProvider } from "../cast/CastTargetProvider.jsx";
import { habitsStore as seedHabits } from "../habits/mediaHabits.js";

// These tests describe a browser that has chosen to watch here: with nothing
// chosen, a film's ▶ asks where (Play on…) instead — see habits/playDestination.js.
beforeEach(() => { seedHabits().recordScreen('video', []); });

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
  dispatchLeafVerbMock.mockClear();
  navBack = 'Devices';
  pageInfo = null;
  fleetDevices = [];
  localStorage.clear(); seedHabits().recordScreen('video', []);
});

describe('BrowseView — container dispatch header (Task 15)', () => {
  it('never names the app area the person came from (owner: "Devices" in a show\'s breadcrumb)', () => {
    renderBrowse();
    expect(screen.queryByTestId('browse-crumb-back')).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).not.toHaveTextContent('Devices');
  });
  it('a page opened by its address: the breadcrumb is the content\'s parents, every part a link, no raw id', () => {
    pageInfo = { title: 'Season 1', type: 'season', metadata: { type: 'season', parentTitle: 'Bluey (2018)', parentRatingKey: '59493' } };
    render(<MantineProvider><CastTargetProvider><BrowseView path="plex/59494" /></CastTargetProvider></MantineProvider>);
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav).toHaveTextContent('Home/Bluey (2018)/Season 1');
    expect(nav).not.toHaveTextContent('59494');
    fireEvent.click(screen.getByTestId('browse-crumb-parent-0'));
    expect(navReplace).toHaveBeenCalledWith('browse', expect.objectContaining({ path: 'plex/59493', label: 'Bluey (2018)', breadcrumbs: [] }));
    expect(screen.getByTestId('browse-crumb-current').tagName).toBe('BUTTON');
  });
  it('a page opened by its address shows no raw id while its title loads', () => {
    render(<MantineProvider><CastTargetProvider><BrowseView path="plex/457029" /></CastTargetProvider></MantineProvider>);
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).not.toHaveTextContent('457029');
  });
  const containerItem = { id: 'plex:663508', title: 'Tuttle Twins', type: 'show' };

  it('does not render the header for a root/category browse level (no containerItem)', () => {
    renderBrowse({ containerItem: null });
    expect(screen.queryByTestId('browse-dispatch-header')).not.toBeInTheDocument();
  });

  it('does not render the header when the item passed along is not actually a container', () => {
    renderBrowse({ containerItem: { id: 'plex:665667', title: 'Episode 8', type: 'episode' } });
    expect(screen.queryByTestId('browse-dispatch-header')).not.toBeInTheDocument();
  });

  it('the header offers the info view\'s row: ▶ (naming where), Play on…, More ⋯ — Shuffle and Queue inside More', () => {
    renderBrowse({ containerItem });
    expect(screen.getByTestId('browse-dispatch-header')).toBeInTheDocument();
    // Nothing aimed or learned: the ▶ says it plays here.
    expect(screen.getByTestId('browse-dispatch-play')).toHaveTextContent('Play here');
    expect(screen.getByTestId('browse-dispatch-play-on')).toHaveTextContent('Play on…');
    expect(screen.queryByTestId('browse-dispatch-shuffle')).toBeNull();
    fireEvent.click(screen.getByTestId('browse-dispatch-more'));
    expect(screen.getByTestId('browse-dispatch-shuffle')).toHaveTextContent('Shuffle');
    expect(screen.getByTestId('browse-dispatch-queue')).toHaveTextContent('Add to Queue');
  });
  it('the header shows the picture, the facts and the summary from the page\'s info', () => {
    pageInfo = {
      title: 'Bluey (2018)', type: 'show', thumbnail: '/thumb.jpg',
      metadata: { type: 'show', year: 2018, contentRating: 'TV-Y', genres: ['Animation'], seasonCount: 4, leafCount: 155, summary: 'A puppy.' },
    };
    renderBrowse({ containerItem: null, path: 'plex/59493' });
    expect(screen.getByTestId('browse-header-art')).toHaveAttribute('src', '/thumb.jpg');
    expect(screen.getByTestId('browse-header-facts')).toHaveTextContent('TV Show · 2018 · TV-Y · Animation · 4 seasons · 155 episodes');
    expect(screen.getByTestId('browse-header-summary')).toHaveTextContent('A puppy.');
  });
  it('an author page lists its items by kind: "Books (2)"', () => {
    pageInfo = { title: 'Mario Livio', type: 'artist', metadata: { type: 'artist', librarySectionTitle: 'Audiobooks' } };
    browseState = { items: [
      { id: 'plex:505133', title: 'Is God a Mathematician?', itemType: 'container', type: 'album', metadata: { type: 'album' } },
      { id: 'plex:505135', title: 'Brilliant Blunders', itemType: 'container', type: 'album', metadata: { type: 'album' } },
    ], total: 2, loading: false, error: null };
    renderBrowse({ containerItem: null, path: 'plex/196996' });
    const section = screen.getByTestId('browse-section-album');
    expect(section).toHaveTextContent('Books (2)');
    expect(screen.getByTestId('browse-header-facts')).toHaveTextContent('Author · 2 books');
  });
  it('arriving at a container page puts focus on its PLAY', async () => {
    renderBrowse({ containerItem });
    await waitFor(() => expect(screen.getByTestId('browse-dispatch-play')).toHaveFocus());
  });
  it('coming Back to a row does not move focus to PLAY', async () => {
    browseState = { items: [{ id: 'plex:9999', title: 'Season 1', itemType: 'container', type: 'season' }, { id: 'plex:9998', title: 'Season 2', itemType: 'container', type: 'season' }], total: 2, loading: false, error: null };
    renderBrowse({ containerItem, focusedId: 'plex:9998' });
    await waitFor(() => expect(screen.getByTestId('browse-open-plex:9998')).toHaveFocus());
    expect(screen.getByTestId('browse-dispatch-play')).not.toHaveFocus();
  });
  it('a show with one season lists that season\'s episodes under the show header', async () => {
    pageInfo = { title: 'Bibleman', type: 'show', metadata: { type: 'show', seasonCount: 1, leafCount: 18 } };
    browseState = { items: [{ id: 'plex:457030', title: 'Season 1', itemType: 'container', type: 'season' }], total: 1, loading: false, error: null };
    renderBrowse({ containerItem: null, path: 'plex/457029' });
    await waitFor(() => expect(listPaths.at(-1)).toBe('plex/457030'));
    expect(screen.getByTestId('browse-header-title')).toHaveTextContent('Bibleman');
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
    fireEvent.click(screen.getByTestId('browse-dispatch-more'));
    fireEvent.click(screen.getByTestId('browse-dispatch-shuffle'));
    expect(playContainerAsQueueMock).toHaveBeenCalledWith('plex:663508', containerItem, { shuffle: true });
  });

  it('Queue invokes the append (+) dispatch, never the replacing Play dispatch', () => {
    renderBrowse({ containerItem });
    fireEvent.click(screen.getByTestId('browse-dispatch-more'));
    fireEvent.click(screen.getByTestId('browse-dispatch-queue'));
    expect(addContainerToQueueMock).toHaveBeenCalledWith('plex:663508', containerItem);
    expect(playContainerAsQueueMock).not.toHaveBeenCalled();
  });

  it('every verb targets the WHOLE container id, not a row within it', () => {
    renderBrowse({ containerItem });
    fireEvent.click(screen.getByTestId('browse-dispatch-play'));
    fireEvent.click(screen.getByTestId('browse-dispatch-more'));
    fireEvent.click(screen.getByTestId('browse-dispatch-shuffle'));
    fireEvent.click(screen.getByTestId('browse-dispatch-more'));
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
    }), expect.objectContaining({
      currentPatch: expect.objectContaining({ path: 'plex/663508', focusedId: 'plex:9999' }),
    }));
  });
});

describe('BrowseView — a playable row: the tap looks, its ▶ plays', () => {
  it('a row tap opens the exact item\'s detail page and plays nothing', () => {
    browseState = {
      items: [{ id: 'plex:55854', title: 'Arrival', type: 'movie', thumbnail: 'arrival.jpg' }],
      total: 1, loading: false, error: null,
    };
    renderBrowse();
    const row = screen.getByRole('button', { name: /Arrival artwork\s+Arrival/ });
    expect(row).toHaveAttribute('data-testid', 'browse-open-plex:55854');
    expect(row.closest('li')).toHaveClass('result-row');
    fireEvent.click(row);

    expect(navPush).toHaveBeenCalledWith('detail', { contentId: 'plex:55854' }, {
      currentPatch: { path: 'plex/663508', scrollTop: 0, focusedId: 'plex:55854', loadedCount: 1 },
    });
    expect(dispatchLeafVerbMock).not.toHaveBeenCalled();
  });

  it('the row\'s own ▶ plays that exact row through the destination dispatcher', () => {
    browseState = {
      items: [{ id: 'plex:685088', title: 'Episode 3', type: 'episode', thumbnail: 'episode.jpg' }],
      total: 1, loading: false, error: null,
    };
    renderBrowse();
    const play = screen.getByTestId('result-play-all-plex:685088');
    expect(play).toHaveTextContent('Play');
    expect(play).toHaveAccessibleName('Play Episode 3 here');
    fireEvent.click(play);

    expect(dispatchLeafVerbMock).toHaveBeenCalledWith('playNow', 'plex:685088', expect.objectContaining({
      id: 'plex:685088', title: 'Episode 3', thumbnail: 'episode.jpg',
    }));
    expect(queuePlayNow).not.toHaveBeenCalled();
    expect(navPush).not.toHaveBeenCalled();
  });
});
