// The destination chip's careful choice (owner ruling 2026-11-27): the ▾
// joined to the chip opens every destination as a list — the cycle's screens
// in the shared ranking, top three then More, and This device — with each
// row's live state. Opening only reads; a pick writes the same sticky aim a
// cycle step does. Esc keeps the choice; focus goes back to the search box.
import React, { useRef, useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { CastTargetProvider, CAST_TARGET_KEY } from "../cast/CastTargetProvider.jsx";
import { useCastTarget } from "../cast/useCastTarget.js";
import { FleetContext } from "../fleet/FleetProvider.jsx";
import { habitsStore, resetHabitsStoreForTests } from "../habits/mediaHabits.js";
import mediaLog from "../logging/mediaLog.js";
import { DestinationChip } from "./DestinationChip.jsx";
import { destinationListScreens, currentRowId } from "./DestinationList.jsx";

vi.mock("../logging/mediaLog.js", () => {
  const stub = new Proxy({}, { get: (target, key) => (target[key] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

const screenDevice = (id, name, type = 'shield-tv') => ({ id, name, type, content_control: { provider: 'fully-kiosk' } });
const office = screenDevice('office-tv', 'Office Screen', 'linux-pc');
const living = screenDevice('livingroom-tv', 'Living Room TV');
const bedroom = screenDevice('bedroom-tv', 'Bedroom TV');
const guest = screenDevice('guest-tv', 'Guest Room TV');
const portal = screenDevice('portal', 'Portal', 'android-tablet');
const speaker = { id: 'speaker-red', name: 'Red Headset', type: 'speaker' };
const DEVICES = [living, office, bedroom, guest, portal, speaker];

function fakeStore(entries = {}) {
  return {
    getEntry: vi.fn((id) => entries[id] ?? null),
    subscribeDevice: vi.fn(() => () => {}),
  };
}

function fleetValue({ devices = DEVICES, store = fakeStore() } = {}) {
  return { devices, loading: false, error: null, refresh: vi.fn(), store, identity: { clientId: 'me', deviceId: 'browser:me' } };
}

function AimProbe() {
  const { targetIds, here } = useCastTarget();
  return <span data-testid="aim-probe">{here ? 'here' : targetIds.join(',')}</span>;
}

// The search surface: an input that owns where focus returns, as Media's does.
function Surface({ controlled = false }) {
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <input ref={inputRef} data-testid="search-input" />
      <DestinationChip
        returnFocusRef={inputRef}
        {...(controlled ? { listOpen: open, onListOpenChange: setOpen } : {})}
      />
    </>
  );
}

function tree(fleet = fleetValue(), props = {}) {
  return (
    <MantineProvider>
      <FleetContext.Provider value={fleet}>
        <CastTargetProvider>
          <Surface {...props} />
          <AimProbe />
        </CastTargetProvider>
      </FleetContext.Provider>
    </MantineProvider>
  );
}

const toggle = () => screen.getByTestId('search-destination-list-toggle');
const list = () => screen.queryByTestId('dest-list');
const openList = () => act(() => { fireEvent.click(toggle()); });

let fetchSpy;
beforeEach(() => {
  localStorage.clear();
  resetHabitsStoreForTests();
  vi.clearAllMocks();
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response('{}')));
});
afterEach(() => fetchSpy.mockRestore());

describe('destinationListScreens (pure)', () => {
  it('lists only the cycle\'s screens, usual first, then habit weight, then by name', () => {
    const order = [
      { targetIds: ['office-tv'] }, { targetIds: ['bedroom-tv'] }, { targetIds: ['livingroom-tv'] }, { targetIds: [] },
    ];
    const weights = new Map([['livingroom-tv', 2]]);
    const ranked = destinationListScreens({ order, devices: DEVICES, usualIds: ['office-tv'], weights });
    expect(ranked.map((d) => d.id)).toEqual(['office-tv', 'livingroom-tv', 'bedroom-tv']);
  });

  it('names the current row: an aim, the learned screen ▶ follows, This device, or none when ▶ asks', () => {
    expect(currentRowId({ unaimed: false, targetIds: ['office-tv'] })).toBe('office-tv');
    expect(currentRowId({ unaimed: true, shownIds: ['office-tv'], targetIds: [] })).toBe('office-tv');
    expect(currentRowId({ unaimed: false, targetIds: [] })).toBe('local');
    expect(currentRowId({ unaimed: true, shownIds: null, targetIds: [] })).toBeNull();
  });
});

describe('DestinationChip ▾ list', () => {
  it('the ▾ opens the list: top three screens (usual first), More, then This device; never a speaker', () => {
    habitsStore().recordScreen('video', ['office-tv']);
    render(tree());
    expect(list()).toBeNull();
    openList();
    const rows = within(list()).getAllByRole('menuitem').map((el) => el.getAttribute('data-testid'));
    expect(rows).toEqual([
      'dest-list-row-office-tv', 'dest-list-row-bedroom-tv', 'dest-list-row-guest-tv',
      'dest-list-more', 'dest-list-row-local',
    ]);
    expect(screen.queryByTestId('dest-list-row-speaker-red')).toBeNull();
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(mediaLog.destListOpened).toHaveBeenCalledWith({ current: 'office-tv', screens: 5 });
  });

  it('More shows the rest in the same list', () => {
    render(tree());
    openList();
    act(() => { fireEvent.click(screen.getByTestId('dest-list-more')); });
    expect(screen.getByTestId('dest-list-row-livingroom-tv')).toBeInTheDocument();
    expect(screen.getByTestId('dest-list-row-portal')).toBeInTheDocument();
    expect(mediaLog.listMoreExpanded).toHaveBeenCalledWith(expect.objectContaining({ surface: 'dest-list' }));
  });

  it('each row shows its state (Asleep / Playing: <title>) and the current one is ticked', () => {
    habitsStore().recordScreen('video', ['office-tv']);
    localStorage.setItem(CAST_TARGET_KEY, JSON.stringify({ mode: 'transfer', targetIds: ['bedroom-tv'], activityAt: Date.now() }));
    const store = fakeStore({
      'office-tv': { offline: true },
      'bedroom-tv': { snapshot: { state: 'playing', currentItem: { title: 'Bluey', contentId: 'plex:1' } } },
    });
    render(tree(fleetValue({ store })));
    openList();
    expect(screen.getByTestId('dest-list-status-office-tv')).toHaveTextContent('Asleep');
    expect(screen.getByTestId('dest-list-status-bedroom-tv')).toHaveTextContent('Playing: Bluey');
    expect(screen.getByTestId('dest-list-row-bedroom-tv')).toHaveAttribute('aria-current', 'true');
    expect(within(screen.getByTestId('dest-list-row-bedroom-tv')).getByLabelText('Current')).toBeInTheDocument();
    expect(screen.getByTestId('dest-list-row-office-tv')).not.toHaveAttribute('aria-current');
  });

  it('opening never wakes anything: no request, no aim change, only reads of the fleet store', () => {
    habitsStore().recordScreen('video', ['office-tv']);
    const store = fakeStore();
    render(tree(fleetValue({ store })));
    openList();
    act(() => { fireEvent.click(screen.getByTestId('dest-list-more')); });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('aim-probe')).toHaveTextContent('');
    expect(Object.keys(store).sort()).toEqual(['getEntry', 'subscribeDevice']);
  });

  it('a pick sets the sticky destination, logs from/to/rank, closes, and focus goes back to the box', () => {
    habitsStore().recordScreen('video', ['office-tv']);
    render(tree());
    openList();
    act(() => { fireEvent.click(screen.getByTestId('dest-list-row-guest-tv')); });
    expect(screen.getByTestId('aim-probe')).toHaveTextContent('guest-tv');
    expect(screen.getByTestId('search-destination-chip')).toHaveTextContent('▶ Guest Room TV');
    expect(JSON.parse(localStorage.getItem(CAST_TARGET_KEY))).toMatchObject({ targetIds: ['guest-tv'] });
    expect(mediaLog.destListPicked).toHaveBeenCalledWith({ from: 'unaimed', to: 'guest-tv', rank: 3 });
    expect(list()).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('search-input'));
  });

  it('picking This device chooses here on purpose (a film ▶ then plays here)', () => {
    habitsStore().recordScreen('video', ['office-tv']);
    render(tree());
    openList();
    act(() => { fireEvent.click(screen.getByTestId('dest-list-row-local')); });
    expect(screen.getByTestId('aim-probe')).toHaveTextContent('here');
    expect(screen.getByTestId('search-destination-chip')).toHaveTextContent('▶ This device');
    expect(mediaLog.destListPicked).toHaveBeenCalledWith({ from: 'unaimed', to: 'local', rank: 6 });
  });

  it('Esc closes the list, keeps the current choice, and returns focus to the box', () => {
    localStorage.setItem(CAST_TARGET_KEY, JSON.stringify({ mode: 'transfer', targetIds: ['bedroom-tv'], activityAt: Date.now() }));
    render(tree());
    openList();
    // Focus lands on the current row when the list opens.
    expect(document.activeElement).toBe(screen.getByTestId('dest-list-row-bedroom-tv'));
    act(() => { fireEvent.keyDown(document.activeElement, { key: 'Escape' }); });
    expect(list()).toBeNull();
    expect(screen.getByTestId('aim-probe')).toHaveTextContent('bedroom-tv');
    expect(mediaLog.destListPicked).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByTestId('search-input'));
  });

  it('keyboard: ↓ on the ▾ (or on the chip) opens it; Enter on a row picks it', () => {
    render(tree());
    act(() => { fireEvent.keyDown(toggle(), { key: 'ArrowDown' }); });
    expect(list()).not.toBeNull();
    act(() => { fireEvent.keyDown(document.activeElement, { key: 'Escape' }); });
    expect(list()).toBeNull();

    act(() => { fireEvent.keyDown(screen.getByTestId('search-destination-chip'), { key: 'ArrowDown' }); });
    expect(list()).not.toBeNull();
    const row = screen.getByTestId('dest-list-row-bedroom-tv');
    act(() => { row.focus(); });
    // Mantine menu items are buttons: Enter activates them as a click.
    act(() => { fireEvent.keyDown(row, { key: 'Enter' }); fireEvent.click(row); });
    expect(screen.getByTestId('aim-probe')).toHaveTextContent('bedroom-tv');
    expect(list()).toBeNull();
  });

  it('a click on the chip itself still cycles (the list is the careful option, not a replacement)', () => {
    habitsStore().recordScreen('video', ['office-tv']);
    render(tree());
    fireEvent.click(screen.getByTestId('search-destination-chip'));
    expect(list()).toBeNull();
    expect(mediaLog.searchDestinationCycled).toHaveBeenCalledWith(expect.objectContaining({ via: 'click' }));
  });

  it('a surface that owns the open state (Alt+↓ in the box) drives the same list', () => {
    render(tree(fleetValue(), { controlled: true }));
    openList();
    expect(list()).not.toBeNull();
    act(() => { fireEvent.click(screen.getByTestId('dest-list-row-bedroom-tv')); });
    expect(list()).toBeNull();
    expect(screen.getByTestId('aim-probe')).toHaveTextContent('bedroom-tv');
  });
});
