// The destination chip in the search box: "▶ <where ▶ plays>". A click (or
// Tab in the box, wired by the search surfaces) walks the fixed cycle — the
// usual film screen, the other screens by name, then This device — and only
// ever writes the aim. A screen that leaves the fleet never shows as a raw id.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { CastTargetProvider, CAST_TARGET_KEY } from "../cast/CastTargetProvider.jsx";
import { useCastTarget } from "../cast/useCastTarget.js";
import { FleetContext } from "../fleet/FleetProvider.jsx";
import { habitsStore, resetHabitsStoreForTests } from "../habits/mediaHabits.js";
import mediaLog from "../logging/mediaLog.js";
import { usePlayDestination } from "../habits/usePlayDestination.js";
import { DestinationChip, useDestinationCycle } from "./DestinationChip.jsx";

vi.mock("../logging/mediaLog.js", () => {
  const stub = new Proxy({}, { get: (target, key) => (target[key] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

const office = { id: 'office-tv', type: 'linux-pc', name: 'Office Screen', content_control: { provider: 'ws' } };
const livingRoom = { id: 'livingroom-tv', type: 'shield-tv', name: 'Living Room TV', content_control: { provider: 'fully-kiosk' } };
const DEVICES = [livingRoom, office];

function fleetValue({ devices = DEVICES, loading = false } = {}) {
  return { devices, loading, error: null, refresh: vi.fn(), identity: { clientId: 'me', deviceId: 'browser:me' } };
}

function AimProbe() {
  const { targetIds } = useCastTarget();
  return <span data-testid="aim-probe">{targetIds.join(',')}</span>;
}

// What a film row's ▶ would do and say — the chip must name the same place.
const FILM = { id: 'plex:1', type: 'movie' };
function FilmPlayProbe() {
  const { destinationFor, labelsFor } = usePlayDestination();
  const d = destinationFor(FILM);
  return (
    <>
      <span data-testid="film-source">{d.source}</span>
      <span data-testid="film-targets">{d.targetIds.join(',')}</span>
      <span data-testid="film-label">{labelsFor(FILM).short}</span>
    </>
  );
}

function CycleProbe() {
  const { current, cycle } = useDestinationCycle();
  return (
    <>
      <span data-testid="cycle-current">{current.label}</span>
      <button type="button" data-testid="cycle-back" onClick={() => cycle(-1)}>back</button>
    </>
  );
}

function tree(fleet) {
  return (
    <MantineProvider>
      <FleetContext.Provider value={fleet}>
        <CastTargetProvider>
          <DestinationChip />
          <CycleProbe />
          <AimProbe />
          <FilmPlayProbe />
        </CastTargetProvider>
      </FleetContext.Provider>
    </MantineProvider>
  );
}

const chip = () => screen.getByTestId('search-destination-chip');

beforeEach(() => {
  localStorage.clear();
  resetHabitsStoreForTests();
  vi.clearAllMocks();
});

describe('DestinationChip', () => {
  // ── The chip names where a film's ▶ goes, in every state ──
  it('nothing learned, nothing aimed: "▶ Choose a screen", and a film ▶ asks', () => {
    render(tree(fleetValue()));
    expect(chip()).toHaveTextContent('▶ Choose a screen');
    expect(screen.getByTestId('film-source')).toHaveTextContent('ask');
    expect(screen.getByTestId('film-label')).toHaveTextContent('Play on…');
  });

  it('learned screen, nothing aimed: the chip names it, and that is where a film ▶ goes', () => {
    habitsStore().recordScreen('video', ['office-tv']);
    render(tree(fleetValue()));
    expect(chip()).toHaveTextContent('▶ Office Screen');
    expect(screen.getByTestId('film-source')).toHaveTextContent('learned');
    expect(screen.getByTestId('film-targets')).toHaveTextContent('office-tv');
    expect(screen.getByTestId('film-label')).toHaveTextContent('Office Screen');
  });

  it('learned screen, cycled to This device: a film ▶ plays here, not on the learned screen', () => {
    habitsStore().recordScreen('video', ['office-tv']);
    render(tree(fleetValue()));
    fireEvent.click(screen.getByTestId('cycle-back')); // unaimed → last = This device
    expect(chip()).toHaveTextContent('▶ This device');
    expect(screen.getByTestId('film-source')).toHaveTextContent('here');
    expect(screen.getByTestId('film-targets')).toHaveTextContent('');
    expect(screen.getByTestId('film-label')).toHaveTextContent('Play');
    // …and it stays chosen across a reload.
    expect(JSON.parse(localStorage.getItem(CAST_TARGET_KEY))).toMatchObject({ targetIds: [], here: true });
  });

  it('Tab from the unaimed state goes to the first entry of the cycle', () => {
    habitsStore().recordScreen('video', ['office-tv']);
    render(tree(fleetValue()));
    fireEvent.click(chip());
    expect(chip()).toHaveTextContent('▶ Office Screen');
    expect(screen.getByTestId('aim-probe')).toHaveTextContent('office-tv');
    expect(mediaLog.searchDestinationCycled).toHaveBeenCalledWith({ from: 'unaimed', to: 'office-tv', via: 'click' });
  });

  it('a click walks the cycle: usual film screen, the others by name, then This device', () => {
    habitsStore().recordScreen('video', ['livingroom-tv']);
    render(tree(fleetValue({ devices: [office, livingRoom, { id: 'bedroom-tv', name: 'Bedroom TV', type: 'shield-tv' }] })));

    fireEvent.click(chip());
    expect(chip()).toHaveTextContent('▶ Living Room TV');
    expect(screen.getByTestId('aim-probe')).toHaveTextContent('livingroom-tv');
    fireEvent.click(chip());
    expect(chip()).toHaveTextContent('▶ Bedroom TV');
    fireEvent.click(chip());
    expect(chip()).toHaveTextContent('▶ Office Screen');
    fireEvent.click(chip());
    expect(chip()).toHaveTextContent('▶ This device');
    expect(screen.getByTestId('aim-probe')).toHaveTextContent('');
  });

  it('without a learned film screen the screens go by name', () => {
    render(tree(fleetValue()));
    fireEvent.click(chip());
    expect(chip()).toHaveTextContent('▶ Living Room TV');
    fireEvent.click(chip());
    expect(chip()).toHaveTextContent('▶ Office Screen');
  });

  it('cycle(-1) walks backwards: This device, then the last screen', () => {
    render(tree(fleetValue()));
    fireEvent.click(screen.getByTestId('cycle-back'));
    expect(chip()).toHaveTextContent('▶ This device');
    fireEvent.click(screen.getByTestId('cycle-back'));
    expect(chip()).toHaveTextContent('▶ Office Screen');
    expect(screen.getByTestId('cycle-current')).toHaveTextContent('Office Screen');
  });

  it('logs each step and announces where things now play', () => {
    render(tree(fleetValue()));
    fireEvent.click(chip());
    expect(mediaLog.searchDestinationCycled).toHaveBeenCalledWith({ from: 'unaimed', to: 'livingroom-tv', via: 'click' });
    expect(screen.getByTestId('search-destination-announcement')).toHaveTextContent('Plays on Living Room TV');
    expect(screen.getByTestId('search-destination-announcement')).toHaveAttribute('aria-live', 'polite');
  });

  it('a press does not take focus from the search field', () => {
    render(tree(fleetValue()));
    const down = fireEvent.mouseDown(chip());
    expect(down).toBe(false); // preventDefault: the box keeps focus and its list
  });

  it('a screen that leaves the fleet falls back to the unaimed state, never its id, and the aim is let go', () => {
    localStorage.setItem(CAST_TARGET_KEY, JSON.stringify({ mode: 'transfer', targetIds: ['livingroom-tv'], activityAt: Date.now() }));
    const { rerender } = render(tree(fleetValue()));
    expect(chip()).toHaveTextContent('▶ Living Room TV');

    rerender(tree(fleetValue({ devices: [office] })));
    expect(chip()).toHaveTextContent('▶ Choose a screen');
    expect(screen.getByTestId('film-source')).toHaveTextContent('ask');
    expect(chip().textContent).not.toMatch(/livingroom/);
    expect(screen.getByTestId('aim-probe')).toHaveTextContent('');
    expect(mediaLog.searchDestinationStale).toHaveBeenCalledWith({ targetIds: ['livingroom-tv'] });
  });

  it('keeps a remembered aim while the fleet is still loading', () => {
    localStorage.setItem(CAST_TARGET_KEY, JSON.stringify({ mode: 'transfer', targetIds: ['office-tv'], activityAt: Date.now() }));
    const { rerender } = render(tree(fleetValue({ devices: [], loading: true })));
    expect(chip()).toHaveTextContent('▶ Choose a screen');
    expect(screen.getByTestId('aim-probe')).toHaveTextContent('office-tv');

    act(() => { rerender(tree(fleetValue())); });
    expect(chip()).toHaveTextContent('▶ Office Screen');
  });

  it('names a several-screen aim by its screens', () => {
    localStorage.setItem(CAST_TARGET_KEY, JSON.stringify({ mode: 'transfer', targetIds: ['office-tv', 'livingroom-tv'], activityAt: Date.now() }));
    render(tree(fleetValue()));
    expect(chip()).toHaveTextContent('▶ Office Screen + Living Room TV');
  });

  it('renders nothing outside an aim provider', () => {
    render(<MantineProvider><DestinationChip /></MantineProvider>);
    expect(screen.queryByTestId('search-destination-chip')).toBeNull();
  });
});
