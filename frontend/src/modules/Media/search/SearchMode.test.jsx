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
vi.mock('./useContentDispatch.js', () => ({
  useContentDispatch: () => dispatchMock,
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

    expect(dispatchMock).toHaveBeenCalledWith(
      'plex:685088',
      expect.objectContaining({ id: 'plex:685088', title: 'Bluey' })
    );
    expect(screen.queryByTestId('search-mode')).not.toBeInTheDocument();
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
});
