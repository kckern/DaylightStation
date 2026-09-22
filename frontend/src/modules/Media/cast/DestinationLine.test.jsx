import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { CastTargetProvider } from './CastTargetProvider.jsx';
import { useCastTarget } from './useCastTarget.js';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { ClientIdentityContext } from '../identity/ClientIdentityProvider.jsx';

// ── Mocks ────────────────────────────────────────────────────────────────
let fleetDevices = [
  { id: 'livingroom-tv', name: 'Living Room TV' },
  { id: 'yellow-room-tablet', name: 'Yellow Room Tablet' },
];
let fleetEntries = new Map();
const fleetStore = {
  subscribeAll: () => () => {},
  getAll: () => fleetEntries,
  getEntry: (id) => fleetEntries.get(id) ?? null,
};
vi.mock('../fleet/useFleetContext.js', () => ({
  useFleetContext: () => ({ devices: fleetDevices, store: fleetStore }),
}));

const dismissLayer = vi.fn();
vi.mock('../shell/useDismissLayer.js', () => ({
  useDismissLayer: (...a) => dismissLayer(...a),
}));

vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

// The sheet body — DispatchTargetPicker itself is exercised by its own
// tests; here it's stubbed to a single button that fires onComplete with
// a fixed pick, so this suite stays focused on what DestinationLine does
// with that pick (the shared-state write-back), not the picker's internals.
let lastPick = { targetIds: ['yellow-room-tablet'], mode: 'transfer' };
vi.mock('./DispatchTargetPicker.jsx', () => ({
  DispatchTargetPicker: ({ onComplete }) => (
    <button data-testid="picker-stub-pick" onClick={() => onComplete(lastPick)}>
      pick
    </button>
  ),
}));

import mediaLog from '../logging/mediaLog.js';
import { DestinationLine } from './DestinationLine.jsx';

function Probe() {
  const { targetIds, mode } = useCastTarget();
  return (
    <div>
      <span data-testid="probe-targets">{targetIds.join(',')}</span>
      <span data-testid="probe-mode">{mode}</span>
    </div>
  );
}

function renderLine(props, controller = null, identity = { clientId: 'current-client', displayName: 'Current browser' }) {
  return render(
    <MantineProvider>
      <ClientIdentityContext.Provider value={identity}>
        <LocalSessionContext.Provider value={controller ? { controller } : null}>
          <CastTargetProvider>
            <DestinationLine {...props} />
            <Probe />
          </CastTargetProvider>
        </LocalSessionContext.Provider>
      </ClientIdentityContext.Provider>
    </MantineProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  delete window.__DAYLIGHT_DEVICE_ID;
  fleetDevices = [
    { id: 'livingroom-tv', name: 'Living Room TV' },
    { id: 'yellow-room-tablet', name: 'Yellow Room Tablet' },
  ];
  lastPick = { targetIds: ['yellow-room-tablet'], mode: 'transfer' };
  fleetEntries = new Map();
});

describe('DestinationLine', () => {
  it('reads "This device" when no remote target is set', () => {
    renderLine();
    expect(screen.getByTestId('destination-line-name')).toHaveTextContent('This device');
  });

  it('resolves a configured target id to its device name via the fleet', () => {
    // Seed the shared target the same way the dock chip would (localStorage
    // persistence is CastTargetProvider's own mechanism) — the provider
    // reads it on mount.
    localStorage.setItem(
      'media-app.cast-target',
      JSON.stringify({ mode: 'transfer', targetIds: ['livingroom-tv'] })
    );
    renderLine();
    expect(screen.getByTestId('destination-line-name')).toHaveTextContent('Living Room TV');
  });

  it('shows who started a busy aimed screen only from explicit live provenance', () => {
    localStorage.setItem(
      'media-app.cast-target',
      JSON.stringify({ mode: 'transfer', targetIds: ['livingroom-tv'], activityAt: Date.now(), exemptionStartedAt: null })
    );
    fleetDevices.push({ id: 'kitchen-tablet', name: 'Kitchen Tablet' });
    fleetEntries = new Map([['livingroom-tv', {
      snapshot: { state: 'playing', meta: { origin: { kind: 'device', id: 'kitchen-tablet' } } },
      offline: false, isStale: false,
    }]]);
    renderLine();
    expect(screen.getByTestId('aim-busy-origin')).toHaveTextContent('Busy — started from Kitchen Tablet');
  });

  it('does not call a busy aimed screen foreign when this browser client started it', () => {
    localStorage.setItem(
      'media-app.cast-target',
      JSON.stringify({ mode: 'transfer', targetIds: ['livingroom-tv'], activityAt: Date.now(), exemptionStartedAt: null })
    );
    fleetDevices.push({ id: 'browser:current-client', name: 'Current browser' });
    fleetEntries = new Map([['livingroom-tv', {
      snapshot: { state: 'playing', meta: { origin: { kind: 'device', id: 'browser:current-client' } } },
      offline: false, isStale: false,
    }]]);
    renderLine();
    expect(screen.queryByTestId('aim-busy-origin')).toBeNull();
  });

  it('does not call a busy aimed screen foreign when this fleet device started it', () => {
    window.__DAYLIGHT_DEVICE_ID = 'kitchen-tablet';
    localStorage.setItem(
      'media-app.cast-target',
      JSON.stringify({ mode: 'transfer', targetIds: ['livingroom-tv'], activityAt: Date.now(), exemptionStartedAt: null })
    );
    fleetDevices.push({ id: 'kitchen-tablet', name: 'Kitchen Tablet' });
    fleetEntries = new Map([['livingroom-tv', {
      snapshot: { state: 'paused', meta: { origin: { kind: 'device', id: 'kitchen-tablet' } } },
      offline: false, isStale: false,
    }]]);
    renderLine();
    expect(screen.queryByTestId('aim-busy-origin')).toBeNull();
    delete window.__DAYLIGHT_DEVICE_ID;
  });

  it('still shows explicit routine provenance as another busy origin', () => {
    localStorage.setItem(
      'media-app.cast-target',
      JSON.stringify({ mode: 'transfer', targetIds: ['livingroom-tv'], activityAt: Date.now(), exemptionStartedAt: null })
    );
    fleetEntries = new Map([['livingroom-tv', {
      snapshot: { state: 'buffering', meta: { origin: { kind: 'routine', name: 'Morning music' } } },
      offline: false, isStale: false,
    }]]);
    renderLine();
    expect(screen.getByTestId('aim-busy-origin')).toHaveTextContent('Busy — started from Morning music routine');
  });

  it('does not invent a busy origin from the receiver owner id', () => {
    localStorage.setItem(
      'media-app.cast-target',
      JSON.stringify({ mode: 'transfer', targetIds: ['livingroom-tv'], activityAt: Date.now(), exemptionStartedAt: null })
    );
    fleetEntries = new Map([['livingroom-tv', {
      snapshot: { state: 'playing', meta: { ownerId: 'kitchen-tablet' } },
      offline: false, isStale: false,
    }]]);
    renderLine();
    expect(screen.queryByTestId('aim-busy-origin')).toBeNull();
  });

  it('shows the remembered move choice on the aim while local playback is active', () => {
    localStorage.setItem(
      'media-app.cast-target',
      JSON.stringify({ mode: 'transfer', targetIds: ['livingroom-tv'] })
    );
    const activeSnapshot = { state: 'playing', currentItem: { contentId: 'plex:1' } };
    const controller = {
      subscribe: () => () => {},
      getSnapshot: () => activeSnapshot,
    };
    renderLine(undefined, controller);
    expect(screen.getByTestId('destination-line-name')).toHaveTextContent('Next tap will move playback');
  });

  it('tapping the line opens the device sheet', async () => {
    renderLine();
    expect(screen.queryByTestId('destination-sheet')).toBeNull();
    const line = screen.getByTestId('destination-line');
    expect(line).toHaveAttribute('data-ignore-outside-clicks');
    fireEvent.click(line);
    expect(await screen.findByTestId('destination-sheet')).toBeInTheDocument();
    expect(screen.getByTestId('picker-stub-pick')).toBeInTheDocument();
  });

  it('announces one interaction lifetime from trigger pointerdown through sheet unmount', async () => {
    const onInteractionStart = vi.fn();
    const onInteractionEnd = vi.fn();
    renderLine({ onInteractionStart, onInteractionEnd });
    const line = screen.getByTestId('destination-line');

    fireEvent.pointerDown(line);
    expect(onInteractionStart).toHaveBeenCalledTimes(1);
    expect(onInteractionEnd).not.toHaveBeenCalled();

    fireEvent.click(line);
    await screen.findByTestId('destination-sheet');
    fireEvent.click(screen.getByTestId('picker-stub-pick'));

    expect(screen.queryByTestId('destination-sheet')).toBeNull();
    expect(onInteractionEnd).toHaveBeenCalledTimes(1);
  });

  it('PLACE.2b stacks the destination sheet above the full-screen phone search surface', async () => {
    renderLine();
    fireEvent.click(screen.getByTestId('destination-line'));
    await screen.findByTestId('destination-sheet');

    const modalRoot = document.querySelector('.mantine-Modal-root');
    const modalZIndex = Number(
      getComputedStyle(modalRoot).getPropertyValue('--mb-z-index')
    );

    // SearchMode is the top-level phone surface at Mantine's modal tier (200). Because the
    // Modal is portaled outside that surface, its own stack level must clear
    // 200 or the visible device buttons cannot receive ordinary pointer taps.
    expect(modalZIndex).toBeGreaterThan(200);
  });

  it('a sheet pick updates the SHARED CastTargetProvider state, not a parallel state', async () => {
    renderLine();
    fireEvent.click(screen.getByTestId('destination-line'));
    await screen.findByTestId('destination-sheet');

    lastPick = { targetIds: ['yellow-room-tablet'], mode: 'transfer' };
    fireEvent.click(screen.getByTestId('picker-stub-pick'));

    expect(screen.getByTestId('probe-targets')).toHaveTextContent('yellow-room-tablet');
    expect(screen.getByTestId('probe-mode')).toHaveTextContent('transfer');
    // The line itself reflects the new destination too — one state, two views.
    expect(screen.getByTestId('destination-line-name')).toHaveTextContent('Yellow Room Tablet');
  });

  it('closes the sheet after a pick', async () => {
    renderLine();
    fireEvent.click(screen.getByTestId('destination-line'));
    await screen.findByTestId('destination-sheet');
    fireEvent.click(screen.getByTestId('picker-stub-pick'));
    expect(screen.queryByTestId('destination-sheet')).toBeNull();
  });

  it('logs dispatch.destination_changed with from/to/surface when the pick actually changes the destination', async () => {
    renderLine({ surface: 'container-header' });
    fireEvent.click(screen.getByTestId('destination-line'));
    await screen.findByTestId('destination-sheet');

    lastPick = { targetIds: ['livingroom-tv'], mode: 'transfer' };
    fireEvent.click(screen.getByTestId('picker-stub-pick'));

    expect(mediaLog.destinationChanged).toHaveBeenCalledWith({
      from: 'local',
      to: 'livingroom-tv',
      surface: 'container-header',
    });
  });

  it('PLACE.2b a This device pick clears the shared remote aim immediately', async () => {
    localStorage.setItem(
      'media-app.cast-target',
      JSON.stringify({ mode: 'transfer', targetIds: ['livingroom-tv'] })
    );
    renderLine();
    fireEvent.click(screen.getByTestId('destination-line'));
    await screen.findByTestId('destination-sheet');

    lastPick = { targetIds: [], mode: 'transfer' };
    fireEvent.click(screen.getByTestId('picker-stub-pick'));

    expect(screen.getByTestId('probe-targets')).toHaveTextContent('');
    expect(screen.getByTestId('destination-line-name')).toHaveTextContent('This device');
    expect(mediaLog.destinationChanged).toHaveBeenCalledWith({
      from: 'livingroom-tv',
      to: 'local',
      surface: null,
    });
  });

  it('surface is optional and defaults to null in the log payload', async () => {
    renderLine();
    fireEvent.click(screen.getByTestId('destination-line'));
    await screen.findByTestId('destination-sheet');

    lastPick = { targetIds: ['livingroom-tv'], mode: 'transfer' };
    fireEvent.click(screen.getByTestId('picker-stub-pick'));

    expect(mediaLog.destinationChanged).toHaveBeenCalledWith(
      expect.objectContaining({ surface: null })
    );
  });
});
