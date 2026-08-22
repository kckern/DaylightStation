// frontend/src/modules/Media/search/SearchMode.history.test.jsx
// Regression suite for CRITICAL 1 of the final pre-merge review: a container
// tap in mobile Search Mode navigated and then IMMEDIATELY un-navigated.
//
// The defect was emergent — it lived in the interaction between three pieces
// that are each correct alone, which is exactly why SearchMode.test.jsx could
// not see it: that suite mocks BOTH useContentDispatch AND NavProvider, so the
// browse push and the history consumption never met.
//
//   1. dispatch() routes a container to useNav().push('browse')
//   2. push() -> syncHistory(next,'push') -> history.pushState
//   3. closeSurface('dispatch') called history.back() for every non-'back'
//      reason -> popped the entry the navigation had just created, landing on
//      the SearchMode marker entry whose mediaNavStack is the PRE-search stack
//
// Net effect on a phone: search "Tuttle Twins", tap the show, and you are back
// on Home. The branch's headline tap-grammar rule ("containers browse")
// failing on its primary surface.
//
// WHAT THIS SUITE MOCKS, AND WHY IT STILL PROVES THE FIX
// -----------------------------------------------------
// REAL (never mocked) — the entire chain the defect lived in:
//   • NavProvider          — the real stack + the real syncHistory/pushState/
//                            replaceState calls and the real popstate handler
//   • useContentDispatch   — the real routing table, so "container -> browse"
//                            is decided by production code, not a stub's
//                            return value
//   • CastTargetProvider / browsePath / comboboxMachine.isContainer
//   • window.history       — assertions read actual history state, and the
//                            push/back call counts come from spies on the real
//                            methods
// MOCKED — only leaves that are OFF the path under test and would otherwise
// drag in network or hardware:
//   • useContentCombobox   — supplies fixed result rows (the alternative is an
//                            SSE transport; the search machine has its own
//                            suite). Its `select` still calls SearchMode's own
//                            onChange, so the tap wiring is real.
//   • useDispatch/useFleetContext/useSessionController — the cast, fleet and
//                            local-queue sinks. A CONTAINER tap returns from
//                            dispatch() before any of them is consulted, and
//                            the leaf case only needs to observe that no
//                            navigation happened.
//   • DismissStackProvider / DispatchTargetPicker / api.mjs / notifications /
//     logging — DestinationLine's and SearchProvider's own leaf dependencies.
//
// So the push and the history consumption both really happen, in production
// code, against a real history object — which is precisely the interaction the
// finding is about.
import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

// ── Search results, without a transport (see header) ──
let comboState = { search: null, results: [] };
vi.mock('../../Content/combobox/useContentCombobox.js', () => ({
  useContentCombobox: (args) => ({
    state: { search: comboState.search, results: comboState.results },
    handleInput: vi.fn(),
    select: (item) => args.onChange(item.id, item),
    isSearching: false,
    pendingSources: [],
    sourceErrors: [],
    fellBackToAll: false,
  }),
}));

// ── Sinks the container branch never reaches; the leaf branch lands in queue ──
const dispatchToTarget = vi.fn(() => Promise.resolve([]));
vi.mock('../cast/DispatchProvider.jsx', () => ({
  useDispatch: () => ({ dispatchToTarget, dispatches: new Map(), retryLast: vi.fn() }),
}));
const queuePlayNow = vi.fn();
vi.mock('../controller/useSessionController.js', () => ({
  useSessionController: () => ({
    queue: { playNow: queuePlayNow, playNext: vi.fn(), addUpNext: vi.fn(), add: vi.fn() },
    config: { setShuffle: vi.fn() },
  }),
}));
vi.mock('../fleet/FleetProvider.jsx', () => ({
  useFleetContext: () => ({ devices: [] }),
}));
vi.mock('../shell/DismissStackProvider.jsx', () => ({ useDismissLayer: () => {} }));
vi.mock('../cast/DispatchTargetPicker.jsx', () => ({
  DispatchTargetPicker: () => <div data-testid="picker-stub" />,
}));
vi.mock('@mantine/notifications', () => ({ notifications: { show: vi.fn() } }));
vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub };
});
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }),
}));
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async (path) => (
    path === 'api/v1/media/config'
      ? { searchScopes: [{ key: 'all', label: 'All', params: '' }] }
      : {}
  )),
}));

import { SearchProvider } from './SearchProvider.jsx';
import { CastTargetProvider } from '../cast/CastTargetProvider.jsx';
import { NavProvider, useNav } from '../shell/NavProvider.jsx';
import { SearchMode } from './SearchMode.jsx';

// Reads the REAL NavProvider so "where did the user end up" is an assertion on
// the live nav state, not on a spy's arguments.
function NavProbe() {
  const { view, depth } = useNav();
  return <span data-testid="nav-probe" data-view={view} data-depth={String(depth)} />;
}

// Mirrors MediaAppShell: NavProvider/SearchProvider/CastTargetProvider persist,
// only SearchMode's presence toggles.
function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <MantineProvider>
      <NavProvider>
        <CastTargetProvider>
          <SearchProvider>
            <NavProbe />
            {open && <SearchMode onClose={() => setOpen(false)} />}
          </SearchProvider>
        </CastTargetProvider>
      </NavProvider>
    </MantineProvider>
  );
}

const CONTAINER = { id: 'plex:663508', title: 'Tuttle Twins', type: 'show', thumbnail: null };
const LEAF = { id: 'plex:685088', title: 'Bluey', type: 'episode', thumbnail: null };

const probe = () => screen.getByTestId('nav-probe');

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  // Each test starts from a clean single history entry on Home — NavProvider's
  // initialStack() reads window.history.state, so a leaked mediaNavStack from
  // the previous test would seed the wrong baseline.
  window.history.replaceState(null, '', '/');
  comboState = { search: null, results: [] };
});

describe('SearchMode history × dispatch (final review, Critical 1)', () => {
  it('a container tap lands the user ON the browse view — it does not un-navigate', async () => {
    comboState = { search: 'tuttle', results: [CONTAINER] };
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const backSpy = vi.spyOn(window.history, 'back');

    render(<Harness />);
    await screen.findByTestId('search-mode-result-plex:663508');
    expect(probe()).toHaveAttribute('data-view', 'home'); // pre-search view
    expect(pushSpy).toHaveBeenCalledTimes(1); // the surface's marker entry

    fireEvent.click(screen.getByTestId('search-mode-result-plex:663508'));

    // 1. The surface is closed…
    expect(screen.queryByTestId('search-mode')).not.toBeInTheDocument();
    // 2. …and the user is ON the browse view. Pre-fix this read 'home': the
    //    unconditional history.back() popped the browse entry and the real
    //    NavProvider popstate handler restored the marker's PRE-search stack.
    expect(probe()).toHaveAttribute('data-view', 'browse');
    // 3. The exit did not traverse history at all — there was nothing to
    //    consume, because the browse route took the marker entry's place.
    expect(backSpy).not.toHaveBeenCalled();
  });

  it('leaves no orphaned SearchMode entry behind the browse view', async () => {
    comboState = { search: 'tuttle', results: [CONTAINER] };
    const pushSpy = vi.spyOn(window.history, 'pushState');

    render(<Harness />);
    await screen.findByTestId('search-mode-result-plex:663508');
    fireEvent.click(screen.getByTestId('search-mode-result-plex:663508'));

    // Exactly ONE entry was ever pushed for this whole flow — the marker, now
    // occupied by the browse route (a second pushState would be the orphan:
    // an entry whose mediaNavStack is the pre-search stack, sitting between
    // Home and browse, that the user's back press would land on as a no-op).
    expect(pushSpy).toHaveBeenCalledTimes(1);

    // The live entry carries the POST-navigation stack, and the marker flag is
    // gone so it cannot ride along into later pushes via the
    // `{...history.state}` spread.
    const state = window.history.state;
    expect(state.mediaNavStack.map((e) => e.view)).toEqual(['home', 'browse']);
    expect(state.mediaSearchMode).toBeUndefined();

    // Browser Back from here therefore has exactly one place to go: Home, the
    // view the user searched from. Depth 2 is what makes that true.
    expect(probe()).toHaveAttribute('data-depth', '2');
  });

  it('the browse route carries the tapped container, so the user sees what they tapped', async () => {
    comboState = { search: 'tuttle', results: [CONTAINER] };
    render(<Harness />);
    await screen.findByTestId('search-mode-result-plex:663508');
    fireEvent.click(screen.getByTestId('search-mode-result-plex:663508'));

    const top = window.history.state.mediaNavStack.at(-1);
    expect(top.view).toBe('browse');
    expect(top.params.label).toBe('Tuttle Twins');
    expect(top.params.containerItem).toMatchObject({ id: 'plex:663508' });
  });

  it('a leaf tap (no navigation) still consumes the marker entry, exactly as before', async () => {
    comboState = { search: 'bluey', results: [LEAF] };
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const backSpy = vi.spyOn(window.history, 'back');

    render(<Harness />);
    await screen.findByTestId('search-mode-result-plex:685088');
    expect(pushSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('search-mode-result-plex:685088'));

    // Leaf -> play locally: nothing navigated, so the marker entry is dead
    // weight and must be traversed away — one push balanced by one back.
    expect(queuePlayNow).toHaveBeenCalledWith(
      expect.objectContaining({ contentId: 'plex:685088' }),
      { clearRest: true }
    );
    expect(backSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(probe()).toHaveAttribute('data-view', 'home'); // never navigated
    expect(screen.queryByTestId('search-mode')).not.toBeInTheDocument();
  });

  it('the ⋯ "Open detail" verb navigates too, and gets the same treatment', async () => {
    comboState = { search: 'bluey', results: [LEAF] };
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const backSpy = vi.spyOn(window.history, 'back');

    render(<Harness />);
    fireEvent.click(await screen.findByTestId('result-more-plex:685088'));
    fireEvent.click(await screen.findByTestId('result-action-detail-plex:685088'));

    expect(probe()).toHaveAttribute('data-view', 'detail');
    expect(backSpy).not.toHaveBeenCalled();
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(window.history.state.mediaNavStack.map((e) => e.view)).toEqual(['home', 'detail']);
    expect(window.history.state.mediaSearchMode).toBeUndefined();
  });
});
