import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Hermetic: mock the hooks the gate depends on so we can drive status directly.
const h = vi.hoisted(() => ({
  connect: vi.fn(),
  turnOffScreen: vi.fn(),
  launchAndroidTarget: vi.fn(),
  midiStatus: 'no-input',
  kioskConfig: { bluetooth: null },
}));
const { connect, turnOffScreen, launchAndroidTarget } = h;

vi.mock('../modules/Piano/PianoKiosk/PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ status: h.midiStatus, connect: h.connect }),
  PianoMidiProvider: ({ children }) => children,
}));
vi.mock('../modules/Piano/PianoKiosk/PianoConfig.jsx', () => ({
  usePianoKioskConfig: () => ({ config: h.kioskConfig }),
}));
vi.mock('../modules/Piano/PianoKiosk/useScreenControl.js', () => ({
  useScreenControl: () => ({ turnOffScreen: h.turnOffScreen }),
}));
vi.mock('../lib/fkb.js', () => ({ launchAndroidTarget: (...a) => h.launchAndroidTarget(...a) }));

import { ConnectGate } from './PianoApp.jsx';

beforeEach(() => {
  connect.mockReset();
  turnOffScreen.mockReset();
  launchAndroidTarget.mockReset();
  h.midiStatus = 'no-input';
  h.kioskConfig = { bluetooth: null };
});

describe('ConnectGate redesign', () => {
  it('renders the card with title, status line and connect action', () => {
    render(<ConnectGate><div>content</div></ConnectGate>);
    expect(screen.getByText('Piano')).toBeTruthy();
    expect(screen.getByText(/No piano found/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Connect piano/i }));
    expect(connect).toHaveBeenCalled();
  });

  it('shows a turn-off-screen button wired to turnOffScreen', () => {
    render(<ConnectGate><div>content</div></ConnectGate>);
    fireEvent.click(screen.getByRole('button', { name: /Turn off screen/i }));
    expect(turnOffScreen).toHaveBeenCalledTimes(1);
  });

  it('the continue-without-piano link reveals children', () => {
    render(<ConnectGate><div>content-shell</div></ConnectGate>);
    expect(screen.queryByText('content-shell')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Continue without piano/i }));
    expect(screen.getByText('content-shell')).toBeTruthy();
  });

  it('shows the Bluetooth action only when configured and wires it', () => {
    render(<ConnectGate><div>content</div></ConnectGate>);
    expect(screen.queryByRole('button', { name: /Bluetooth/i })).toBeNull();

    h.kioskConfig = { bluetooth: { action: 'android.settings.BLUETOOTH_SETTINGS' } };
    render(<ConnectGate><div>content</div></ConnectGate>);
    const btn = screen.getByRole('button', { name: /Open Bluetooth settings/i });
    fireEvent.click(btn);
    expect(launchAndroidTarget).toHaveBeenCalledWith(h.kioskConfig.bluetooth);
  });

  it('renders the unsupported status and hides the connect button', () => {
    h.midiStatus = 'unsupported';
    render(<ConnectGate><div>content</div></ConnectGate>);
    expect(screen.getByText(/does not support Web MIDI/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Connect piano/i })).toBeNull();
    // The screen-off kill switch is still available on the unsupported screen.
    expect(screen.getByRole('button', { name: /Turn off screen/i })).toBeTruthy();
  });

  it('renders children directly once connected', () => {
    h.midiStatus = 'connected';
    render(<ConnectGate><div>content-shell</div></ConnectGate>);
    expect(screen.getByText('content-shell')).toBeTruthy();
    expect(screen.queryByText('Piano')).toBeNull();
  });
});
