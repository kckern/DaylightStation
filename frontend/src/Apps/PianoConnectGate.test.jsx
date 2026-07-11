import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// Hermetic: mock the hooks the gate depends on so we can drive status directly.
const h = vi.hoisted(() => ({
  connect: vi.fn(),
  turnOffScreen: vi.fn(),
  launchAndroidTarget: vi.fn(),
  daylightAPI: vi.fn(() => Promise.resolve({})),
  midiStatus: 'no-input',
  kioskConfig: { bluetooth: null },
}));
const { connect, turnOffScreen, launchAndroidTarget, daylightAPI } = h;

vi.mock('../modules/Piano/PianoKiosk/PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ status: h.midiStatus, connect: h.connect }),
  PianoMidiProvider: ({ children }) => children,
}));
vi.mock('../modules/Piano/PianoKiosk/PianoConfig.jsx', () => ({
  usePianoKioskConfig: () => ({ config: h.kioskConfig }),
}));
vi.mock('../modules/Piano/PianoKiosk/useScreenControl.js', () => ({
  useScreenControl: () => ({ turnOffScreen: h.turnOffScreen }),
  screenOffFailureMessage: (res) => (res?.lever === 'none' ? 'No screen control available' : "Couldn't reach the screen"),
}));
vi.mock('../lib/fkb.js', () => ({ launchAndroidTarget: (...a) => h.launchAndroidTarget(...a) }));
vi.mock('../lib/api.mjs', () => ({ DaylightAPI: (...a) => h.daylightAPI(...a) }));
vi.mock('../modules/Piano/PianoKiosk/icons/Icon.jsx', () => ({ default: () => null }));

import { ConnectGate } from './PianoApp.jsx';

beforeEach(() => {
  connect.mockReset();
  turnOffScreen.mockReset();
  launchAndroidTarget.mockReset();
  daylightAPI.mockReset();
  h.midiStatus = 'no-input';
  h.kioskConfig = { bluetooth: null };
});

describe('ConnectGate redesign', () => {
  it('renders the card with title + status and NO dead "Connect" button', () => {
    render(<ConnectGate><div>content</div></ConnectGate>);
    expect(screen.getByText('Piano')).toBeTruthy();
    expect(screen.getByText(/No piano found/i)).toBeTruthy();
    // The old accent "Connect piano" button is gone — a good connect auto-advances.
    expect(screen.queryByRole('button', { name: /Connect piano/i })).toBeNull();
  });

  it('auto-retries the connect while no piano is found', () => {
    vi.useFakeTimers();
    try {
      render(<ConnectGate><div>content</div></ConnectGate>);
      expect(connect).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(5000); });
      expect(connect).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('turn-off-screen requires arm→confirm (2-tap) before firing', () => {
    render(<ConnectGate><div>content</div></ConnectGate>);
    fireEvent.click(screen.getByRole('button', { name: /Turn off screen/i }));
    expect(turnOffScreen).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Tap again to confirm/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Tap again to confirm/i }));
    expect(turnOffScreen).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failure message in the status line when turnOffScreen fails', async () => {
    turnOffScreen.mockResolvedValue({ ok: false, lever: 'none' });
    render(<ConnectGate><div>content</div></ConnectGate>);
    fireEvent.click(screen.getByRole('button', { name: /Turn off screen/i }));
    fireEvent.click(screen.getByRole('button', { name: /Tap again to confirm/i }));
    expect(await screen.findByText(/No screen control available/i)).toBeTruthy();
  });

  it('Continue without piano is a real button that reveals children', () => {
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
    const btn = screen.getByRole('button', { name: /Bluetooth settings/i });
    fireEvent.click(btn);
    expect(launchAndroidTarget).toHaveBeenCalledWith(h.kioskConfig.bluetooth);
  });

  it('shows a Reboot device button only when a device id is configured (2-tap → reboot API)', () => {
    render(<ConnectGate><div>content</div></ConnectGate>);
    expect(screen.queryByRole('button', { name: /Reboot device/i })).toBeNull();

    h.kioskConfig = { bluetooth: null, screensaver: { deviceId: 'piano-tablet' } };
    render(<ConnectGate><div>content</div></ConnectGate>);
    fireEvent.click(screen.getByRole('button', { name: /Reboot device/i }));
    expect(daylightAPI).not.toHaveBeenCalled(); // armed, not fired
    fireEvent.click(screen.getByRole('button', { name: /Tap again to reboot/i }));
    expect(daylightAPI).toHaveBeenCalledWith('api/v1/device/piano-tablet/reboot', {}, 'POST');
  });

  it('renders the unsupported status with no connect button but keeps turn-off-screen', () => {
    h.midiStatus = 'unsupported';
    render(<ConnectGate><div>content</div></ConnectGate>);
    expect(screen.getByText(/does not support Web MIDI/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Connect piano/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Turn off screen/i })).toBeTruthy();
  });

  it('renders children directly once connected', () => {
    h.midiStatus = 'connected';
    render(<ConnectGate><div>content-shell</div></ConnectGate>);
    expect(screen.getByText('content-shell')).toBeTruthy();
    expect(screen.queryByText('Piano')).toBeNull();
  });
});
