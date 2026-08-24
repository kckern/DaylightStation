import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const repairConnection = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const connection = vi.hoisted(() => ({
  health: { state: 'offline', input: { state: 'down', name: null }, output: { state: 'down', name: null }, bridge: { state: 'unavailable' } },
  repair: { state: 'idle', message: null }, repairConnection,
}));
const midi = vi.hoisted(() => ({ sendNote: vi.fn(() => true), sendPanic: vi.fn(() => true) }));
const screenOff = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const launchAndroidTarget = vi.hoisted(() => vi.fn());
const daylightAPI = vi.hoisted(() => vi.fn(async () => ({ ok: true })));

vi.mock('./PianoConnectionContext.jsx', () => ({ usePianoConnection: () => connection }));
vi.mock('./PianoMidiContext.jsx', () => ({ usePianoMidi: () => midi }));
vi.mock('./PianoConfig.jsx', () => ({ usePianoKioskConfig: () => ({ pianoId: 'default', config: { bluetooth: 'pkg/.Bluetooth', screensaver: { deviceId: 'tablet-1' } } }) }));
vi.mock('./usePianoScreenOff.js', () => ({ usePianoScreenOff: () => screenOff }));
vi.mock('./useScreenControl.js', () => ({ screenOffFailureMessage: () => 'Couldn’t turn off display.' }));
vi.mock('../../../lib/fkb.js', () => ({ launchAndroidTarget }));
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: daylightAPI }));
vi.mock('./PianoMidiMonitor.jsx', () => ({ default: () => <div data-testid="midi-monitor">MIDI log</div> }));
vi.mock('@/modules/Feedback/FeedbackOverlay.jsx', () => ({ default: ({ open, context }) => open ? <div data-testid="feedback">{JSON.stringify(context)}</div> : null }));

import OperatorDrawer from './OperatorDrawer.jsx';

const renderDrawer = (props = {}) => render(<><button type="button">opener</button><OperatorDrawer open onClose={vi.fn()} {...props} /></>);

describe('Piano maintenance', () => {
  beforeEach(() => {
    vi.useFakeTimers(); repairConnection.mockClear(); screenOff.mockClear(); launchAndroidTarget.mockClear(); daylightAPI.mockClear(); midi.sendNote.mockReset().mockReturnValue(true); midi.sendPanic.mockReset().mockReturnValue(true);
    Object.assign(connection.health, { state: 'offline', input: { state: 'down', name: null }, output: { state: 'down', name: null }, bridge: { state: 'unavailable' } });
    Object.assign(connection.repair, { state: 'idle', message: null });
  });
  afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

  it('uses a named dialog, a single repair action, and no raw MIDI controls', () => {
    renderDrawer();
    expect(screen.getByRole('dialog', { name: 'Piano maintenance' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Repair connection' })).toHaveLength(1);
    expect(screen.queryByText(/Program Change|Local On|Force reset MIDI|Restart audio & MIDI/)).toBeNull();
  });

  it('repairs centrally and shows Bluetooth only for unhealthy or detailed connections', () => {
    const { rerender } = renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Repair connection' }));
    expect(repairConnection).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Open Bluetooth pairing' }));
    expect(launchAndroidTarget).toHaveBeenCalledWith('pkg/.Bluetooth');
    Object.assign(connection.health, { state: 'ready', input: { state: 'bridge', name: 'Keys' }, output: { state: 'up', name: 'Piano' }, bridge: { state: 'open' } });
    rerender(<><button type="button">opener</button><OperatorDrawer open onClose={vi.fn()} /></>);
    expect(screen.queryByRole('button', { name: 'Open Bluetooth pairing' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Connection details' }));
    expect(screen.getByText('Input: Keys')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Bluetooth pairing' })).toBeTruthy();
  });

  it('offers a test note only with output and reports whether it was sent', () => {
    connection.health.output = { state: 'up', name: 'Piano' };
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Play test note' }));
    expect(midi.sendNote).toHaveBeenCalledWith(60, 100, 0, 500);
    expect(screen.getByRole('status')).toHaveTextContent('Test note command sent.');
  });

  it('reports Stop stuck notes success and disconnected failure', () => {
    const { rerender } = renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Stop stuck notes' }));
    expect(screen.getByRole('status')).toHaveTextContent('Stop stuck notes command sent.');
    midi.sendPanic.mockReturnValue(false);
    rerender(<><button type="button">opener</button><OperatorDrawer open onClose={vi.fn()} /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Stop stuck notes' }));
    expect(screen.getByRole('status')).toHaveTextContent('Piano not connected.');
  });

  it('two-tap confirms display off and reports the result', async () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off display' }));
    expect(screenOff).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' })); });
    expect(screenOff).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Display turned off.');
  });

  it('mounts the read-only MIDI log only when Diagnostics is expanded', () => {
    renderDrawer();
    expect(screen.queryByTestId('midi-monitor')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
    expect(screen.getByTestId('midi-monitor')).toBeTruthy();
  });

  it('hides advanced recovery by default and surfaces reboot API failure', async () => {
    daylightAPI.mockRejectedValueOnce(new Error('server offline'));
    renderDrawer();
    expect(screen.queryByRole('button', { name: 'Reboot tablet' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced recovery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reboot tablet' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tap again to reboot tablet' })); });
    expect(daylightAPI).toHaveBeenCalledWith('api/v1/device/tablet-1/reboot', {}, 'POST');
    expect(screen.getByRole('status')).toHaveTextContent('Couldn’t reboot tablet: server offline');
  });

  it('keeps feedback adult-only at the bottom with maintenance context', () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Record feedback' }));
    expect(screen.getByTestId('feedback')).toHaveTextContent('piano-maintenance');
  });
});
