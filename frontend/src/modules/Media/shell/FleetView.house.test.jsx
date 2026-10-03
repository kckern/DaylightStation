// House view rows (P1/P2): start status for everyone (RQ-HOUSE-04), Started
// by (RQ-HOUSE-07), Add only label + switch off (RQ-PLAY-10), notes with Put
// it back on screens that can't show them (RQ-STEER-21), "(was …)"
// (RQ-HOUSE-06), Stop "and turn the screen off" only where supported
// (RQ-STEER-11), and the house-wide bar (RQ-STEER-13).
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { PeekContext } from '../peek/PeekContext.js';
import { DispatchContext } from '../cast/DispatchProvider.jsx';

const fleet = vi.hoisted(() => ({ devices: [], entries: {}, statuses: new Map(), startedBy: new Map() }));
const push = vi.fn();
const houseApi = vi.hoisted(() => ({ screenOff: vi.fn(async () => ({ ok: true })) }));

vi.mock('../fleet/useFleetContext.js', () => ({
  useFleetContext: () => ({ devices: fleet.devices, loading: false, error: null, connected: true,
    store: { getEntry: (id) => fleet.entries[id] ?? null } }),
}));
vi.mock('../fleet/useDevice.js', () => ({
  useDevice: (deviceId) => ({ device: fleet.devices.find((d) => d.id === deviceId) ?? null, entry: fleet.entries[deviceId] ?? null }),
}));
vi.mock('./NavProvider.jsx', () => ({ useNav: () => ({ push }) }));
vi.mock('../fleet/FleetPlayPicker.jsx', () => ({ FleetPlayPicker: () => null }));
vi.mock('../house/useHouseSignals.js', () => ({
  useStartStatuses: () => fleet.statuses,
  useStartedByAll: () => fleet.startedBy,
  useStartedBy: () => null,
}));
vi.mock('../house/HouseQuietControls.jsx', () => ({ HouseQuietBar: () => <div data-testid="house-quiet-bar" /> }));
vi.mock('../house/houseApi.js', async (orig) => ({ ...(await orig()), houseApi: houseApi }));

import { FleetView } from './FleetView.jsx';

const controllers = {};
const recordLocal = vi.fn();
function renderFleet() {
  return render(
    <MantineProvider>
      <PeekContext.Provider value={{ getController: (id) => controllers[id] }}>
        <DispatchContext.Provider value={{ recordLocal }}>
          <FleetView />
        </DispatchContext.Provider>
      </PeekContext.Provider>
    </MantineProvider>,
  );
}

const soon = () => new Date(Date.now() + 8_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  fleet.devices = [
    { id: 'livingroom-tv', name: 'Den TV', type: 'shield-tv', device_control: {}, content_control: {}, wasName: 'Living Room TV', state: 'playing' },
    { id: 'speaker-white', name: 'Bedroom speaker', type: 'speaker', state: 'playing' },
  ];
  fleet.entries = {
    'livingroom-tv': { snapshot: { state: 'playing', currentItem: { title: 'Bluey', contentId: 'plex:1' }, controls: { addOnly: true, notes: [] } } },
    'speaker-white': { snapshot: { state: 'playing', currentItem: { title: 'Rain', contentId: 'plex:2' }, controls: {
      addOnly: false,
      notes: [{ id: 'n1', kind: 'paused', label: "Paused by Dad's phone", count: 2, at: new Date().toISOString(), putBack: { availableUntil: soon() } }],
    } } },
  };
  fleet.statuses = new Map([['livingroom-tv', { phase: 'failed', step: 'power', error: 'timeout', updatedAt: new Date().toISOString() }]]);
  fleet.startedBy = new Map([['livingroom-tv', { startedBy: { kind: 'routine', name: 'Kitchen Button 1' }, at: new Date().toISOString() }]]);
  for (const k of Object.keys(controllers)) delete controllers[k];
});

describe('FleetView house rows', () => {
  it('shows the last failed start, the starter and the old name on the row', () => {
    renderFleet();
    expect(screen.getByTestId('house-start-status-livingroom-tv')).toHaveTextContent("Couldn't start at");
    expect(screen.getByTestId('house-start-status-livingroom-tv')).toHaveTextContent('Turning on TV failed (timeout)');
    expect(screen.getByTestId('house-started-by-livingroom-tv')).toHaveTextContent('Started by Kitchen Button 1,');
    expect(screen.getByTestId('fleet-was-name-livingroom-tv')).toHaveTextContent('(was Living Room TV)');
    expect(screen.getByTestId('house-quiet-bar')).toBeInTheDocument();
  });

  it('labels Add only and lets anyone switch it off from the row', async () => {
    controllers['livingroom-tv'] = { sessionControls: { setAddOnly: vi.fn(async () => ({ ok: true })) }, transport: {} };
    renderFleet();
    expect(screen.getByTestId('house-add-only-livingroom-tv')).toHaveTextContent('Add only is on');
    expect(screen.queryByTestId('house-add-only-speaker-white')).toBeNull();
    fireEvent.click(screen.getByTestId('house-add-only-off-livingroom-tv'));
    await waitFor(() => expect(controllers['livingroom-tv'].sessionControls.setAddOnly).toHaveBeenCalledWith(false));
    await waitFor(() => expect(recordLocal).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'addOnly', phase: 'confirmed', targetId: 'livingroom-tv',
    })));
  });

  it('records a speaker\'s grouped notes on its row with Put it back; a TV shows its own', async () => {
    controllers['speaker-white'] = { sessionControls: { putBack: vi.fn(async () => ({ ok: true })) }, transport: {} };
    renderFleet();
    expect(screen.queryByTestId('house-notes-livingroom-tv')).toBeNull();
    const note = screen.getByTestId('house-note-speaker-white-n1');
    expect(note).toHaveTextContent("Paused by Dad's phone ×2");
    fireEvent.click(within(note).getByTestId('house-put-back-speaker-white-n1'));
    await waitFor(() => expect(controllers['speaker-white'].sessionControls.putBack).toHaveBeenCalledWith('n1'));
  });

  it('offers "and turn the screen off" on a screen with device control, never on a speaker', async () => {
    controllers['livingroom-tv'] = { transport: { stop: vi.fn(async () => ({ ok: true })) } };
    renderFleet();
    expect(screen.queryByTestId('fleet-stop-more-speaker-white')).toBeNull();
    expect(screen.getByTestId('fleet-stop-speaker-white')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('fleet-stop-more-livingroom-tv'));
    fireEvent.click(await screen.findByTestId('fleet-stop-off-livingroom-tv'));
    await waitFor(() => expect(houseApi.screenOff).toHaveBeenCalledWith('livingroom-tv'));
    expect(controllers['livingroom-tv'].transport.stop).toHaveBeenCalled();
    await waitFor(() => expect(recordLocal).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'screenOff', phase: 'confirmed',
      command: { copy: { primary: 'Stopped Den TV and turned the screen off', secondary: 'Queue kept' } },
    })));
  });

  it('leads to screen admin and routine history', () => {
    renderFleet();
    fireEvent.click(screen.getByTestId('fleet-open-screens'));
    fireEvent.click(screen.getByTestId('fleet-open-routines'));
    expect(push).toHaveBeenCalledWith('screens', {});
    expect(push).toHaveBeenCalledWith('routines', {});
  });
});
