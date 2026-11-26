// frontend/src/modules/Media/search/MediaContentSearch.test.jsx
// The dock's transient content picker: a selection is handed to
// useContentDispatch and the destination it chose is logged.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mutable holders — factories close over these but only read at render time.
const dispatch = vi.fn();
const dispatchLeafVerb = vi.fn();
const playContainerAsQueue = vi.fn();
const addContainerToQueue = vi.fn();
const { info } = vi.hoisted(() => ({ info: vi.fn() }));

vi.mock("./useContentDispatch.js", () => ({
  useContentDispatch: () => ({ dispatch, dispatchLeafVerb, playContainerAsQueue, addContainerToQueue }),
}));

// ── useSessionController: the ⋯ verb menu's four queue actions ──
const queuePlayNow = vi.fn();
const queuePlayNext = vi.fn();
const queueAddUpNext = vi.fn();
const queueAdd = vi.fn();
vi.mock("../controller/useSessionController.js", () => ({
  useSessionController: () => ({
    queue: { playNow: queuePlayNow, playNext: queuePlayNext, addUpNext: queueAddUpNext, add: queueAdd },
  }),
}));

// ── NavProvider: "Open detail" push ──
const navPush = vi.fn();
vi.mock("../shell/NavProvider.jsx", () => ({
  useNav: () => ({ push: navPush }),
}));

const notificationsShow = vi.fn();
vi.mock('@mantine/notifications', () => ({
  notifications: { show: (...a) => notificationsShow(...a) },
}));

// Mutable so a test can point currentScope/currentScopeKey at a narrowed
// scope to check the D5 fallback wiring (scopes[0] is always the catalog-wide
// "All" entry by convention — see SearchProvider.jsx).
let searchContext = {
  scopes: [{ key: 'all', label: 'All', params: '' }],
  currentScopeKey: 'all',
  currentScope: { key: 'all', label: 'All', params: '' },
  scopeError: null,
  setScopeKey: vi.fn(),
  resetScope: vi.fn(),
};

vi.mock("./useSearchContext.js", () => ({
  useSearchContext: () => searchContext,
}));

vi.mock("../cast/DestinationLine.jsx", () => ({
  DestinationLine: ({ surface }) => <div data-testid="destination-line" data-surface={surface} />,
}));

// Stand-in for the real combobox: buttons that fire the same onChange/
// onPlayAll/onMore contracts the real ContentCombobox uses (Task 14 wires
// these through to ResultRowActions — that wiring itself is covered by
// ContentCombobox.test.jsx; this suite only proves MediaContentSearch hands
// off the right callbacks). Captures the props MediaContentSearch threads in
// (fallbackSearchParams/scopeKey/scopeLabel — Task 11 fix round) so tests
// can assert on them directly.
let comboboxProps;
vi.mock("../../../../../__capabilities/content-catalog/browser/picker.mjs", () => ({
  ContentCombobox: (props) => {
    comboboxProps = props;
    const leaf = { id: 'plex:685088', title: 'Episode 3', type: 'episode' };
    const container = { id: 'plex:663508', title: 'Tuttle Twins', type: 'show' };
    return (
      <>
        <button data-testid="pick-episode" onClick={() => props.onChange(leaf.id, leaf)}>pick</button>
        <button data-testid="pick-container" onClick={() => props.onChange(container.id, container)}>pick container</button>
        <button data-testid="play-all-container" onClick={() => props.onPlayAll?.(container)}>play all</button>
        <button data-testid="more-play-next" onClick={() => props.onMore?.('playNext', leaf)}>play next</button>
        <button data-testid="more-play-now" onClick={() => props.onMore?.('playNow', leaf)}>play now</button>
        <button data-testid="more-add" onClick={() => props.onMore?.('add', leaf)}>add</button>
        <button data-testid="more-detail" onClick={() => props.onMore?.('detail', leaf)}>open detail</button>
        <button data-testid="close-search" onClick={() => props.onClose?.('escape')}>close</button>
        {/* Mirrors ContentCombobox's opt-in Tab contract: the input's own
            keydown asks onTabKey first; unhandled, Tab closes the search. */}
        <input
          data-testid="mock-search-input"
          onKeyDown={(e) => {
            if (e.key !== 'Tab') return;
            if (props.onTabKey?.(e.shiftKey ? -1 : 1)) { e.preventDefault(); return; }
            props.onClose?.('tab');
          }}
        />
        <div data-testid="mock-input-accessory">{props.inputAccessory}</div>
        <div role="menu" data-testid="mock-more-menu"><button role="menuitem" data-testid="mock-menu-item">Play next</button></div>
      </>
    );
  },
}));

vi.mock("../../../../../frontend/src/lib/logging/Logger.js", () => {
  const logger = { info, debug: () => {}, warn: () => {}, error: () => {}, sampled: () => {} };
  logger.child = () => logger;
  const getLogger = () => logger;
  return { default: getLogger, getLogger };
});

import { MediaContentSearch } from "./MediaContentSearch.jsx";
import { MantineProvider } from '@mantine/core';
import { CastTargetProvider, CAST_TARGET_KEY } from "../cast/CastTargetProvider.jsx";
import { FleetContext } from "../fleet/FleetProvider.jsx";
import { resetHabitsStoreForTests } from "../habits/mediaHabits.js";

const office = { id: 'office-tv', type: 'linux-pc', name: 'Office Screen', content_control: { provider: 'ws' } };
const livingRoom = { id: 'livingroom-tv', type: 'shield-tv', name: 'Living Room TV', content_control: { provider: 'fully-kiosk' } };
function fleet(devices = [office, livingRoom]) {
  return { devices, loading: false, error: null, refresh: vi.fn(), identity: { clientId: 'me', deviceId: 'browser:me' } };
}
function withAim(ui, devices) {
  return (
    <MantineProvider>
      <FleetContext.Provider value={fleet(devices)}>
        <CastTargetProvider>{ui}</CastTargetProvider>
      </FleetContext.Provider>
    </MantineProvider>
  );
}

beforeEach(() => {
  dispatch.mockReset();
  dispatchLeafVerb.mockReset();
  playContainerAsQueue.mockReset();
  addContainerToQueue.mockReset();
  info.mockReset();
  queuePlayNow.mockReset();
  queuePlayNext.mockReset();
  queueAddUpNext.mockReset();
  queueAdd.mockReset();
  navPush.mockReset();
  notificationsShow.mockReset();
  comboboxProps = undefined;
  searchContext = {
    scopes: [{ key: 'all', label: 'All', params: '' }],
    currentScopeKey: 'all',
    currentScope: { key: 'all', label: 'All', params: '' },
    scopeError: null,
    setScopeKey: vi.fn(),
    resetScope: vi.fn(),
  };
});

describe('MediaContentSearch', () => {
  it('leaves the destination to the header control (one control, not a copy beside the field)', () => {
    render(<MediaContentSearch />);

    expect(screen.queryByTestId('destination-line')).toBeNull();
    expect(screen.getByTestId('scope-chips')).toBeInTheDocument();
  });

  it('logs the destination a selection was routed to', () => {
    dispatch.mockReturnValue('cast');
    render(<MediaContentSearch />);
    fireEvent.click(screen.getByTestId('pick-episode'));

    expect(dispatch).toHaveBeenCalledWith(
      'plex:685088',
      { id: 'plex:685088', title: 'Episode 3', type: 'episode' }
    );
    expect(info).toHaveBeenCalledWith('dispatch', {
      contentId: 'plex:685088',
      route: 'cast',
    });
  });

  it('records a local route distinctly from a cast', () => {
    dispatch.mockReturnValue('local');
    render(<MediaContentSearch />);
    fireEvent.click(screen.getByTestId('pick-episode'));

    expect(info).toHaveBeenCalledWith('dispatch', {
      contentId: 'plex:685088',
      route: 'local',
    });
  });

  // ── Task 11 fix round: D5 wiring — previously this was dead code because
  // nothing passed fallbackSearchParams anywhere. ──

  it('D5: passes scopes[0] (the catalog-wide "All" scope) as fallbackSearchParams to ContentCombobox', () => {
    searchContext = {
      scopes: [
        { key: 'all', label: 'All', params: '' },
        { key: 'music-ambient', label: 'Ambient', params: 'source=plex&plex.libraryId=9' },
      ],
      currentScopeKey: 'music-ambient',
      currentScope: { key: 'music-ambient', label: 'Ambient', params: 'source=plex&plex.libraryId=9' },
      scopeError: null,
      setScopeKey: vi.fn(),
    };
    render(<MediaContentSearch />);

    expect(comboboxProps.searchParams).toBe('source=plex&plex.libraryId=9'); // the narrowed scope
    expect(comboboxProps.fallbackSearchParams).toBe(''); // scopes[0]'s params — catalog-wide
    expect(comboboxProps.scopeKey).toBe('music-ambient');
    expect(comboboxProps.scopeLabel).toBe('Ambient');
  });

  it('D5: falls back to an empty-string fallbackSearchParams when scopes[0] carries no params key', () => {
    searchContext = {
      scopes: [{ key: 'all', label: 'All' }], // no `params` key at all
      currentScopeKey: 'all',
      currentScope: { key: 'all', label: 'All' },
      scopeError: null,
      setScopeKey: vi.fn(),
    };
    render(<MediaContentSearch />);

    expect(comboboxProps.fallbackSearchParams).toBe('');
  });

  it('keeps the desktop scope when the search closes (the kept query keeps its scope)', () => {
    const resetScope = vi.fn();
    searchContext = {
      scopes: [{ key: 'all', label: 'All', params: '' }, { key: 'video', label: 'Video', params: 'mediaType=video' }],
      currentScopeKey: 'video',
      currentScope: { key: 'video', label: 'Video', params: 'mediaType=video' },
      scopeError: null,
      setScopeKey: vi.fn(),
      resetScope,
    };
    render(<MediaContentSearch />);

    fireEvent.click(screen.getByTestId('close-search'));
    expect(resetScope).not.toHaveBeenCalled();
  });

  // ── Task 14 (spec D6): the desktop half of the same tap grammar — a
  // container tap still routes through dispatch() (browse, per the hook's
  // own tests); what's new here is the ▶/⋯ verbs MediaContentSearch now
  // hands to ContentCombobox. ──
  describe('tap grammar (Task 14)', () => {
    it('a container tap routes through dispatch(), not playContainerAsQueue', () => {
      dispatch.mockReturnValue('browse');
      render(<MediaContentSearch />);
      fireEvent.click(screen.getByTestId('pick-container'));

      expect(dispatch).toHaveBeenCalledWith('plex:663508', expect.objectContaining({ id: 'plex:663508' }));
      expect(playContainerAsQueue).not.toHaveBeenCalled();
    });

    it('▶ calls playContainerAsQueue; its local outcome is reported by the outcome system, not a toast', () => {
      playContainerAsQueue.mockReturnValue('local');
      render(<MediaContentSearch />);
      fireEvent.click(screen.getByTestId('play-all-container'));

      expect(playContainerAsQueue).toHaveBeenCalledWith('plex:663508', expect.objectContaining({ id: 'plex:663508' }));
      expect(notificationsShow).not.toHaveBeenCalled();
    });

    it('▶ does not toast on a cast route (its dispatch outcome reports it)', () => {
      playContainerAsQueue.mockReturnValue('cast');
      render(<MediaContentSearch />);
      fireEvent.click(screen.getByTestId('play-all-container'));

      expect(notificationsShow).not.toHaveBeenCalled();
    });

    it('⋯ Play Next follows the displayed destination', () => {
      render(<MediaContentSearch />);
      fireEvent.click(screen.getByTestId('more-play-next'));

      expect(dispatchLeafVerb).toHaveBeenCalledWith('playNext', 'plex:685088', expect.objectContaining({ id: 'plex:685088' }));
    });

    it('⋯ Play Now routes the leaf through the current aim instead of a local applier', () => {
      dispatchLeafVerb.mockReturnValue('cast');
      render(<MediaContentSearch />);
      fireEvent.click(screen.getByTestId('more-play-now'));

      expect(dispatchLeafVerb).toHaveBeenCalledWith(
        'playNow', 'plex:685088', { id: 'plex:685088', title: 'Episode 3', type: 'episode' }
      );
      expect(queuePlayNow).not.toHaveBeenCalled();
    });

    it('⋯ Add dispatches the leaf to an aimed target instead of mutating the local queue', () => {
      dispatchLeafVerb.mockReturnValue('cast');
      render(<MediaContentSearch />);
      fireEvent.click(screen.getByTestId('more-add'));

      expect(dispatchLeafVerb).toHaveBeenCalledWith(
        'add', 'plex:685088',
        { id: 'plex:685088', title: 'Episode 3', type: 'episode' }
      );
      expect(queueAdd).not.toHaveBeenCalled();
    });

    it('⋯ Add retains the existing local append route when no target is aimed', () => {
      dispatchLeafVerb.mockReturnValue('local');
      render(<MediaContentSearch />);
      fireEvent.click(screen.getByTestId('more-add'));

      expect(dispatchLeafVerb).toHaveBeenCalledWith('add', 'plex:685088', expect.objectContaining({ id: 'plex:685088' }));
      expect(queueAdd).not.toHaveBeenCalled();
      expect(queuePlayNow).not.toHaveBeenCalled();
    });

    it('⋯ Open detail pushes the detail view, touching no queue applier', () => {
      render(<MediaContentSearch />);
      fireEvent.click(screen.getByTestId('more-detail'));

      expect(navPush).toHaveBeenCalledWith('detail', { contentId: 'plex:685088' });
      expect(queuePlayNow).not.toHaveBeenCalled();
    });
  });

  // ── The destination lives in the search box; Tab cycles it ──
  describe('destination chip', () => {
    beforeEach(() => {
      localStorage.clear();
      resetHabitsStoreForTests();
      localStorage.setItem(CAST_TARGET_KEY, JSON.stringify({ mode: 'transfer', targetIds: ['office-tv'], activityAt: Date.now() }));
    });
    const chipText = () => screen.getByTestId('search-destination-chip').textContent;

    it('mounts the chip inside the search input and opts in to Tab', () => {
      render(withAim(<MediaContentSearch />));
      expect(screen.getByTestId('mock-input-accessory')).toContainElement(screen.getByTestId('search-destination-chip'));
      expect(typeof comboboxProps.onTabKey).toBe('function');
      expect(chipText()).toBe('▶ Office Screen');
    });

    it('typing then Tab moves the chip on; Shift+Tab moves it back; the search stays open', () => {
      const onClose = vi.fn();
      render(withAim(<MediaContentSearch />));
      const input = screen.getByTestId('mock-search-input');
      fireEvent.change(input, { target: { value: 'termin' } });

      expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(false);
      expect(chipText()).toBe('▶ This device');
      fireEvent.keyDown(input, { key: 'Tab' });
      expect(chipText()).toBe('▶ Living Room TV');
      fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
      expect(chipText()).toBe('▶ This device');
      fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
      expect(chipText()).toBe('▶ Office Screen');
      expect(onClose).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith('search.destination-cycled', { from: 'local', to: 'livingroom-tv', via: 'tab' });
    });

    it('a click on the chip cycles too, logged as a click', () => {
      render(withAim(<MediaContentSearch />));
      fireEvent.click(screen.getByTestId('search-destination-chip'));
      expect(chipText()).toBe('▶ This device');
      expect(info).toHaveBeenCalledWith('search.destination-cycled', { from: 'office-tv', to: 'local', via: 'click' });
    });

    it('Tab inside a ⋯ menu does not cycle the destination', () => {
      render(withAim(<MediaContentSearch />));
      fireEvent.keyDown(screen.getByTestId('mock-menu-item'), { key: 'Tab' });
      expect(chipText()).toBe('▶ Office Screen');
      expect(info).not.toHaveBeenCalledWith('search.destination-cycled', expect.anything());
    });

    it('the aimed screen leaving the fleet reads "▶ This device"', () => {
      const { rerender } = render(withAim(<MediaContentSearch />));
      expect(chipText()).toBe('▶ Office Screen');
      rerender(withAim(<MediaContentSearch />, [livingRoom]));
      expect(chipText()).toBe('▶ This device');
    });

    it('without an aim provider Tab is left to the combobox (closes as before)', () => {
      render(<MediaContentSearch />);
      expect(screen.queryByTestId('search-destination-chip')).toBeNull();
      expect(comboboxProps.onTabKey?.(1) ?? false).toBe(false);
    });
  });
});
