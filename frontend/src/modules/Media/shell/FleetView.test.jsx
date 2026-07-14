// frontend/src/modules/Media/shell/FleetView.test.jsx
// Fleet card "Play…" affordance: the button sits next to Remote, toggles the
// inline FleetPlayPicker open/closed, and the picker's onClose collapses it.
// Existing card testids (fleet-card-*, fleet-peek-*, fleet-state-*) stay put.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const fleet = { devices: [], entries: {} };

vi.mock('../fleet/FleetProvider.jsx', () => ({
  useFleetContext: () => ({ devices: fleet.devices, loading: false, error: null, store: {} }),
}));
vi.mock('../fleet/useDevice.js', () => ({
  useDevice: (deviceId) => ({
    device: fleet.devices.find((d) => d.id === deviceId) ?? null,
    entry: fleet.entries[deviceId] ?? null,
  }),
}));
vi.mock('./NavProvider.jsx', () => ({
  useNav: () => ({ push: vi.fn() }),
}));
vi.mock('../peek/useTakeOver.js', () => ({
  useTakeOver: () => vi.fn(),
}));
// The picker's own behavior is covered in fleet/FleetPlayPicker.test.jsx —
// here it's a marker with a close hook.
vi.mock('../fleet/FleetPlayPicker.jsx', () => ({
  FleetPlayPicker: ({ deviceId, onClose }) => (
    <div data-testid={`mock-play-picker-${deviceId}`}>
      <button data-testid={`mock-play-picker-close-${deviceId}`} onClick={onClose}>close</button>
    </div>
  ),
}));

import { FleetView } from './FleetView.jsx';

function renderFleet() {
  return render(
    <MantineProvider>
      <FleetView />
    </MantineProvider>,
  );
}

beforeEach(() => {
  fleet.devices = [
    { id: 'livingroom-tv', name: 'Living Room TV', type: 'shield-tv' },
    { id: 'office-tv', name: 'Office TV', type: 'linux-pc' },
  ];
  fleet.entries = {};
});

describe('FleetView Play… affordance', () => {
  it('renders a Play… button on every card alongside the existing actions', () => {
    renderFleet();
    for (const id of ['livingroom-tv', 'office-tv']) {
      expect(screen.getByTestId(`fleet-card-${id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`fleet-peek-${id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`fleet-state-${id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`fleet-play-${id}`)).toHaveTextContent('Play…');
    }
  });

  it('opens the inline picker for THAT card on tap, and toggles it closed on a second tap', () => {
    renderFleet();
    expect(screen.queryByTestId('mock-play-picker-livingroom-tv')).toBeNull();

    fireEvent.click(screen.getByTestId('fleet-play-livingroom-tv'));
    expect(screen.getByTestId('mock-play-picker-livingroom-tv')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-play-picker-office-tv')).toBeNull();

    fireEvent.click(screen.getByTestId('fleet-play-livingroom-tv'));
    expect(screen.queryByTestId('mock-play-picker-livingroom-tv')).toBeNull();
  });

  it('collapses the panel when the picker asks to close', () => {
    renderFleet();
    fireEvent.click(screen.getByTestId('fleet-play-office-tv'));
    expect(screen.getByTestId('mock-play-picker-office-tv')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mock-play-picker-close-office-tv'));
    expect(screen.queryByTestId('mock-play-picker-office-tv')).toBeNull();
  });

  it('marks the toggle so the picker can ignore its pointerdowns (clean toggle, no flicker)', () => {
    renderFleet();
    expect(screen.getByTestId('fleet-play-livingroom-tv'))
      .toHaveAttribute('data-play-toggle', 'livingroom-tv');
  });
});
