import { act, fireEvent, render, screen, within } from '@testing-library/react';
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

vi.mock('./usePianoConnection.js', () => ({ usePianoConnection: () => connection }));
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
    Object.assign(connection.health, { state: 'offline', copy: 'not connected', input: { state: 'down', name: null }, output: { state: 'down', name: null }, bridge: { state: 'unavailable', unavailable: true } });
    Object.assign(connection.repair, { state: 'idle', message: null });
  });
  afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

  it('uses a named dialog, a single repair action, and no raw MIDI controls', () => {
    renderDrawer();
    expect(screen.getByRole('dialog', { name: 'Piano maintenance' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Repair connection' })).toHaveLength(1);
    expect(screen.queryByText(/Program Change|Local On|Force reset MIDI|Restart audio & MIDI/)).toBeNull();
    expect(screen.queryByRole('button', { name: /connection details|advanced recovery/i })).toBeNull();
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
  });

  it('reports every link from one source in the status card', () => {
    Object.assign(connection.health, { state: 'connecting', copy: 'connecting', input: { state: 'bridge', name: 'Keys' }, output: { state: 'down', name: null }, bridge: { state: 'reconnecting', unavailable: false } });
    renderDrawer();
    const card = screen.getByRole('group', { name: 'Connection' });
    expect(card).toHaveTextContent('Keys: Keys');
    expect(card).toHaveTextContent('Sound: not connected');
    expect(card).toHaveTextContent('Bridge: reconnecting…');
    expect(card.querySelectorAll('.is-on')).toHaveLength(1);
    expect(card.querySelectorAll('.is-off')).toHaveLength(1);
    expect(card.querySelectorAll('.is-warn')).toHaveLength(1);
  });

  it('names every bridge link state in plain words', () => {
    const { rerender } = renderDrawer();
    const show = (bridge) => {
      Object.assign(connection.health, { bridge });
      rerender(<><button type="button">opener</button><OperatorDrawer open onClose={vi.fn()} /></>);
      return screen.getByRole('group', { name: 'Connection' });
    };
    let card = show({ state: 'idle', unavailable: false });
    expect(card).toHaveTextContent('Bridge: connecting…');
    expect(card.querySelectorAll('.is-warn')).toHaveLength(1);
    card = show({ state: 'connecting', unavailable: false });
    expect(card).toHaveTextContent('Bridge: connecting…');
    card = show({ state: 'closed', unavailable: false });
    expect(card).toHaveTextContent('Bridge: not connected');
    expect(card.querySelectorAll('.is-warn')).toHaveLength(0);
    card = show({ state: 'closed', unavailable: true });
    expect(card).toHaveTextContent('Bridge: not running');
  });

  it('shows Bluetooth pairing whenever configured, primary while not ready', () => {
    const { rerender } = renderDrawer();
    const bluetooth = screen.getByRole('button', { name: 'Bluetooth pairing' });
    expect(bluetooth).toHaveClass('piano-tbtn--primary');
    fireEvent.click(bluetooth);
    expect(launchAndroidTarget).toHaveBeenCalledWith('pkg/.Bluetooth');
    Object.assign(connection.health, { state: 'ready', copy: 'connected', input: { state: 'bridge', name: 'Keys' }, output: { state: 'up', name: 'Piano' }, bridge: { state: 'connected', unavailable: false } });
    rerender(<><button type="button">opener</button><OperatorDrawer open onClose={vi.fn()} /></>);
    expect(screen.getByRole('button', { name: 'Bluetooth pairing' })).not.toHaveClass('piano-tbtn--primary');
    expect(screen.getByRole('button', { name: 'Repair connection' })).not.toHaveClass('piano-tbtn--primary');
    const card = screen.getByRole('group', { name: 'Connection' });
    expect(card).toHaveTextContent('Bridge: connected');
    expect(card.querySelectorAll('.is-on')).toHaveLength(3);
    expect(card.querySelectorAll('.is-off')).toHaveLength(0);
    expect(card.querySelectorAll('.is-warn')).toHaveLength(0);
  });

  it('repairs centrally and shows the repair message under the tile', () => {
    const { rerender } = renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Repair connection' }));
    expect(repairConnection).toHaveBeenCalledTimes(1);
    Object.assign(connection.repair, { state: 'working', message: 'Repairing connection…' });
    rerender(<><button type="button">opener</button><OperatorDrawer open onClose={vi.fn()} /></>);
    const tile = screen.getByRole('button', { name: 'Repair connection' });
    expect(tile).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Repairing…');
    expect(screen.queryByText('Repairing connection…')).toBeNull();
    Object.assign(connection.repair, { state: 'failed', message: 'Couldn’t reach the piano.' });
    rerender(<><button type="button">opener</button><OperatorDrawer open onClose={vi.fn()} /></>);
    expect(screen.getByRole('button', { name: 'Repair connection' })).not.toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Couldn’t reach the piano.');
    expect(screen.getByRole('status')).toHaveClass('is-failed');
  });

  it('offers a test note only with output and reports whether it was sent on the tile', () => {
    connection.health.output = { state: 'up', name: 'Piano' };
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Play test note' }));
    expect(midi.sendNote).toHaveBeenCalledWith(60, 100, 0, 500);
    expect(screen.getByRole('status')).toHaveTextContent('Test note command sent.');
  });

  it('disables the test note without output', () => {
    renderDrawer();
    expect(screen.getByRole('button', { name: 'Play test note' })).toBeDisabled();
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

  it('two-tap confirms display off with a visible armed state and reports the result', async () => {
    renderDrawer();
    const off = screen.getByRole('button', { name: 'Turn off display' });
    expect(off).toHaveClass('piano-tbtn--danger');
    fireEvent.click(off);
    expect(screenOff).not.toHaveBeenCalled();
    const armed = screen.getByRole('button', { name: 'Tap again to confirm' });
    expect(armed).toHaveAttribute('aria-pressed', 'true');
    await act(async () => { fireEvent.click(armed); });
    expect(screenOff).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Display turned off.');
  });

  it('mounts the read-only MIDI log only while Diagnostics is shown, with a Back tile', () => {
    renderDrawer();
    expect(screen.queryByTestId('midi-monitor')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
    expect(screen.getByTestId('midi-monitor')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reboot tablet' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByTestId('midi-monitor')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reboot tablet' })).toBeTruthy();
  });

  it('keeps restart and reboot in the danger strip, armed visibly, and surfaces reboot API failure', async () => {
    daylightAPI.mockRejectedValueOnce(new Error('server offline'));
    renderDrawer();
    const strip = screen.getByRole('group', { name: 'Recovery' });
    expect(within(strip).getByRole('button', { name: 'Restart piano app' })).toHaveClass('piano-tbtn--danger');
    const reboot = within(strip).getByRole('button', { name: 'Reboot tablet' });
    expect(reboot).toHaveClass('piano-tbtn--danger');
    fireEvent.click(reboot);
    const armed = screen.getByRole('button', { name: 'Tap again to reboot tablet' });
    expect(armed).toHaveAttribute('aria-pressed', 'true');
    await act(async () => { fireEvent.click(armed); });
    expect(daylightAPI).toHaveBeenCalledWith('api/v1/device/tablet-1/reboot', {}, 'POST');
    expect(screen.getByRole('status')).toHaveTextContent('Couldn’t reboot tablet: server offline');
  });

  it('forgets armed tiles, Diagnostics and result lines when the sheet closes', async () => {
    const { rerender } = renderDrawer();
    const closed = () => rerender(<><button type="button">opener</button><OperatorDrawer open={false} onClose={vi.fn()} /></>);
    const opened = () => rerender(<><button type="button">opener</button><OperatorDrawer open onClose={vi.fn()} /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Reboot tablet' }));
    expect(screen.getByRole('button', { name: 'Tap again to reboot tablet' })).toBeTruthy();
    closed(); opened();
    expect(screen.getByRole('button', { name: 'Reboot tablet' })).not.toHaveAttribute('aria-pressed');
    expect(screen.queryByRole('button', { name: 'Tap again to reboot tablet' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stop stuck notes' }));
    expect(screen.getByRole('status')).toHaveTextContent('Stop stuck notes command sent.');
    fireEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
    expect(screen.getByTestId('midi-monitor')).toBeTruthy();
    closed(); opened();
    expect(screen.queryByTestId('midi-monitor')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reboot tablet' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Record feedback' }));
    expect(screen.getByTestId('feedback')).toBeTruthy();
    closed(); opened();
    expect(screen.queryByTestId('feedback')).toBeNull();
  });

  it('keeps feedback adult-only with maintenance context', () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Record feedback' }));
    expect(screen.getByTestId('feedback')).toHaveTextContent('piano-maintenance');
  });
});
