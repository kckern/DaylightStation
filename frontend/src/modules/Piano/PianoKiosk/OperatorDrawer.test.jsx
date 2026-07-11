import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const turnOffScreen = vi.fn();
const connect = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const applyBundle = vi.hoisted(() => vi.fn());
const launchAndroidTarget = vi.hoisted(() => vi.fn());

const currentBundle = {
  voice: { pc: 0, bank: 0, name: 'Acoustic Grand' },
  reverb: { type: 4, level: 64, on: true },
  chorus: null,
  volume: 0.8,
};

vi.mock('./PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ connected: false, inputName: null, status: 'no-input', connect }),
}));
vi.mock('./usePianoSoundBundle.js', () => ({
  usePianoSoundBundle: () => ({ currentBundle, applyBundle }),
}));
vi.mock('./PianoConfig.jsx', () => ({
  usePianoKioskConfig: () => ({ config: { bluetooth: 'com.example/.BtSettings' }, pianoId: 'default' }),
}));
vi.mock('./useScreenControl.js', () => ({
  useScreenControl: () => ({ turnOffScreen }),
  screenOffFailureMessage: (res) => (res?.lever === 'none' ? 'No screen control available' : "Couldn't reach the screen"),
}));
vi.mock('../../../lib/fkb.js', () => ({ launchAndroidTarget }));
vi.mock('./PianoMidiMonitor.jsx', () => ({ default: () => <div data-testid="midi-monitor">monitor</div> }));
vi.mock('@/modules/Feedback/FeedbackOverlay.jsx', () => ({
  default: ({ open, context }) => (open ? <div data-testid="feedback-overlay">{JSON.stringify(context)}</div> : null),
}));
vi.mock('./icons/Icon.jsx', () => ({ default: () => null }));

import OperatorDrawer from './OperatorDrawer.jsx';

beforeEach(() => {
  turnOffScreen.mockReset();
  connect.mockClear();
  applyBundle.mockClear();
  launchAndroidTarget.mockClear();
  vi.useFakeTimers();
});
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

describe('OperatorDrawer', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<OperatorDrawer open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders all sections: Hardware, Diagnostics, Display, Recovery, Feedback', () => {
    render(<OperatorDrawer open onClose={vi.fn()} />);
    expect(screen.getByText('Hardware')).toBeTruthy();
    expect(screen.getByText('Diagnostics')).toBeTruthy();
    expect(screen.getByTestId('midi-monitor')).toBeTruthy();
    expect(screen.getByText('Display')).toBeTruthy();
    expect(screen.getByText('Recovery')).toBeTruthy();
    expect(screen.getByText('Feedback')).toBeTruthy();
  });

  it('shows Connect when not connected, and a Bluetooth settings launcher when configured', () => {
    render(<OperatorDrawer open onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Bluetooth settings/i }));
    expect(launchAndroidTarget).toHaveBeenCalledWith('com.example/.BtSettings');
  });

  it('orders Recovery actions with "Restart audio & MIDI" BEFORE "Reload app" (audit T8)', () => {
    render(<OperatorDrawer open onClose={vi.fn()} />);
    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    const restartIdx = buttons.findIndex((t) => /Restart audio/i.test(t));
    const reloadIdx = buttons.findIndex((t) => /Reload app/i.test(t));
    expect(restartIdx).toBeGreaterThanOrEqual(0);
    expect(reloadIdx).toBeGreaterThan(restartIdx);
  });

  it('"Restart audio & MIDI" reconnects then re-asserts the full sound bundle', async () => {
    render(<OperatorDrawer open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Restart audio/i }));
    await act(async () => {});
    expect(connect).toHaveBeenCalledTimes(1);
    expect(applyBundle).toHaveBeenCalledWith(currentBundle);
  });

  it('still re-asserts the bundle even if the MIDI reconnect rejects', async () => {
    connect.mockRejectedValueOnce(new Error('no BLE'));
    render(<OperatorDrawer open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Restart audio/i }));
    await act(async () => {});
    expect(applyBundle).toHaveBeenCalledWith(currentBundle);
  });

  it('"Reload app" reloads the page', () => {
    const reloadSpy = vi.fn();
    const originalLocation = window.location;
    delete window.location;
    window.location = { ...originalLocation, reload: reloadSpy };
    render(<OperatorDrawer open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Reload app/i }));
    expect(reloadSpy).toHaveBeenCalled();
    window.location = originalLocation;
  });

  it('screen-off is 2-tap armed: first tap arms, second fires', () => {
    render(<OperatorDrawer open onClose={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /Turn off screen/i });
    fireEvent.click(btn);
    expect(screen.getByRole('button', { name: /Tap again to confirm/i })).toBeTruthy();
    expect(turnOffScreen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Tap again to confirm/i }));
    expect(turnOffScreen).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Turn off screen/i })).toBeTruthy();
  });

  it('disarms screen-off after 3s without a confirming tap', () => {
    render(<OperatorDrawer open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Turn off screen/i }));
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByRole('button', { name: /Turn off screen/i })).toBeTruthy();
    expect(turnOffScreen).not.toHaveBeenCalled();
  });

  it('"Record feedback" opens the overlay scoped to the operator-drawer surface', () => {
    render(<OperatorDrawer open onClose={vi.fn()} />);
    expect(screen.queryByTestId('feedback-overlay')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Record feedback/i }));
    const overlay = screen.getByTestId('feedback-overlay');
    expect(overlay.textContent).toContain('"surface":"operator-drawer"');
    expect(overlay.textContent).toContain('"pianoId":"default"');
  });

  it('calls onClose when the scrim or close button is tapped', () => {
    const onClose = vi.fn();
    render(<OperatorDrawer open onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Close operator drawer/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
