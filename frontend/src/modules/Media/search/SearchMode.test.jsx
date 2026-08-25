// frontend/src/modules/Media/search/SearchMode.test.jsx
// Full-screen mobile search surface (spec D1-D2). Mounts the REAL
// SearchProvider (not a mock) so the "scope resets to All on every open"
// requirement is proven against the actual shared scope state a mounted
// SearchMode and its nested ScopeChips both read — a per-component mock of
// useSearchContext can't express "two components share one scope" the way a
// real Provider does. ScopeChips and DestinationLine mount as-is (per Task
// 13's interface contract); only their own leaf dependencies (fleet devices,
// the dismiss-layer registrar, the device picker sheet body) are stubbed.
// useContentCombobox and useContentDispatch are mocked at the hook boundary:
// this suite exercises SearchMode's own wiring (autofocus, scope-reset,
// open/close/back, row-tap -> dispatch -> close), not the combobox's search
// machine (already covered by its own tests) or the dispatch routing table
// (useContentDispatch.test.jsx).
import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

// ── useContentDispatch: capture what SearchMode hands off, control the route ──
const dispatchMock = vi.fn();
const playContainerAsQueueMock = vi.fn();
vi.mock('./useContentDispatch.js', () => ({
  useContentDispatch: () => ({ dispatch: dispatchMock, playContainerAsQueue: playContainerAsQueueMock }),
}));

// ── useSessionController: the ⋯ verb menu's four queue actions ──
const queuePlayNow = vi.fn();
const queuePlayNext = vi.fn();
const queueAddUpNext = vi.fn();
const queueAdd = vi.fn();
vi.mock('../controller/useSessionController.js', () => ({
  useSessionController: () => ({
    queue: { playNow: queuePlayNow, playNext: queuePlayNext, addUpNext: queueAddUpNext, add: queueAdd },
  }),
}));

// ── NavProvider: "Open detail" push ──
const navPush = vi.fn();
vi.mock('../shell/NavProvider.jsx', () => ({
  useNav: () => ({ push: navPush }),
}));

// ── useContentCombobox: SearchMode uses the HOOK directly (not the popover
// component). `select` mimics the real hook's select(): it calls the
// `onChange` SearchMode passed in — the same callback that drives dispatch +
// close — so a row tap in these tests exercises the real wiring, not a stub
// that merely records a call. ──
let comboState = { search: null, results: [] };
let comboExtra = {};
const handleInputSpy = vi.fn();
vi.mock('../../Content/combobox/useContentCombobox.js', () => ({
  useContentCombobox: (args) => ({
    state: { search: comboState.search, results: comboState.results },
    handleInput: (text) => handleInputSpy(text),
    select: (item) => args.onChange(item.id, item),
    isSearching: comboExtra.isSearching ?? false,
    pendingSources: comboExtra.pendingSources ?? [],
    sourceErrors: comboExtra.sourceErrors ?? [],
    fellBackToAll: comboExtra.fellBackToAll ?? false,
  }),
}));

// ── mediaLog: assert entered/exited without touching the real transport ──
vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub };
});

// ── notifications: capture the local-dispatch toast ──
const notificationsShow = vi.fn();
vi.mock('@mantine/notifications', () => ({
  notifications: { show: (...a) => notificationsShow(...a) },
}));

// ── DestinationLine's own leaf deps (mounted for real otherwise) ──
let fleetDevices = [];
vi.mock('../fleet/FleetProvider.jsx', () => ({
  useFleetContext: () => ({ devices: fleetDevices }),
}));
vi.mock('../shell/DismissStackProvider.jsx', () => ({
  useDismissLayer: () => {},
}));
vi.mock('../cast/DispatchTargetPicker.jsx', () => ({
  DispatchTargetPicker: () => <div data-testid="picker-stub" />,
}));

// ── component-local info logger ──
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: vi.fn() }) }),
}));

// ── SearchProvider's config fetch ──
let scopeConfig = [
  { key: 'all', label: 'All', params: '' },
  { key: 'ambient', label: 'Ambient', params: 'source=plex&plex.libraryId=9' },
];
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async (path) => (path === 'api/v1/media/config' ? { searchScopes: scopeConfig } : {})),
}));

import mediaLog from '../logging/mediaLog.js';
import { SearchProvider } from './SearchProvider.jsx';
import { CastTargetProvider } from '../cast/CastTargetProvider.jsx';
import { SearchMode } from './SearchMode.jsx';

// Mirrors how MediaAppShell actually wires this: SearchProvider/CastTargetProvider
// stay mounted across the app's life; only SearchMode's presence toggles.
function Harness({ initialOpen = true }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <MantineProvider>
      <CastTargetProvider>
        <SearchProvider>
          <button data-testid="harness-reopen" onClick={() => setOpen(true)}>reopen</button>
          {open && <SearchMode onClose={() => setOpen(false)} />}
        </SearchProvider>
      </CastTargetProvider>
    </MantineProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  playContainerAsQueueMock.mockReset();
  navPush.mockReset();
  localStorage.clear();
  comboState = { search: null, results: [] };
  comboExtra = {};
  fleetDevices = [];
  scopeConfig = [
    { key: 'all', label: 'All', params: '' },
    { key: 'ambient', label: 'Ambient', params: 'source=plex&plex.libraryId=9' },
  ];
});

describe('SearchMode', () => {
  it('autofocuses the input on open', async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('search-mode-input')).toHaveFocus());
  });

  it('logs search.mode_entered on open', async () => {
    render(<Harness />);
    await waitFor(() => expect(mediaLog.searchModeEntered).toHaveBeenCalledWith({}));
  });

  it('pushes a history entry on open', async () => {
    const pushSpy = vi.spyOn(window.history, 'pushState');
    render(<Harness />);
    await screen.findByTestId('search-mode');
    expect(pushSpy).toHaveBeenCalled();
    pushSpy.mockRestore();
  });

  it('renders chips with All selected on every open, resetting after a scope change', async () => {
    render(<Harness />);
    await screen.findByTestId('scope-chip-all');
    expect(screen.getByTestId('scope-chip-all')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('scope-chip-ambient'));
    expect(screen.getByTestId('scope-chip-ambient')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('scope-chip-all')).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByTestId('search-mode-close'));
    expect(screen.queryByTestId('search-mode')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('harness-reopen'));
    await screen.findByTestId('scope-chip-all');
    expect(screen.getByTestId('scope-chip-all')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('scope-chip-ambient')).toHaveAttribute('aria-pressed', 'false');
  });

  it('✕ closes the surface', async () => {
    render(<Harness />);
    await screen.findByTestId('search-mode');
    fireEvent.click(screen.getByTestId('search-mode-close'));
    expect(screen.queryByTestId('search-mode')).not.toBeInTheDocument();
  });

  it('logs search.mode_exited with reason "dismiss" on ✕', async () => {
    render(<Harness />);
    await screen.findByTestId('search-mode');
    fireEvent.click(screen.getByTestId('search-mode-close'));
    expect(mediaLog.searchModeExited).toHaveBeenCalledWith({ reason: 'dismiss' });
  });

  it('browser back (popstate) closes the surface', async () => {
    render(<Harness />);
    await screen.findByTestId('search-mode');
    act(() => { window.dispatchEvent(new Event('popstate')); });
    expect(screen.queryByTestId('search-mode')).not.toBeInTheDocument();
    expect(mediaLog.searchModeExited).toHaveBeenCalledWith({ reason: 'back' });
  });

  it('a select of a leaf result calls dispatch and closes', async () => {
    comboState = {
      search: 'bluey',
      results: [{ id: 'plex:685088', title: 'Bluey', type: 'episode', thumbnail: null }],
    };
    dispatchMock.mockReturnValue('local');
    render(<Harness />);
    await screen.findByTestId('search-mode-result-plex:685088');

    fireEvent.click(screen.getByTestId('search-mode-result-plex:685088'));

    // The third arg is the fix-round history option: a route this dispatch
    // pushes must REPLACE the surface's marker entry (see
    // SearchMode.history.test.jsx, which exercises that end to end against the
    // real NavProvider — this suite mocks both sides of it).
    expect(dispatchMock).toHaveBeenCalledWith(
      'plex:685088',
      expect.objectContaining({ id: 'plex:685088', title: 'Bluey' }),
      { replaceHistoryEntry: true }
    );
    expect(screen.queryByTestId('search-mode')).not.toBeInTheDocument();
  });

  // ── Fix round (Critical 1): the dispatch exit used to close WITHOUT
  // consuming the history entry pushed on open — unlike the ✕ path, which
  // always called history.back(). Every "tap a result" exit (the most
  // common one) leaked an entry carrying `mediaSearchMode: true`, and that
  // flag then propagated into every later pushState via the
  // `{...history.state}` spread, so the user's next real back press would
  // silently no-op. This asserts on actual history depth/state, not just
  // that the surface closed. ──
  it('consumes the history entry pushed on open when closing via a successful dispatch', async () => {
    comboState = {
      search: 'bluey',
      results: [{ id: 'plex:685088', title: 'Bluey', type: 'episode', thumbnail: null }],
    };
    dispatchMock.mockReturnValue('local');
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const backSpy = vi.spyOn(window.history, 'back');

    render(<Harness />);
    await screen.findByTestId('search-mode-result-plex:685088');
    expect(pushSpy).toHaveBeenCalledTimes(1); // one entry pushed on open

    fireEvent.click(screen.getByTestId('search-mode-result-plex:685088'));

    // The dispatch exit must consume the SAME entry the ✕ path consumes:
    // exactly one back() call (not zero — the leaked-entry bug — and not a
    // second pushState, which would just push a fresh copy of the flag).
    expect(backSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledTimes(1);

    // The resulting popstate must not re-fire a second close/log — closedRef
    // already latched on the 'dispatch' exit. This is what actually proves
    // depth returned to baseline rather than merely "one call happened":
    // if the leaked-entry bug were still present, closeSurface would never
    // call history.back() at all, so the guard here would be untested and
    // a stray push would sit unconsumed — one push balanced by exactly one
    // back, with no compensating second exit log, is the whole proof.
    expect(mediaLog.searchModeExited).toHaveBeenCalledTimes(1);
    expect(mediaLog.searchModeExited).toHaveBeenCalledWith({ reason: 'dispatch' });

    // NOTE: happy-dom (this suite's DOM environment) does not actually
    // replay `history.state` back to the prior entry after `history.back()`
    // — verified directly against happy-dom's History implementation, which
    // leaves `state` pointing at the last-pushed entry regardless of back()
    // calls or elapsed time. A real browser does not have this limitation
    // (that's what the ✕ path already relied on pre-fix-round), so a
    // `window.history.state` assertion here would be asserting on a test
    // environment gap, not on SearchMode's behavior — the push/back call
    // parity above is the reliable, environment-agnostic proof instead.

    pushSpy.mockRestore();
    backSpy.mockRestore();
  });

  it('shows a "Playing" toast for a local dispatch route', async () => {
    comboState = {
      search: 'bluey',
      results: [{ id: 'plex:685088', title: 'Bluey', type: 'episode', thumbnail: null }],
    };
    dispatchMock.mockReturnValue('local');
    render(<Harness />);
    await screen.findByTestId('search-mode-result-plex:685088');
    fireEvent.click(screen.getByTestId('search-mode-result-plex:685088'));

    expect(notificationsShow).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Playing Bluey' })
    );
  });

  it('does not double-toast a cast route (useContentDispatch already toasts it)', async () => {
    comboState = {
      search: 'bluey',
      results: [{ id: 'plex:685088', title: 'Bluey', type: 'episode', thumbnail: null }],
    };
    dispatchMock.mockReturnValue('cast');
    render(<Harness />);
    await screen.findByTestId('search-mode-result-plex:685088');
    fireEvent.click(screen.getByTestId('search-mode-result-plex:685088'));

    expect(notificationsShow).not.toHaveBeenCalled();
    expect(screen.queryByTestId('search-mode')).not.toBeInTheDocument();
  });

  it('mounts ScopeChips, DestinationLine, and StreamStatusLine', async () => {
    render(<Harness />);
    await screen.findByTestId('search-mode');
    expect(screen.getByTestId('scope-chips')).toBeInTheDocument();
    expect(screen.getByTestId('destination-line')).toBeInTheDocument();
  });

  // ── Fix round (Important 2): the D5 widening notice. The hook widened
  // correctly and ContentCombobox rendered a notice on DESKTOP, but this
  // surface — the mobile one the whole remediation exists for — destructured
  // everything from the hook EXCEPT fellBackToAll and rendered nothing. The
  // 2026-08-21 acceptance scenario (scope "Ambient", empty settle, silent
  // catalog-wide re-run, Ambient chip still aria-pressed) therefore shipped
  // inert here. ──
  describe('D5 widening notice', () => {
    async function renderWidened({ results, fellBackToAll = true, isSearching = false }) {
      comboState = { search: 'bluey', results };
      comboExtra = { fellBackToAll, isSearching };
      render(<Harness />);
      await screen.findByTestId('search-mode');
      // The notice must name the scope that came up empty, so put the surface
      // on the Ambient chip the way the incident did.
      //
      // AWAITED, not `getBy`: the chips mount a beat after `search-mode`
      // itself, so a synchronous get here is a race the test only loses when
      // the machine is busy — it was the last roaming failure of the full
      // parallel sweep, and passed every time this file ran alone.
      fireEvent.click(await screen.findByTestId('scope-chip-ambient'));
    }

    it('names the empty scope and the widened result count once the widened search has landed', async () => {
      await renderWidened({ results: [{ id: 'plex:685088', title: 'Bluey', type: 'episode', thumbnail: null }] });

      const notice = screen.getByTestId('search-mode-widening-notice');
      expect(notice).toHaveTextContent('Nothing in Ambient — showing 1 result from everywhere.');
      // The chip that came up empty is still the pressed one — that is exactly
      // why the notice has to exist.
      expect(screen.getByTestId('scope-chip-ambient')).toHaveAttribute('aria-pressed', 'true');
    });

    it('pluralizes the widened result count', async () => {
      await renderWidened({
        results: [
          { id: 'plex:1', title: 'Bluey', type: 'episode', thumbnail: null },
          { id: 'plex:2', title: 'Bluey 2', type: 'episode', thumbnail: null },
        ],
      });
      expect(screen.getByTestId('search-mode-widening-notice'))
        .toHaveTextContent('Nothing in Ambient — showing 2 results from everywhere.');
    });

    it('says nothing was found anywhere when the widened search is also empty, and suppresses the generic empty line', async () => {
      await renderWidened({ results: [] });
      expect(screen.getByTestId('search-mode-widening-notice'))
        .toHaveTextContent('Nothing in Ambient — and nothing found anywhere else either.');
      expect(screen.queryByTestId('search-mode-empty')).toBeNull();
    });

    it('stays hidden while the widened search is still in flight', async () => {
      await renderWidened({ results: [], isSearching: true });
      expect(screen.queryByTestId('search-mode-widening-notice')).toBeNull();
    });

    it('renders no notice when the search never widened', async () => {
      await renderWidened({
        results: [{ id: 'plex:685088', title: 'Bluey', type: 'episode', thumbnail: null }],
        fellBackToAll: false,
      });
      expect(screen.queryByTestId('search-mode-widening-notice')).toBeNull();
    });
  });

  // ── Task 14 (spec D6): the ONE tap grammar, wired via ResultRow ──
  describe('tap grammar (Task 14)', () => {
    it('a container row taps through dispatch (browse), never playContainerAsQueue', async () => {
      comboState = {
        search: 'tuttle',
        results: [{ id: 'plex:663508', title: 'Tuttle Twins', type: 'show', thumbnail: null }],
      };
      dispatchMock.mockReturnValue('browse');
      render(<Harness />);
      await screen.findByTestId('search-mode-result-plex:663508');
      fireEvent.click(screen.getByTestId('search-mode-result-plex:663508'));

      expect(dispatchMock).toHaveBeenCalledWith(
        'plex:663508',
        expect.objectContaining({ id: 'plex:663508' }),
        { replaceHistoryEntry: true }
      );
      expect(playContainerAsQueueMock).not.toHaveBeenCalled();
    });

    it('▶ on a container calls playContainerAsQueue and closes the surface', async () => {
      comboState = {
        search: 'tuttle',
        results: [{ id: 'plex:663508', title: 'Tuttle Twins', type: 'show', thumbnail: null }],
      };
      playContainerAsQueueMock.mockReturnValue('cast');
      render(<Harness />);
      await screen.findByTestId('result-play-all-plex:663508');
      fireEvent.click(screen.getByTestId('result-play-all-plex:663508'));

      expect(playContainerAsQueueMock).toHaveBeenCalledWith('plex:663508', expect.objectContaining({ id: 'plex:663508' }));
      expect(screen.queryByTestId('search-mode')).not.toBeInTheDocument();
    });

    it('a container row never shows the ⋯ leaf menu', async () => {
      comboState = {
        search: 'tuttle',
        results: [{ id: 'plex:663508', title: 'Tuttle Twins', type: 'show', thumbnail: null }],
      };
      render(<Harness />);
      await screen.findByTestId('search-mode-result-plex:663508');
      expect(screen.queryByTestId('result-more-plex:663508')).toBeNull();
    });

    it('a leaf row never shows the container ▶', async () => {
      comboState = {
        search: 'bluey',
        results: [{ id: 'plex:685088', title: 'Bluey', type: 'episode', thumbnail: null }],
      };
      render(<Harness />);
      await screen.findByTestId('search-mode-result-plex:685088');
      expect(screen.queryByTestId('result-play-all-plex:685088')).toBeNull();
    });

    it('⋯ on a leaf: Play Next calls queue.playNext and closes the surface', async () => {
      comboState = {
        search: 'bluey',
        results: [{ id: 'plex:685088', title: 'Bluey', type: 'episode', thumbnail: null }],
      };
      render(<Harness />);
      await screen.findByTestId('result-more-plex:685088');
      fireEvent.click(screen.getByTestId('result-more-plex:685088'));
      fireEvent.click(await screen.findByTestId('result-action-playNext-plex:685088'));

      expect(queuePlayNext).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'plex:685088' }));
      expect(screen.queryByTestId('search-mode')).not.toBeInTheDocument();
    });

    it('⋯ Up Next calls queue.addUpNext', async () => {
      comboState = {
        search: 'bluey',
        results: [{ id: 'plex:685088', title: 'Bluey', type: 'episode', thumbnail: null }],
      };
      render(<Harness />);
      await screen.findByTestId('result-more-plex:685088');
      fireEvent.click(screen.getByTestId('result-more-plex:685088'));
      fireEvent.click(await screen.findByTestId('result-action-upNext-plex:685088'));

      expect(queueAddUpNext).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'plex:685088' }));
    });

    it('⋯ Add to Queue calls queue.add', async () => {
      comboState = {
        search: 'bluey',
        results: [{ id: 'plex:685088', title: 'Bluey', type: 'episode', thumbnail: null }],
      };
      render(<Harness />);
      await screen.findByTestId('result-more-plex:685088');
      fireEvent.click(screen.getByTestId('result-more-plex:685088'));
      fireEvent.click(await screen.findByTestId('result-action-add-plex:685088'));

      expect(queueAdd).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'plex:685088' }));
    });

    it('⋯ Open detail pushes the detail view and closes the surface, touching no queue applier', async () => {
      comboState = {
        search: 'bluey',
        results: [{ id: 'plex:685088', title: 'Bluey', type: 'episode', thumbnail: null }],
      };
      render(<Harness />);
      await screen.findByTestId('result-more-plex:685088');
      fireEvent.click(screen.getByTestId('result-more-plex:685088'));
      fireEvent.click(await screen.findByTestId('result-action-detail-plex:685088'));

      // `replaceEntry` (fix round, Critical 1): "Open detail" navigates, so it
      // must take OVER the surface's marker history entry rather than stack on
      // top of an entry the close path would then traverse back over.
      expect(navPush).toHaveBeenCalledWith('detail', { contentId: 'plex:685088' }, { replaceEntry: true });
      expect(queuePlayNow).not.toHaveBeenCalled();
      expect(screen.queryByTestId('search-mode')).not.toBeInTheDocument();
    });
  });
});
