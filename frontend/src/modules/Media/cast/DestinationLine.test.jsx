import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { CastTargetProvider } from './CastTargetProvider.jsx';
import { useCastTarget } from './useCastTarget.js';

// ── Mocks ────────────────────────────────────────────────────────────────
let fleetDevices = [
  { id: 'livingroom-tv', name: 'Living Room TV' },
  { id: 'yellow-room-tablet', name: 'Yellow Room Tablet' },
];
vi.mock('../fleet/useFleetContext.js', () => ({
  useFleetContext: () => ({ devices: fleetDevices }),
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

function renderLine(props) {
  return render(
    <MantineProvider>
      <CastTargetProvider>
        <DestinationLine {...props} />
        <Probe />
      </CastTargetProvider>
    </MantineProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  fleetDevices = [
    { id: 'livingroom-tv', name: 'Living Room TV' },
    { id: 'yellow-room-tablet', name: 'Yellow Room Tablet' },
  ];
  lastPick = { targetIds: ['yellow-room-tablet'], mode: 'transfer' };
});

describe('DestinationLine', () => {
  it('reads "This browser" when no remote target is set', () => {
    renderLine();
    expect(screen.getByTestId('destination-line-name')).toHaveTextContent('This browser');
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

  it('tapping the line opens the device sheet', async () => {
    renderLine();
    expect(screen.queryByTestId('destination-sheet')).toBeNull();
    fireEvent.click(screen.getByTestId('destination-line'));
    expect(await screen.findByTestId('destination-sheet')).toBeInTheDocument();
    expect(screen.getByTestId('picker-stub-pick')).toBeInTheDocument();
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

  it('does NOT log destinationChanged when the pick resolves to the same destination', async () => {
    renderLine();
    fireEvent.click(screen.getByTestId('destination-line'));
    await screen.findByTestId('destination-sheet');

    // Nothing was set before (local), and picking an empty set is still local.
    lastPick = { targetIds: [], mode: 'transfer' };
    fireEvent.click(screen.getByTestId('picker-stub-pick'));

    expect(mediaLog.destinationChanged).not.toHaveBeenCalled();
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
